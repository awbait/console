package models

import "errors"

// Shared sentinel errors used across upstream ports and stores.
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	// ErrStaleVersion indicates an optimistic-lock mismatch on update.
	ErrStaleVersion = errors.New("stale version")
)
