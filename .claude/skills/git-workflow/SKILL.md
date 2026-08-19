---
name: git-workflow
description: "Enforces the project's Git workflow: feature branches, conventional commits, PR creation, and release process. Use this skill whenever working with git - creating branches, committing, switching tasks, creating PRs, or making releases. Triggers on any git operation, branch management, PR creation, or when the user says 'сделай релиз', 'создай PR', 'закоммить', 'commit', 'release'."
---

# Git Workflow

This skill enforces the project's branching and release strategy. Every code change flows through feature branches and pull requests - main is always protected.

Where this skill and the project's `CLAUDE.md` disagree, `CLAUDE.md` wins.

## Branch Rules

### Never commit to main

All work happens on feature branches created from main:
- `feat/short-description` - new features
- `fix/short-description` - bug fixes
- `chore/short-description` - maintenance, refactoring, deps
- `docs/short-description` - documentation only
- `release/vX.Y.Z` - release preparation

Before creating a branch, pull the latest main:
```bash
git checkout main
git pull origin main
git checkout -b feat/my-feature
```

### Switching between tasks

If the current branch has uncommitted or unfinished work and the user asks for a different task:

1. Stage and commit current changes as WIP:
   ```bash
   git add -A
   git commit -m "wip: описание текущей работы"
   ```
2. Switch to main and create a new branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/new-task
   ```

The unfinished work stays safe in its branch. Never lose uncommitted changes.

## Commits

Use **Conventional Commits** format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`

Keep commits small and focused - one logical change per commit.

The message, subject and body alike, is written in **English**. Never add a
`Co-Authored-By` trailer and never mention that the change was generated. Do not
use an em dash anywhere in the message.

Before committing, pull the latest changes for the current branch to avoid conflicts:
```bash
git pull origin <current-branch> --rebase
```

## Checks

Checking the work is the author's job: build it, run the tests, run the
typechecker for the part of the tree you touched, before the commit.

**lefthook** repeats those checks on `git push` as a backstop, not as a
replacement. If the push fails there, read the error output, fix the issue,
commit the fix, and push again. Never bypass the hook with `--no-verify` unless
the user asks for it.

## Pull Requests

After finishing work on a branch:

0. If the change is visible to the user, add its entry to `CHANGELOG.md` and
   `CHANGELOG.ru.md` under `## [Unreleased]` and commit it with the change - see
   the `changelog` skill for what deserves an entry and how it is worded.
1. Push the branch:
   ```bash
   git push -u origin feat/my-feature
   ```
2. Create a PR to main using `gh pr create`
3. If the work came from an issue, write the analysis and the result there too -
   see **Issues** below
4. The **user reviews and merges** - Claude never merges PRs

PR title must be in **English**, Conventional Commits format, concise (<70 chars): on squash-merge it becomes the commit message, so Cyrillic is not allowed there. The PR body may be in Russian and should summarize what changed and why.

## Issues

Work that came from an issue ends with a comment in that issue, not only with a
pull request. The two are read by different people at different times: the pull
request is read once, next to the diff, by whoever merges it. The issue is what
stays searchable afterwards, and it is where the next person lands when the same
thing happens again - with the pull request long merged and its branch gone.

Write the comment when the pull request is opened, before the work leaves your
hands. It says, in the issue's own language:

- **Причина.** What was actually going on, in the code, and why it behaved that
  way. This is the part that has no other home: a diff shows the fix, never the
  reasoning that led to it.
- **Что сделал.** The decision taken and its boundaries: what deliberately
  stayed as it was, and why. A rejected option is worth a line when somebody is
  likely to propose it again.
- **Как проверил.** What was run or clicked, and what came out. Say plainly what
  was left unchecked.
- **Ссылка на PR.** One line at the end.

Do not restate the issue back to its author, and do not paste the diff. If the
investigation ended somewhere other than where the issue pointed, say so: that
is the most useful thing in the whole comment.

Analysis that ends without a change is a comment too. An issue closed as "not
reproducible" or "works as intended" needs its reasoning written down more than
a fixed one does, because nothing else records it.

## Releases

Releases happen **only when the user explicitly asks** ("сделай релиз", "release", etc.).

### Release process

1. Determine the new version from the `## [Unreleased]` section of the CHANGELOG
   (the `changelog` skill has the rules):
   - new capabilities (Added) → minor bump (v0.3.0 → v0.4.0)
   - only fixes (Fixed, Security) → patch bump (v0.3.0 → v0.3.1)
   - something removed or changed in a way that requires action → major bump
   - If no tags exist yet, start with v0.1.0

2. Create a release branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b release/vX.Y.Z
   ```

3. Turn `## [Unreleased]` into the `## [X.Y.Z] - YYYY-MM-DD` section in
   CHANGELOG.md and CHANGELOG.ru.md using the `changelog` skill. The entries are
   already there from the merged PRs: reread them as one release, do not
   reconstruct them from the git log

4. Commit and create a PR:
   ```bash
   git add CHANGELOG.md CHANGELOG.ru.md
   git commit -m "chore(release): prepare vX.Y.Z"
   git push -u origin release/vX.Y.Z
   gh pr create --title "release: vX.Y.Z" --body "..."
   ```

5. The **user merges** the release PR. GitHub Action automatically creates the git tag and GitHub Release from the CHANGELOG

## Prohibited Actions

Never delete branches, tags, or releases - only the user can do that. Specifically:
- No `git branch -d/-D` on remote branches
- No `git push --delete`
- No `git tag -d` + push
- No `gh release delete`
- No `git push --force` to any branch

## Quick Reference

| Situation | Action |
|-----------|--------|
| Start new feature | `git checkout main && git pull && git checkout -b feat/...` |
| Switch to another task | WIP commit → checkout main → new branch |
| Work is done | CHANGELOG под `[Unreleased]` → push (lefthook проверит) → create PR → комментарий в issue → checkout main |
| User says "release" | Determine version → release branch → CHANGELOG → PR |
| Merge conflict | Resolve, `git add`, continue rebase/merge |
