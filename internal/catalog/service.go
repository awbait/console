// Package catalog serves the chart catalog from Harbor with Redis caching.
package catalog

import (
	"context"
	"time"

	"idp/internal/cache"
	"idp/internal/changelog"
	"idp/internal/harbor"
	"idp/pkg/models"
)

// Service is the catalog domain.
type Service struct {
	hb    harbor.Port
	cache cache.Cache
}

// New builds a catalog service.
func New(hb harbor.Port, c cache.Cache) *Service {
	return &Service{hb: hb, cache: c}
}

// VisibleTo reports whether a chart is allowed for the user (allowlist + admin).
func VisibleTo(c *models.Chart, u *models.User) bool {
	if u != nil && u.IsAdmin() {
		return true
	}
	if len(c.AllowedTeams) == 0 {
		return true
	}
	if u == nil {
		return false
	}
	for _, t := range c.AllowedTeams {
		if u.InTeam(t) {
			return true
		}
	}
	return false
}

// ListCharts returns charts visible to the user.
func (s *Service) ListCharts(ctx context.Context, u *models.User) ([]models.Chart, error) {
	all, err := s.hb.ListCharts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.Chart, 0, len(all))
	for i := range all {
		if VisibleTo(&all[i], u) {
			out = append(out, all[i])
		}
	}
	return out, nil
}

// GetChart returns a chart's details (with version list).
func (s *Service) GetChart(ctx context.Context, project, name string) (*models.Chart, error) {
	return s.hb.GetChart(ctx, project, name)
}

// ListVersions returns the versions of a chart.
func (s *Service) ListVersions(ctx context.Context, project, name string) ([]models.ChartVersion, error) {
	return s.hb.ListVersions(ctx, project, name)
}

// GetVersion returns one version's details.
func (s *Service) GetVersion(ctx context.Context, project, name, version string) (*models.ChartVersion, error) {
	return s.hb.GetVersion(ctx, project, name, version)
}

// blob fetches a per-version file body, cached by content digest for 30 days.
func (s *Service) blob(ctx context.Context, kind, project, name, version string,
	fetch func(ctx context.Context, p, n, v string) ([]byte, error)) ([]byte, error) {

	ver, err := s.hb.GetVersion(ctx, project, name, version)
	if err != nil {
		return nil, err
	}
	key := kind + ":" + ver.Digest
	if b, ok, _ := s.cache.Get(ctx, key); ok {
		return b, nil
	}
	b, err := fetch(ctx, project, name, version)
	if err != nil {
		return nil, err
	}
	_ = s.cache.Set(ctx, key, b, 30*24*time.Hour)
	return b, nil
}

// GetValues returns the chart's values.yaml.
func (s *Service) GetValues(ctx context.Context, project, name, version string) ([]byte, error) {
	return s.blob(ctx, "values", project, name, version, s.hb.GetValues)
}

// GetReadme returns the chart's README.md.
func (s *Service) GetReadme(ctx context.Context, project, name, version string) ([]byte, error) {
	return s.blob(ctx, "readme", project, name, version, s.hb.GetReadme)
}

// GetSchema returns the chart's values.schema.json.
func (s *Service) GetSchema(ctx context.Context, project, name, version string) ([]byte, error) {
	return s.blob(ctx, "schema", project, name, version, s.hb.GetSchema)
}

// GetChangelog returns the parsed changelog entry for the given version.
func (s *Service) GetChangelog(ctx context.Context, project, name, version string) (*models.ChangelogEntry, error) {
	raw, err := s.blob(ctx, "changelog", project, name, version, s.hb.GetChangelog)
	if err != nil {
		return nil, err
	}
	if e := changelog.ParseVersion(raw, version); e != nil {
		return e, nil
	}
	return nil, models.ErrNotFound
}

// GetAggregatedChangelog parses the whole CHANGELOG.md (from the latest version's
// artifact) and returns up to limit entries.
func (s *Service) GetAggregatedChangelog(ctx context.Context, project, name string, limit int) ([]models.ChangelogEntry, error) {
	chart, err := s.hb.GetChart(ctx, project, name)
	if err != nil {
		return nil, err
	}
	if chart.LatestVersion == "" {
		return nil, models.ErrNotFound
	}
	raw, err := s.blob(ctx, "changelog", project, name, chart.LatestVersion, s.hb.GetChangelog)
	if err != nil {
		return nil, err
	}
	entries := changelog.Parse(raw)
	if limit > 0 && len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}
