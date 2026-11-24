package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"console/internal/api"
	"console/internal/catalog"
	"console/pkg/models"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) registerCatalogTools(srv *sdkmcp.Server) {
	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "whoami",
		Description: "Return the authenticated Console user (subject, name, role, teams), platform capability health, and whether write MCP tools are enabled.",
		Annotations: readOnlyAnnotations("Current User & Platform Health"),
	}, s.toolWhoami)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "list_stands",
		Description: "List available deployment stands (id, name, default cluster, delivery mode, git layout, Argo CD connection status).",
		Annotations: readOnlyAnnotations("List Stands"),
	}, s.toolListStands)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "list_catalog",
		Description: "List categories and Helm charts visible to the caller, with publication status and orderable, recommended, and deprecated versions.",
		Annotations: readOnlyAnnotations("List Service Catalog"),
	}, s.toolListCatalog)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "get_chart_version",
		Description: "Inspect a chart version: metadata, README, values.yaml, effective JSON schema (including dependencies), merged chart defaults, approved view document, and prefilled initial order values.",
		Annotations: readOnlyAnnotations("Get Chart Version Details"),
	}, s.toolGetChartVersion)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "get_chart_changelog",
		Description: "Read the changelog for one chart version or an aggregated changelog across recent versions.",
		Annotations: readOnlyAnnotations("Get Chart Changelog"),
	}, s.toolGetChartChangelog)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "check_chart",
		Description: "Check whether a Harbor chart at an arbitrary project/name path exists and which standard files its latest version provides.",
		Annotations: readOnlyAnnotations("Check Harbor Chart Path"),
	}, s.toolCheckChart)
}

type emptyArgs struct{}

func (s *Server) toolWhoami(ctx context.Context, _ *sdkmcp.CallToolRequest, _ emptyArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "whoami", true, func(ctx context.Context, u *models.User) (any, error) {
		return map[string]any{
			"user":            u,
			"platform_health": s.API.PlatformHealthSnapshot(ctx),
			"write_enabled":   s.WriteEnabled,
			"public_url":      s.PublicURL,
		}, nil
	})
}

func (s *Server) toolListStands(ctx context.Context, _ *sdkmcp.CallToolRequest, _ emptyArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "list_stands", false, func(ctx context.Context, _ *models.User) (any, error) {
		stands, err := s.API.Prov.ListStands(ctx)
		if err != nil {
			return nil, err
		}
		if stands == nil {
			stands = []*models.Stand{}
		}
		return map[string]any{"stands": stands}, nil
	})
}

type listCatalogArgs struct {
	Category      string `json:"category,omitempty" jsonschema:"Filter charts by category ID"`
	Search        string `json:"search,omitempty" jsonschema:"Case-insensitive substring filter on chart path or description"`
	PublishedOnly bool   `json:"published_only,omitempty" jsonschema:"Return only charts with at least one orderable published version"`
	Limit         int    `json:"limit,omitempty" jsonschema:"Maximum number of charts to return (default 50, max 200)"`
	Offset        int    `json:"offset,omitempty" jsonschema:"Number of charts to skip for pagination"`
}

type compactCatalogChart struct {
	Chart              string                  `json:"chart"`
	Description        string                  `json:"description,omitempty"`
	Versions           []string                `json:"versions,omitempty"`
	CategoryID         string                  `json:"category_id,omitempty"`
	OwnerTeam          string                  `json:"owner_team,omitempty"`
	PublicationID      string                  `json:"publication_id,omitempty"`
	PublicationStatus  string                  `json:"publication_status,omitempty"`
	Published          bool                    `json:"published"`
	RecommendedVersion string                  `json:"recommended_version,omitempty"`
	OrderableVersions  []string                `json:"orderable_versions,omitempty"`
	DeprecatedVersions []api.DeprecatedVersion `json:"deprecated_versions,omitempty"`
	Missing            bool                    `json:"missing,omitempty"`
}

func (s *Server) toolListCatalog(ctx context.Context, _ *sdkmcp.CallToolRequest, in listCatalogArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "list_catalog", false, func(ctx context.Context, u *models.User) (any, error) {
		ov, err := s.API.CatalogSnapshot(ctx, u)
		if err != nil {
			return nil, err
		}
		q := strings.ToLower(strings.TrimSpace(in.Search))
		filtered := make([]compactCatalogChart, 0, len(ov.Charts))
		for _, c := range ov.Charts {
			pub := c.Publication
			if in.PublishedOnly && (pub == nil || !pub.Published) {
				continue
			}
			if in.Category != "" && (pub == nil || pub.CategoryID != in.Category) {
				continue
			}
			desc := c.Description
			if pub != nil && pub.ApprovedDescription != "" {
				desc = pub.ApprovedDescription
			}
			path := c.Project + "/" + c.Name
			if q != "" && !strings.Contains(strings.ToLower(path), q) && !strings.Contains(strings.ToLower(desc), q) {
				continue
			}
			item := compactCatalogChart{
				Chart:       path,
				Description: desc,
				Versions:    c.Versions,
				Missing:     c.Missing,
			}
			if pub != nil {
				item.CategoryID = pub.CategoryID
				item.OwnerTeam = pub.OwnerTeam
				item.PublicationID = pub.ID
				item.PublicationStatus = string(pub.Status)
				item.Published = pub.Published
				item.RecommendedVersion = pub.RecommendedVersion
				item.OrderableVersions = pub.OrderableVersions
				item.DeprecatedVersions = pub.DeprecatedVersions
			}
			filtered = append(filtered, item)
		}

		total := len(filtered)
		offset := max(in.Offset, 0)
		limit := clampLimit(in.Limit, 50, 200)
		if offset > total {
			offset = total
		}
		end := min(offset+limit, total)
		return map[string]any{
			"categories": ov.Categories,
			"charts":     filtered[offset:end],
			"total":      total,
			"has_more":   end < total,
		}, nil
	})
}

type getChartVersionArgs struct {
	Chart          string `json:"chart" jsonschema:"Chart path in project/name form, e.g. platform/postgres"`
	Version        string `json:"version,omitempty" jsonschema:"Chart version; defaults to recommended or latest version"`
	Team           string `json:"team,omitempty" jsonschema:"Team name used to render initial order values"`
	StandID        string `json:"stand_id,omitempty" jsonschema:"Stand ID used to render stand-scoped initial order values"`
	IncludeReadme  *bool  `json:"include_readme,omitempty" jsonschema:"Include chart README.md (default true)"`
	IncludeValues  *bool  `json:"include_values,omitempty" jsonschema:"Include chart values.yaml (default true)"`
	IncludeSchema  *bool  `json:"include_schema,omitempty" jsonschema:"Include effective JSON schema and merged defaults (default true)"`
	IncludeView    *bool  `json:"include_view,omitempty" jsonschema:"Include approved order view document (default true)"`
	IncludeInitial *bool  `json:"include_initial,omitempty" jsonschema:"Include rendered initial order values for team/stand (default true)"`
}

func defaultTrue(p *bool) bool { return p == nil || *p }

func (s *Server) toolGetChartVersion(ctx context.Context, _ *sdkmcp.CallToolRequest, in getChartVersionArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_chart_version", false, func(ctx context.Context, u *models.User) (any, error) {
		project, name, err := parseChartPath(in.Chart)
		if err != nil {
			return nil, err
		}
		ch, err := s.API.Catalog.Authorize(ctx, u, project, name)
		if err != nil {
			return nil, err
		}
		version := strings.TrimSpace(in.Version)
		if version == "" {
			if len(ch.Versions) == 0 {
				return nil, models.ErrNotFound
			}
			version = ch.Versions[0]
		}
		ver, err := s.API.Catalog.GetVersion(ctx, project, name, version)
		if err != nil {
			return nil, err
		}

		res := map[string]any{
			"chart":   project + "/" + name,
			"version": ver,
		}
		if defaultTrue(in.IncludeReadme) {
			if b, rerr := s.API.Catalog.GetReadme(ctx, project, name, version); rerr == nil {
				text, trunc := truncateText(string(b), maxTextBytes)
				res["readme"] = text
				if trunc {
					res["readme_truncated"] = true
				}
			}
		}
		if defaultTrue(in.IncludeValues) {
			if b, verr := s.API.Catalog.GetValues(ctx, project, name, version); verr == nil {
				text, trunc := truncateText(string(b), maxTextBytes)
				res["values_yaml"] = text
				if trunc {
					res["values_truncated"] = true
				}
			}
		}
		if defaultTrue(in.IncludeSchema) {
			schema, deps, serr := s.API.Catalog.FormSchema(ctx, project, name, version)
			if serr != nil && !errors.Is(serr, models.ErrNotFound) {
				return nil, serr
			}
			if len(schema) > 0 {
				res["effective_schema"] = json.RawMessage(schema)
			}
			if len(deps) > 0 {
				res["dependencies"] = deps
			}
			res["defaults"] = s.API.Catalog.ValuesForValidation(ctx, project, name, version, map[string]any{})
		}
		if defaultTrue(in.IncludeView) {
			if view, verr := s.API.Pubs.ActiveViewVersion(ctx, project, name, version); verr == nil && len(view) > 0 {
				res["view"] = view
			}
		}
		if defaultTrue(in.IncludeInitial) {
			team := strings.TrimSpace(in.Team)
			if team == "" && len(u.Teams) == 1 {
				team = u.Teams[0]
			}
			if vals, ierr := s.API.Pubs.OrderInitialValues(ctx, u, project, name, version, team, in.StandID); ierr == nil {
				res["initial_values"] = vals
			}
		}
		return res, nil
	})
}

type getChartChangelogArgs struct {
	Chart   string `json:"chart" jsonschema:"Chart path in project/name form"`
	Version string `json:"version,omitempty" jsonschema:"Specific chart version; omit to return aggregated changelog across recent versions"`
	Limit   int    `json:"limit,omitempty" jsonschema:"Maximum versions for aggregated changelog (default 10, max 50)"`
}

func (s *Server) toolGetChartChangelog(ctx context.Context, _ *sdkmcp.CallToolRequest, in getChartChangelogArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_chart_changelog", false, func(ctx context.Context, u *models.User) (any, error) {
		project, name, err := parseChartPath(in.Chart)
		if err != nil {
			return nil, err
		}
		if _, err := s.API.Catalog.Authorize(ctx, u, project, name); err != nil {
			return nil, err
		}
		if v := strings.TrimSpace(in.Version); v != "" {
			entry, err := s.API.Catalog.GetChangelog(ctx, project, name, v)
			if err != nil {
				return nil, err
			}
			return entry, nil
		}
		limit := clampLimit(in.Limit, 10, 50)
		entries, err := s.API.Catalog.GetAggregatedChangelog(ctx, project, name, limit)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"chart":   project + "/" + name,
			"entries": entries,
		}, nil
	})
}

type checkChartArgs struct {
	Path string `json:"path" jsonschema:"Harbor chart path in project/name form"`
}

func (s *Server) toolCheckChart(ctx context.Context, _ *sdkmcp.CallToolRequest, in checkChartArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "check_chart", false, func(ctx context.Context, u *models.User) (any, error) {
		project, name, err := parseChartPath(in.Path)
		if err != nil {
			return nil, err
		}
		res, err := s.API.Catalog.CheckChart(ctx, project, name)
		if err != nil {
			return nil, err
		}
		if res.Chart != nil && !catalog.VisibleTo(res.Chart, u) {
			return nil, models.ErrNotFound
		}
		return res, nil
	})
}
