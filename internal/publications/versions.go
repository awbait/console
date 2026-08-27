package publications

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"console/internal/observability"
	"console/internal/store"
	"console/internal/views"
	"console/pkg/models"
)

// Multi-version publications: a ChartPublication is the service; each published
// chart version is a PublicationVersion with its own view document and approval
// FSM (DRAFT -> PENDING -> APPROVED | REJECTED). orderable is the owner-controlled
// allowlist; recommended_version (on the publication) is the default for new
// orders, with a fall back to the highest orderable+APPROVED version. View
// documents live only here: the publication itself carries no view (the legacy
// single-view columns were dropped, see docs/multi-version-publications.md).

// ListVersions returns all version rows of a publication (oldest first).
func (s *Service) ListVersions(ctx context.Context, pubID string) ([]*models.PublicationVersion, error) {
	if _, err := s.store.GetPublication(ctx, pubID); err != nil {
		return nil, err
	}
	return s.store.ListVersions(ctx, pubID)
}

// SaveVersionView creates or updates the draft view of a chart version. A new
// version row starts in DRAFT; editing a REJECTED version returns it to DRAFT.
// The approved view (if any) keeps serving until the new draft is re-approved.
func (s *Service) SaveVersionView(ctx context.Context, u *models.User, pubID, chartVersion string, view json.RawMessage) (*models.PublicationVersion, error) {
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
	if err := s.RequireInRegistry(ctx, p, chartVersion); err != nil {
		return nil, err
	}
	// A draft may carry schema flaws (the chart schema can drift), but the
	// document format itself must be valid.
	if issues := views.ValidateStructure(view); len(issues) > 0 {
		return nil, &ValidationError{Message: "view.schema.json не проходит валидацию формата", Issues: issues}
	}
	v, err := s.getOrInitVersion(ctx, p, chartVersion)
	if err != nil {
		return nil, err
	}
	// This path does not go through loadManagedVersion (it creates the row when
	// there is none), so it asks about support itself.
	if v.Deprecated() {
		return nil, errDeprecated(v)
	}
	if v.Status == models.PubPending {
		return nil, ErrPendingLocked
	}
	v.ViewJSON = view
	if v.Status == models.PubRejected {
		v.Status = models.PubDraft
	}
	if err := s.store.UpsertVersion(ctx, v); err != nil {
		return nil, err
	}
	s.addEvent(ctx, p.ID, u, "version_updated", "", "", map[string]any{"chart_version": chartVersion})
	return v, nil
}

// SubmitVersion sends a version's draft view for review (-> PENDING).
func (s *Service) SubmitVersion(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.PublicationVersion, error) {
	p, v, err := s.loadManagedVersion(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	if err := s.RequireInRegistry(ctx, p, chartVersion); err != nil {
		return nil, err
	}
	if v.Status == models.PubPending {
		return nil, conflict("версия уже на согласовании")
	}
	if len(v.ViewJSON) == 0 {
		return nil, invalid("нечего отправлять: нет черновика view")
	}
	if issues := s.validateVersionView(ctx, p, chartVersion, v.ViewJSON); len(issues) > 0 {
		return nil, &ValidationError{Message: "view.schema.json не проходит валидацию", Issues: issues}
	}
	from := v.Status
	v.Status = models.PubPending
	if err := s.store.UpsertVersion(ctx, v); err != nil {
		return nil, err
	}
	s.addEvent(ctx, p.ID, u, "version_submitted", from, v.Status, map[string]any{"chart_version": chartVersion})
	// The queue is somebody's work now: the admins hear about it instead of
	// finding out when they next open the approvals page.
	if s.notify != nil {
		s.notify.VersionSubmitted(ctx, nil, p, chartVersion, u)
	}
	observability.ObservePublicationVersionEvent("submitted")
	return v, nil
}

// WithdrawVersion pulls a version back from review for rework (PENDING -> DRAFT).
func (s *Service) WithdrawVersion(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.PublicationVersion, error) {
	p, v, err := s.loadManagedVersion(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	if v.Status != models.PubPending {
		return nil, conflict("версия не находится на согласовании")
	}
	from := v.Status
	v.Status = models.PubDraft
	if err := s.store.UpsertVersion(ctx, v); err != nil {
		return nil, err
	}
	s.addEvent(ctx, p.ID, u, "version_withdrawn", from, v.Status, map[string]any{"chart_version": chartVersion})
	observability.ObservePublicationVersionEvent("withdrawn")
	return v, nil
}

// ApproveVersion (admin): the version's draft view becomes its approved view.
func (s *Service) ApproveVersion(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.PublicationVersion, error) {
	return s.reviewVersion(ctx, u, pubID, chartVersion, models.PubApproved, "")
}

// RejectVersion (admin): the version's draft is rejected with a comment; its
// approved view (if any) keeps serving.
func (s *Service) RejectVersion(ctx context.Context, u *models.User, pubID, chartVersion, comment string) (*models.PublicationVersion, error) {
	return s.reviewVersion(ctx, u, pubID, chartVersion, models.PubRejected, comment)
}

func (s *Service) reviewVersion(ctx context.Context, u *models.User, pubID, chartVersion string, to models.PublicationStatus, comment string) (*models.PublicationVersion, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return nil, err
	}
	v, err := s.store.GetVersion(ctx, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	// Approving publishes the version, so it has to exist; rejecting only clears
	// the submission and stays available whatever the registry says.
	if to == models.PubApproved {
		if err := s.RequireInRegistry(ctx, p, chartVersion); err != nil {
			return nil, err
		}
	}
	// Taking a version out of support withdraws it from review, so a deprecated
	// version in the queue is a race with the owner rather than a decision left
	// to make. Asked here because the review path loads the row itself.
	if v.Deprecated() {
		return nil, errDeprecated(v)
	}
	if v.Status != models.PubPending {
		return nil, conflict("версия не находится на согласовании")
	}
	from := v.Status
	if to == models.PubApproved {
		v.ApprovedViewJSON = v.ViewJSON
		// Snapshot description/icon so the catalog shows approved, not live,
		// data. Best-effort and chart-level (Harbor does not expose per-version
		// Chart.yaml metadata here); a no-op if the source is unavailable.
		if s.schemas != nil {
			if d, err := s.schemas.LatestDescription(ctx, p.ChartProject, p.ChartName); err == nil {
				v.ApprovedDescription = d
			}
			if ic, err := s.schemas.LatestIcon(ctx, p.ChartProject, p.ChartName); err == nil {
				v.ApprovedIconURL = ic
			}
		}
	}
	v.Status = to
	v.ReviewedBy = u.Subject
	v.ReviewComment = comment
	if err := s.store.UpsertVersion(ctx, v); err != nil {
		return nil, err
	}
	event := "version_approved"
	metric := "approved"
	var payload map[string]any
	if to == models.PubRejected {
		event = "version_rejected"
		metric = "rejected"
		payload = map[string]any{"chart_version": chartVersion, "comment": comment}
	} else {
		payload = map[string]any{"chart_version": chartVersion}
	}
	s.addEvent(ctx, p.ID, u, event, from, to, payload)
	// The owning team hears the decision. A rejection carries the reviewer's
	// comment: it is the whole point of the message, and going to look for it is
	// what the notification saves.
	if s.notify != nil {
		if to == models.PubRejected {
			s.notify.VersionRejected(ctx, nil, p, chartVersion, comment, u)
		} else {
			s.notify.VersionApproved(ctx, nil, p, chartVersion, u)
		}
	}
	observability.ObservePublicationVersionEvent(metric)
	s.logger().Debug("publication version review",
		"publication_id", p.ID, "chart", p.ChartName, "chart_version", chartVersion,
		"from", from, "to", to, "actor", u.Subject)
	return v, nil
}

// SetVersionOrderable flips a version's allowlist flag. Only an APPROVED version
// can be made orderable; clearing the flag is always allowed.
func (s *Service) SetVersionOrderable(ctx context.Context, u *models.User, pubID, chartVersion string, orderable bool) (*models.PublicationVersion, error) {
	p, v, err := s.loadManagedVersion(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	if orderable {
		if v.Status != models.PubApproved || len(v.ApprovedViewJSON) == 0 {
			return nil, conflict("включить в каталог можно только согласованную версию")
		}
		// Putting it in the catalog means offering it; taking it out is always
		// allowed, including when the registry has lost it.
		if err := s.RequireInRegistry(ctx, p, chartVersion); err != nil {
			return nil, err
		}
	}
	if v.Orderable == orderable {
		return v, nil // no-op
	}
	if err := s.store.SetOrderable(ctx, v.ID, orderable); err != nil {
		return nil, err
	}
	v.Orderable = orderable
	s.addEvent(ctx, p.ID, u, "version_orderable", "", "", map[string]any{
		"chart_version": chartVersion, "orderable": orderable,
	})
	s.logger().Info("publication version allowlist",
		"publication_id", p.ID, "chart", p.ChartName, "chart_version", chartVersion,
		"orderable", orderable, "actor", u.Subject)
	if orderable {
		observability.ObservePublicationVersionEvent("orderable_on")
	} else {
		observability.ObservePublicationVersionEvent("orderable_off")
	}
	return v, nil
}

// SetRecommendedVersion marks the recommended version for new orders, or clears
// it with an empty chartVersion. A non-empty target must be orderable+APPROVED.
func (s *Service) SetRecommendedVersion(ctx context.Context, u *models.User, pubID, chartVersion string) error {
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return err
	}
	if !canManage(u, p.OwnerTeam) {
		return ErrForbidden
	}
	if chartVersion != "" {
		v, err := s.store.GetVersion(ctx, pubID, chartVersion)
		if err != nil {
			return err
		}
		if err := s.RequireInRegistry(ctx, p, chartVersion); err != nil {
			return err
		}
		if v.Deprecated() {
			return errDeprecated(v)
		}
		if !v.Published() {
			return conflict("рекомендуемой можно сделать только доступную для заказа версию")
		}
	}
	if err := s.store.SetRecommended(ctx, pubID, chartVersion); err != nil {
		return err
	}
	s.addEvent(ctx, p.ID, u, "version_recommended", "", "", map[string]any{"chart_version": chartVersion})
	s.logger().Info("publication version recommended",
		"publication_id", p.ID, "chart", p.ChartName, "chart_version", chartVersion, "actor", u.Subject)
	observability.ObservePublicationVersionEvent("recommended")
	return nil
}

// DeprecateVersion takes a version out of support: it leaves the catalog, gives
// up the recommendation if it held it, and refuses every change until somebody
// puts it back. Orders already running on it are untouched - deprecation closes
// the door on new orders, it does not take a service down.
//
// note is the owner's reason, and it travels: it is in the journal, in the chip
// on every page showing the version, and in the message the teams still running
// it receive. Empty is allowed - a version can simply be old - but the sentence
// those teams read is much better with it.
//
// Only a version that was published at some point can be taken out of support.
// A draft nobody ever approved was never offered to anybody, so there is nothing
// to withdraw: it is deleted or left alone, not deprecated.
func (s *Service) DeprecateVersion(ctx context.Context, u *models.User, pubID, chartVersion, note string) (*models.PublicationVersion, error) {
	p, v, err := s.loadVersionToManage(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	if v.Deprecated() {
		return nil, conflict("Версия %s уже снята с поддержки.", chartVersion)
	}
	if len(v.ApprovedViewJSON) == 0 {
		return nil, conflict("Снять с поддержки можно только версию, которая была согласована.")
	}
	note = strings.TrimSpace(note)

	// A version waiting in the admin's queue leaves it in the same move. Without
	// this the queue keeps offering a decision on something already buried, and
	// approving it would put a deprecated version back in the catalog.
	withdrawn := v.Status == models.PubPending
	// The mark, the catalog flag, the review status and the recommendation are
	// one decision and are written as one: a failure halfway through must not
	// leave a version that is out of the catalog but not out of support, or the
	// service recommending something nobody can order.
	at := time.Now()
	clearRecommended := p.RecommendedVersion == chartVersion
	if err := s.store.Tx(ctx, func(tx store.Store) error {
		if withdrawn {
			v.Status = models.PubDraft
			if err := tx.UpsertVersion(ctx, v); err != nil {
				return err
			}
		}
		if v.Orderable {
			if err := tx.SetOrderable(ctx, v.ID, false); err != nil {
				return err
			}
			v.Orderable = false
		}
		if err := tx.SetDeprecated(ctx, v.ID, &at, u.Subject, note); err != nil {
			return err
		}
		// The owner's explicit pick is cleared rather than moved: with it empty
		// the recommendation falls to the highest orderable version by the rule
		// in models.ChartPublication, which is the same answer and one that stays
		// right as versions come and go.
		if clearRecommended {
			if err := tx.SetRecommended(ctx, p.ID, ""); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	v.DeprecatedAt, v.DeprecatedBy, v.DeprecationNote = &at, u.Subject, note
	if clearRecommended {
		p.RecommendedVersion = ""
	}

	payload := map[string]any{"chart_version": chartVersion}
	if note != "" {
		payload["note"] = note
	}
	if withdrawn {
		payload["withdrawn"] = true // it was in the approval queue
	}
	s.addEvent(ctx, p.ID, u, "version_deprecated", "", "", payload)
	s.logger().Info("publication version deprecated",
		"publication_id", p.ID, "chart", p.ChartName, "chart_version", chartVersion,
		"actor", u.Subject)
	observability.ObservePublicationVersionEvent("deprecated")
	s.notifyDeprecated(ctx, p, v, u)
	return v, nil
}

// UndeprecateVersion puts a version back in support. The approval status it had
// is what it goes back to - deprecation only ever moved it out of the review
// queue, and that move cannot be undone by guessing. It does not go back into
// the catalog by itself either: offering a version again is a decision, and the
// owner makes it with the catalog switch.
func (s *Service) UndeprecateVersion(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.PublicationVersion, error) {
	p, v, err := s.loadVersionToManage(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, err
	}
	if !v.Deprecated() {
		return nil, conflict("Версия %s и так на поддержке.", chartVersion)
	}
	if err := s.store.SetDeprecated(ctx, v.ID, nil, "", ""); err != nil {
		return nil, err
	}
	v.DeprecatedAt, v.DeprecatedBy, v.DeprecationNote = nil, "", ""
	s.addEvent(ctx, p.ID, u, "version_undeprecated", "", "", map[string]any{"chart_version": chartVersion})
	s.logger().Info("publication version undeprecated",
		"publication_id", p.ID, "chart", p.ChartName, "chart_version", chartVersion,
		"actor", u.Subject)
	observability.ObservePublicationVersionEvent("undeprecated")
	return v, nil
}

// notifyDeprecated tells the teams still running the version that it is out of
// support, and what to move to. Addressed by who has an order on it rather than
// to everybody: a team that never ordered this service cannot act on the news,
// and a bell that rings for them is a bell they learn to ignore.
//
// Best effort throughout: a version leaves support whether or not the message
// goes out, so a failure to work out the audience is logged and dropped.
func (s *Service) notifyDeprecated(ctx context.Context, p *models.ChartPublication, v *models.PublicationVersion, u *models.User) {
	if s.notify == nil {
		return
	}
	teams, err := s.teamsRunning(ctx, p, v.ChartVersion)
	if err != nil {
		s.logger().Warn("deprecation audience", "publication_id", p.ID,
			"chart", p.ChartName, "chart_version", v.ChartVersion, "err", err)
		return
	}
	if len(teams) == 0 {
		return // nobody is running it, so there is nobody to tell
	}
	// Where to go instead: whatever the service recommends now, worked out after
	// the version left the catalog. Empty when the service has nothing orderable
	// left, and the message then simply does not name a replacement.
	moveTo := ""
	if versions, err := s.store.ListVersions(ctx, p.ID); err == nil {
		if next := resolveOrderableVersion(p, versions, ""); next != nil {
			moveTo = next.ChartVersion
		}
	}
	s.notify.VersionDeprecated(ctx, nil, p, v.ChartVersion, v.DeprecationNote, moveTo, teams, u)
}

// teamsRunning lists the teams holding a live order on one version of a chart,
// in a stable order.
func (s *Service) teamsRunning(ctx context.Context, p *models.ChartPublication, chartVersion string) ([]string, error) {
	// Admin: the audience is every team that ordered it, not the teams of
	// whoever pressed the button.
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Chart: p.ChartName})
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var teams []string
	for _, r := range orders {
		if r.ChartProject != p.ChartProject || r.ChartVersion != chartVersion || r.Team == "" {
			continue
		}
		if seen[r.Team] {
			continue
		}
		seen[r.Team] = true
		teams = append(teams, r.Team)
	}
	sort.Strings(teams)
	return teams, nil
}

// PendingVersion is a version awaiting review together with its publication.
type PendingVersion struct {
	Publication *models.ChartPublication   `json:"publication"`
	Version     *models.PublicationVersion `json:"version"`
}

// PendingVersions returns every PENDING version across all publications (the
// admin approval queue for per-version submissions).
func (s *Service) PendingVersions(ctx context.Context) ([]PendingVersion, error) {
	pubs, err := s.store.ListPublications(ctx, store.PublicationFilter{})
	if err != nil {
		return nil, err
	}
	var out []PendingVersion
	for _, p := range pubs {
		vs, err := s.store.ListVersions(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		// A submission whose chart version has since been deleted is not a
		// decision anyone can make: approving it would publish something that
		// cannot be pulled. It leaves the queue rather than sitting in it, and
		// comes back by itself if the version does. The owner still sees it on the
		// chart's page, where it can be withdrawn.
		present, known := s.inRegistry(ctx, p.ChartProject, p.ChartName)
		for _, v := range vs {
			if v.Status != models.PubPending {
				continue
			}
			// Deprecation withdraws a version from review, so this cannot normally
			// happen - but the queue is what an admin acts on, and it must never
			// offer a decision that the version's own routes would refuse.
			if v.Deprecated() {
				continue
			}
			if known && !present[v.ChartVersion] {
				continue
			}
			out = append(out, PendingVersion{Publication: p, Version: v})
		}
	}
	return out, nil
}

// ValidateVersionView runs a full validation of a draft view against a specific
// chart version's schema (the live builder check). Returns the list of problems
// (empty = valid), not an error.
func (s *Service) ValidateVersionView(ctx context.Context, pubID, chartVersion string, view json.RawMessage) ([]views.Issue, error) {
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return nil, err
	}
	return s.validateVersionView(ctx, p, chartVersion, view), nil
}

// CatalogView is what the catalog needs to know about a publication's versions.
type CatalogView struct {
	// Recommended is the version served by default - its description/icon
	// snapshots feed the catalog card. Nil when nothing is orderable yet.
	Recommended *models.PublicationVersion
	// Orderable is every orderable+APPROVED version, highest first (the card's
	// main chip and its "+N").
	Orderable []string
	// Gone names the versions a person did approve for the catalog that the
	// registry has since lost. They are not orderable; the owner and the admin
	// need them said out loud, or a service whose version was deleted is
	// indistinguishable from one nobody has published yet.
	Gone []string
	// Deprecated is the versions the owner has taken out of support, highest
	// first. Nothing offers them either, but for a different reason and to a
	// different audience: somebody may still be running one, and the interface
	// has to be able to say so on their order - with the date and the reason,
	// which is why these are the rows and not just the numbers.
	Deprecated []*models.PublicationVersion
}

// CatalogVersions projects a publication's versions for the catalog.
// inRegistry lists the chart versions the registry currently holds, so a
// version the allowlist still names but the registry has lost is not offered.
// Pass nil when that is not known (a registry outage) and the allowlist is used
// as it stands.
func (s *Service) CatalogVersions(ctx context.Context, p *models.ChartPublication, inRegistry []string) (CatalogView, error) {
	versions, err := s.store.ListVersions(ctx, p.ID)
	if err != nil {
		return CatalogView{}, err
	}
	var out CatalogView
	present := presentSet(inRegistry)
	for _, v := range versions {
		if v.Published() && present != nil && !present[v.ChartVersion] {
			out.Gone = append(out.Gone, v.ChartVersion)
		}
		// Support is the owner's word about the version, so it is reported
		// whatever the registry currently holds.
		if v.Deprecated() {
			out.Deprecated = append(out.Deprecated, v)
		}
	}
	sort.Slice(out.Gone, func(i, j int) bool {
		return models.CompareChartVersions(out.Gone[i], out.Gone[j]) > 0
	})
	sort.Slice(out.Deprecated, func(i, j int) bool {
		return models.CompareChartVersions(out.Deprecated[i].ChartVersion, out.Deprecated[j].ChartVersion) > 0
	})
	versions = availableVersions(versions, present)
	pub := make([]*models.PublicationVersion, 0, len(versions))
	for _, v := range versions {
		if v.Published() {
			pub = append(pub, v)
		}
	}
	sort.Slice(pub, func(i, j int) bool {
		return models.CompareChartVersions(pub[i].ChartVersion, pub[j].ChartVersion) > 0 // highest first
	})
	out.Orderable = make([]string, len(pub))
	for i, v := range pub {
		out.Orderable[i] = v.ChartVersion
	}
	out.Recommended = resolveOrderableVersion(p, versions, "")
	return out, nil
}

// ActiveViewVersion returns the approved view of an orderable version (for order
// forms). An empty chartVersion resolves the recommended version, falling back
// to the highest orderable+APPROVED one.
func (s *Service) ActiveViewVersion(ctx context.Context, project, name, chartVersion string) (json.RawMessage, error) {
	p, err := s.store.GetPublicationByChart(ctx, project, name)
	if err != nil {
		return nil, err
	}
	versions, err := s.store.ListVersions(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	// An order form is the start of a deployment, so it only opens on a version
	// that can actually be pulled. Without this the form opens, is filled in, and
	// the order is refused at the end - or worse, goes through onto nothing.
	present, _ := s.inRegistry(ctx, project, name)
	v := resolveOrderableVersion(p, availableVersions(versions, present), chartVersion)
	if v == nil {
		return nil, models.ErrNotFound
	}
	return v.ApprovedViewJSON, nil
}

// resolveOrderableVersion picks the version to serve: the requested one if it is
// orderable+APPROVED; otherwise (empty request) the recommended version, falling
// back to the highest orderable+APPROVED version. Returns nil if none qualifies.
func resolveOrderableVersion(p *models.ChartPublication, versions []*models.PublicationVersion, requested string) *models.PublicationVersion {
	published := make([]*models.PublicationVersion, 0, len(versions))
	for _, v := range versions {
		if v.Published() {
			published = append(published, v)
		}
	}
	if len(published) == 0 {
		return nil
	}
	if requested != "" {
		for _, v := range published {
			if v.ChartVersion == requested {
				return v
			}
		}
		return nil
	}
	if p.RecommendedVersion != "" {
		for _, v := range published {
			if v.ChartVersion == p.RecommendedVersion {
				return v
			}
		}
	}
	// Fall back to the highest orderable+APPROVED version.
	sort.Slice(published, func(i, j int) bool {
		return models.CompareChartVersions(published[i].ChartVersion, published[j].ChartVersion) < 0
	})
	return published[len(published)-1]
}

// --- helpers ---

// getOrInitVersion returns the stored version row, or a fresh DRAFT one (with a
// new ID) when (publication, chart_version) does not exist yet.
func (s *Service) getOrInitVersion(ctx context.Context, p *models.ChartPublication, chartVersion string) (*models.PublicationVersion, error) {
	v, err := s.store.GetVersion(ctx, p.ID, chartVersion)
	if err == nil {
		return v, nil
	}
	if !errors.Is(err, models.ErrNotFound) {
		return nil, err
	}
	return &models.PublicationVersion{
		ID:            newID(),
		PublicationID: p.ID,
		ChartVersion:  chartVersion,
		Status:        models.PubDraft,
	}, nil
}

// loadManagedVersion loads a publication and one of its existing versions,
// enforcing manage rights. Whether the registry still has the version is a
// separate question, asked only by the calls that would put it forward (see
// RequireInRegistry): withdrawing one has to keep working, or a version that
// vanished mid-review could never be cleared.
//
// A version its owner has taken out of support is refused here, which is what
// makes "снята с поддержки" mean the same thing on every route: submitting,
// reviewing, putting it in the catalog and recommending it all end at this
// call. The only way past it is UndeprecateVersion.
func (s *Service) loadManagedVersion(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.ChartPublication, *models.PublicationVersion, error) {
	p, v, err := s.loadVersionToManage(ctx, u, pubID, chartVersion)
	if err != nil {
		return nil, nil, err
	}
	if v.Deprecated() {
		return nil, nil, errDeprecated(v)
	}
	return p, v, nil
}

// loadVersionToManage is loadManagedVersion without the support check: only the
// two calls that change support itself may use it.
func (s *Service) loadVersionToManage(ctx context.Context, u *models.User, pubID, chartVersion string) (*models.ChartPublication, *models.PublicationVersion, error) {
	p, err := s.store.GetPublication(ctx, pubID)
	if err != nil {
		return nil, nil, err
	}
	if !canManage(u, p.OwnerTeam) {
		return nil, nil, ErrForbidden
	}
	v, err := s.store.GetVersion(ctx, pubID, chartVersion)
	if err != nil {
		return nil, nil, err
	}
	return p, v, nil
}

// errDeprecated is the one refusal every operation on an unsupported version
// gives, so a person meets the same sentence wherever they run into it.
func errDeprecated(v *models.PublicationVersion) error {
	return conflict("Версия %s снята с поддержки. Верните её в работу, чтобы изменить.", v.ChartVersion)
}

// validateVersionView cross-validates a view against that chart version's schema;
// if the schema is unavailable, only the structure is checked.
func (s *Service) validateVersionView(ctx context.Context, p *models.ChartPublication, chartVersion string, view json.RawMessage) []views.Issue {
	var schema []byte
	if s.schemas != nil {
		if b, err := s.schemas.GetSchema(ctx, p.ChartProject, p.ChartName, chartVersion); err == nil {
			schema = b
		}
	}
	return views.Validate(view, schema)
}

