package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"console/internal/auth"
	"console/internal/provisioning"
	"console/internal/publications"
	"console/pkg/models"
	"github.com/go-chi/chi/v5/middleware"
)

type errorBody struct {
	Error   string                    `json:"error"`
	Message string                    `json:"message,omitempty"`
	Details []provisioning.FieldError `json:"details,omitempty"`
	// MRURL/MRIID accompany the "open_mr" conflict so the UI can link to the
	// merge request that blocks a new change.
	MRURL string `json:"mr_url,omitempty"`
	MRIID int    `json:"mr_iid,omitempty"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, errorBody{Error: errCode, Message: msg})
}

// writeDomainErr maps domain/store errors to HTTP responses per the spec table.
//
// It is a method, and takes the request, for one reason: the log. A failure the
// portal blames on something outside itself carries its whole story in the error
// chain ("upstream unavailable: gitlab commit: status 403 ..."), and until this
// was written that chain went into the response body and nowhere else - read
// once in a browser, then gone. Whoever is handed "the order does not go
// through" gets the same line in the log now, joined to the access line by
// request_id.
func (s *Server) writeDomainErr(w http.ResponseWriter, r *http.Request, err error) {
	s.logDomainErr(r, err)
	var ve *provisioning.ValidationError
	var pve *publications.ValidationError
	var ome *provisioning.OpenMRError
	switch {
	case errors.As(err, &ome):
		// An order's open MR blocks the change: 409 with a link so the UI can
		// point the user at it instead of showing a bare English domain string.
		writeJSON(w, http.StatusConflict,
			errorBody{Error: "open_mr", Message: ome.Error(), MRURL: ome.URL, MRIID: ome.IID})
	case errors.As(err, &ve):
		writeJSON(w, http.StatusUnprocessableEntity,
			errorBody{Error: "validation_failed", Message: ve.Message, Details: ve.Fields})
	case errors.As(err, &pve):
		// Report view-document issues in details using the same path+message
		// format as values schema errors.
		details := make([]provisioning.FieldError, 0, len(pve.Issues))
		for _, is := range pve.Issues {
			details = append(details, provisioning.FieldError{Path: is.Path, Message: is.Message})
		}
		writeJSON(w, http.StatusUnprocessableEntity,
			errorBody{Error: "validation_failed", Message: pve.Message, Details: details})
	case errors.Is(err, models.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found", "")
	case errors.Is(err, models.ErrConflict), errors.Is(err, models.ErrStaleVersion),
		errors.Is(err, provisioning.ErrOpenMR), errors.Is(err, publications.ErrPendingLocked):
		writeErr(w, http.StatusConflict, "conflict", msgOf(err))
	case errors.Is(err, provisioning.ErrForbidden), errors.Is(err, publications.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "")
	case errors.Is(err, models.ErrUpstream):
		// The message is the internal chain ("upstream unavailable: harbor: ...")
		// and stays for logs and support; the UI renders its own text per code,
		// because what the user can do about it depends on the page, not on which
		// upstream failed.
		writeErr(w, http.StatusBadGateway, "upstream_unavailable", msgOf(err))
	case errors.Is(err, models.ErrNotConfigured):
		// The upstream answered and refused: a group nobody created, a token
		// without the rights for it. Not a 502 on purpose - the platform is up,
		// so neither the health probe nor the outage banner should fire, and the
		// user is told to wait for a person rather than to try again.
		writeErr(w, http.StatusConflict, "not_configured", msgOf(err))
	case errors.Is(err, auth.ErrUnauthenticated):
		writeErr(w, http.StatusUnauthorized, "unauthorized", "")
	default:
		writeErr(w, http.StatusInternalServerError, "internal", "")
	}
}

// logDomainErr writes the failures worth a log line, and only those. A refused
// or absent thing is the ordinary course of a request (a 404 on a deleted order,
// a form that did not validate) and says nothing about the portal's health; a
// failure against an upstream, a misconfigured platform, or an error nothing
// recognises is what somebody is later asked to explain, so it gets the full
// chain under the standard "err" key.
func (s *Server) logDomainErr(r *http.Request, err error) {
	if err == nil {
		return
	}
	var level slog.Level
	switch {
	case errors.Is(err, models.ErrUpstream), errors.Is(err, models.ErrNotConfigured):
		level = slog.LevelWarn
	case isExpected(err):
		return
	default:
		// Whatever falls through here answers 500 with the bare code "internal";
		// the log is the only place its cause survives.
		level = slog.LevelError
	}
	ctx := r.Context()
	s.logger().LogAttrs(ctx, level, "request failed",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("request_id", middleware.GetReqID(ctx)),
		slog.String("err", err.Error()))
}

// isExpected reports whether an error is a normal answer to a request rather
// than a fault: the API states it in the response and there is nothing to
// investigate afterwards.
func isExpected(err error) bool {
	var ve *provisioning.ValidationError
	var pve *publications.ValidationError
	var ome *provisioning.OpenMRError
	switch {
	case errors.As(err, &ve), errors.As(err, &pve), errors.As(err, &ome):
		return true
	case errors.Is(err, models.ErrNotFound), errors.Is(err, models.ErrConflict),
		errors.Is(err, models.ErrStaleVersion), errors.Is(err, provisioning.ErrOpenMR),
		errors.Is(err, publications.ErrPendingLocked), errors.Is(err, provisioning.ErrForbidden),
		errors.Is(err, publications.ErrForbidden), errors.Is(err, auth.ErrUnauthenticated):
		return true
	}
	return false
}

func msgOf(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
