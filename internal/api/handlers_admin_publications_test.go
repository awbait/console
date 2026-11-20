package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"console/internal/publications"
	"console/pkg/models"
)

// The registry is the admin's list: every publication with its orders counted,
// the live ones apart from the rest. A member is not shown it.
func TestAdminPublicationsRegistry(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()
	ctx := context.Background()
	do := func(req *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	owner := &models.User{Subject: "owner", Teams: []string{"core"}, Role: models.RoleMember}
	if err := srv.Pubs.CreateCategory(ctx, &models.User{Role: models.RoleAdmin}, &models.Category{ID: "network", Label: "net"}); err != nil {
		t.Fatal(err)
	}
	pub, err := srv.Pubs.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Three orders on the chart: two running, one turned down. A fourth on
	// another chart stays out of the count.
	for i, o := range []struct {
		chart  string
		status models.RequestStatus
	}{
		{"ingress-gateway", models.StatusHealthy},
		{"ingress-gateway", models.StatusDeploying},
		{"ingress-gateway", models.StatusMRClosed},
		{"postgres", models.StatusHealthy},
	} {
		name := "svc-" + string(rune('a'+i))
		r := &models.Request{
			ID: uuid.NewString(), CreatedBy: "u1", CreatedByName: "U One", Team: "core",
			ChartProject: "platform", ChartName: o.chart, ChartVersion: "1",
			ServiceName: name, Cluster: "in-cluster", Namespace: name,
			ValuesYAML: "{}", Status: o.status,
		}
		if err := srv.Store.CreateRequest(ctx, r); err != nil {
			t.Fatalf("order %s: %v", name, err)
		}
	}

	if rec := do(devReq("GET", "/api/v1/admin/publications", "core", nil)); rec.Code != http.StatusForbidden {
		t.Fatalf("member: want 403, got %d", rec.Code)
	}
	rec := do(adminReq("GET", "/api/v1/admin/publications", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin: %d body=%s", rec.Code, rec.Body.String())
	}
	var rows []struct {
		Publication models.ChartPublication `json:"publication"`
		Versions    struct {
			Total     int      `json:"total"`
			Orderable []string `json:"orderable"`
		} `json:"versions"`
		Orders struct {
			Live  int `json:"live"`
			Total int `json:"total"`
		} `json:"orders"`
		Issues []string `json:"issues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Publication.ID != pub.ID {
		t.Fatalf("rows = %+v", rows)
	}
	row := rows[0]
	if row.Orders.Live != 2 || row.Orders.Total != 3 {
		t.Fatalf("orders = %+v, want live 2 of 3", row.Orders)
	}
	if row.Versions.Total != 0 || row.Versions.Orderable == nil {
		t.Fatalf("versions = %+v", row.Versions)
	}
	if len(row.Issues) != 1 || row.Issues[0] != publications.IssueNoOrderForm {
		t.Fatalf("issues = %v", row.Issues)
	}
}
