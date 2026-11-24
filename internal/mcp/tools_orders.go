package mcp

import (
	"context"
	"strings"
	"time"

	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) registerOrderTools(srv *sdkmcp.Server) {
	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "list_orders",
		Description: "List managed service orders visible to the caller, optionally filtered by team, status, chart, or stand.",
		Annotations: readOnlyAnnotations("List Orders"),
	}, s.toolListOrders)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "get_order",
		Description: "Get full diagnostic details of an order: current values_yaml, merge requests (including blocked_reason), timeline events, drift status, pending merge conflicts, review policy, and Argo CD link.",
		Annotations: readOnlyAnnotations("Get Order Details"),
	}, s.toolGetOrder)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "validate_new_order",
		Description: "Dry-run validate a proposed new order against chart schema, view rules, AllowedTeams, stand, and uniqueness constraints without writing to the database or GitLab.",
		Annotations: readOnlyAnnotations("Validate New Order"),
	}, s.toolValidateNewOrder)

	sdkmcp.AddTool(srv, &sdkmcp.Tool{
		Name:        "validate_order_update",
		Description: "Dry-run validate a proposed update (version and/or values) to an existing live order without opening a merge request.",
		Annotations: readOnlyAnnotations("Validate Order Update"),
	}, s.toolValidateOrderUpdate)

	if s.WriteEnabled {
		sdkmcp.AddTool(srv, &sdkmcp.Tool{
			Name:        "create_draft_order",
			Description: "Create a DRAFT order in Console (never touches GitLab or Argo CD) and return its direct portal URL for human review and submission. Validates schema strictly by default.",
			Annotations: &sdkmcp.ToolAnnotations{
				Title:           "Create Draft Order",
				ReadOnlyHint:    false,
				DestructiveHint: boolPtr(false),
				IdempotentHint:  false,
				OpenWorldHint:   boolPtr(false),
			},
		}, s.toolCreateDraftOrder)
	}
}

type listOrdersArgs struct {
	Team           string `json:"team,omitempty" jsonschema:"Filter by team name"`
	Status         string `json:"status,omitempty" jsonschema:"Filter by order status (DRAFT, MR_CREATED, HEALTHY, DEGRADED, etc.)"`
	Chart          string `json:"chart,omitempty" jsonschema:"Filter by chart name"`
	Stand          string `json:"stand,omitempty" jsonschema:"Filter by stand ID"`
	IncludeDeleted bool   `json:"include_deleted,omitempty" jsonschema:"Include deleted orders"`
	Limit          int    `json:"limit,omitempty" jsonschema:"Maximum orders to return (default 50, max 200)"`
	Offset         int    `json:"offset,omitempty" jsonschema:"Number of orders to skip"`
}

type orderSummary struct {
	ID            string               `json:"id"`
	Team          string               `json:"team"`
	Chart         string               `json:"chart"`
	ChartVersion  string               `json:"chart_version"`
	ServiceName   string               `json:"service_name"`
	DisplayName   string               `json:"display_name"`
	StandID       string               `json:"stand_id"`
	Cluster       string               `json:"cluster"`
	Namespace     string               `json:"namespace"`
	Status        models.RequestStatus `json:"status"`
	Drifted       bool                 `json:"drifted,omitempty"`
	DriftDetail   string               `json:"drift_detail,omitempty"`
	ArgoCDAppName string               `json:"argocd_app_name,omitempty"`
	PortalURL     string               `json:"portal_url,omitempty"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

func (s *Server) toolListOrders(ctx context.Context, _ *sdkmcp.CallToolRequest, in listOrdersArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "list_orders", false, func(ctx context.Context, u *models.User) (any, error) {
		reqs, err := s.API.Prov.List(ctx, u, store.RequestFilter{
			Team:           strings.TrimSpace(in.Team),
			Status:         models.RequestStatus(strings.TrimSpace(in.Status)),
			Chart:          strings.TrimSpace(in.Chart),
			Stand:          strings.TrimSpace(in.Stand),
			IncludeDeleted: in.IncludeDeleted,
		})
		if err != nil {
			return nil, err
		}
		total := len(reqs)
		offset := max(in.Offset, 0)
		limit := clampLimit(in.Limit, 50, 200)
		if offset > total {
			offset = total
		}
		end := min(offset+limit, total)

		out := make([]orderSummary, 0, end-offset)
		for _, r := range reqs[offset:end] {
			out = append(out, orderSummary{
				ID:            r.ID,
				Team:          r.Team,
				Chart:         r.ChartProject + "/" + r.ChartName,
				ChartVersion:  r.ChartVersion,
				ServiceName:   r.ServiceName,
				DisplayName:   r.DisplayName,
				StandID:       r.StandID,
				Cluster:       r.Cluster,
				Namespace:     r.DestNamespace(),
				Status:        r.Status,
				Drifted:       r.Drifted,
				DriftDetail:   r.DriftDetail,
				ArgoCDAppName: r.ArgoCDAppName,
				PortalURL:     s.portalURL("/requests/" + r.ID),
				UpdatedAt:     r.UpdatedAt,
			})
		}
		return map[string]any{
			"orders":   out,
			"total":    total,
			"has_more": end < total,
		}, nil
	})
}

type getOrderArgs struct {
	ID          string `json:"id" jsonschema:"Order ID"`
	EventsLimit int    `json:"events_limit,omitempty" jsonschema:"Maximum timeline events to include (default 50, max 200)"`
}

func (s *Server) toolGetOrder(ctx context.Context, _ *sdkmcp.CallToolRequest, in getOrderArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "get_order", false, func(ctx context.Context, u *models.User) (any, error) {
		id := strings.TrimSpace(in.ID)
		if id == "" {
			return nil, &badInputError{msg: "id is required"}
		}
		req, err := s.API.Prov.Get(ctx, u, id)
		if err != nil {
			return nil, err
		}
		mrs, _ := s.API.Prov.ListMRs(ctx, id)
		evs, _ := s.API.Prov.ListEvents(ctx, id)
		evLimit := clampLimit(in.EventsLimit, 50, 200)
		eventsTruncated := false
		if len(evs) > evLimit {
			evs = evs[len(evs)-evLimit:]
			eventsTruncated = true
		}

		// Copy request so truncating large values_yaml does not mutate store memory.
		reqCopy := *req
		valuesTruncated := false
		reqCopy.ValuesYAML, valuesTruncated = truncateText(reqCopy.ValuesYAML, maxTextBytes)
		reqCopy.EditorState = nil

		var retention time.Duration
		if s.API.Config != nil {
			retention = s.API.Config.DeletedOrdersRetention
		}

		res := map[string]any{
			"request":        &reqCopy,
			"merge_requests": mrs,
			"events":         evs,
			"argocd_url":     s.API.ArgoCDAppURL(req),
			"portal_url":     s.portalURL("/requests/" + req.ID),
			"purge_at":       provisioning.PurgeAt(req, retention),
			"review":         s.API.Prov.OrderReview(ctx, req),
			"conflict":       s.API.Prov.PendingConflict(ctx, req),
		}
		if valuesTruncated {
			res["values_truncated"] = true
		}
		if eventsTruncated {
			res["events_truncated"] = true
		}
		return res, nil
	})
}

type newOrderArgs struct {
	Chart       string         `json:"chart" jsonschema:"Chart path in project/name form"`
	Version     string         `json:"version" jsonschema:"Orderable chart version"`
	Team        string         `json:"team" jsonschema:"Owning team name"`
	ServiceName string         `json:"service_name" jsonschema:"Kubernetes DNS-1123 service instance name"`
	DisplayName string         `json:"display_name,omitempty" jsonschema:"Human-readable display name"`
	StandID     string         `json:"stand_id,omitempty" jsonschema:"Target stand ID (empty uses default stand)"`
	Cluster     string         `json:"cluster,omitempty" jsonschema:"Destination cluster (empty uses stand default)"`
	Namespace   string         `json:"namespace,omitempty" jsonschema:"Destination namespace"`
	Values      map[string]any `json:"values,omitempty" jsonschema:"Helm values map"`
}

func (s *Server) toolValidateNewOrder(ctx context.Context, _ *sdkmcp.CallToolRequest, in newOrderArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "validate_new_order", false, func(ctx context.Context, u *models.User) (any, error) {
		project, name, err := parseChartPath(in.Chart)
		if err != nil {
			return nil, err
		}
		res, err := s.API.Prov.ValidateCreate(ctx, u, provisioning.CreateInput{
			ChartProject: project, ChartName: name, Version: in.Version,
			Team: in.Team, ServiceName: in.ServiceName, DisplayName: in.DisplayName,
			StandID: in.StandID, Cluster: in.Cluster, Namespace: in.Namespace,
			Values: in.Values,
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"valid":       true,
			"values_yaml": res.ValuesYAML,
		}, nil
	})
}

type validateOrderUpdateArgs struct {
	ID      string         `json:"id" jsonschema:"Order ID"`
	Version string         `json:"version,omitempty" jsonschema:"Target chart version (empty keeps current)"`
	Values  map[string]any `json:"values" jsonschema:"Proposed Helm values map"`
}

func (s *Server) toolValidateOrderUpdate(ctx context.Context, _ *sdkmcp.CallToolRequest, in validateOrderUpdateArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "validate_order_update", false, func(ctx context.Context, u *models.User) (any, error) {
		id := strings.TrimSpace(in.ID)
		if id == "" {
			return nil, &badInputError{msg: "id is required"}
		}
		res, err := s.API.Prov.ValidateUpdate(ctx, u, id, provisioning.UpdateInput{
			Version: in.Version,
			Values:  in.Values,
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"valid":       true,
			"changed":     res.Changed,
			"values_yaml": res.ValuesYAML,
		}, nil
	})
}

type createDraftOrderArgs struct {
	Chart       string         `json:"chart" jsonschema:"Chart path in project/name form"`
	Version     string         `json:"version" jsonschema:"Orderable chart version"`
	Team        string         `json:"team" jsonschema:"Owning team name"`
	ServiceName string         `json:"service_name" jsonschema:"Kubernetes DNS-1123 service instance name"`
	DisplayName string         `json:"display_name,omitempty" jsonschema:"Human-readable display name"`
	StandID     string         `json:"stand_id,omitempty" jsonschema:"Target stand ID (empty uses default stand)"`
	Cluster     string         `json:"cluster,omitempty" jsonschema:"Destination cluster (empty uses stand default)"`
	Namespace   string         `json:"namespace,omitempty" jsonschema:"Destination namespace"`
	Values      map[string]any `json:"values,omitempty" jsonschema:"Helm values map"`
	Strict      *bool          `json:"strict,omitempty" jsonschema:"Validate values strictly against chart schema before saving the draft (default true)"`
}

func (s *Server) toolCreateDraftOrder(ctx context.Context, _ *sdkmcp.CallToolRequest, in createDraftOrderArgs) (*sdkmcp.CallToolResult, any, error) {
	return s.runTool(ctx, "create_draft_order", false, func(ctx context.Context, u *models.User) (any, error) {
		if !s.WriteEnabled {
			return nil, errWriteDisabled
		}
		project, name, err := parseChartPath(in.Chart)
		if err != nil {
			return nil, err
		}
		createIn := provisioning.CreateInput{
			ChartProject: project, ChartName: name, Version: in.Version,
			Team: in.Team, ServiceName: in.ServiceName, DisplayName: in.DisplayName,
			StandID: in.StandID, Cluster: in.Cluster, Namespace: in.Namespace,
			Values: in.Values, Draft: true,
		}
		// Draft creation normally defers JSON schema checks to Submit; for MCP
		// callers we validate strictly by default so agents do not leave broken
		// drafts behind unless they explicitly opt out.
		if defaultTrue(in.Strict) {
			if _, err := s.API.Prov.ValidateCreate(ctx, u, createIn); err != nil {
				return nil, err
			}
		}
		req, err := s.API.Prov.Create(ctx, u, createIn)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"id":           req.ID,
			"status":       req.Status,
			"chart":        req.ChartProject + "/" + req.ChartName,
			"version":      req.ChartVersion,
			"team":         req.Team,
			"service_name": req.ServiceName,
			"display_name": req.DisplayName,
			"stand_id":     req.StandID,
			"cluster":      req.Cluster,
			"namespace":    req.DestNamespace(),
			"portal_url":   s.portalURL("/requests/" + req.ID),
			"values_yaml":  req.ValuesYAML,
		}, nil
	})
}
