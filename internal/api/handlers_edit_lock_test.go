package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"console/internal/publications"
	"console/pkg/models"
)

// TestEditLockAPI drives the edit lease over HTTP: the holder, the colleague
// who is refused by name, the save that is refused with them, the forced
// hand-over, the release, and the badge in the versions list.
func TestEditLockAPI(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()
	ctx := context.Background()
	view := json.RawMessage(`{"views":{"order":{"identity":"/gateways/0/name","include":["gateways"]}}}`)

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
	base := "/api/v1/publications/" + pub.ID + "/versions/3.1.0"

	// as makes the dev request come from a named person.
	as := func(r *http.Request, sub, name string) *http.Request {
		r.Header.Set("X-Dev-Sub", sub)
		r.Header.Set("X-Dev-Name", name)
		return r
	}
	alice := func(method, path string, body any) *http.Request {
		return as(devReq(method, path, "core", body), "u-alice", "Alice")
	}
	bob := func(method, path string, body any) *http.Request {
		return as(devReq(method, path, "core", body), "u-bob", "Bob")
	}
	do := func(req *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	var errBody struct {
		Error  string         `json:"error"`
		Editor *models.Editor `json:"editor"`
	}
	wantLocked := func(rec *httptest.ResponseRecorder, holder string) {
		t.Helper()
		if rec.Code != http.StatusConflict {
			t.Fatalf("want 409, got %d body=%s", rec.Code, rec.Body.String())
		}
		errBody.Editor = nil
		_ = json.Unmarshal(rec.Body.Bytes(), &errBody)
		if errBody.Error != "edit_locked" || errBody.Editor == nil || errBody.Editor.Subject != holder {
			t.Fatalf("want edit_locked by %s, got %s", holder, rec.Body.String())
		}
	}

	// Alice takes the document.
	rec := do(alice("POST", base+"/lock", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("alice lock: %d body=%s", rec.Code, rec.Body.String())
	}
	var ed models.Editor
	_ = json.Unmarshal(rec.Body.Bytes(), &ed)
	if ed.Subject != "u-alice" || ed.Name != "Alice" || ed.Until.IsZero() {
		t.Fatalf("alice lock body: %+v", ed)
	}

	// Bob is refused by name, on the lock and on the save; an outsider is
	// forbidden before the lease is even looked at.
	wantLocked(do(bob("POST", base+"/lock", nil)), "u-alice")
	wantLocked(do(bob("PUT", base, map[string]any{"view": view})), "u-alice")
	if rec := do(as(devReq("POST", base+"/lock", "other", nil), "u-eve", "Eve")); rec.Code != http.StatusForbidden {
		t.Fatalf("outsider lock: %d", rec.Code)
	}

	// Everybody can ask who holds it.
	rec = do(bob("GET", base+"/lock", nil))
	var who struct {
		Editing *models.Editor `json:"editing"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &who)
	if rec.Code != http.StatusOK || who.Editing == nil || who.Editing.Subject != "u-alice" {
		t.Fatalf("get lock: %d body=%s", rec.Code, rec.Body.String())
	}

	// Alice's save is announced on the version's topic, and the versions list
	// carries the badge.
	ch, unsub := srv.Bus.Subscribe(publications.VersionTopic(pub.ID, "3.1.0"))
	defer unsub()
	if rec := do(alice("PUT", base, map[string]any{"view": view})); rec.Code != http.StatusOK {
		t.Fatalf("alice save: %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case e := <-ch:
		if e.Type != "view_saved" {
			t.Fatalf("event = %s", e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("no view_saved event")
	}
	rec = do(bob("GET", "/api/v1/publications/"+pub.ID+"/versions", nil))
	var list []models.PublicationVersion
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != http.StatusOK || len(list) != 1 || list[0].Editing == nil || list[0].Editing.Subject != "u-alice" {
		t.Fatalf("versions list: %d body=%s", rec.Code, rec.Body.String())
	}

	// Force is the administrator's: Bob may not, the admin takes it over and
	// Alice is refused from then on.
	if rec := do(bob("POST", base+"/lock", map[string]any{"force": true})); rec.Code != http.StatusForbidden {
		t.Fatalf("bob force: %d body=%s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", base+"/lock", map[string]any{"force": true})); rec.Code != http.StatusOK {
		t.Fatalf("admin force: %d body=%s", rec.Code, rec.Body.String())
	}
	wantLocked(do(alice("PUT", base, map[string]any{"view": view})), "dev-user")

	// Release: not Alice's any more, the admin's to give back, and giving back
	// what nobody holds is fine.
	wantLocked(do(alice("DELETE", base+"/lock", nil)), "dev-user")
	if rec := do(adminReq("DELETE", base+"/lock", nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("admin release: %d body=%s", rec.Code, rec.Body.String())
	}
	if rec := do(bob("DELETE", base+"/lock", nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("release of nothing: %d body=%s", rec.Code, rec.Body.String())
	}
	rec = do(bob("GET", base+"/lock", nil))
	who.Editing = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &who)
	if who.Editing != nil {
		t.Fatalf("still held: %s", rec.Body.String())
	}

	// The stream opens for a reader and closes with the request.
	sctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	rec = do(bob("GET", base+"/events", nil).WithContext(sctx))
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("events: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := do(bob("GET", "/api/v1/publications/missing/versions/3.1.0/events", nil)); rec.Code != http.StatusNotFound {
		t.Fatalf("events of missing publication: %d", rec.Code)
	}
}
