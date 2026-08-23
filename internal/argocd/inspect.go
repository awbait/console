package argocd

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"console/pkg/models"
)

// Read-only calls the configuration checks use (internal/checks). An order that
// passes every portal-side step still dies in silence if the Argo CD project it
// names does not exist, if the destination cluster is not registered, or if the
// Application is committed into a namespace Argo CD does not read. All three are
// visible from here without creating anything.

// ProjectExists reports whether the Argo CD project the portal puts its
// applications in is there. models.ErrNotFound comes back as (false, nil): a
// missing project is an answer, not a failure to get one.
func (c *Client) ProjectExists(ctx context.Context, name string) (bool, error) {
	var p struct {
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
	}
	err := c.do(ctx, http.MethodGet, "/projects/"+url.PathEscape(name), nil, nil, &p)
	if err != nil {
		if errors.Is(err, models.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Cluster is a cluster registered in Argo CD. An order names one by either
// field: "in-cluster" is a name, an API endpoint is a server.
type Cluster struct {
	Name   string `json:"name"`
	Server string `json:"server"`
}

// ListClusters returns the clusters Argo CD can deploy to. A project-scoped
// token may be refused here; callers treat that as "cannot look".
func (c *Client) ListClusters(ctx context.Context) ([]Cluster, error) {
	var out struct {
		Items []Cluster `json:"items"`
	}
	if err := c.do(ctx, http.MethodGet, "/clusters", nil, nil, &out); err != nil {
		return nil, err
	}
	return out.Items, nil
}

// CanI asks Argo CD what this token is allowed to do, which is the one question
// it answers without doing anything. subresource is the RBAC object, e.g.
// "portal-managed/*" - its slash is part of the path, so it is joined verbatim
// rather than escaped into one segment.
func (c *Client) CanI(ctx context.Context, resource, action, subresource string) (bool, error) {
	var out struct {
		Value string `json:"value"`
	}
	path := "/account/can-i/" + url.PathEscape(resource) + "/" + url.PathEscape(action) + "/" + subresource
	if err := c.do(ctx, http.MethodGet, path, nil, nil, &out); err != nil {
		return false, err
	}
	return strings.EqualFold(out.Value, "yes"), nil
}

// ApplicationNamespace returns the namespace Argo CD keeps its Applications in,
// read from the applications it already has. Argo CD does not report its own
// namespace, and it only picks up Applications from it - so an application.yaml
// committed elsewhere is applied by the app-of-apps and then read by nobody.
// Comparing against a live application is the only way to see that from here.
//
// An empty string with no error means Argo CD has no applications yet, so there
// is nothing to compare with.
func (c *Client) ApplicationNamespace(ctx context.Context) (string, error) {
	var out struct {
		Items []struct {
			Metadata struct {
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		} `json:"items"`
	}
	q := url.Values{"fields": {"items.metadata.namespace"}}
	if err := c.do(ctx, http.MethodGet, "/applications", q, nil, &out); err != nil {
		return "", err
	}
	for _, it := range out.Items {
		if it.Metadata.Namespace != "" {
			return it.Metadata.Namespace, nil
		}
	}
	return "", nil
}

// Forbidden reports whether Argo CD refused the call on the token's permissions
// rather than failing. Argo CD answers 403 for an RBAC denial and 401 for a
// token it does not accept at all.
func Forbidden(err error) bool {
	var ae *apiError
	if !errors.As(err, &ae) {
		return false
	}
	return ae.status == http.StatusForbidden || ae.status == http.StatusUnauthorized
}
