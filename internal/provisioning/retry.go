package provisioning

import (
	"context"
	"errors"
	"fmt"

	"gopkg.in/yaml.v3"

	"console/internal/gitlab"
	"console/internal/observability"
	"console/pkg/models"
)

// maxMergeRetries bounds how many times one order may be rewritten onto a moved
// branch before the portal stops and lets a person look. Retrying is cheap and
// safe (each attempt recomputes everything from Git), but a branch that moves
// faster than the portal can follow is a situation to report, not to chase.
// Process-local, like the blocked-reason bookkeeping next to it: a restart is
// allowed to try again.
const maxMergeRetries = 3

// retryOutcome is what came of one attempt to rewrite a conflicted change.
type retryOutcome int

const (
	// retryNotDone - nothing was attempted or nothing came of it (no fork point
	// on record, files that could not be read, too many attempts already). The
	// caller falls back to announcing a merge it cannot get past.
	retryNotDone retryOutcome = iota
	// retryReported - both changes moved the same field, so the portal named
	// those fields and left the change where it is.
	retryReported
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
// real disagreement, not a formatting accident.
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
	// The chart version lives in application.yaml, not in the values, but it is
	// part of the same change and follows the same rule.
	version, versionConflict := mergeVersion(
		s.chartVersionAt(ctx, proj.ID, r, mr.DiffRefs.BaseSHA),
		s.chartVersionAt(ctx, proj.ID, r, branch),
		s.chartVersionAt(ctx, proj.ID, r, mr.SourceBranch),
	)
	if versionConflict {
		// Not a values field, so it gets a name of its own rather than a path into
		// the tree. The UI names it in the reader's language.
		conflicts = append(conflicts, mergeConflict{Path: "chartVersion"})
	}
	if len(conflicts) > 0 {
		s.reportMergeConflicts(ctx, r, rec, conflicts)
		return retryReported
	}
	if version == "" {
		version = r.ChartVersion
	}

	// The merged values are two people's work combined, which neither of them
	// ever submitted as a whole: check them against the chart's schema before
	// committing. A combination the chart refuses is a case for a person.
	valuesYAML, err := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, version, r.Namespace, merged, true)
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
	s.supersedeMR(ctx, r, rec)
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
func (s *Service) reportMergeConflicts(ctx context.Context, r *models.Request,
	rec *models.RequestMR, conflicts []mergeConflict) {

	paths := conflictPaths(conflicts)
	s.mergeBlockedMu.Lock()
	seen, ok := s.mergeBlocked[rec.ID]
	s.mergeBlocked[rec.ID] = "conflict:" + paths
	s.mergeBlockedMu.Unlock()
	if ok && seen == "conflict:"+paths {
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
// and on record. Best-effort: a merge request left open is untidy, not broken,
// and the order now points at the new one.
func (s *Service) supersedeMR(ctx context.Context, r *models.Request, rec *models.RequestMR) {
	if err := s.gl.CloseMR(ctx, rec.GitLabProjectID, rec.MRIID); err != nil {
		s.logger().Warn("superseded mr not closed in gitlab",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
		return
	}
	rec.Status = models.MRClosed
	if err := s.store.UpdateMR(ctx, rec); err != nil {
		s.logger().Warn("superseded mr state not persisted",
			"order_id", r.ID, "mr_iid", rec.MRIID, "err", err)
	}
	s.forgetMergeBlocked(rec.ID)
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
	s.mergeBlockedMu.Lock()
	defer s.mergeBlockedMu.Unlock()
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
	s.mergeBlockedMu.Lock()
	defer s.mergeBlockedMu.Unlock()
	delete(s.mergeRetries, requestID)
}
