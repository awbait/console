package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"strings"

	"console/internal/auth"
	"console/internal/views"
	"console/pkg/models"
	"github.com/go-chi/chi/v5/middleware"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) registerResources(srv *sdkmcp.Server) {
	srv.AddResource(&sdkmcp.Resource{
		URI:         "console://view-schema",
		Name:        "view-schema",
		Title:       "Console View Document JSON Schema",
		Description: "JSON Schema describing the format of chart version view documents.",
		MIMEType:    "application/json",
	}, s.readViewSchema)

	srv.AddResourceTemplate(&sdkmcp.ResourceTemplate{
		URITemplate: "console://charts/{project}/{name}/{version}/readme",
		Name:        "chart-readme",
		Title:       "Chart README",
		Description: "README.md of a Helm chart version in Console's catalog.",
		MIMEType:    "text/markdown",
	}, s.readChartFile("readme", "text/markdown"))

	srv.AddResourceTemplate(&sdkmcp.ResourceTemplate{
		URITemplate: "console://charts/{project}/{name}/{version}/schema",
		Name:        "chart-schema",
		Title:       "Chart Effective Schema",
		Description: "Effective values JSON Schema (including dependencies) of a Helm chart version.",
		MIMEType:    "application/json",
	}, s.readChartFile("schema", "application/json"))

	srv.AddResourceTemplate(&sdkmcp.ResourceTemplate{
		URITemplate: "console://charts/{project}/{name}/{version}/values",
		Name:        "chart-values",
		Title:       "Chart Default values.yaml",
		Description: "Default values.yaml of a Helm chart version.",
		MIMEType:    "text/yaml",
	}, s.readChartFile("values", "text/yaml"))

	srv.AddResourceTemplate(&sdkmcp.ResourceTemplate{
		URITemplate: "console://orders/{id}",
		Name:        "order",
		Title:       "Order Snapshot",
		Description: "Full JSON snapshot of a Console order including merge requests, events, and drift status.",
		MIMEType:    "application/json",
	}, s.readOrderResource)
}

func (s *Server) resourceAuth(ctx context.Context) (*models.User, error) {
	u := auth.UserFrom(ctx)
	if u == nil {
		return nil, auth.ErrUnauthenticated
	}
	if s.maintenanceBlocked(ctx, u) {
		return nil, errMaintenance
	}
	return u, nil
}

func (s *Server) readViewSchema(ctx context.Context, req *sdkmcp.ReadResourceRequest) (*sdkmcp.ReadResourceResult, error) {
	if _, err := s.resourceAuth(ctx); err != nil {
		return nil, err
	}
	return &sdkmcp.ReadResourceResult{
		Contents: []*sdkmcp.ResourceContents{{
			URI:      req.Params.URI,
			MIMEType: "application/json",
			Text:     string(views.DocumentSchema()),
		}},
	}, nil
}

func (s *Server) readChartFile(kind, mime string) sdkmcp.ResourceHandler {
	return func(ctx context.Context, req *sdkmcp.ReadResourceRequest) (*sdkmcp.ReadResourceResult, error) {
		u, err := s.resourceAuth(ctx)
		if err != nil {
			return nil, err
		}
		project, name, version, ok := parseChartResourceURI(req.Params.URI, kind)
		if !ok {
			return nil, sdkmcp.ResourceNotFoundError(req.Params.URI)
		}
		if _, err := s.API.Catalog.Authorize(ctx, u, project, name); err != nil {
			if isNotFoundErr(err) {
				return nil, sdkmcp.ResourceNotFoundError(req.Params.URI)
			}
			s.logResourceErr(ctx, u, req.Params.URI, err)
			return nil, errors.New("failed to read chart resource")
		}
		var data []byte
		switch kind {
		case "readme":
			data, err = s.API.Catalog.GetReadme(ctx, project, name, version)
		case "values":
			data, err = s.API.Catalog.GetValues(ctx, project, name, version)
		case "schema":
			data, _, err = s.API.Catalog.FormSchema(ctx, project, name, version)
		}
		if err != nil {
			if isNotFoundErr(err) {
				return nil, sdkmcp.ResourceNotFoundError(req.Params.URI)
			}
			s.logResourceErr(ctx, u, req.Params.URI, err)
			return nil, errors.New("failed to read chart resource")
		}
		text, _ := truncateText(string(data), maxTextBytes)
		return &sdkmcp.ReadResourceResult{
			Contents: []*sdkmcp.ResourceContents{{
				URI:      req.Params.URI,
				MIMEType: mime,
				Text:     text,
			}},
		}, nil
	}
}

func (s *Server) readOrderResource(ctx context.Context, req *sdkmcp.ReadResourceRequest) (*sdkmcp.ReadResourceResult, error) {
	u, err := s.resourceAuth(ctx)
	if err != nil {
		return nil, err
	}
	id, ok := parseOrderResourceURI(req.Params.URI)
	if !ok {
		return nil, sdkmcp.ResourceNotFoundError(req.Params.URI)
	}
	order, err := s.API.Prov.Get(ctx, u, id)
	if err != nil {
		if isNotFoundErr(err) {
			return nil, sdkmcp.ResourceNotFoundError(req.Params.URI)
		}
		s.logResourceErr(ctx, u, req.Params.URI, err)
		return nil, errors.New("failed to read order resource")
	}
	mrs, _ := s.API.Prov.ListMRs(ctx, id)
	evs, _ := s.API.Prov.ListEvents(ctx, id)
	payload, err := json.Marshal(map[string]any{
		"request":        order,
		"merge_requests": mrs,
		"events":         evs,
		"argocd_url":     s.API.ArgoCDAppURL(order),
		"portal_url":     s.portalURL("/requests/" + order.ID),
		"review":         s.API.Prov.OrderReview(ctx, order),
		"conflict":       s.API.Prov.PendingConflict(ctx, order),
	})
	if err != nil {
		return nil, errors.New("failed to encode order resource")
	}
	return &sdkmcp.ReadResourceResult{
		Contents: []*sdkmcp.ResourceContents{{
			URI:      req.Params.URI,
			MIMEType: "application/json",
			Text:     string(payload),
		}},
	}, nil
}

func (s *Server) logResourceErr(ctx context.Context, u *models.User, uri string, err error) {
	s.logger().LogAttrs(ctx, slog.LevelWarn, "mcp resource read",
		slog.String("actor", u.Subject),
		slog.String("uri", uri),
		slog.String("request_id", middleware.GetReqID(ctx)),
		slog.String("err", err.Error()),
	)
}

func parseChartResourceURI(rawURI, wantKind string) (project, name, version string, ok bool) {
	u, err := url.Parse(rawURI)
	if err != nil || u.Scheme != "console" || u.Host != "charts" {
		return "", "", "", false
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 4 || parts[3] != wantKind {
		return "", "", "", false
	}
	if parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func parseOrderResourceURI(rawURI string) (string, bool) {
	u, err := url.Parse(rawURI)
	if err != nil || u.Scheme != "console" || u.Host != "orders" {
		return "", false
	}
	id := strings.Trim(u.Path, "/")
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}
