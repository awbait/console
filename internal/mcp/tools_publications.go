package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"console/internal/catalog"
	"console/internal/config"
	"console/internal/provisioning"
	"console/internal/store"
	"console/internal/views"
	"console/pkg/models"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) registerPublicationTools(srv *sdkmcp.Server, isAdmin bool) {
	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "list_publications",
		Description: "List chart publications with their category, owner team, approval status, and recommended version.",
		Annotations: readOnlyAnnotations("List Publications"),
	}, s.toolListPublications)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "get_publication_versions",
		Description: "Inspect a publication, its per-version approval statuses, orderable/deprecated flags, and active edit leases.",
		Annotations: readOnlyAnnotations("Get Publication Versions"),
	}, s.toolGetPublicationVersions)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "get_view_authoring_context",
		Description: "Return the view document JSON Schema, supported template references, and current platform variables for authoring chart version views.",
		Annotations: readOnlyAnnotations("Get View Authoring Context"),
	}, s.toolGetViewAuthoringContext)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "validate_publication_version",
		Description: "Dry-run validate a candidate view JSON document against a publication's chart version schema without saving.",
		Annotations: readOnlyAnnotations("Validate Publication Version View"),
	}, s.toolValidatePublicationVersion)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "list_notifications",
		Description: "Read the caller's notification feed and unread count.",
		Annotations: readOnlyAnnotations("List Notifications"),
	}, s.toolListNotifications)

	if isAdmin {
		sdkmcp.AddTool(srv, &sdkmcp.Tool{
			Name:        "get_admin_board",
			Description: "Admin only: return the duty board summarizing orders needing attention, component health, failing checks, approval queue, and active stand jobs.",
			Annotations: readOnlyAnnotations("Get Admin Duty Board"),
		}, s.toolGetAdminBoard)

		sdkmcp.AddTool(srv, &sdkmcp.Tool{
			Name:        "get_platform_status",
			Description: "Admin only: return integration and storage health, background reconciler states, configuration checks, and stand check summaries.",
			Annotations: readOnlyAnnotations("Get Platform Status"),
		}, s.toolGetPlatformStatus)

		sdkmcp.AddTool(srv, &sdkmcp.Tool{
			Name:        "get_platform_config",
			Description: "Admin only: return the redacted runtime configuration (secrets hidden).",
			Annotations: readOnlyAnnotations("Get Platform Configuration"),
		}, s.toolGetPlatformConfig)
	}
}

type listPublicationsArgs struct {
	Status string `json:"status,omitempty" jsonschema:"Filter by status (DRAFT, PENDING, APPROVED, REJECTED)"`
	Team   string `json:"team,omitempty" jsonschema:"Filter by owner team"`
	Chart  string `json:"chart,omitempty" jsonschema:"Filter by chart name"`
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum publications to return (default 50, max 200)"`
	Offset int    `json:"offset,omitempty" jsonschema:"Number of publications to skip"`
}

func (s *Server) toolListPublications(ctx context.Context, _ *sdkmcp.CallToolRequest, in listPublicationsArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "list_publications", false, func(ctx context.Context, u *models.User) (any, error) {
		pubs, err := s.API.Pubs.List(ctx, store.PublicationFilter{
			Status: models.PublicationStatus(strings.TrimSpace(in.Status)),
			Team:   strings.TrimSpace(in.Team),
			Chart:  strings.TrimSpace(in.Chart),
		})
		if err != nil {
			return nil, err
		}
		visible := make([]*models.ChartPublication, 0, len(pubs))
		for _, p := range pubs {
			if s.publicationVisible(ctx, u, p) {
				visible = append(visible, p)
			}
		}
		total := len(visible)
		offset := max(in.Offset, 0)
		limit := clampLimit(in.Limit, 50, 200)
		if offset > total {
			offset = total
		}
		end := min(offset+limit, total)
		return map[string]any{
			"publications": visible[offset:end],
			"total":        total,
			"has_more":     end < total,
		}, nil
	})
}

type getPublicationVersionsArgs struct {
	PublicationID string `json:"publication_id" jsonschema:"Publication ID"`
	IncludeViews  bool   `json:"include_views,omitempty" jsonschema:"Include raw view_json and approved_view_json bodies (default false)"`
}

func (s *Server) toolGetPublicationVersions(ctx context.Context, _ *sdkmcp.CallToolRequest, in getPublicationVersionsArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_publication_versions", false, func(ctx context.Context, u *models.User) (any, error) {
		id := strings.TrimSpace(in.PublicationID)
		if id == "" {
			return nil, &badInputError{msg: "publication_id is required"}
		}
		pub, err := s.API.Pubs.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if !s.publicationVisible(ctx, u, pub) {
			return nil, models.ErrNotFound
		}
		versions, err := s.API.Pubs.ListVersions(ctx, id)
		if err != nil {
			return nil, err
		}
		outVersions := make([]models.PublicationVersion, 0, len(versions))
		var leaseErr error
		for _, v := range versions {
			vc := *v
			vc.Editing = nil
			if leaseErr == nil {
				if ed, err := s.API.Pubs.Editing(ctx, id, v.ChartVersion); err == nil {
					vc.Editing = ed
				} else {
					leaseErr = err
				}
			}
			if !in.IncludeViews {
				vc.ViewJSON = nil
				vc.ApprovedViewJSON = nil
			}
			outVersions = append(outVersions, vc)
		}
		return map[string]any{
			"publication": pub,
			"versions":    outVersions,
		}, nil
	})
}

func (s *Server) toolGetViewAuthoringContext(ctx context.Context, _ *sdkmcp.CallToolRequest, _ emptyArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_view_authoring_context", false, func(ctx context.Context, _ *models.User) (any, error) {
		refs := views.TemplateRefs()
		vars, err := s.API.Pubs.ListVariables(ctx)
		if err != nil {
			return nil, err
		}
		if vars == nil {
			vars = []*models.Variable{}
		}
		for _, v := range vars {
			refs = append(refs, views.TemplateRef{
				Ref: ".Vars." + v.Name, Desc: v.Description, AtOrderForm: true, InNamespace: true,
			})
		}
		return map[string]any{
			"view_schema":   json.RawMessage(views.DocumentSchema()),
			"template_refs": refs,
			"variables":     vars,
		}, nil
	})
}

type validatePubVersionArgs struct {
	PublicationID string         `json:"publication_id" jsonschema:"Publication ID"`
	Version       string         `json:"version" jsonschema:"Chart version to validate the view document against"`
	View          map[string]any `json:"view" jsonschema:"Candidate view JSON document"`
}

func (s *Server) toolValidatePublicationVersion(ctx context.Context, _ *sdkmcp.CallToolRequest, in validatePubVersionArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "validate_publication_version", false, func(ctx context.Context, u *models.User) (any, error) {
		id := strings.TrimSpace(in.PublicationID)
		ver := strings.TrimSpace(in.Version)
		if id == "" || ver == "" || len(in.View) == 0 {
			return nil, &badInputError{msg: "publication_id, version, and view are required"}
		}
		rawView, err := json.Marshal(in.View)
		if err != nil {
			return nil, &badInputError{msg: "view must be valid JSON"}
		}
		pub, err := s.API.Pubs.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if !s.publicationVisible(ctx, u, pub) {
			return nil, models.ErrNotFound
		}
		issues, err := s.API.Pubs.ValidateVersionView(ctx, id, ver, rawView)
		if err != nil {
			return nil, err
		}
		if issues == nil {
			issues = []views.Issue{}
		}
		return map[string]any{
			"valid":  len(issues) == 0,
			"issues": issues,
		}, nil
	})
}

type listNotificationsArgs struct {
	Before string `json:"before,omitempty" jsonschema:"RFC3339Nano timestamp cursor to page backwards"`
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum notifications to return (default 30, max 100)"`
}

func (s *Server) toolListNotifications(ctx context.Context, _ *sdkmcp.CallToolRequest, in listNotificationsArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "list_notifications", false, func(ctx context.Context, u *models.User) (any, error) {
		f := store.NotificationFilter{
			Subject: u.Subject,
			Teams:   u.Teams,
			Role:    string(u.Role),
			Limit:   clampLimit(in.Limit, 30, 100),
		}
		if in.Before != "" {
			if t, err := time.Parse(time.RFC3339Nano, in.Before); err == nil {
				f.Before = t
			}
		}
		if f.Subject != "" {
			_ = s.API.Store.RecordAudiences(ctx, f.Subject, f.Teams, f.Role, time.Time{})
		}
		list, err := s.API.Store.ListNotifications(ctx, f)
		if err != nil {
			return nil, err
		}
		if list == nil {
			list = []*models.Notification{}
		}
		unread, err := s.API.Store.CountUnread(ctx, f)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"unread":        unread,
			"notifications": list,
		}, nil
	})
}

type getAdminBoardArgs struct {
	TZ string `json:"tz,omitempty" jsonschema:"IANA timezone for daily trend buckets (default UTC)"`
}

func (s *Server) toolGetAdminBoard(ctx context.Context, _ *sdkmcp.CallToolRequest, in getAdminBoardArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_admin_board", false, func(ctx context.Context, u *models.User) (any, error) {
		if !u.IsAdmin() {
			return nil, provisioning.ErrForbidden
		}
		return s.API.AdminBoardSnapshot(ctx, strings.TrimSpace(in.TZ))
	})
}

func (s *Server) toolGetPlatformStatus(ctx context.Context, _ *sdkmcp.CallToolRequest, _ emptyArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_platform_status", false, func(ctx context.Context, u *models.User) (any, error) {
		if !u.IsAdmin() {
			return nil, provisioning.ErrForbidden
		}
		stands, err := s.API.Prov.StandChecksSummary(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"system":        s.API.SystemStatusSnapshot(),
			"config_checks": s.API.StatusChecksSnapshot(),
			"stands":        stands,
		}, nil
	})
}

func (s *Server) toolGetPlatformConfig(ctx context.Context, _ *sdkmcp.CallToolRequest, _ emptyArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_platform_config", false, func(ctx context.Context, u *models.User) (any, error) {
		if !u.IsAdmin() {
			return nil, provisioning.ErrForbidden
		}
		if s.API.Config == nil {
			return map[string]any{"fields": []config.Field{}}, nil
		}
		return map[string]any{"fields": config.Describe(s.API.Config)}, nil
	})
}

// publicationVisible checks chart AllowedTeams visibility when the chart exists
// in the registry. Orphaned publications (chart gone from Harbor) stay visible
// so owners and admins can see and clean them up.
func (s *Server) publicationVisible(ctx context.Context, u *models.User, p *models.ChartPublication) bool {
	if u.IsAdmin() {
		return true
	}
	ch, err := s.API.Catalog.GetChart(ctx, p.ChartProject, p.ChartName)
	if err != nil {
		return true
	}
	return catalog.VisibleTo(ch, u)
}
