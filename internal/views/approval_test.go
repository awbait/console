package views_test

import (
	"testing"

	"console/internal/views"
)

func TestReadAutoMergeRule(t *testing.T) {
	cases := []struct {
		name         string
		doc          string
		wantDeclared bool
		wantAllowed  bool
	}{
		{
			name:         "a service that must be reviewed says so",
			doc:          `{"approval": {"autoMerge": false}}`,
			wantDeclared: true,
		},
		{
			name:         "and one that need not",
			doc:          `{"approval": {"autoMerge": true}}`,
			wantDeclared: true,
			wantAllowed:  true,
		},
		{name: "no block at all", doc: `{"views": {"order": {}}}`},
		{name: "the block without the rule", doc: `{"approval": {}}`},
		{name: "the rule in a shape we do not read", doc: `{"approval": {"autoMerge": "yes"}}`},
		{name: "not a document", doc: `not json`},
		{name: "nothing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := views.ReadAutoMergeRule([]byte(tc.doc))
			if got.Declared != tc.wantDeclared || got.Allowed != tc.wantAllowed {
				t.Fatalf("rule = %+v, want declared=%v allowed=%v", got, tc.wantDeclared, tc.wantAllowed)
			}
		})
	}
}

// The installation's setting is a ceiling: a version may refuse unattended
// merges, and none may grant them where they are switched off.
func TestAutoMergeAllowed(t *testing.T) {
	cases := []struct {
		name         string
		doc          string
		installation bool
		want         bool
	}{
		{name: "silent version follows the installation", doc: `{}`, installation: true, want: true},
		{name: "and follows it when it is off", doc: `{}`},
		{name: "a version can refuse", doc: `{"approval": {"autoMerge": false}}`, installation: true},
		{name: "a version cannot grant what is switched off", doc: `{"approval": {"autoMerge": true}}`},
		{name: "agreeing changes nothing", doc: `{"approval": {"autoMerge": true}}`, installation: true, want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := views.AutoMergeAllowed([]byte(tc.doc), tc.installation); got != tc.want {
				t.Fatalf("allowed = %v, want %v", got, tc.want)
			}
		})
	}
}
