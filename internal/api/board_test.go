package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/internal/api"
	"console/pkg/models"
	"github.com/google/uuid"
)

// The board lists named orders, people and stands: admins only.
func TestBoardIsAdminOnly(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("GET", "/api/v1/admin/board", "core", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member: %d body=%s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, adminReq("GET", "/api/v1/admin/board?tz=Europe/Moscow", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin: %d body=%s", rec.Code, rec.Body.String())
	}
	var b api.Board
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	// An empty platform still draws two weeks of days, all zero, and lists
	// come back empty rather than null.
	if len(b.Tiles.Orders.Series) != 14 || len(b.Tiles.Users.Series) != 14 || len(b.Tiles.Actions.Series) != 14 {
		t.Fatalf("series: %+v", b.Tiles)
	}
	if b.Attention == nil || b.InProgress == nil || b.Queue == nil || b.Events == nil {
		t.Fatalf("nil lists: %s", rec.Body.String())
	}
}

// Orders in trouble become problems, failures first; orders on their way are
// work in progress; the tiles count what people did today.
func TestBoardOrders(t *testing.T) {
	srv, _, _ := newServer(t)
	ctx := context.Background()
	st := &models.Stand{ID: uuid.NewString(), Name: "idp", DefaultCluster: "in-cluster"}
	if err := srv.Store.CreateStand(ctx, st); err != nil {
		t.Fatal(err)
	}
	order := func(name string, status models.RequestStatus, drifted bool) *models.Request {
		r := &models.Request{
			ID: uuid.NewString(), CreatedBy: "u1", CreatedByName: "U One", Team: "core",
			ChartProject: "platform", ChartName: "postgres", ChartVersion: "1",
			ServiceName: name, StandID: st.ID, Cluster: "in-cluster", Namespace: name,
			ValuesYAML: "{}", Status: status, Drifted: drifted,
		}
		if err := srv.Store.CreateRequest(ctx, r); err != nil {
			t.Fatal(err)
		}
		if err := srv.Store.AddEvent(ctx, &models.RequestEvent{RequestID: r.ID, Actor: "u1", EventType: "created"}); err != nil {
			t.Fatal(err)
		}
		return r
	}
	broken := order("broken", models.StatusDegraded, false)
	drifted := order("drifted", models.StatusHealthy, true)
	moving := order("moving", models.StatusMRCreated, false)
	order("draft", models.StatusDraft, false)
	// What the platform did on its own is not an action.
	if err := srv.Store.AddEvent(ctx, &models.RequestEvent{RequestID: broken.ID, Actor: models.ActorSystem, EventType: "app_error"}); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq("GET", "/api/v1/admin/board", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("board: %d body=%s", rec.Code, rec.Body.String())
	}
	var b api.Board
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}

	if len(b.Attention) < 2 {
		t.Fatalf("attention: %+v", b.Attention)
	}
	first, second := b.Attention[0], b.Attention[1]
	if first.Code != "order_degraded" || first.Severity != api.SeverityCritical || first.OrderID != broken.ID || first.Stand != "idp" {
		t.Fatalf("first problem: %+v", first)
	}
	if second.Code != "order_drifted" || second.Severity != api.SeverityWarning || second.OrderID != drifted.ID {
		t.Fatalf("second problem: %+v", second)
	}
	if len(b.InProgress) != 1 || b.InProgress[0].OrderID != moving.ID || b.InProgress[0].Status != string(models.StatusMRCreated) {
		t.Fatalf("in progress: %+v", b.InProgress)
	}

	// Four orders were created today, the draft among them by event but not
	// as a live order; the system's event is no action.
	if b.Tiles.Orders.Value != 4 || b.Tiles.Orders.Total == nil || *b.Tiles.Orders.Total != 3 {
		t.Fatalf("orders tile: %+v total=%v", b.Tiles.Orders, b.Tiles.Orders.Total)
	}
	if b.Tiles.Actions.Value != 4 {
		t.Fatalf("actions tile: %+v", b.Tiles.Actions)
	}
	found := map[string]bool{}
	for _, c := range b.Components {
		found[c.ID] = true
	}
	if !found["storage"] || !found["stands"] {
		t.Fatalf("components: %+v", b.Components)
	}
}
