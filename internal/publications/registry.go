package publications

import (
	"context"
	"errors"

	"console/pkg/models"
)

// The registry says what exists; this database says what is allowed. Neither
// answers the question a person actually asks - "can I order this?" - and for a
// while nothing put the two together: a chart version deleted from the registry
// went on being offered in the catalog, opened order forms, and could be
// deployed onto orders, because the allowlist row outlived the artifact.
//
// Everything here is the meeting point of the two. Note which way each side
// fails: a version the registry has lost is not orderable, but a registry that
// cannot be reached right now changes nothing. An outage must not empty the
// catalogue - it would look exactly like every service being withdrawn at once.

// inRegistry reports which of a chart's versions the registry still has. The
// second result is false when the registry could not be asked, and callers then
// leave the allowlist alone rather than acting on an answer they do not have.
func (s *Service) inRegistry(ctx context.Context, project, name string) (map[string]bool, bool) {
	if s.schemas == nil {
		return nil, false
	}
	versions, err := s.schemas.ListVersions(ctx, project, name)
	if err != nil {
		// A chart gone entirely reads as "no versions", which is the truth: none
		// of its allowlisted versions can be ordered any more.
		if errors.Is(err, models.ErrNotFound) {
			return map[string]bool{}, true
		}
		s.logger().Debug("registry versions unavailable",
			"chart", name, "chart_project", project, "err", err)
		return nil, false
	}
	out := make(map[string]bool, len(versions))
	for _, v := range versions {
		out[v.Version] = true
	}
	return out, true
}

// availableVersions drops the versions the registry no longer has. An unknown
// registry state (nil) keeps every version, so a registry outage is not read as
// a mass withdrawal.
func availableVersions(versions []*models.PublicationVersion, present map[string]bool) []*models.PublicationVersion {
	if present == nil {
		return versions
	}
	out := make([]*models.PublicationVersion, 0, len(versions))
	for _, v := range versions {
		if present[v.ChartVersion] {
			out = append(out, v)
		}
	}
	return out
}

// presentSet turns a list of version strings (e.g. the chart listing the
// catalogue endpoint already holds) into the shape availableVersions wants.
// A nil list means "not known", not "nothing".
func presentSet(versions []string) map[string]bool {
	if versions == nil {
		return nil
	}
	out := make(map[string]bool, len(versions))
	for _, v := range versions {
		out[v] = true
	}
	return out
}

// RequireInRegistry refuses to put a version forward when the registry no
// longer has it: approving, allowlisting or recommending something that cannot
// be pulled is meaningless, and doing it quietly is how the catalogue came to
// offer versions nobody could deploy.
//
// Only that direction is blocked. Taking a version back - rejecting it,
// withdrawing it from review, removing it from the catalogue - stays allowed,
// or a submission whose chart vanished mid-review would sit in the approval
// queue forever with no move anyone could make. Nothing here writes the loss
// into the database: the version is workable again as soon as it is back.
func (s *Service) RequireInRegistry(ctx context.Context, p *models.ChartPublication, chartVersion string) error {
	present, known := s.inRegistry(ctx, p.ChartProject, p.ChartName)
	if !known || present[chartVersion] {
		return nil
	}
	return conflict("версии %s больше нет в реестре, изменить её не получится", chartVersion)
}
