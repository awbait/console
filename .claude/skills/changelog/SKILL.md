---
name: changelog
description: "Maintain the changelog in Keep a Changelog format: add an entry for every user-visible change under [Unreleased], turn [Unreleased] into a version section on release, and pick the semantic version. Use whenever a change is finished or a release is prepared, or when the user says 'changelog', 'журнал изменений', 'release notes', 'какая версия'."
---

# Changelog

The changelog is a product document, not a git log. It answers one question for
the person using the product: what is different now, and what does it mean for
me.

Two moments matter:

1. **A change is finished.** Its entry goes under `## [Unreleased]` in the same
   pull request that makes the change, so nothing has to be reconstructed later.
2. **A release is cut.** `## [Unreleased]` becomes a version section with a
   date, and a fresh empty `## [Unreleased]` takes its place.

## File layout

Follow [Keep a Changelog](https://keepachangelog.com/) with the newest version
on top:

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Dark mode: the interface follows the system theme or a choice of your own.

## [1.2.0] - 2025-01-15

### Added
- Two-factor authentication. Turn it on in Settings, Security.

### Changed
- Search returns results noticeably faster on large projects.

### Fixed
- The password reset email no longer gets lost for addresses with a plus sign.

[Unreleased]: https://github.com/<owner>/<repo>/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/<owner>/<repo>/compare/v1.1.0...v1.2.0
```

Categories, in this order, and only the ones that have entries: **Added**,
**Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.

One line under the title says what the file is; there is no boilerplate about
the format or the versioning scheme, since it is written for the reader of the
product, not for the reader of the standard.

## Step 1: an entry per change

Add the entry in the same pull request as the change itself. Put it under
`## [Unreleased]`, in the category it belongs to, at the end of that category's
list.

**Write an entry when the change is visible or significant for the user:** a new
capability, a changed behaviour or wording, a removed or renamed thing, a fixed
defect someone could hit, a security fix, a new requirement to run or configure
the product.

**Skip it when nobody outside the code can tell:** refactoring, internal
renames, test-only work, CI and build tweaks, dependency bumps with no visible
effect, formatting, typo fixes in comments.

One bullet per change. If a single pull request does two visible things, it gets
two bullets, possibly in two categories.

## Step 2: the style

Write for the person using the product, in their language, in short finished
sentences. Say what is different and, when it is not obvious, what it gives them
or what to do about it.

**An entry is at most three sentences, and every one of them has a job:**

1. **What it is now.** Present tense, naming the place in the interface. Always
   there.
2. **What it was.** One short sentence, only where the change makes no sense
   without it.
3. **What to do.** A button to press, a setting to write. Only where something
   is actually required of the reader.

Nothing else belongs in an entry. Why we decided to do it, which layer changed,
where the rule is now declared - that is written for us, and it is what turns a
two-sentence entry into a six-sentence one.

**Sentence length is the rule that matters most.** A changelog is skimmed, not
read. An entry written as one flowing sentence with clauses hanging off it is
the single most common way to make it unreadable, and it is what this section
exists to prevent.

- **Every entry stands on its own: what changed, where it is, what to do with
  it.** Short is not the goal - understood is. "The owner learns that a version
  was approved" answers nothing: learns where? "The portal announces its own
  updates" - announces how? Name the place in the interface the reader will find
  it, in the words the interface uses.
- **Never refer to something the reader may never have seen.** "The stripe in
  the catalog is gone" means nothing to somebody who never saw it. Say what it
  was ("a message on the catalog page") or drop the comparison entirely.
- **Name the feature, then use plain words.** Introduce the bell once, when the
  notifications arrive; after that a notification simply "arrives", it is not
  "written into the bell".
- **One sentence, one thought, about 15 words.** Two thoughts are two sentences.
- **More than three sentences means it is two entries.** Split it, or drop what
  the reader was never going to act on.
- **"What it was" is about the product, not about the reader.** "People filled
  it in anyway", "users kept getting confused" are guesses nobody checked. Say
  what the portal or the cluster did: the field was shown for every protocol,
  and a domain on TCP stopped the gateway from rolling out.
- **No list of five things inside an entry.** Name the class of them - "the
  token, the webhook, a Harbor or Argo CD project" - and let the page itself
  show the rest.
- **No parenthetical asides set off by dashes, and no semicolons.** If a clause
  needs punctuation to be squeezed in, it is a sentence of its own.
- **Lead with what the reader sees now.** How it used to be comes after, in one
  short sentence, and only when the change makes no sense without it.
- **No narrator, and no writerly turns of phrase.** "The page went on looking
  current", "waiting looks like the content that is coming", "the menu keeps one
  geometry" - each of those made a reader stop and decode it. Say "the page kept
  showing stale data", "an outline of the data is shown while it loads", "the
  icons stay on the same line".
- No internal vocabulary: no function, file, package, table, flag or endpoint
  names, no ticket numbers, no branch or commit references.
- **A term the reader meets is not internal vocabulary.** Protocols, namespace,
  merge request, the name of an environment variable - keep them, spelling them
  out costs the reader more than it saves. The line is whether the word lives
  anywhere outside our code.
- No implementation detail: the reader does not care which layer changed or how
  it was done, only what changed for them.
- Be specific. "Bug fixes", "performance improvements" and "various
  improvements" say nothing.
- Do not paste commit subjects. A conventional-commit line is written for
  developers; rewrite it.
- Name the visible thing the way the interface names it. A setting the reader
  has to write themselves is part of that surface: name it exactly, the way it
  is written in the configuration. In a translated file this holds for the
  translated wording, see **Translations**.

| Instead of | Write |
| --- | --- |
| `feat(web): add SUB_ROW constant to sidebar` | The sidebar menu lines up in one column, so a long list is easier to scan. |
| Fixed a nil pointer dereference in the order poller | An order no longer gets stuck without a status when the deployment takes a long time. |
| Performance improvements | The catalog opens in about a second even with several hundred products. |
| Bumped the OIDC library | (no entry: nothing changed for the user) |

Length and missing context are where entries go wrong, and they go wrong in
opposite directions - one long sentence nobody finishes, or a short one that
answers nothing:

| Instead of | Write |
| --- | --- |
| A value the order was refused for is explained in the words the field itself used while it was being filled in, and a missing value is pointed at the field rather than at the block around it. | The order form explains a refusal in the same words its hint used. A field you skipped is highlighted itself. |
| The owner learns that a version was approved or rejected. | The team publishing a service is notified what became of its version: approved or rejected. A rejection carries the reviewer's comment. |
| The stripe in the catalog is gone. | This used to be a message on the catalog page, and it is gone. |

Read every entry back as the person using the product, and answer for them:
what changed, where it is, what to do with it. If any of the three has no
answer, the entry is not finished.

Breaking changes go into **Changed**, **Removed** or **Deprecated** and always
say what to do instead: what replaces the removed thing, or what has to be
updated before the new version works.

## Step 3: the release

When a release is prepared:

1. Replace the `## [Unreleased]` heading with `## [X.Y.Z] - YYYY-MM-DD` (the
   release date in ISO format).
2. Optionally open the section with one or two sentences that say what this
   release is about, above the categories.
3. Insert a fresh empty `## [Unreleased]` above it.
4. Update the link references at the bottom of the file if the project uses
   them: point `[Unreleased]` at `compare/vX.Y.Z...HEAD` and add a line for the
   new version.
5. Reread the section as a whole: merge entries that describe the same change,
   drop what turned out to be invisible to the user, put the entries that matter
   most first.

Never edit a section of an already released version, except to correct an error
in it. Text nobody can read is such an error: rewording a released entry so it
can be understood is allowed, dropping or rewriting what it says is not.

## Step 4: the version number

`MAJOR.MINOR.PATCH`, decided by the content of the release section:

- **MAJOR**: something the user relied on is gone or works differently in a way
  that requires action (entries under Removed, or breaking ones under Changed).
- **MINOR**: new capabilities, everything keeps working without action (Added).
- **PATCH**: only fixes (Fixed, Security).

Before `1.0.0` a project may keep breaking changes in the minor position
(`0.1.0` to `0.2.0`); stay consistent with what the project already did.

## Translations

If the project keeps translated changelogs (`CHANGELOG.ru.md` and the like),
update every one of them in the same change. They must stay identical in
structure: the same versions, the same dates, the same categories in the same
order, the same number of entries in the same order. Only the wording is
translated, and it is translated as product text, not word by word.

Category names in Russian: Added - Добавлено, Changed - Изменено, Deprecated -
Устарело, Removed - Удалено, Fixed - Исправлено, Security - Безопасность.

**Each file is written in one language, all the way through.** Page, button and
field names are translated with the rest of the entry, even where the interface
itself is only in the other language. A quoted original dropped into the middle
of a translated sentence makes the entry read as two languages at once, and the
reader who needs the exact wording has the other file for it.

## This project

The rules above are the whole method; this section is only what is specific to
the Console repository.

- Two files, kept in one change and identical in structure: `CHANGELOG.md`
  (English) and `CHANGELOG.ru.md` (Russian).
- The version number is never set by hand outside a release. `## [Unreleased]`
  becomes `## [X.Y.Z] - YYYY-MM-DD` only in the release pull request
  (`release/vX.Y.Z`); merging it lets a GitHub Action create the tag and the
  GitHub Release from the changelog. The `git-workflow` skill has the order of
  steps.
- Chart changes are logged separately, in the chart's own `CHANGELOG.md` inside
  the charts repository, not here.

## Rules

**Must**

- Newest version first, `[Unreleased]` always on top.
- Dates in `YYYY-MM-DD`.
- Every entry in a category, every category with at least one entry.
- Every user-visible change gets an entry in the pull request that makes it.
- All translations updated together.

**Must not**

- No copied git log or commit subjects.
- No vague entries.
- No internal names or implementation detail.
- No entry for a change nobody outside the code can observe.
- No editing of released sections.
