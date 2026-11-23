package views_test

import (
	"testing"

	"console/internal/views"
)

func TestImmutableRulesAndChanges(t *testing.T) {
	t.Run("identity and namespace sources are frozen", func(t *testing.T) {
		doc := []byte(`{
			"views": {
				"order": {
					"identity": "/gateways/0/name",
					"namespace": {
						"source": "template",
						"template": "{{.Team}}-{{.Values.global.purpose}}"
					}
				}
			}
		}`)
		rules := views.ImmutableRules(doc, nil)
		before := map[string]any{
			"gateways": []any{map[string]any{"name": "gw-main", "port": 80}},
			"global":   map[string]any{"purpose": "prod"},
		}
		// Editing a mutable sibling passes.
		okAfter := map[string]any{
			"gateways": []any{map[string]any{"name": "gw-main", "port": 443}},
			"global":   map[string]any{"purpose": "prod"},
		}
		if field, changed := views.FirstImmutableChange(before, okAfter, rules, false); changed {
			t.Fatalf("unexpected immutable change on %q", field)
		}

		// Changing identity fails.
		badID := map[string]any{
			"gateways": []any{map[string]any{"name": "gw-other", "port": 80}},
			"global":   map[string]any{"purpose": "prod"},
		}
		if field, changed := views.FirstImmutableChange(before, badID, rules, false); !changed || field != "gateways.0.name" {
			t.Fatalf("identity change = (%q, %v), want (gateways.0.name, true)", field, changed)
		}

		// Removing gateways[0] on same-version update also fails.
		removedID := map[string]any{
			"gateways": []any{},
			"global":   map[string]any{"purpose": "prod"},
		}
		if field, changed := views.FirstImmutableChange(before, removedID, rules, false); !changed || field != "gateways.0.name" {
			t.Fatalf("removed identity = (%q, %v), want (gateways.0.name, true)", field, changed)
		}
		// On upgrade (allowRemoved=true) a moved field is allowed to disappear.
		if field, changed := views.FirstImmutableChange(before, removedID, rules, true); changed {
			t.Fatalf("upgrade removal unexpectedly flagged %q", field)
		}

		// Changing namespace template input fails.
		badNS := map[string]any{
			"gateways": []any{map[string]any{"name": "gw-main", "port": 80}},
			"global":   map[string]any{"purpose": "stage"},
		}
		if field, changed := views.FirstImmutableChange(before, badNS, rules, false); !changed || field != "global.purpose" {
			t.Fatalf("namespace template field = (%q, %v), want (global.purpose, true)", field, changed)
		}
	})

	t.Run("namespace source values is frozen", func(t *testing.T) {
		doc := []byte(`{"views":{"order":{"namespace":{"source":"values","pointer":"/ns/name"}}}}`)
		rules := views.ImmutableRules(doc, nil)
		before := map[string]any{"ns": map[string]any{"name": "alpha"}}
		after := map[string]any{"ns": map[string]any{"name": "beta"}}
		if field, changed := views.FirstImmutableChange(before, after, rules, false); !changed || field != "ns.name" {
			t.Fatalf("got (%q, %v), want (ns.name, true)", field, changed)
		}
	})

	t.Run("identity inside graph entries is not frozen", func(t *testing.T) {
		doc := []byte(`{
			"views": {"order": {"identity": "/policies/0/name"}},
			"graph": {"profile": "policies", "entries": "/policies"}
		}`)
		rules := views.ImmutableRules(doc, nil)
		before := map[string]any{"policies": []any{map[string]any{"name": "p1"}}}
		after := map[string]any{"policies": []any{map[string]any{"name": "p2"}}}
		if field, changed := views.FirstImmutableChange(before, after, rules, false); changed {
			t.Fatalf("graph entry identity should not be frozen, got %q", field)
		}
	})

	t.Run("ui:readOnly in view overrides and ui:widget single", func(t *testing.T) {
		doc := []byte(`{
			"views": {
				"order": {
					"overrides": {
						"auth/database": {"ui:readOnly": true},
						"gateways": {
							"ui:widget": "single",
							"ui:view": {
								"overrides": {
									"class": {"ui:readOnly": true}
								}
							}
						}
					}
				}
			}
		}`)
		rules := views.ImmutableRules(doc, nil)
		before := map[string]any{
			"auth":     map[string]any{"database": "app"},
			"gateways": []any{map[string]any{"class": "internal"}},
		}
		badDB := map[string]any{
			"auth":     map[string]any{"database": "other"},
			"gateways": []any{map[string]any{"class": "internal"}},
		}
		if field, changed := views.FirstImmutableChange(before, badDB, rules, false); !changed || field != "auth.database" {
			t.Fatalf("got (%q, %v), want (auth.database, true)", field, changed)
		}
		badGW := map[string]any{
			"auth":     map[string]any{"database": "app"},
			"gateways": []any{map[string]any{"class": "public"}},
		}
		if field, changed := views.FirstImmutableChange(before, badGW, rules, false); !changed || field != "gateways.0.class" {
			t.Fatalf("got (%q, %v), want (gateways.0.class, true)", field, changed)
		}
		// Set-once: filling in a previously absent field is allowed.
		emptyBefore := map[string]any{}
		if field, changed := views.FirstImmutableChange(emptyBefore, before, rules, false); changed {
			t.Fatalf("set-once should allow initial fill, got %q", field)
		}
	})

	t.Run("ui:readOnly in schema and ui:readOnly false override", func(t *testing.T) {
		schema := []byte(`{
			"type": "object",
			"definitions": {
				"storage": {
					"type": "object",
					"properties": {
						"class": {"type": "string", "ui:readOnly": true},
						"size": {"type": "string", "ui:readOnly": true}
					}
				}
			},
			"properties": {
				"storage": {"$ref": "#/definitions/storage"}
			}
		}`)
		// View explicitly unlocks storage.size with ui:readOnly: false.
		doc := []byte(`{
			"views": {
				"order": {
					"overrides": {
						"storage": {
							"ui:view": {
								"overrides": {
									"size": {"ui:readOnly": false}
								}
							}
						}
					}
				}
			}
		}`)
		rules := views.ImmutableRules(doc, schema)
		before := map[string]any{"storage": map[string]any{"class": "fast", "size": "10Gi"}}
		resizeAfter := map[string]any{"storage": map[string]any{"class": "fast", "size": "20Gi"}}
		if field, changed := views.FirstImmutableChange(before, resizeAfter, rules, false); changed {
			t.Fatalf("unlocked field storage.size should be editable, got %q", field)
		}
		reclassAfter := map[string]any{"storage": map[string]any{"class": "slow", "size": "10Gi"}}
		if field, changed := views.FirstImmutableChange(before, reclassAfter, rules, false); !changed || field != "storage.class" {
			t.Fatalf("got (%q, %v), want (storage.class, true)", field, changed)
		}
	})

	t.Run("tab list matches surviving rows by uniqueBy without breaking delete or reorder", func(t *testing.T) {
		doc := []byte(`{
			"views": {
				"order": {},
				"route": {
					"overrides": {
						"name": {"ui:readOnly": true},
						"protocol": {"ui:readOnly": true}
					}
				}
			},
			"tabs": [
				{"id": "routes", "items": "/routes", "form": "route", "ui:uniqueBy": "name"}
			]
		}`)
		rules := views.ImmutableRules(doc, nil)
		before := map[string]any{
			"routes": []any{
				map[string]any{"name": "api", "protocol": "http", "port": 80},
				map[string]any{"name": "grpc", "protocol": "grpc", "port": 9090},
			},
		}
		// Deleting row 0 ("api") and adding a new row "web" must succeed.
		deletedAndAdded := map[string]any{
			"routes": []any{
				map[string]any{"name": "grpc", "protocol": "grpc", "port": 9091},
				map[string]any{"name": "web", "protocol": "https", "port": 443},
			},
		}
		if field, changed := views.FirstImmutableChange(before, deletedAndAdded, rules, false); changed {
			t.Fatalf("delete+add in tab list unexpectedly flagged %q", field)
		}
		// Changing frozen field "protocol" on surviving row "grpc" must fail.
		mutatedRow := map[string]any{
			"routes": []any{
				map[string]any{"name": "grpc", "protocol": "tcp", "port": 9090},
			},
		}
		if field, changed := views.FirstImmutableChange(before, mutatedRow, rules, false); !changed || field != "routes.0.protocol" {
			t.Fatalf("got (%q, %v), want (routes.0.protocol, true)", field, changed)
		}
	})
}
