package publications

import (
	"context"
	"sort"
	"time"

	"console/internal/store"
	"console/pkg/models"
)

// The admin's registry of publications (issue #470): every publication with
// what the admin's list has to say about it in one row, instead of the page
// stitching it together from the publication list, every publication's
// versions and the catalog.

// Submission is who put something forward for a decision and when, read from
// the event journal.
type Submission struct {
	// By is the OIDC subject of the person, ByName what the portal knows them
	// as (the subject itself when the user directory has no record of them).
	By     string    `json:"by"`
	ByName string    `json:"by_name"`
	At     time.Time `json:"at"`
}

// Event types the journal records a submission under (see addEvent callers).
const (
	eventSubmitted        = "submitted"         // the publication's category and owner
	eventVersionSubmitted = "version_submitted" // one version's view document
)

// Issue codes of a registry row: what is wrong with a publication, said by the
// server so the admin's list and the duty board never disagree on it. The
// interface puts words to the codes.
const (
	// IssueChartMissing: the registry no longer has the chart at all.
	IssueChartMissing = "chart_missing"
	// IssueGone: versions approved for the catalog that the registry has lost.
	IssueGone = "gone"
	// IssueNoOwner: a chart auto-discovery found and nobody has claimed.
	IssueNoOwner = "no_owner"
	// IssueNoOrderForm: no version carries a view document, draft or approved,
	// so there is nothing to review and nothing to order.
	IssueNoOrderForm = "no_order_form"
	// IssueNotOrderable: approved, and still nothing to order - every approved
	// version is off the allowlist or out of support.
	IssueNotOrderable = "not_orderable"
	// IssueDeprecated: some versions are out of support while orders may still
	// run on them.
	IssueDeprecated = "deprecated"
)

// VersionSummary counts a publication's versions the way the registry row
// shows them: how many, in which states, and which one an order gets.
type VersionSummary struct {
	Total      int `json:"total"`
	Approved   int `json:"approved"`
	Pending    int `json:"pending"`
	Draft      int `json:"draft"`
	Rejected   int `json:"rejected"`
	Deprecated int `json:"deprecated"`
	Gone       int `json:"gone"`
	// Orderable is what the catalog offers, highest first; Recommended the one
	// an order gets by default. Both as the catalog computes them.
	Orderable   []string `json:"orderable"`
	Recommended string   `json:"recommended,omitempty"`
}

// RegistryRow is one publication as the admin's registry lists it.
type RegistryRow struct {
	Publication *models.ChartPublication `json:"publication"`
	Versions    VersionSummary           `json:"versions"`
	// Issues are the Issue* codes that apply, worst first. Empty, not nil,
	// when nothing is wrong.
	Issues []string `json:"issues"`
	// Submitted is who proposed the category and owner now waiting for a
	// decision. Nil unless the publication's metadata is under review.
	Submitted *Submission `json:"submitted,omitempty"`
}

// Registry lists every publication for the admin's registry page.
func (s *Service) Registry(ctx context.Context) ([]RegistryRow, error) {
	pubs, err := s.store.ListPublications(ctx, store.PublicationFilter{})
	if err != nil {
		return nil, err
	}
	names := s.userNames(ctx)
	rows := make([]RegistryRow, 0, len(pubs))
	for _, p := range pubs {
		vs, err := s.store.ListVersions(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		p.EffectiveStatus = models.DeriveStatus(p, vs)
		p.Adoptable = s.adoptable(p, vs)
		present, known := s.inRegistry(ctx, p.ChartProject, p.ChartName)
		cv := catalogView(p, vs, present)
		if cv.Recommended != nil {
			p.RecommendedVersion = cv.Recommended.ChartVersion
		} else {
			p.RecommendedVersion = ""
		}
		row := RegistryRow{
			Publication: p,
			Versions:    summarizeVersions(vs, cv),
			Issues:      registryIssues(p, vs, cv, known && len(present) == 0),
		}
		if p.Status == models.PubPending {
			row.Submitted = submissionOf(s.journal(ctx, p.ID), eventSubmitted, "", names)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func summarizeVersions(vs []*models.PublicationVersion, cv CatalogView) VersionSummary {
	sum := VersionSummary{
		Total:      len(vs),
		Deprecated: len(cv.Deprecated),
		Gone:       len(cv.Gone),
		Orderable:  cv.Orderable,
	}
	if sum.Orderable == nil {
		sum.Orderable = []string{}
	}
	if cv.Recommended != nil {
		sum.Recommended = cv.Recommended.ChartVersion
	}
	for _, v := range vs {
		switch v.Status {
		case models.PubApproved:
			sum.Approved++
		case models.PubPending:
			sum.Pending++
		case models.PubDraft:
			sum.Draft++
		case models.PubRejected:
			sum.Rejected++
		}
	}
	return sum
}

// registryIssues decides which Issue* codes a publication carries, worst
// first. chartMissing says the registry answered and has no version of the
// chart at all; it stands in for the gone versions it implies.
func registryIssues(p *models.ChartPublication, vs []*models.PublicationVersion, cv CatalogView, chartMissing bool) []string {
	issues := []string{}
	switch {
	case chartMissing:
		issues = append(issues, IssueChartMissing)
	case len(cv.Gone) > 0:
		issues = append(issues, IssueGone)
	}
	if p.Adoptable {
		issues = append(issues, IssueNoOwner)
	}
	hasView := false
	for _, v := range vs {
		if len(v.ViewJSON) > 0 || len(v.ApprovedViewJSON) > 0 {
			hasView = true
			break
		}
	}
	if !hasView {
		issues = append(issues, IssueNoOrderForm)
	}
	// Approved and nothing to order is a problem only when the registry does
	// not already explain it: a lost chart or version is reported above.
	if p.EffectiveStatus == models.PubApproved && len(cv.Orderable) == 0 && !chartMissing && len(cv.Gone) == 0 {
		issues = append(issues, IssueNotOrderable)
	}
	if len(cv.Deprecated) > 0 {
		issues = append(issues, IssueDeprecated)
	}
	return issues
}

// journal is the publication's event log, oldest first. A journal that cannot
// be read leaves the submission unknown rather than failing the list: who
// asked is context, not the decision.
func (s *Service) journal(ctx context.Context, pubID string) []*models.PublicationEvent {
	events, err := s.store.ListPublicationEvents(ctx, pubID)
	if err != nil {
		s.logger().Debug("publication journal unavailable", "publication_id", pubID, "err", err)
		return []*models.PublicationEvent{}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].CreatedAt.Before(events[j].CreatedAt) })
	return events
}

// submissionOf finds the latest submission event of the kind in the journal.
// chartVersion narrows a version submission to one version; empty matches the
// publication's own metadata submission.
func submissionOf(journal []*models.PublicationEvent, kind, chartVersion string, names map[string]string) *Submission {
	for i := len(journal) - 1; i >= 0; i-- {
		e := journal[i]
		if e.EventType != kind {
			continue
		}
		if chartVersion != "" {
			if v, _ := e.Payload["chart_version"].(string); v != chartVersion {
				continue
			}
		}
		name := names[e.Actor]
		if name == "" {
			name = e.Actor
		}
		return &Submission{By: e.Actor, ByName: name, At: e.CreatedAt}
	}
	return nil
}

// userNames maps OIDC subjects to display names from the user directory. The
// journal records subjects only, and a queue that names "sub-7f3a" names
// nobody. A directory that cannot be read gives an empty map: the subject is
// shown as it is.
func (s *Service) userNames(ctx context.Context) map[string]string {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		s.logger().Debug("user directory unavailable", "err", err)
		return map[string]string{}
	}
	names := make(map[string]string, len(users))
	for _, u := range users {
		if u.Name != "" {
			names[u.Subject] = u.Name
		}
	}
	return names
}
