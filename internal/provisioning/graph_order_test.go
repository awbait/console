package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// graphView is a version whose values are drawn as a graph, on the chart the
// other tests use. Only the graph block matters here.
const graphView = `{"graph":{"profile":"policies"},"views":{"order":{"include":["auth"]}}}`

func orderInput(values map[string]any, draft bool) provisioning.CreateInput {
	return provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pol1", Values: values, Draft: draft,
	}
}

// An order drawn as a graph with nothing drawn on it deploys a service with no
// rules in it. The schema cannot object - an empty list is a valid list - so
// the order path has to.
func TestOrderRefusesEmptyGraph(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(graphView))

	values := validValues()
	values["policies"] = []any{
		map[string]any{"name": "pol1", "ingress": []any{}, "egress": []any{}},
	}
	_, err := s.prov.Create(ctx, member("core"), orderInput(values, false))

	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("empty graph: want ValidationError, got %v", err)
	}
	if !strings.Contains(ve.Message, "связь") {
		t.Errorf("message = %q, want it to ask for a connection", ve.Message)
	}
}

// One rule is enough: the guard is about nothing at all, not about how much.
func TestOrderAcceptsGraphWithOneRule(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(graphView))

	values := validValues()
	values["policies"] = []any{
		map[string]any{"name": "pol1", "egress": []any{
			map[string]any{"to": []any{map[string]any{"namespace": "other"}}},
		}},
	}
	if _, err := s.prov.Create(ctx, member("core"), orderInput(values, false)); err != nil {
		t.Fatalf("one rule: %v", err)
	}
}

// A draft is where someone is still drawing, so it must stay saveable while it
// is empty. The guard belongs to ordering, not to editing.
func TestDraftMayHaveEmptyGraph(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(graphView))

	req, err := s.prov.Create(ctx, member("core"), orderInput(validValues(), true))
	if err != nil {
		t.Fatalf("empty draft: %v", err)
	}
	if req.Status != models.StatusDraft {
		t.Errorf("status = %q, want %q", req.Status, models.StatusDraft)
	}
}

// A chart with no graph is untouched by any of this: its empty lists are its
// own business.
func TestOrderWithoutGraphIsNotChecked(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2",
		[]byte(`{"views":{"order":{"include":["auth"]}}}`))

	if _, err := s.prov.Create(ctx, member("core"), orderInput(validValues(), false)); err != nil {
		t.Fatalf("chart without a graph: %v", err)
	}
}

func TestDeclarativeGraphOrderChecksReferencesAndAllowsUnlinkedNodes(t *testing.T) {
	const doc = `{"views":{"order":{}},"graph":{"profile":"declarative","version":1,"nodes":{"broker":{"collection":"/brokers","key":"/name"}},"relations":{"link":{"collection":"/links","key":"/name","from":{"node":"broker","field":"/from"},"to":{"node":"broker","field":"/to"}}}}}`
	for _, invalid := range []bool{false, true} {
		t.Run(map[bool]string{false: "unlinked", true: "dangling"}[invalid], func(t *testing.T) {
			s := newStack(t)
			seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(doc))
			values := validValues()
			values["brokers"] = []any{map[string]any{"name": "main"}}
			if invalid {
				values["links"] = []any{map[string]any{"name": "sub", "from": "missing", "to": "main"}}
			}
			_, err := s.prov.Create(context.Background(), member("core"), orderInput(values, false))
			if !invalid && err != nil {
				t.Fatal(err)
			}
			var ve *provisioning.ValidationError
			if invalid && !errors.As(err, &ve) {
				t.Fatalf("want ValidationError, got %v", err)
			}
		})
	}
}
