package store

import (
	"testing"

	"idp/internal/views"
)

// Сид-документ ingress-gateway обязан проходить валидацию формата — иначе
// конструктор сразу покажет ошибки на эталонной публикации.
func TestSeedViewIsStructurallyValid(t *testing.T) {
	if issues := views.ValidateStructure(seedIngressView); len(issues) > 0 {
		t.Fatalf("seed view has issues: %+v", issues)
	}
}
