package api

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"console/internal/auth"
	"console/internal/maintenance"
	"console/internal/observability"
	"console/internal/provisioning"
	"console/pkg/models"
)

// Maintenance: an admin announces, extends and ends a window (see
// internal/maintenance); while it is on, everybody but the platform admins is
// answered 503 "maintenance" by the gate below.

// maintenanceView is what the admin page reads: the window as it stands, and
// the history of windows.
type maintenanceView struct {
	Status  maintenance.Status         `json:"status"`
	History []*models.MaintenanceEvent `json:"history"`
}

func (s *Server) handleGetMaintenance(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	s.writeMaintenance(w, r, s.Maintenance.Status(r.Context()))
}

func (s *Server) handleSetMaintenance(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in maintenance.Input
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	st, err := s.Maintenance.Set(r.Context(), auth.UserFrom(r.Context()), in)
	if err != nil {
		s.writeMaintenanceErr(w, r, err)
		return
	}
	s.writeMaintenance(w, r, st)
}

func (s *Server) handleEndMaintenance(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	st, err := s.Maintenance.End(r.Context(), auth.UserFrom(r.Context()))
	if err != nil {
		s.writeMaintenanceErr(w, r, err)
		return
	}
	s.writeMaintenance(w, r, st)
}

func (s *Server) writeMaintenance(w http.ResponseWriter, r *http.Request, st maintenance.Status) {
	history, err := s.Maintenance.History(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, maintenanceView{Status: st, History: history})
}

// writeMaintenanceErr answers a broken rule as validation_failed with the field
// and the rule's code in details; the admin page words it.
func (s *Server) writeMaintenanceErr(w http.ResponseWriter, r *http.Request, err error) {
	if ve, ok := err.(*maintenance.ValidationError); ok {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{
			Error:   "validation_failed",
			Message: ve.Error(),
			Details: []provisioning.FieldError{{Path: ve.Field, Message: ve.Code}},
		})
		return
	}
	s.writeDomainErr(w, r, err)
}

// requireAdmin answers 403 to anybody who is not a platform admin.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if u := auth.UserFrom(r.Context()); u == nil || !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "")
		return false
	}
	return true
}

// maintenanceOpen are the API paths that answer during maintenance whoever
// asks: who the person is (the interface needs the role to know it is locked
// out), what the portal is, and the bell, which is where the end is announced.
var maintenanceOpen = []string{"/auth/me", "/info", "/changelog", "/notifications"}

// maintenanceGate turns away everybody but platform admins while maintenance
// is on. It sits behind the authenticator, so it knows the role; sign-in,
// health and webhooks are registered outside it and never blocked.
func (s *Server) maintenanceGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Maintenance == nil || maintenanceAllowed(r.URL.Path) ||
			!s.Maintenance.Blocks(r.Context(), auth.UserFrom(r.Context())) {
			next.ServeHTTP(w, r)
			return
		}
		pub := s.Maintenance.Status(r.Context()).Public()
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter(pub, time.Now())))
		observability.ObserveMaintenanceBlocked()
		writeJSON(w, http.StatusServiceUnavailable, struct {
			Error       string             `json:"error"`
			Maintenance maintenance.Public `json:"maintenance"`
		}{Error: "maintenance", Maintenance: pub})
	})
}

func maintenanceAllowed(path string) bool {
	p := strings.TrimPrefix(path, "/api/v1")
	for _, open := range maintenanceOpen {
		if p == open || strings.HasPrefix(p, open+"/") {
			return true
		}
	}
	return false
}

// retryAfter is the seconds until the planned end, at least a minute, and five
// minutes when there is no end or it has passed.
func retryAfter(p maintenance.Public, now time.Time) int {
	if p.EndsAt == nil || !p.EndsAt.After(now) {
		return 300
	}
	return int(math.Max(60, math.Ceil(p.EndsAt.Sub(now).Seconds())))
}
