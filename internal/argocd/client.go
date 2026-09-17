package argocd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"console/pkg/models"
)

// Client is the real ArgoCD implementation of Port. It speaks the ArgoCD
// gRPC-gateway REST API (the same endpoints the argocd CLI uses) with a bearer
// token, exposing only the read/sync subset the status layer needs. App
// creation is GitOps-driven (a bootstrap ApplicationSet materialises apps from
// the manifests the portal commits to Git), so there is no Create here.
type Client struct {
	base  string // API root, e.g. https://argocd.local/api/v1
	token string
	http  *http.Client
}

var _ Port = (*Client)(nil)

// NewClient builds an ArgoCD client. baseURL is the argocd-server root
// (e.g. http://argocd.local:8083); token is a bearer token from
// `argocd account generate-token` (or a project token). A zero timeout is 30s.
func NewClient(baseURL, token string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Client{
		base:  strings.TrimRight(baseURL, "/") + "/api/v1",
		token: token,
		http:  &http.Client{Timeout: timeout},
	}
}

// apiError carries a non-2xx ArgoCD response for diagnostics.
type apiError struct {
	status int
	body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("argocd: status %d: %s", e.status, e.body)
}

// do performs an API request, decoding a 2xx body into out when non-nil.
// A 404 maps to models.ErrNotFound; other non-2xx become *apiError.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	endpoint := c.base + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == http.StatusNotFound {
		return models.ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &apiError{status: resp.StatusCode, body: strings.TrimSpace(string(data))}
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("argocd: decode %s: %w", path, err)
		}
	}
	return nil
}

// apiApp is the trimmed ArgoCD Application JSON the portal reads.
type apiApp struct {
	Metadata struct {
		Name       string            `json:"name"`
		Labels     map[string]string `json:"labels"`
		Finalizers []string          `json:"finalizers"`
	} `json:"metadata"`
	Spec struct {
		Project     string `json:"project"`
		Destination struct {
			Name   string `json:"name"`
			Server string `json:"server"`
		} `json:"destination"`
		// source / sources: the portal writes multi-source applications (the
		// chart from the registry plus this repo for values.yaml), but a chart
		// somebody wired up by hand may still be single-source, so both are read.
		Source  apiSource   `json:"source"`
		Sources []apiSource `json:"sources"`
	} `json:"spec"`
	Status struct {
		Sync struct {
			Status    string   `json:"status"`
			Revision  string   `json:"revision"`
			Revisions []string `json:"revisions"`
		} `json:"sync"`
		Health struct {
			Status string `json:"status"`
		} `json:"health"`
		// conditions is where an application that could not be rendered at all
		// says why. Health says nothing then - it stays Unknown - so this is the
		// only thing to report and the only thing to act on.
		Conditions []struct {
			Type               string `json:"type"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
		// operationState is the last sync ArgoCD ran: how it ended, what it was
		// for, and when. An application carries a failed condition long after the
		// sync that produced it, so this is what says whether the failure is about
		// what the order asks for now.
		OperationState struct {
			Phase      string `json:"phase"`
			Message    string `json:"message"`
			FinishedAt string `json:"finishedAt"`
			SyncResult struct {
				Revision  string   `json:"revision"`
				Revisions []string `json:"revisions"`
			} `json:"syncResult"`
		} `json:"operationState"`
	} `json:"status"`
}

// apiSource is one source of an application: a Helm chart from a registry
// (chart + targetRevision) or a Git repository (targetRevision is the branch).
type apiSource struct {
	RepoURL        string `json:"repoURL"`
	Chart          string `json:"chart"`
	TargetRevision string `json:"targetRevision"`
}

// chartSource finds the source that pulls the chart, and where it sits in the
// list - ArgoCD records one revision per source, in the same order, so the
// position is what connects a sync to the chart version it ran against.
// Returns -1 when the application has no chart source at all.
func (a *apiApp) chartSource() (apiSource, int) {
	if len(a.Spec.Sources) == 0 {
		if a.Spec.Source.Chart != "" {
			return a.Spec.Source, 0
		}
		return apiSource{}, -1
	}
	for i, s := range a.Spec.Sources {
		if s.Chart != "" {
			return s, i
		}
	}
	return apiSource{}, -1
}

// parseTime reads an ArgoCD timestamp, answering with the zero time for
// anything it cannot read: an unparsable timestamp must not be mistaken for
// 1970, which would make every age calculation say "long ago".
func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func (a *apiApp) toApp() Application {
	cluster := a.Spec.Destination.Name
	if cluster == "" {
		cluster = a.Spec.Destination.Server
	}
	sync := SyncStatus(a.Status.Sync.Status)
	if sync == "" {
		sync = SyncUnknown
	}
	health := HealthStatus(a.Status.Health.Status)
	if health == "" {
		health = HealthUnknown
	}
	// The first failing condition, not all of them: one reason is what a person
	// acts on, and ArgoCD repeats the same failure across conditions often enough
	// that a list of them reads as noise.
	var appErr string
	var errSince time.Time
	for _, c := range a.Status.Conditions {
		if errorCondition(c.Type) && strings.TrimSpace(c.Message) != "" {
			appErr = c.Type + ": " + strings.TrimSpace(c.Message)
			errSince = parseTime(c.LastTransitionTime)
			break
		}
	}
	chart, chartIdx := a.chartSource()
	return Application{
		Name:         a.Metadata.Name,
		Project:      a.Spec.Project,
		Cluster:      cluster,
		Sync:         sync,
		Health:       health,
		Labels:       a.Metadata.Labels,
		Revision:     a.Status.Sync.Revision,
		Revisions:    a.Status.Sync.Revisions,
		Error:        appErr,
		ErrorSince:   errSince,
		ChartVersion: chart.TargetRevision,
		LastOp:       a.lastOperation(chartIdx),
	}
}

// lastOperation reads the sync ArgoCD ran last, or nil when there has been
// none. chartIdx is where the chart sits among the application's sources, which
// is also where its revision sits among the ones the sync recorded.
func (a *apiApp) lastOperation(chartIdx int) *Operation {
	op := a.Status.OperationState
	if op.Phase == "" {
		return nil
	}
	// A single-source application records one revision; a multi-source one
	// records them per source, in the order the sources are declared.
	version := op.SyncResult.Revision
	if chartIdx >= 0 && chartIdx < len(op.SyncResult.Revisions) {
		version = op.SyncResult.Revisions[chartIdx]
	}
	return &Operation{
		Phase:        OperationPhase(op.Phase),
		ChartVersion: version,
		Message:      strings.TrimSpace(op.Message),
		FinishedAt:   parseTime(op.FinishedAt),
	}
}

func (c *Client) GetApplication(ctx context.Context, name string) (*Application, error) {
	return c.getApplication(ctx, name, "")
}

// getApplication fetches one application. refresh ("normal"|"hard"|"") asks
// ArgoCD to re-pull the app's Git revision before answering; "" reads the cached
// state. A 403 (ArgoCD hides non-existent apps behind "permission denied" rather
// than 404) maps to ErrNotFound so callers can observe a pruned app.
func (c *Client) getApplication(ctx context.Context, name, refresh string) (*Application, error) {
	var query url.Values
	if refresh != "" {
		query = url.Values{"refresh": {refresh}}
	}
	var app apiApp
	if err := c.do(ctx, http.MethodGet, "/applications/"+url.PathEscape(name), query, nil, &app); err != nil {
		var ae *apiError
		if errors.Is(err, models.ErrNotFound) || (errors.As(err, &ae) && ae.status == http.StatusForbidden) {
			return nil, models.ErrNotFound
		}
		return nil, err
	}
	a := app.toApp()
	return &a, nil
}

// ResourcesFinalizer is what makes deleting an Application delete the service it
// deployed. Without it Argo CD removes the Application alone and leaves every
// resource behind it running, owned by nothing.
const ResourcesFinalizer = "resources-finalizer.argocd.argoproj.io"

// EnsureCascadingDelete stamps the resources finalizer on a live Application, so
// that whatever removes it later takes the deployed resources with it.
//
// The portal writes the finalizer into every manifest it generates, so for an
// order created by this portal this is a no-op that costs one read. It exists for
// the ones where the manifest cannot be trusted: orders committed before the
// portal wrote the finalizer, and orders imported from manifests somebody else
// wrote by hand.
//
// Called before the change removing the manifest is opened, while the
// Application is still what Git asks for: patching it then races with nothing.
func (c *Client) EnsureCascadingDelete(ctx context.Context, name string) error {
	var app apiApp
	if err := c.do(ctx, http.MethodGet, "/applications/"+url.PathEscape(name), nil, nil, &app); err != nil {
		return err
	}
	if slices.Contains(app.Metadata.Finalizers, ResourcesFinalizer) {
		return nil
	}
	// A JSON merge patch replaces a list rather than adding to it, so send the
	// finalizers this application already has plus ours. Dropping somebody else's
	// finalizer would strand the resource it guards.
	merged := append(slices.Clone(app.Metadata.Finalizers), ResourcesFinalizer)
	patch, err := json.Marshal(map[string]any{
		"metadata": map[string]any{"finalizers": merged},
	})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPatch, "/applications/"+url.PathEscape(name), nil,
		map[string]string{"patch": string(patch), "patchType": "merge"}, nil)
}

func (c *Client) Sync(ctx context.Context, name string) error {
	// Force a hard refresh first so ArgoCD re-pulls the latest Git revision. A
	// plain sync only applies ArgoCD's cached manifests, which is a no-op on an
	// app whose automated syncPolicy already keeps that cached revision applied -
	// the refresh is what makes a freshly-pushed commit visible to the sync.
	if _, err := c.getApplication(ctx, name, "hard"); err != nil {
		return err
	}
	// Empty body = sync the (now refreshed) target revision with default options.
	return c.do(ctx, http.MethodPost, "/applications/"+url.PathEscape(name)+"/sync", nil, struct{}{}, nil)
}

func (c *Client) Healthz(ctx context.Context) error {
	// The version endpoint lives at /api/version (outside the /api/v1 base) and is
	// unauthenticated, so it wouldn't validate the token. session/userinfo is under
	// /api/v1, cheap, and reports whether our bearer token is accepted - covering
	// both connectivity and auth. It returns 200 even when unauthenticated, so we
	// must inspect loggedIn rather than rely on the status code.
	var info struct {
		LoggedIn bool `json:"loggedIn"`
	}
	if err := c.do(ctx, http.MethodGet, "/session/userinfo", nil, nil, &info); err != nil {
		return err
	}
	if !info.LoggedIn {
		return errors.New("argocd: token rejected (not logged in)")
	}
	return nil
}
