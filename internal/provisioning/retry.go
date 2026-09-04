package provisioning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"

	"console/internal/gitlab"
	"console/internal/observability"
	"console/pkg/models"
)

// maxMergeRetries bounds how many times one order may be rewritten onto a moved
// branch before the portal stops and lets a person look. Retrying is cheap and
// safe (each attempt recomputes everything from Git), but a branch that moves
// faster than the portal can follow is a situation to report, not to chase.
// Counted in memory: a restart is allowed to try again.
const maxMergeRetries = 3

// retryOutcome is what came of one attempt to rewrite a conflicted change.
type retryOutcome int

const (
	// retryNotDone - nothing was attempted or nothing came of it (no fork point
	// on record, files that could not be read, too many attempts already). The
	// caller falls back to announcing a merge it cannot get past.
	retryNotDone retryOutcome = iota
	// retryWithdrawn - both changes moved the same field, so the portal named
	// those fields and took its own change back rather than leave the order
	// holding one that can never merge. The merge request is closed, and the
	// order is free to be changed again.
	retryWithdrawn
	// retryReopened - the change was merged with the branch and reopened. The
	// merge request the order was pointing at is closed; the order now has a new
	// one, and whatever else was about to act on the old one must stand down.
	retryReopened
)

// retryConflictedMR rewrites an order's change on top of the branch as it is
// now, when the only thing standing between them is that the branch has moved.
//
// The change was written against an older state of values.yaml, so Git refuses
// to merge it on the text. The portal, unlike Git, knows this file is a tree of
// fields: it merges the two edits field by field and reopens the change from
// the current branch. A field both sides moved is left to a person - that is a
// real disagreement, not a formatting accident - and the change is taken back so
// the order does not sit behind one nobody can apply.
//
// Everything it needs comes from Git, so an attempt that gets nowhere leaves
// nothing behind and the next tick tries again.
func (s *Service) retryConflictedMR(ctx context.Context, r *models.Request, rec *models.RequestMR) retryOutcome {
	if !s.takeMergeRetry(r.ID) {
		return retryNotDone
	}
	proj, err := s.gl.GetProject(ctx, s.gitops.RepoPath(r.Team, r.ChartName))
	if err != nil {
		s.logger().Debug("merge retry skipped: repo unavailable", "order_id", r.ID, "err", err)
		return retryNotDone
	}
	mr, err := s.gl.GetMR(ctx, rec.GitLabProjectID, rec.MRIID)
	if err != nil {
		s.logger().Debug("merge retry skipped: mr unavailable", "order_id", r.ID, "err", err)
		return retryNotDone
	}
	// Without the fork point there is no base, and a two-way merge would have to
	// guess which side of every difference is the edit. Leave it to a person.
	if mr.DiffRefs.BaseSHA == "" || mr.SourceBranch == "" {
		s.logger().Debug("merge retry skipped: no merge base reported",
			"order_id", r.ID, "mr_iid", rec.MRIID)
		return retryNotDone
	}
	branch := proj.DefaultBranch
	if branch == "" {
		branch = s.defaultBranch
	}

	valuesPath := s.gitops.ValuesPath(r)
	base, err := s.readValues(ctx, proj.ID, valuesPath, mr.DiffRefs.BaseSHA)
	if err != nil {
		s.logger().Debug("merge retry skipped: base values unreadable", "order_id", r.ID, "err", err)
		return retryNotDone
	}
	theirs, err := s.readValues(ctx, proj.ID, valuesPath, branch)
	if err != nil {
		s.logger().Debug("merge retry skipped: branch values unreadable", "order_id", r.ID, "err", err)
		return retryNotDone
	}
	mine, err := s.readValues(ctx, proj.ID, valuesPath, mr.SourceBranch)
	if err != nil {
		s.logger().Debug("merge retry skipped: change values unreadable", "order_id", r.ID, "err", err)
		return retryNotDone
	}

	merged, conflicts := threeWayMerge(base, theirs, mine)
	valuesConflicts := len(conflicts)
	// The chart version lives in application.yaml, not in the values, but it is
	// part of the same change and follows the same rule.
	theirVersion, myVersion := s.chartVersionAt(ctx, proj.ID, r, branch),
		s.chartVersionAt(ctx, proj.ID, r, mr.SourceBranch)
	version, versionConflict := mergeVersion(
		s.chartVersionAt(ctx, proj.ID, r, mr.DiffRefs.BaseSHA), theirVersion, myVersion,
	)
	if versionConflict {
		// Not a values field, so it gets a name of its own rather than a path into
		// the tree. The UI names it in the reader's language.
		conflicts = append(conflicts, models.ValuesConflict{
			Path: models.VersionConflictPath, Theirs: theirVersion, Mine: myVersion,
		})
	}
	if len(conflicts) > 0 {
		set := &models.ValuesConflictSet{
			Conflicts: conflicts, Merged: merged, MergedVersion: version, MRIID: rec.MRIID,
		}
		s.reportMergeConflicts(ctx, r, rec, conflicts)
		s.withdrawMR(ctx, r, rec, set)
		s.markConflictDrift(ctx, r, valuesConflicts > 0, versionConflict, theirVersion)
		return retryWithdrawn
	}
	if version == "" {
		version = r.ChartVersion
	}

	// The merged values are two people's work combined, which neither of them
	// ever submitted as a whole: check them against the chart's schema before
	// committing. A combination the chart refuses is a case for a person.
	valuesYAML, err := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, version, r.Namespace, merged, true, stampOf(r))
	if err != nil {
		s.logger().Warn("merge retry refused: merged values do not validate",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
		return retryNotDone
	}

	prevValues, prevVersion := r.ValuesYAML, r.ChartVersion
	r.ValuesYAML, r.ChartVersion = valuesYAML, version
	appYAML, err := s.gitops.RenderApplication(r, proj.WebURL)
	if err != nil {
		r.ValuesYAML, r.ChartVersion = prevValues, prevVersion
		s.logger().Warn("merge retry refused: application.yaml did not render",
			"order_id", r.ID, "err", err)
		return retryNotDone
	}
	actions := []gitlab.FileAction{
		{Action: "update", FilePath: s.gitops.AppPath(r), Content: appYAML},
		{Action: "update", FilePath: valuesPath, Content: valuesYAML},
	}
	// Opened before the old one is closed: an order momentarily carrying two open
	// merge requests is harmless, losing the change between the two calls is not.
	fresh, err := s.openChange(ctx, r, proj, models.ActionUpdate, actions)
	if err != nil {
		r.ValuesYAML, r.ChartVersion = prevValues, prevVersion
		s.logger().Warn("merge retry failed: could not reopen the change",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
		return retryNotDone
	}
	s.supersedeMR(ctx, r, rec, mr.SourceBranch)
	if err := s.store.UpdateRequest(ctx, r); err != nil {
		// The change is in Git either way; the record catching up is what drift
		// detection would report on next.
		s.logger().Error("merge retry: order not updated after reopening",
			"order_id", r.ID, "mr_iid", fresh.MRIID, "err", err)
	}
	observability.ObserveMRMergeRetried("reopened")
	s.logger().Info("mr merge retried",
		"order_id", r.ID, "mr_iid", rec.MRIID, "new_mr_iid", fresh.MRIID)
	s.eventWith(ctx, r, bySystem(), "merge_retried", r.Status, r.Status, map[string]any{
		"superseded_mr_iid": rec.MRIID,
		"mr_iid":            fresh.MRIID,
	})
	s.publishStatus(r.ID, string(r.Status))
	return retryReopened
}

// reportMergeConflicts records the fields two changes disagree on. Reported
// through the same once-per-reason gate as any other blocked merge, so the
// poller coming back every few seconds does not repeat itself.
//
// Said at once, with none of the waiting the other blocks get: this one is the
// portal's own finding about two versions of a file, not a verdict GitLab is
// still recomputing, so there is nothing to wait for it to change its mind about.
func (s *Service) reportMergeConflicts(ctx context.Context, r *models.Request,
	rec *models.RequestMR, conflicts []models.ValuesConflict) {

	paths := conflictPaths(conflicts)
	if !s.takeMergeBlock(ctx, r, rec, "conflict:"+paths, 0) {
		return
	}
	observability.ObserveMRMergeRetried("conflict")
	s.logger().Warn("mr merge blocked by field conflicts",
		"order_id", r.ID, "mr_iid", rec.MRIID, "fields", paths)
	s.eventWith(ctx, r, bySystem(), "merge_blocked", "", "", map[string]any{
		"reason": "conflict",
		"fields": paths,
	})
	if s.notify != nil {
		s.notify.OrderChangeBlocked(ctx, nil, r, "conflict")
	}
}

// supersedeMR closes the merge request the rewritten change replaces, in GitLab
// and on record, and removes the branch it was opened from. Best-effort: a merge
// request left open is untidy, not broken, and the order now points at the new one.
//
// The branch is only deleted here, where the portal is the one closing the merge
// request and everything that was on the branch has just been carried into the
// new one. A merge request a person turned down keeps its branch: whatever they
// objected to is still written there, and it is not the portal's to throw away.
func (s *Service) supersedeMR(ctx context.Context, r *models.Request, rec *models.RequestMR, branch string) {
	if err := s.gl.CloseMR(ctx, rec.GitLabProjectID, rec.MRIID); err != nil {
		s.logger().Warn("superseded mr not closed in gitlab",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
		return
	}
	if branch != "" {
		if err := s.gl.DeleteBranch(ctx, rec.GitLabProjectID, branch); err != nil {
			s.logger().Warn("superseded mr branch not deleted",
				"order_id", r.ID, "mr_iid", rec.MRIID, "branch", branch, "err", err)
		}
	}
	// It was not refused, it was replaced: nothing is waiting on it any more.
	rec.BlockedReason = ""
	s.markMRClosed(ctx, r, rec)
}

// withdrawMR takes back a change the portal cannot apply and nobody asked it to
// keep proposing: the merge request is closed, and the order stops pointing at
// an open change.
//
// Closing it is the whole point. An order with a change open refuses every next
// one (ErrOpenMR), so a change that can never merge - two people moved the same
// field, and only they can say which value is right - used to leave the service
// unchangeable through the portal until somebody with repository access went and
// closed it by hand.
//
// Nothing is thrown away by it. The branch stays where it is, so the closed
// merge request still carries what was proposed; the portal still holds the same
// values on the order; and the branch really has moved, which is what the drift
// check says next, with the button that pulls it in. What a person loses is a
// change they would have had to redo anyway.
//
// The disagreement itself is written into the event, field by field, with the
// values on both sides and the tree the portal did settle. That is what the
// order page reads to show the two values and let somebody pick between them:
// the paths alone name the fields, they do not carry the choice.
func (s *Service) withdrawMR(ctx context.Context, r *models.Request,
	rec *models.RequestMR, set *models.ValuesConflictSet) {

	if err := s.gl.CloseMR(ctx, rec.GitLabProjectID, rec.MRIID); err != nil {
		// Next tick tries again; until then the order stays as it was.
		s.logger().Warn("conflicted mr not withdrawn",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
		return
	}
	// BlockedReason is left as it is: on a closed merge request it is the record
	// of why it was closed.
	s.markMRClosed(ctx, r, rec)
	// The bound is on chasing one moving branch. This change is over, and the
	// next one starts its own count.
	s.clearMergeRetries(r.ID)
	paths := conflictPaths(set.Conflicts)
	s.logger().Info("conflicted change withdrawn",
		"order_id", r.ID, "mr_iid", rec.MRIID, "fields", paths)
	s.eventWith(ctx, r, bySystem(), "change_withdrawn", "", "", map[string]any{
		"reason":         "conflict",
		"fields":         paths,
		"mr_iid":         rec.MRIID,
		"conflicts":      set.Conflicts,
		"merged":         set.Merged,
		"merged_version": set.MergedVersion,
	})
}

// markConflictDrift writes down, then and there, that Git no longer holds what
// the order says it does.
//
// The drift check would find the same thing on its own within a cycle - two
// sides moved one field, and the portal is holding the side that did not get
// committed - but "within a cycle" is too late for the page a person is looking
// at right now: they are being offered the choice between the two values, and
// the order has to be in the state that lets them act on it.
func (s *Service) markConflictDrift(ctx context.Context, r *models.Request,
	valuesConflict, versionConflict bool, gitVersion string) {

	// Worded exactly as CheckDrift words it, so the reconciler agrees with this
	// on its next pass instead of rewriting it and logging a second finding.
	var reasons []string
	if valuesConflict {
		reasons = append(reasons, "values.yaml изменён в Git")
	}
	if versionConflict {
		reasons = append(reasons,
			fmt.Sprintf("версия чарта в Git: %s (в портале: %s)", gitVersion, r.ChartVersion))
	}
	detail := strings.Join(reasons, "; ")
	if r.Drifted && r.DriftDetail == detail {
		return
	}
	if err := s.store.SetDrift(ctx, r.ID, true, detail); err != nil {
		s.logger().Warn("drift flag not persisted after withdrawing a change",
			"order_id", r.ID, "err", err)
		return
	}
	r.Drifted, r.DriftDetail = true, detail
	s.event(ctx, r, bySystem(), "drift_detected", r.Status, r.Status)
	s.publishStatus(r.ID, string(r.Status))
}

// markMRClosed writes down that a change is no longer open. Best-effort: it is
// closed in GitLab either way, and the next tick reads its state back from there.
func (s *Service) markMRClosed(ctx context.Context, r *models.Request, rec *models.RequestMR) {
	rec.Status = models.MRClosed
	if err := s.store.UpdateMR(ctx, rec); err != nil {
		s.logger().Warn("closed mr state not persisted",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
	}
}

// readValues reads and parses values.yaml at a ref. A missing file reads as an
// empty tree: a change that adds the instance has no base to speak of.
func (s *Service) readValues(ctx context.Context, projectID int, path, ref string) (map[string]any, error) {
	raw, err := s.gl.GetFile(ctx, projectID, path, ref)
	if errors.Is(err, models.ErrNotFound) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := yaml.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("values at %s: %w", ref, err)
	}
	return out, nil
}

// chartVersionAt reads the chart version an order's application.yaml declares at
// a ref, or "" when it cannot be read.
func (s *Service) chartVersionAt(ctx context.Context, projectID int, r *models.Request, ref string) string {
	raw, err := s.gl.GetFile(ctx, projectID, s.gitops.AppPath(r), ref)
	if err != nil {
		return ""
	}
	return chartVersionFromApp(raw)
}

// mergeVersion applies the field rule to a single value: whichever side moved
// wins, both moving the same way is agreement, both moving apart is a conflict.
func mergeVersion(base, theirs, mine string) (string, bool) {
	switch {
	case mine == base:
		return theirs, false
	case theirs == base:
		return mine, false
	case theirs == mine:
		return mine, false
	default:
		return theirs, true
	}
}

// takeMergeRetry reports whether this order may be rewritten again, counting the
// attempt. Bounded so a branch that keeps moving cannot keep the portal
// rewriting the same change forever.
func (s *Service) takeMergeRetry(requestID string) bool {
	s.mergeMu.Lock()
	defer s.mergeMu.Unlock()
	if s.mergeRetries[requestID] >= maxMergeRetries {
		return false
	}
	s.mergeRetries[requestID]++
	return true
}

// clearMergeRetries forgets an order's attempts once one of its changes has
// merged. The bound is on how long the portal chases a branch that keeps moving
// under one change, not on how often an order may ever be edited: without this,
// the fourth conflict in an order's life would be refused because of three
// resolved months earlier.
func (s *Service) clearMergeRetries(requestID string) {
	s.mergeMu.Lock()
	defer s.mergeMu.Unlock()
	delete(s.mergeRetries, requestID)
}

// PendingConflict returns the disagreement an order is still sitting on: the
// last change the portal took back because two sides moved the same fields, so
// long as nothing has happened since to settle it.
//
// It is read off the history rather than kept as a column of its own. The
// withdrawal is already written down there, values and all, and a second copy
// of it on the order would be a second thing to keep true - one that could
// outlive the fact it describes.
//
// Settled means one of two things, and both are somebody deciding: the order
// was pulled from Git (their values won outright), or another change was opened
// on it (the person went and edited it, whatever they typed).
func (s *Service) PendingConflict(ctx context.Context, r *models.Request) *models.ValuesConflictSet {
	if r == nil || r.DeletedAt != nil || r.Status == models.StatusDraft {
		return nil
	}
	evs, err := s.store.ListEvents(ctx, r.ID)
	if err != nil {
		s.logger().Debug("pending conflict unknown: history unreadable", "order_id", r.ID, "err", err)
		return nil
	}
	var set *models.ValuesConflictSet
	for i := len(evs) - 1; i >= 0; i-- {
		e := evs[i]
		if e.EventType == "git_pulled" {
			return nil
		}
		if e.EventType == "change_withdrawn" {
			set = conflictSetFrom(e)
			break
		}
	}
	if set == nil {
		return nil
	}
	mrs, err := s.store.ListMRs(ctx, r.ID)
	if err != nil {
		return nil
	}
	for _, mr := range mrs {
		if mr.CreatedAt.After(set.At) {
			return nil
		}
	}
	return set
}

// conflictSetFrom reads a withdrawal event back into the set the page is served,
// or nil when that event carries no disagreement to show - it was withdrawn for
// some other reason, or it was written by a build that only recorded the field
// names. Re-encoded through JSON on purpose: the payload comes back as a plain
// tree from the database and as the original Go values from the memory store,
// and this is the one reading that works for both.
func conflictSetFrom(e *models.RequestEvent) *models.ValuesConflictSet {
	if e.Payload == nil || e.Payload["reason"] != "conflict" {
		return nil
	}
	raw, err := json.Marshal(e.Payload)
	if err != nil {
		return nil
	}
	var p struct {
		Conflicts     []models.ValuesConflict `json:"conflicts"`
		Merged        map[string]any          `json:"merged"`
		MergedVersion string                  `json:"merged_version"`
		MRIID         int                     `json:"mr_iid"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || len(p.Conflicts) == 0 {
		return nil
	}
	return &models.ValuesConflictSet{
		Conflicts:     p.Conflicts,
		Merged:        p.Merged,
		MergedVersion: p.MergedVersion,
		MRIID:         p.MRIID,
		At:            e.CreatedAt,
	}
}
