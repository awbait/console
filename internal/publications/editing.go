package publications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"console/internal/events"
	"console/internal/observability"
	"console/pkg/models"
)

// Edit leases: one person edits a version document at a time.
//
// The constructor saves the document a couple of seconds after every change
// and once more when the page closes. Two people with the same version open
// would therefore overwrite each other silently, and neither would know. So
// the document is leased: the first to open it holds it, renews it while the
// page is open, and everybody else reads. The lease lives in the cache under
// the publication and the chart version, not in Postgres: it is a fact about
// the last minute, and losing it with the cache costs one person a few
// seconds of being able to type.
//
// Save and submit go through the same gate. Somebody else's live lease refuses
// them, a free lease is taken by whoever saves: a save that arrives without a
// lease is the page closing or a lease that lapsed while the laptop slept, and
// losing that text over a formality would be the worse outcome.

// EditLeaseTTL is how long a lease lives without being renewed. The page
// renews every 15-20 seconds, so a closed tab or a sleeping laptop frees the
// document within a minute and nobody has to ask anybody to let go.
const EditLeaseTTL = 60 * time.Second

// EditLockedError is the refusal: somebody else holds the lease. It is a
// conflict (409) that carries who, so the page can say so by name.
type EditLockedError struct {
	Editor models.Editor
}

func (e *EditLockedError) Error() string {
	return fmt.Sprintf("документ редактирует %s", e.Editor.Name)
}

// Is keeps errors.Is(err, models.ErrConflict) true, like the other conflicts
// of this package.
func (e *EditLockedError) Is(target error) bool { return target == models.ErrConflict }

// editKey is the cache key of a version document's lease.
func editKey(pubID, chartVersion string) string {
	return "edit:publication:" + pubID + ":" + chartVersion
}

// VersionTopic is the events topic of one version document: what the pages
// looking at it subscribe to. It carries saves and lease changes, as signals
// only: a subscriber re-reads the version itself.
func VersionTopic(pubID, chartVersion string) string {
	return "version:" + pubID + ":" + chartVersion
}

// editorFor describes u as the holder of a lease taken at now.
func editorFor(u *models.User, now time.Time) models.Editor {
	name := strings.TrimSpace(u.Name)
	if name == "" {
		name = u.Username
	}
	if name == "" {
		name = u.Subject
	}
	return models.Editor{Subject: u.Subject, Name: name, Since: now, Until: now.Add(EditLeaseTTL)}
}

// decodeEditor reads the holder out of a lease payload. A payload that does
// not parse (an older format, a corrupted value) still names the owner, which
// is the part that decides anything.
func decodeEditor(owner string, payload []byte) models.Editor {
	var ed models.Editor
	if err := json.Unmarshal(payload, &ed); err != nil || ed.Subject == "" {
		ed = models.Editor{Subject: owner, Name: owner}
	}
	return ed
}

// AcquireEdit takes the lease on a version document for u, or renews it when
// u already holds it. With force an administrator takes it over whoever holds
// it, for the colleague who left for the day with the tab open. Somebody
// else's live lease is an EditLockedError naming them.
func (s *Service) AcquireEdit(ctx context.Context, u *models.User, pubID, chartVersion string, force bool) (*models.Editor, error) {
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return nil, err
	}
	if !canManage(u, p.OwnerTeam) {
		return nil, ErrForbidden
	}
	if strings.TrimSpace(chartVersion) == "" {
		return nil, invalid("chart_version is required")
	}
	if force && !u.IsAdmin() {
		return nil, ErrForbidden
	}
	if s.leases == nil {
		ed := editorFor(u, s.now())
		return &ed, nil
	}
	return s.acquireEdit(ctx, u, pubID, chartVersion, force)
}

// acquireEdit is AcquireEdit after the checks: the lease itself.
func (s *Service) acquireEdit(ctx context.Context, u *models.User, pubID, chartVersion string, force bool) (*models.Editor, error) {
	key := editKey(pubID, chartVersion)
	now := s.now()
	ed := editorFor(u, now)

	// A renewal keeps the original "since": the banner says how long somebody
	// has been at it, not when they last breathed.
	prev, err := s.leases.Holder(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("edit lease: %w", err)
	}
	ours := prev != nil && prev.Owner == u.Subject
	if ours {
		if before := decodeEditor(prev.Owner, prev.Payload); !before.Since.IsZero() {
			ed.Since = before.Since
		}
	}
	payload, _ := json.Marshal(ed)

	if force {
		if err := s.leases.Seize(ctx, key, u.Subject, payload, EditLeaseTTL); err != nil {
			return nil, fmt.Errorf("edit lease: %w", err)
		}
		if prev != nil && !ours {
			from := decodeEditor(prev.Owner, prev.Payload)
			s.logger().Info("edit lease seized", "publication_id", pubID, "chart_version", chartVersion, "actor", u.Subject, "from", from.Subject)
			observability.ObservePublicationVersionEvent("edit_seized")
		}
		s.publishVersion(pubID, chartVersion, "edit_acquired", map[string]any{"editor": ed})
		return &ed, nil
	}

	held, cur, err := s.leases.Acquire(ctx, key, u.Subject, payload, EditLeaseTTL)
	if err != nil {
		return nil, fmt.Errorf("edit lease: %w", err)
	}
	if !held {
		return nil, &EditLockedError{Editor: decodeEditor(cur.Owner, cur.Payload)}
	}
	if !ours {
		s.logger().Debug("edit lease taken", "publication_id", pubID, "chart_version", chartVersion, "actor", u.Subject)
		s.publishVersion(pubID, chartVersion, "edit_acquired", map[string]any{"editor": ed})
	}
	return &ed, nil
}

// ReleaseEdit hands u's lease on a version document back. A lease nobody
// holds is already released; somebody else's is not u's to release and is an
// EditLockedError.
func (s *Service) ReleaseEdit(ctx context.Context, u *models.User, pubID, chartVersion string) error {
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return err
	}
	if !canManage(u, p.OwnerTeam) {
		return ErrForbidden
	}
	if s.leases == nil {
		return nil
	}
	key := editKey(pubID, chartVersion)
	ok, err := s.leases.Release(ctx, key, u.Subject)
	if err != nil {
		return fmt.Errorf("edit lease: %w", err)
	}
	if ok {
		s.logger().Debug("edit lease released", "publication_id", pubID, "chart_version", chartVersion, "actor", u.Subject)
		s.publishVersion(pubID, chartVersion, "edit_released", map[string]any{"subject": u.Subject})
		return nil
	}
	cur, err := s.leases.Holder(ctx, key)
	if err != nil {
		return fmt.Errorf("edit lease: %w", err)
	}
	if cur != nil && cur.Owner != u.Subject {
		return &EditLockedError{Editor: decodeEditor(cur.Owner, cur.Payload)}
	}
	return nil
}

// Editing reports who holds the lease on a version document, nil when nobody
// does or when leases are not wired.
func (s *Service) Editing(ctx context.Context, pubID, chartVersion string) (*models.Editor, error) {
	if s.leases == nil {
		return nil, nil
	}
	cur, err := s.leases.Holder(ctx, editKey(pubID, chartVersion))
	if err != nil {
		return nil, fmt.Errorf("edit lease: %w", err)
	}
	if cur == nil {
		return nil, nil
	}
	ed := decodeEditor(cur.Owner, cur.Payload)
	return &ed, nil
}

// requireEdit is the gate on save and submit: u must hold the lease, and takes
// it when it is free. Somebody else's lease is the refusal; the caller has
// already checked that u may manage the publication at all.
func (s *Service) requireEdit(ctx context.Context, u *models.User, pubID, chartVersion string) error {
	if s.leases == nil {
		return nil
	}
	_, err := s.acquireEdit(ctx, u, pubID, chartVersion, false)
	var locked *EditLockedError
	if errors.As(err, &locked) {
		s.logger().Info("edit refused: document leased", "publication_id", pubID, "chart_version", chartVersion, "actor", u.Subject, "holder", locked.Editor.Subject)
		observability.ObservePublicationVersionEvent("edit_refused")
	}
	return err
}

// publishVersion announces something about one version document to the pages
// looking at it. Data is a signal, not the document: subscribers re-read.
func (s *Service) publishVersion(pubID, chartVersion, typ string, data map[string]any) {
	if s.bus == nil {
		return
	}
	if data == nil {
		data = map[string]any{}
	}
	data["publication_id"] = pubID
	data["chart_version"] = chartVersion
	s.bus.Publish(events.Event{Topic: VersionTopic(pubID, chartVersion), Type: typ, Data: data})
}
