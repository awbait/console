package argocd

import (
	"encoding/json"
	"testing"
	"time"
)

// What the portal reads off an application in the middle of an upgrade: which
// chart version the application currently asks for, and which one the sync that
// last ran was for. Both are needed to tell a failure of the version being
// ordered from the failure of the one it is replacing.
func TestApplicationCarriesTheChartVersionAndTheLastSync(t *testing.T) {
	const body = `{
	  "metadata": {"name": "core-egress-negr"},
	  "spec": {
	    "project": "default",
	    "destination": {"name": "in-cluster"},
	    "sources": [
	      {"repoURL": "harbor.example/charts", "chart": "egress-gateway", "targetRevision": "8.0.0"},
	      {"repoURL": "https://gitlab.example/managed-services", "targetRevision": "main"}
	    ]
	  },
	  "status": {
	    "sync": {"status": "OutOfSync"},
	    "health": {"status": "Healthy"},
	    "conditions": [
	      {"type": "ComparisonError", "message": "got object, want array",
	       "lastTransitionTime": "2026-09-16T17:59:00Z"}
	    ],
	    "operationState": {
	      "phase": "Failed",
	      "message": "one or more objects failed to apply",
	      "finishedAt": "2026-09-16T17:59:30Z",
	      "syncResult": {"revisions": ["5.0.0", "79483d75"]}
	    }
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	app := a.toApp()

	if app.ChartVersion != "8.0.0" {
		t.Errorf("chart version = %q, want the one the application asks for", app.ChartVersion)
	}
	if app.LastOp == nil {
		t.Fatal("the last sync was not read at all")
	}
	if !app.LastOp.Failed() {
		t.Errorf("phase = %q, want a failure", app.LastOp.Phase)
	}
	// The revision of the chart source, not of the Git one beside it: the sync
	// ran on the version the application had before the upgrade landed.
	if app.LastOp.ChartVersion != "5.0.0" {
		t.Errorf("the sync was read as being for %q, want 5.0.0", app.LastOp.ChartVersion)
	}
	if want := time.Date(2026, 9, 16, 17, 59, 30, 0, time.UTC); !app.LastOp.FinishedAt.Equal(want) {
		t.Errorf("finished at %v, want %v", app.LastOp.FinishedAt, want)
	}
	if want := time.Date(2026, 9, 16, 17, 59, 0, 0, time.UTC); !app.ErrorSince.Equal(want) {
		t.Errorf("the condition is dated %v, want %v", app.ErrorSince, want)
	}
}

// A single-source application records one revision rather than a list, and an
// application nobody has ever synced has no operation to read.
func TestApplicationWithOneSourceAndNoSyncYet(t *testing.T) {
	const body = `{
	  "metadata": {"name": "a"},
	  "spec": {"source": {"chart": "postgres", "targetRevision": "15.4.2"}},
	  "status": {"sync": {"status": "Synced"}, "health": {"status": "Healthy"}}
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	app := a.toApp()

	if app.ChartVersion != "15.4.2" {
		t.Errorf("chart version = %q", app.ChartVersion)
	}
	if app.LastOp != nil {
		t.Errorf("an application with no sync reported one: %+v", app.LastOp)
	}
	if !app.ErrorSince.IsZero() {
		t.Errorf("an application with no condition was dated %v", app.ErrorSince)
	}
}

// An application whose sources are all Git has no chart version to read, and
// saying so is what keeps the portal from treating "" as a version that does
// not match and waiting for an upgrade that already arrived.
func TestApplicationWithNoChartSource(t *testing.T) {
	const body = `{
	  "metadata": {"name": "a"},
	  "spec": {"sources": [{"repoURL": "https://gitlab.example/x", "targetRevision": "main"}]},
	  "status": {
	    "sync": {"status": "Synced"},
	    "health": {"status": "Healthy"},
	    "operationState": {"phase": "Succeeded", "syncResult": {"revision": "79483d75"}}
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	app := a.toApp()

	if app.ChartVersion != "" {
		t.Errorf("chart version = %q, want none", app.ChartVersion)
	}
	if app.LastOp == nil || app.LastOp.ChartVersion != "79483d75" {
		t.Errorf("the only revision recorded should stand in for the sync: %+v", app.LastOp)
	}
}

// A timestamp ArgoCD writes in a shape we cannot read must not become 1970:
// every age would then read as "long ago", and a complaint seconds old would be
// treated as one that has held for hours.
func TestAnUnreadableTimestampIsNotLongAgo(t *testing.T) {
	const body = `{
	  "metadata": {"name": "a"},
	  "status": {
	    "conditions": [{"type": "SyncError", "message": "boom", "lastTransitionTime": "whenever"}],
	    "operationState": {"phase": "Failed", "finishedAt": ""}
	  }
	}`
	var a apiApp
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	app := a.toApp()

	if !app.ErrorSince.IsZero() {
		t.Errorf("unreadable condition time became %v", app.ErrorSince)
	}
	if app.LastOp == nil || !app.LastOp.FinishedAt.IsZero() {
		t.Errorf("unreadable finish time became %+v", app.LastOp)
	}
}
