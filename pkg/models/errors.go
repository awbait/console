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
	// ErrNotConfigured means an upstream answered normally and refused: the
	// platform is not set up for what was asked (a group onboarding never
	// created, a token without the rights for it, a branch nobody may push to).
	// It is deliberately not ErrUpstream: waiting never clears it, so it must
	// not read as an outage - the API maps it to 409 instead of 502, the health
	// probe is left alone, and the UI tells the user a person has to act.
	ErrNotConfigured = errors.New("platform not configured")
)
