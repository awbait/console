package provisioning

import "errors"

// Domain errors mapped to HTTP codes by the API layer.
var (
	ErrForbidden = errors.New("forbidden")
	ErrOpenMR    = errors.New("an open merge request already exists for this order")
	ErrUpstream  = errors.New("upstream unavailable")
)

// FieldError is one schema-validation failure pinned to a values field.
// Path is a JSON Pointer into the submitted values (e.g. "/gateways/0/listeners/0").
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidationError is a 422 with a human-readable reason and, when it comes from
// schema validation, a per-field breakdown for the UI.
type ValidationError struct {
	Message string
	Fields  []FieldError
}

func (e *ValidationError) Error() string { return e.Message }
