package mcp

import (
	"errors"
	"log/slog"

	"console/internal/auth"
	"console/internal/provisioning"
	"console/internal/publications"
	"console/pkg/models"
)

var (
	errMaintenance   = errors.New("portal is in maintenance mode")
	errWriteDisabled = errors.New("write tools are disabled on this MCP server")
)

type badInputError struct{ msg string }

func (e *badInputError) Error() string { return e.msg }

// toolErrorPayload is the structured JSON body returned inside CallToolResult
// when IsError is true, matching the HTTP API's error vocabulary.
type toolErrorPayload struct {
	Error   string                    `json:"error"`
	Message string                    `json:"message,omitempty"`
	Details []provisioning.FieldError `json:"details,omitempty"`
	MRURL   string                    `json:"mr_url,omitempty"`
	MRIID   int                       `json:"mr_iid,omitempty"`
	Editor  *models.Editor            `json:"editor,omitempty"`
}

// mapError translates domain errors into safe MCP error payloads and selects
// the appropriate metric status label and log level. Internal upstream details
// (hosts, ports, drivers) are logged server-side and never returned verbatim.
func mapError(err error) (string, toolErrorPayload, slog.Level) {
	var bi *badInputError
	var ve *provisioning.ValidationError
	var pve *publications.ValidationError
	var ome *provisioning.OpenMRError
	var ele *publications.EditLockedError

	switch {
	case errors.As(err, &bi):
		return "bad_request", toolErrorPayload{Error: "bad_request", Message: bi.msg}, slog.LevelInfo
	case errors.Is(err, errMaintenance):
		return "maintenance", toolErrorPayload{Error: "maintenance", Message: "portal is currently in maintenance mode"}, slog.LevelInfo
	case errors.Is(err, errWriteDisabled):
		return "forbidden", toolErrorPayload{Error: "write_disabled", Message: "write MCP tools are disabled"}, slog.LevelInfo
	case errors.As(err, &ele):
		return "conflict", toolErrorPayload{Error: "edit_locked", Message: ele.Error(), Editor: &ele.Editor}, slog.LevelInfo
	case errors.As(err, &ome):
		return "conflict", toolErrorPayload{Error: "open_mr", Message: ome.Error(), MRURL: ome.URL, MRIID: ome.IID}, slog.LevelInfo
	case errors.As(err, &ve):
		return "validation_failed", toolErrorPayload{Error: "validation_failed", Message: ve.Message, Details: ve.Fields}, slog.LevelInfo
	case errors.As(err, &pve):
		details := make([]provisioning.FieldError, 0, len(pve.Issues))
		for _, is := range pve.Issues {
			details = append(details, provisioning.FieldError{Path: is.Path, Message: is.Message})
		}
		return "validation_failed", toolErrorPayload{Error: "validation_failed", Message: pve.Message, Details: details}, slog.LevelInfo
	case errors.Is(err, models.ErrNotFound):
		return "not_found", toolErrorPayload{Error: "not_found", Message: "resource not found"}, slog.LevelInfo
	case errors.Is(err, provisioning.ErrForbidden), errors.Is(err, publications.ErrForbidden):
		return "forbidden", toolErrorPayload{Error: "forbidden", Message: "access denied"}, slog.LevelInfo
	case errors.Is(err, models.ErrConflict), errors.Is(err, models.ErrStaleVersion),
		errors.Is(err, provisioning.ErrOpenMR), errors.Is(err, publications.ErrPendingLocked):
		return "conflict", toolErrorPayload{Error: "conflict", Message: err.Error()}, slog.LevelInfo
	case errors.Is(err, models.ErrNotConfigured):
		return "not_configured", toolErrorPayload{Error: "not_configured", Message: "upstream integration is not configured for this operation"}, slog.LevelWarn
	case errors.Is(err, models.ErrUpstream):
		return "upstream_unavailable", toolErrorPayload{Error: "upstream_unavailable", Message: "upstream service unavailable"}, slog.LevelWarn
	case errors.Is(err, auth.ErrUnauthenticated):
		return "unauthorized", toolErrorPayload{Error: "unauthorized", Message: "authentication required"}, slog.LevelInfo
	default:
		return "internal", toolErrorPayload{Error: "internal", Message: "internal error"}, slog.LevelError
	}
}
