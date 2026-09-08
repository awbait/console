package models

import (
	"encoding/json"
	"time"
)

// Chart is a Helm chart (managed service) in the catalog.
type Chart struct {
	Project       string   `json:"project"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	IconURL       string   `json:"icon_url,omitempty"`
	LatestVersion string   `json:"latest_version"`
	Versions      []string `json:"versions"`
	AllowedTeams  []string `json:"allowed_teams,omitempty"` // empty = all teams
	// Author is the first maintainer from Chart.yaml (if any). Used as the author
	// of an auto-discovered publication. The real Harbor client does not parse
	// Chart.yaml yet, so for it this is empty.
	Author string `json:"author,omitempty"`
}

// ChartVersion is a single artifact (version) of a chart.
type ChartVersion struct {
	Project    string    `json:"project"`
	Name       string    `json:"name"`
	Version    string    `json:"version"`
	Digest     string    `json:"digest"`
	AppVersion string    `json:"app_version,omitempty"`
	Created    time.Time `json:"created"`
	Tags       []string  `json:"tags,omitempty"`
}

// ChangelogEntry is one parsed CHANGELOG.md section (Keep a Changelog).
type ChangelogEntry struct {
	Version  string             `json:"version"`
	Date     string             `json:"date,omitempty"`
	Intro    string             `json:"intro,omitempty"` // prose opening the release, before the first category
	Sections []ChangelogSection `json:"sections"`
}

// ChangelogSection is one category of an entry (Added, Fixed, ...). A slice
// rather than a map: the categories are read in the order the changelog lists
// them, and a map would hand them over alphabetically.
type ChangelogSection struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}

// SchemaDependencyAnnotation marks a property of the effective chart schema that
// the portal mounted from a dependency rather than the chart declaring it. Its
// value is the dependency's chart name. Written when the effective schema is
// built (internal/catalog), read wherever a dependency has to be told apart from
// a field of the chart itself: the view checker, the constructor, the order form.
const SchemaDependencyAnnotation = "x-dependency"

// ChartDependency is one entry of a chart's Chart.yaml "dependencies", paired
// with the values.schema.json found inside the packaged subchart.
//
// Key is what the portal addresses the dependency by: in Helm the values of a
// dependency sit in the parent's values under its alias, or under its chart name
// when there is no alias. The order form writes that key, so it is the key a view
// document names ("redis/architecture"), while Name is only what to call it on
// screen.
type ChartDependency struct {
	Name      string `json:"name"`
	Alias     string `json:"alias,omitempty"`
	Key       string `json:"key"`
	Version   string `json:"version,omitempty"`
	Condition string `json:"condition,omitempty"`
	// Schema is the dependency's own values.schema.json, verbatim. Absent for
	// most external charts, which is normal and not an error.
	Schema json.RawMessage `json:"schema,omitempty"`
	// Warning is a problem with the pair (parent, dependency) that the portal can
	// see but not fix, shown in the version constructor. Empty when there is none.
	Warning string `json:"warning,omitempty"`
}
