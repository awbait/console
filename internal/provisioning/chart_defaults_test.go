package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
)

// Helm hands a dependency its own values.yaml before it checks any schema. The
// portal checked only what the form sent, which is a stricter standard than the
// order will ever face - and a field under a dependency's key is nobody's to
// fill in: the form does not show it, the chart author answers it. So the person
// ended up copying the chart's own values into their order to get it accepted.
func TestOrderPassesOnADependencyValueTheChartAnswersItself(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	req, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1",
		// The pooler requires poolMode and answers it in its own values.yaml.
		Values: map[string]any{
			"auth":   map[string]any{"database": "app"},
			"pooler": map[string]any{"enabled": true},
		},
	})
	if err != nil {
		t.Fatalf("an order Helm would accept was refused: %v", err)
	}

	// And the order keeps its own values: writing the merged ones would freeze
	// today's chart defaults into it, and an upgrade would stop moving what
	// nobody touched.
	if strings.Contains(req.ValuesYAML, "poolMode") {
		t.Errorf("the chart's defaults were written into the order:\n%s", req.ValuesYAML)
	}
}

// What a dependency does not answer either is still refused: the defaults are
// there to stop the portal being stricter than Helm, not to stop it checking.
func TestOrderStillFailsOnADependencyValueNobodyAnswers(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg2",
		Values: map[string]any{
			"auth":   map[string]any{"database": "app"},
			"pooler": map[string]any{"poolMode": "nonsense"},
		},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("a value outside the dependency's enum went through: %v", err)
	}
}

// The chart's own fields keep their guard. "An incomplete draft cannot be
// submitted" is a rule somebody put there on purpose, and a dependency's
// defaults have nothing to say about it.
func TestTheChartsOwnFieldsAreStillRequired(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg3", Values: map[string]any{"auth": map[string]any{}},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("an order missing a field of the chart itself went through: %v", err)
	}
}
