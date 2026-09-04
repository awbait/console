package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// TestOrderAppliesViewDefaults: an order for a chart whose approved view declares
// a "defaults" block gets those values stamped into the persisted values YAML,
// overwriting any submitted value (provenance-style stamping, e.g.
// namespace.creator=console). The rule lives in the view document, not in code.
func TestOrderAppliesViewDefaults(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/creator":"console"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	mk := func(service, ns string, values map[string]any) (*models.Request, error) {
		return s.prov.Create(ctx, u, provisioning.CreateInput{
			ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
			Team: "core", ServiceName: service, Namespace: ns, Values: values, Draft: true,
		})
	}

	// Field absent in the order -> stamped in.
	r, err := mk("alpha", "ns-a", draft("app"))
	if err != nil {
		t.Fatalf("create alpha: %v", err)
	}
	if !strings.Contains(r.ValuesYAML, "creator: console") {
		t.Fatalf("default not stamped, values:\n%s", r.ValuesYAML)
	}

	// Field submitted as something else -> overwritten ("перезапись").
	r2, err := mk("bravo", "ns-b", map[string]any{"auth": map[string]any{"database": "app", "creator": "lk"}})
	if err != nil {
		t.Fatalf("create bravo: %v", err)
	}
	if strings.Contains(r2.ValuesYAML, "creator: lk") || !strings.Contains(r2.ValuesYAML, "creator: console") {
		t.Fatalf("submitted value not overwritten, values:\n%s", r2.ValuesYAML)
	}
}

// TestOrderWithoutViewKeepsValues: with no published view (and thus no defaults),
// order values are persisted unchanged.
func TestOrderWithoutViewKeepsValues(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if strings.Contains(r.ValuesYAML, "creator") {
		t.Fatalf("unexpected stamped value without a view:\n%s", r.ValuesYAML)
	}
}

// TestOrderRendersTemplatedDefaults: a default may reference what the portal
// knows about the order instead of carrying a literal.
func TestOrderRendersTemplatedDefaults(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{` +
		`"/auth/creator":"{{.User.Name}}","/auth/team":"{{.Team}}",` +
		`"/auth/host":"{{.ServiceName}}.{{.Cluster}}.example.com"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Cluster: "in-cluster", Namespace: "ns-a",
		Values: draft("app"), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, want := range []string{"creator: User One", "team: core", "host: alpha.in-cluster.example.com"} {
		if !strings.Contains(r.ValuesYAML, want) {
			t.Fatalf("want %q in values:\n%s", want, r.ValuesYAML)
		}
	}
}

// TestTemplatedDefaultKeepsOrderAuthor: the author a template stamps is the one
// who made the order, not whoever is saving it now. Support edits other teams'
// orders and background retries rewrite the same values, so reading the session
// here would quietly hand the order to somebody else, in Git.
func TestTemplatedDefaultKeepsOrderAuthor(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/creator":"{{.User.Name}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	r, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	edited, err := s.prov.Update(ctx, support(), r.ID, provisioning.UpdateInput{Values: draft("app2")})
	if err != nil {
		t.Fatalf("update by support: %v", err)
	}
	if !strings.Contains(edited.ValuesYAML, "creator: User One") {
		t.Fatalf("author must survive somebody else's edit, values:\n%s", edited.ValuesYAML)
	}
}

// TestOrderRefusesUnknownTemplateRef: a view document asking for a value the
// portal does not have refuses the order instead of writing an empty string,
// and says which field is at fault and whose problem it is.
func TestOrderRefusesUnknownTemplateRef(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/creator":"{{.Teem}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err == nil {
		t.Fatal("order with a broken default must be refused")
	}
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("want a validation error, got %T: %v", err, err)
	}
	if !strings.Contains(verr.Message, "/auth/creator") {
		t.Fatalf("message must name the field: %s", verr.Message)
	}
}

// TestOrderStampsPlatformVariable: a default may reference a value the platform
// team keeps in the portal, so a domain that moves does not cost every service
// owner an edit of their own document.
func TestOrderStampsPlatformVariable(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS_DOMAIN", Value: "example.com"}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/host":"{{.ServiceName}}.{{.Vars.OPS_DOMAIN}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	r, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.Contains(r.ValuesYAML, "host: alpha.example.com") {
		t.Fatalf("variable not stamped, values:\n%s", r.ValuesYAML)
	}
}

// TestOrderRefusesMissingVariable: a document outliving the variable it names
// refuses the order and says the variable is missing, rather than stamping an
// empty string and deploying a service named after nothing.
func TestOrderRefusesMissingVariable(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/host":"{{.Vars.GONE}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err == nil {
		t.Fatal("an order naming a missing variable must be refused")
	}
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("want a validation error, got %T: %v", err, err)
	}
	if !strings.Contains(verr.Message, "GONE") {
		t.Fatalf("message must name the variable: %s", verr.Message)
	}
}

// TestOrderStampsIntoListItem is the case this portal's charts actually write:
// the value being stamped lives inside a list ("/gateways/0/ipAddress"), not at
// the top level. It used to be dropped without a word, so a document looked
// right, validated, and did nothing.
func TestOrderStampsIntoListItem(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS_IP", Value: "10.0.0.7"}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/gateways/0/ipAddress":"{{.Vars.OPS_IP}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	values := draft("app")
	values["gateways"] = []any{map[string]any{"name": "gw1"}}
	r, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: values, Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.Contains(r.ValuesYAML, "ipAddress: 10.0.0.7") {
		t.Fatalf("value not stamped into the list item:\n%s", r.ValuesYAML)
	}
	if !strings.Contains(r.ValuesYAML, "name: gw1") {
		t.Fatalf("the item's own fields must survive:\n%s", r.ValuesYAML)
	}
}

// TestOrderStampsNumberFromVariable: a template renders text, and the chart's
// "replicas" is an integer. The value has to reach the order as a number, or the
// chart's own schema refuses the order and blames a field nobody filled in.
func TestOrderStampsNumberFromVariable(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "REPLICAS", Value: "3"}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/primary/replicas":"{{.Vars.REPLICAS}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	// Draft:false, so the values go through the chart's schema validation.
	r, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.Contains(r.ValuesYAML, "replicas: 3") {
		t.Fatalf("want a number in the values:\n%s", r.ValuesYAML)
	}
}

// TestOrderRefusesTextInNumberField: the same field, a variable holding text.
// The refusal comes from the portal and says which field and what it takes,
// instead of the chart validator complaining about the customer's form.
func TestOrderRefusesTextInNumberField(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "REPLICAS", Value: "abc"}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/primary/replicas":"{{.Vars.REPLICAS}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"),
	})
	if err == nil {
		t.Fatal("text in a number field must refuse the order")
	}
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("want a validation error, got %T: %v", err, err)
	}
	for _, want := range []string{"/primary/replicas", "целое число", "владельцу"} {
		if !strings.Contains(verr.Message, want) {
			t.Fatalf("message %q does not mention %q", verr.Message, want)
		}
	}
}
