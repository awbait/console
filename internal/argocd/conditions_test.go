package argocd

import (
	"encoding/json"
	"strings"
	"testing"
)

// An application that cannot be rendered says so in status.conditions, and
// nowhere else: health stays Unknown, so a portal reading only health has
// nothing to tell anyone.
func TestApplicationCarriesTheErrorCondition(t *testing.T) {
	const body = `{
	  "metadata": {"name": "core-ingress-lk"},
	  "spec": {"project": "default", "destination": {"name": "in-cluster"}},
	  "status": {
	    "sync": {"status": "Unknown"},
	    "health": {"status": "Unknown"},
	    "conditions": [
	      {"type": "ComparisonError", "message": "failed to execute helm template command"}
	    ]
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	app := a.toApp()
	if !strings.HasPrefix(app.Error, "ComparisonError: ") ||
		!strings.Contains(app.Error, "helm template") {
		t.Errorf("error = %q", app.Error)
	}
}

// Conditions are not only failures: ArgoCD reports informational ones too, and
// an order must not be called broken over a note.
func TestApplicationIgnoresConditionsThatAreNotErrors(t *testing.T) {
	const body = `{
	  "metadata": {"name": "a"},
	  "status": {
	    "health": {"status": "Healthy"},
	    "conditions": [
	      {"type": "SharedResourceWarning", "message": "shared with another app"},
	      {"type": "OrphanedResourceWarning", "message": "an orphan"}
	    ]
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := a.toApp().Error; got != "" {
		t.Errorf("a warning was read as a failure: %q", got)
	}
}

// A condition whose type ends in Error but carries no message says nothing, and
// reporting an empty reason is worse than reporting none.
func TestApplicationSkipsAnEmptyErrorMessage(t *testing.T) {
	const body = `{
	  "metadata": {"name": "a"},
	  "status": {
	    "health": {"status": "Unknown"},
	    "conditions": [
	      {"type": "ComparisonError", "message": "   "},
	      {"type": "SyncError", "message": "could not apply"}
	    ]
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := a.toApp().Error; got != "SyncError: could not apply" {
		t.Errorf("error = %q", got)
	}
}

// An application with nothing wrong carries no error at all.
func TestApplicationWithoutConditions(t *testing.T) {
	var a apiApp
	if err := json.Unmarshal([]byte(`{"metadata":{"name":"a"},"status":{"health":{"status":"Healthy"}}}`), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := a.toApp().Error; got != "" {
		t.Errorf("error = %q", got)
	}
}
