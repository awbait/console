package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"console/internal/activity"
	"console/internal/api"
	"console/internal/cache"
	"console/pkg/models"
)

// The activity page is a list of named people. No role but the platform admin
// has a reason to read it, and the gate is what keeps it that way.
func TestActivityIsAdminOnly(t *testing.T) {
	srv, _, _ := newServer(t)
	p, _ := srv.Cache.(cache.Presence)
	srv.Activity = activity.New(srv.Store, srv.Cache, p, nil)
	h := srv.Router()

	for _, path := range []string{"/api/v1/admin/activity", "/api/v1/admin/online"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, devReq("GET", path, "core", nil))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s as a member: %d body=%s", path, rec.Code, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, adminReq("GET", path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s as an admin: %d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

// Without a recorder the endpoints say so instead of pretending nobody uses the
// portal.
func TestActivityUnwired(t *testing.T) {
	srv, _, _ := newServer(t)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq("GET", "/api/v1/admin/activity", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unwired activity: %d body=%s", rec.Code, rec.Body.String())
	}
}

// What the page is built from: the directory, who is in it now, the teams, and
// what people did. The events come from the order journal, so the feed is the
// same stream the order timeline shows, minus what the platform did by itself.
func TestActivityPayload(t *testing.T) {
	srv, _, _ := newServer(t)
	p, _ := srv.Cache.(cache.Presence)
	srv.Activity = activity.New(srv.Store, srv.Cache, p, nil)
	ctx := context.Background()

	srv.Activity.Touch(ctx, &models.User{
		Subject: "u1", Name: "Ada", Email: "ada@example.org",
		Teams: []string{"core"}, Role: models.RoleMember,
	})
	r := &models.Request{ID: "55555555-5555-5555-5555-555555555555", Team: "core",
		ChartName: "gateway", ServiceName: "edge", Status: models.StatusDraft}
	if err := srv.Store.CreateRequest(ctx, r); err != nil {
		t.Fatalf("create request: %v", err)
	}
	if err := srv.Store.AddEvent(ctx, &models.RequestEvent{
		RequestID: r.ID, Actor: "u1", ActorName: "Ada", EventType: "created",
	}); err != nil {
		t.Fatalf("add event: %v", err)
	}
	if err := srv.Store.AddEvent(ctx, &models.RequestEvent{
		RequestID: r.ID, Actor: models.ActorSystem, EventType: "status_changed",
	}); err != nil {
		t.Fatalf("add system event: %v", err)
	}

	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq("GET", "/api/v1/admin/activity", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("activity: %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Totals struct {
			Users, Online, Teams int
		} `json:"totals"`
		Online []struct {
			Subject string `json:"subject"`
			Name    string `json:"name"`
		} `json:"online"`
		Teams []struct {
			Team    string `json:"team"`
			Members int    `json:"members"`
		} `json:"teams"`
		Events []struct {
			EventType string `json:"event_type"`
			ActorName string `json:"actor_name"`
			Title     string `json:"title"`
			Team      string `json:"team"`
		} `json:"events"`
		OnlineWindowSeconds int `json:"online_window_seconds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if got.Totals.Users != 1 || got.Totals.Online != 1 || got.Totals.Teams != 1 {
		t.Fatalf("totals: %+v", got.Totals)
	}
	if len(got.Online) != 1 || got.Online[0].Name != "Ada" {
		t.Fatalf("online: %+v", got.Online)
	}
	if len(got.Teams) != 1 || got.Teams[0].Team != "core" || got.Teams[0].Members != 1 {
		t.Fatalf("teams: %+v", got.Teams)
	}
	if len(got.Events) != 1 {
		t.Fatalf("want only the human event, got %+v", got.Events)
	}
	if got.Events[0].EventType != "created" || got.Events[0].Title != "edge" ||
		got.Events[0].Team != "core" || got.Events[0].ActorName != "Ada" {
		t.Fatalf("event: %+v", got.Events[0])
	}
	if got.OnlineWindowSeconds != int(activity.OnlineWindow.Seconds()) {
		t.Fatalf("window: %d", got.OnlineWindowSeconds)
	}
}

// The gauges carry no names: /metrics is served without authentication, so a
// per-person series there would be a staff list anyone able to scrape can read.
func TestMetricsCarryNoNames(t *testing.T) {
	srv, _, _ := newServer(t)
	p, _ := srv.Cache.(cache.Presence)
	srv.Activity = activity.New(srv.Store, srv.Cache, p, nil)
	ctx := context.Background()
	srv.Activity.Touch(ctx, &models.User{
		Subject: "u1", Name: "Ada", Email: "ada@example.org",
		Teams: []string{"core"}, Role: models.RoleMember,
	})
	srv.RefreshMetrics(ctx)

	rec := httptest.NewRecorder()
	api.MetricsHandler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, leak := range []string{"u1", "Ada", "ada@example.org"} {
		if strings.Contains(body, leak) {
			t.Fatalf("/metrics leaked %q", leak)
		}
	}
	if !strings.Contains(body, `console_users{state="online"}`) {
		t.Fatalf("people gauge missing from /metrics")
	}
	if !strings.Contains(body, `console_team_users{state="member",team="core"}`) {
		t.Fatalf("team gauge missing from /metrics")
	}
}
