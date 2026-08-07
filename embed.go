// Package console embeds the repository files that ship inside the portal
// binary but have to stay at the repository root, where the rest of the tooling
// looks for them: the release workflow reads the changelog from there, and an
// embed directive cannot reach outside its own directory.
package console

import _ "embed"

// ChangelogRU is the portal's own changelog, served on the About page. The
// portal speaks Russian, so the English original is not embedded.
//
//go:embed CHANGELOG.ru.md
var ChangelogRU []byte
