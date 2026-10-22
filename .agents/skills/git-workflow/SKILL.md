---
name: git-workflow
description: "Enforces the project's Git workflow: feature branches, conventional commits, pull requests on GitHub or Gitea, issue comments and the release process. Use this skill whenever working with git - creating branches, committing, switching tasks, creating PRs, or making releases. Triggers on any git operation, branch management, PR creation, or when the user says 'сделай релиз', 'создай PR', 'закоммить', 'commit', 'release'."
---

# Git Workflow

This skill is the single source of truth for the Git process: branches, commits,
pull requests, issue comments and releases. Every code change flows through a
feature branch and a pull request; the default branch is always protected.

Content rules live in the project instructions (`AGENTS.md`, `CLAUDE.md`): the
language of commit messages, the ban on AI attribution, forbidden characters,
what to check before a commit. They are not repeated here. Where this skill and
the project instructions disagree, the project instructions win.

If the project has no such rules, use these defaults: commit messages and PR
titles in English, no `Co-Authored-By` or any other mention that the change was
generated, no em dash anywhere in the message.

## Forge

Find out where the repository is hosted before the first PR:

```bash
git remote get-url origin
```

**GitHub:** the `gh` CLI (`gh pr create`, `gh issue comment`).

**Gitea**, in this order:

1. **Gitea MCP tools** (`gitea-mcp` server): pull requests, issues, comments,
   labels. The main path, and the only one that keeps non-ASCII text intact
   without extra steps.
2. **Gitea REST API through `curl`** as a fallback when the MCP server is not
   available. The token comes from the `GITEA_ACCESS_TOKEN` environment
   variable; never write it into a file in the repository. On Windows, inline
   JSON with Russian text turns into `?????`: write the payload to a file from
   Python (`encoding="utf-8"`, `ensure_ascii=False`) and send it with
   `curl --data-binary @payload.json -H "Content-Type: application/json; charset=utf-8"`.
   Delete the payload file afterwards.
3. **The `tea` CLI is forbidden.** It waits for interactive input and hangs
   forever in a non-interactive shell.

If neither the MCP server nor a token is available, stop and tell the user
that the PR could not be opened and why. Do not report the work as done.

The default branch is `main` unless the repository says otherwise
(`git symbolic-ref refs/remotes/origin/HEAD`).

## Branch Rules

### Never commit to main

All work happens on branches created from main:
- `feat/short-description` - new features
- `fix/short-description` - bug fixes
- `chore/short-description` - maintenance, refactoring, deps
- `docs/short-description` - documentation only
- `release/vX.Y.Z` - release preparation

When the work comes from an issue, put its number after the type:
`feat/42-short-description`. Statuses, labels and the claim on the issue itself
follow the `issue-workflow` skill.

Before creating a branch, pull the latest main:
```bash
git checkout main
git pull origin main
git checkout -b feat/my-feature
```

The only exception is an empty repository with no commits yet: the first commit
that creates main goes to main directly.

### Switching between tasks

If the current branch has uncommitted or unfinished work and the user asks for a
different task:

1. Commit the current changes as WIP:
   ```bash
   git add -A
   git commit -m "wip: describe the unfinished work"
   ```
2. Switch to main and create a new branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/new-task
   ```

The unfinished work stays safe in its branch. Never lose uncommitted changes.
Before `git add -A`, check `git status` for files that must not be committed
(secrets, build artifacts, local configs) and leave them out.

## Worktrees

A worktree is a second checkout of the same repository in its own folder, on its
own branch. Use one when two tasks must run at the same time (a subagent in
isolation, a long check while other work goes on). For one task at a time the
task switch above is enough.

**Where.** Use the agent's built-in worktree support when it has one (Claude Code
isolation, Codex worktrees). A worktree made by hand goes to `.worktrees/<branch>`
in the repository root:

```bash
git worktree add .worktrees/feat-my-feature -b feat/my-feature main
```

Worktree folders inside the repository are listed in `.gitignore`; check that
before creating one, or the whole copy shows up in `git status`.

**What a new worktree does not have.** Git copies only tracked files. Ignored
files are missing: installed dependencies, generated code, `.env` and other local
configs, build caches. Set them up by the project instructions before building
or testing, and never commit them from there.

**Running two copies at once.** Two worktrees on one machine share ports, Docker
and databases unless told otherwise:

- give each running copy its own ports for the dev servers;
- give each copy its own Docker Compose project name, otherwise they share
  containers and volumes;
- do not point two copies at one development database when either of them runs
  migrations.

The project instructions name the concrete variables.

**Hooks and config are shared.** Git hooks (lefthook) live in the common `.git`
and apply to every worktree; installing them once is enough.

**One branch, one worktree.** Git refuses to check out a branch that is already
checked out in another worktree. Do not work around it with `--force`.

**Cleanup.** Remove a worktree you created yourself once its PR is merged or the
task is dropped:

```bash
git worktree remove .worktrees/feat-my-feature
git worktree prune
```

This removes the folder only; the branch stays, and deleting branches remains
the user's call (see **Prohibited Actions**). Never remove a worktree with
uncommitted changes, and never remove one you did not create.

## Commits

Use **Conventional Commits**: `type(scope): description`.

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `wip`
(only for the task-switch commit above).

Keep commits small and focused: one logical change per commit.

Before committing, pull the latest changes for the current branch to avoid
conflicts:
```bash
git pull origin <current-branch> --rebase
```

Checking the work before the commit follows the project instructions. A
`lefthook` (or other) hook on `git push` is a backstop: if the push fails there,
read the error, fix it, commit the fix and push again. Never bypass a hook with
`--no-verify` unless the user asks for it.

## Pull Requests

After finishing work on a branch:

0. If the change is visible to the user and the project keeps a changelog, add
   its entry with the change, in the same branch. What deserves an entry, the
   wording and the file format are in the `changelog` skill. The changelog
   files themselves are written only on release.
0. If the project keeps technical docs that describe how the system works
   (a code-to-document map in its instructions), update the affected documents
   in the same branch. Docs updated "later" never are. A PR that does not change
   behaviour says so (some projects have a label for it, e.g. `docs/none`).
1. Push the branch and open the PR to main in the same step (see **Forge**):
   ```bash
   git push -u origin feat/my-feature
   ```
   A pushed branch without a PR is invisible to the reviewer and cannot be
   merged. Never finish with "the branch is pushed, open the PR yourself":
   commit, branch and PR go together. The only exception is when neither the
   forge MCP nor a token is available: then say so plainly and name what is
   missing.
2. The PR body says what changed, how it was checked and, if it matters,
   the merge order relative to other open PRs.
   If the project deploys a preview stand per PR, the project instructions say
   how to ask for one (usually a label). To close the issue on merge, put
   `Closes #N` (GitHub) or `fixes #N` (Gitea) in the PR body: the keyword must
   be in English even when the body is not.
3. If the work came from an issue, write the analysis and the result there too:
   see **Issues** below.
4. The **user reviews and merges**. The agent never merges PRs.

The PR title is in **English**, Conventional Commits format, concise (under 70
characters): on squash-merge it becomes the commit message, so Cyrillic is not
allowed there. The PR body may be in Russian and summarizes what changed and why.

## Issues

Work that came from an issue ends with a comment in that issue, not only with a
pull request. The two are read by different people at different times: the pull
request is read once, next to the diff, by whoever merges it. The issue is what
stays searchable afterwards, and it is where the next person lands when the same
thing happens again, with the pull request long merged and its branch gone.

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

Comment with `gh issue comment <n> --body "..."` on GitHub, or through the
Gitea MCP tools on Gitea (REST fallback: see **Forge**).

## Releases

Releases happen **only when the user explicitly asks** ("сделай релиз",
"release", etc.).

1. Choose the version by the project's versioning scheme (project
   instructions). Without one, use the SemVer rules of the `changelog` skill
   (`changelog.py next` suggests one); if no tags and no released versions
   exist yet, start with 0.1.0.
2. Create a release branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b release/vX.Y.Z
   ```
3. Assemble the changelog section with the `changelog` skill (the project's own
   builder if it has one, otherwise the skill's script). Reread the assembled
   section as one release; do not reconstruct it from the git log. Editing the
   wording here is fine; writing a new entry from scratch means somebody skipped
   step 0 of **Pull Requests**.
4. Commit and open a PR. The used entry files are removed by the assembly, so
   the deletions go into the same commit:
   ```bash
   git add CHANGELOG*.md changelog.d
   git commit -m "chore(release): prepare vX.Y.Z"
   git push -u origin release/vX.Y.Z
   ```
   PR title: `release: vX.Y.Z`.
5. The **user merges** the release PR. If CI creates the tag and the release on
   merge, do nothing more. If the project has no such automation, tell the user
   the tag is not created yet; create and push it only when asked.

## Prohibited Actions

Never delete branches, tags, or releases: only the user can do that.
Specifically:
- No `git branch -d/-D` on remote branches
- No `git push --delete`
- No `git tag -d` + push
- No `gh release delete` and no release deletion through the Gitea API or MCP
- No `git push --force` to any branch

## Quick Reference

| Situation | Action |
|-----------|--------|
| Start new feature | `git checkout main && git pull && git checkout -b feat/...` |
| Switch to another task | WIP commit, checkout main, new branch |
| Work is done | changelog entry if user-visible, docs updated per the project map, push and open the PR at once (the hook checks), create PR, comment in the issue, checkout main |
| User says "release" | version via `changelog`, release branch, assemble changelog, PR |
| Two tasks at once | worktree in `.worktrees/<branch>`, own ports and Compose project, remove it after merge |
| Merge conflict | Resolve, `git add`, continue rebase/merge |
