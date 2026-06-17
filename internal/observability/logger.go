// Package observability wires logging and metrics.
package observability

import (
	"log/slog"
	"os"
	"strings"
)

// Logging convention (keep logs uniform and greppable across the portal):
//
//   - Every subsystem tags its logger with a "component" attribute via Component
//     so a line's origin is always clear (api, provisioning, publications,
//     poller, ...). Wire the child logger once in main and pass it down.
//   - Messages are short, lowercase, event-style and STABLE (no interpolated
//     values): "order transition", "http request", "reconcile ok". Variable
//     data goes into attributes, never into the message, so logs stay greppable.
//   - Reuse the standard attribute keys below instead of inventing synonyms.
//   - Levels: Debug = detailed flow (per-tick, per-transition, noisy endpoints);
//     Info = notable lifecycle/business events; Warn = recovered/expected errors;
//     Error = failures that need attention.
//
// Standard attribute keys (use these literal keys; do not invent synonyms):
//
//	component      // subsystem emitting the log (set via Component)
//	request_id     // HTTP correlation id (chi RequestID); NOT a domain id
//	order_id       // order (models.Request) id
//	publication_id // chart publication id
//	chart          // chart name
//	from, to       // FSM states on a transition
//	actor          // who triggered it: a user subject, or "system"
//	reconciler     // reconciler name (poller)
//	duration_ms    // elapsed milliseconds
//	err            // error value
//
// Component returns a child logger tagged with the given component name, so
// every line it emits carries component=<name>. Nil-safe: falls back to the
// default logger when log is nil (tests).
func Component(log *slog.Logger, name string) *slog.Logger {
	if log == nil {
		log = slog.Default()
	}
	return log.With(slog.String("component", name))
}

// NewLogger builds a slog logger from level and format ("json"|"text").
func NewLogger(level, format string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: lvl}
	var h slog.Handler
	if strings.ToLower(format) == "text" {
		h = slog.NewTextHandler(os.Stdout, opts)
	} else {
		h = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(h)
}
