package models

import "errors"

// Shared sentinel errors used across upstream ports and stores.
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	// ErrStaleVersion indicates an optimistic-lock mismatch on update.
	ErrStaleVersion = errors.New("stale version")
	// ErrUpstream means an external system (Harbor, GitLab, ArgoCD) could not be
	// reached or refused to answer. It lives here rather than in one domain
	// package because every domain talking to an upstream needs it, and the API
	// layer maps it to 502 - without it a registry outage reads as an internal
	// server error and the user sees the bare code "internal".
	ErrUpstream = errors.New("upstream unavailable")
)
