package provisioning_test

import (
	"context"
	"fmt"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
	"gopkg.in/yaml.v3"
)

// The YAML editor submits parsed values just like the form. A constructor
// default must win on every save, while initial values remain editable.
func TestOrderYAMLClusterDefaultPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, block string
		overwrite   bool
	}{
		{"defaults", `,"defaults":{"/identity/cluster":"constructor-cluster"}`, true},
		{"initial", `,"initial":{"/identity/cluster":"constructor-cluster"}`, false},
		{"without_default", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			s := newStack(t)
			u := member("core")
			view := []byte(`{"views":{"order":{"identity":"/auth/database"}}` + tc.block + `}`)
			seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

			input := func(cluster string) map[string]any {
				t.Helper()
				var values map[string]any
				if err := yaml.Unmarshal([]byte(fmt.Sprintf("auth:\n  database: app\nidentity:\n  cluster: %s\n  environment: test\n", cluster)), &values); err != nil {
					t.Fatal(err)
				}
				return values
			}
			checkYAML := func(raw, submitted string) {
				t.Helper()
				var values struct {
					Identity struct{ Cluster, Environment string }
				}
				if err := yaml.Unmarshal([]byte(raw), &values); err != nil {
					t.Fatal(err)
				}
				want := submitted
				if tc.overwrite {
					want = "constructor-cluster"
				}
				if values.Identity.Cluster != want || values.Identity.Environment != "test" {
					t.Fatalf("want cluster=%q and unchanged sibling, got:\n%s", want, raw)
				}
			}
			checkStored := func(r *models.Request, submitted string) {
				t.Helper()
				stored, err := s.st.GetRequest(ctx, r.ID)
				if err != nil {
					t.Fatal(err)
				}
				checkYAML(stored.ValuesYAML, submitted)
				if stored.Cluster != "in-cluster" {
					t.Fatalf("values must not change the deployment cluster: %q", stored.Cluster)
				}
			}

			r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
				ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
				Team: "core", ServiceName: "pg1", Namespace: "apps",
				Values: input("yaml-cluster"), Draft: true,
			})
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			checkStored(r, "yaml-cluster")

			r, err = s.prov.Update(ctx, u, r.ID, provisioning.UpdateInput{Values: input("edited-cluster")})
			if err != nil {
				t.Fatalf("update: %v", err)
			}
			checkStored(r, "edited-cluster")

			r, err = s.prov.Submit(ctx, u, r.ID)
			if err != nil {
				t.Fatalf("submit: %v", err)
			}
			if r.Status != models.StatusMRCreated {
				t.Fatalf("want MR_CREATED, got %s", r.Status)
			}
			checkStored(r, "edited-cluster")
			s.mergeLatestMR(ctx, t, r.ID)
			checkYAML(valuesOnRef(ctx, t, s, r, "main"), "edited-cluster")
		})
	}
}
