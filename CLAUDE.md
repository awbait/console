# CLAUDE.md — project rules & context

Internal Developer Portal: Go backend (`cmd/portal`, `internal/…`) + React SPA
(`web/`). Catalog of Helm charts from **Harbor**, self-service orders via **GitLab**
GitOps MRs, deploy status from **ArgoCD**. Spec: `docs/idp-spec.md`. Chart layout:
`docs/chart-convention.md`.

## Workflow rules

- **Commits: Conventional Commits, and DO NOT add a `Co-Authored-By` trailer.**
  (`type(scope): summary`, e.g. `feat(status): …`, `fix(api): …`, `docs: …`,
  `refactor(stand): …`.) One logical change per commit.
- **Verify before committing.** Backend: `go build ./...` and `go test ./...`
  (run from repo root, or `go -C <repo> …` if the shell cwd drifted). Frontend:
  `cd web && npx tsc --noEmit`. Don't commit red.
- Touch only what the task needs; match surrounding style.

## Architecture

- **Ports/adapters per upstream.** Each of `internal/{harbor,gitlab,argocd}` has a
  `Port` interface, a `Fake` (in-memory), and a real `Client`. Tests construct the
  `Fake` directly; they don't go through config.
- **`*_MODE` defaults to `real`** (so a misconfigured deploy fails loudly).
  `fake` is opt-in: tests + explicit local dev (`make run`, `run-oidc.ps1` without
  `-RealGitlab` — both set `*_MODE=fake` explicitly).
- **Storage:** `store.Store` (Postgres/`memory`) + `cache.Cache` (Redis/`memory`).
  Postgres migrations in `internal/store/migrations/*.up.sql` are **auto-applied
  on startup** (embedded) — add a new numbered file, no manual step.
- **Provisioning:** order FSM + GitOps in `internal/provisioning` (`service.go`,
  `gitops.go`, `reconcile.go`); reverse-sync in `drift.go`/`pull.go`/`import.go`.
  A background poller (`internal/status`) runs reconcilers; single-replica.
- **Catalog source is always Harbor in real mode** (live listing → new chart
  versions show immediately). Redis caches only file bodies by digest.

## Charts — IMPORTANT

The repo is **chart-agnostic**: deployable charts (ingress-gateway, egress, …)
live OUTSIDE this repo and are published to Harbor by their own pipeline. **Never
vendor real charts here / never re-create a top-level `charts/` dir.** The only
chart-shaped thing is the minimal **test fixture** in
`internal/harbor/charts/platform/ingress-gateway/` (embedded for `harbor` unit
tests + `HARBOR_MODE=fake`). Seed a stand's Harbor from an external dir via
`deployments/kind/50-charts.ps1 -ChartsDir <path>` (`STAND_CHARTS_DIR`).

## Stand & layout (`deployments/`)

- `deployments/docker-compose.yml` (+ `.upstreams.yml`), `keycloak/`, `gitlab/`.
- `deployments/kind/` — KinD + Argo CD + Harbor + istio bring-up (`up.ps1`,
  numbered steps, `README.md`).
- `deployments/scripts/` — host helpers: `run-oidc.ps1`, `dev-web.ps1`,
  `reset-state.ps1`, `seed-import.ps1`.
- Make targets: `run`, `up`/`down`, `up-upstreams`/`down-upstreams`,
  `gitlab-seed`, `stand-up`/`stand-down`/`stand-charts`/`stand-token`/`stand-reset`,
  `seed-import`, `test`/`vet`/`cover`.

## Environment

- Windows + **PowerShell 5.1** (no `&&`/ternary/`??`; `2>&1` on native exes is a
  trap; `param()` first; here-string `'@` at column 0). Bash also available.
- Git: `core.autocrlf=false` (files are LF). Identity is set locally.
- Frontend: React + React Aria Components + Tailwind + Monaco (Vite/TS).
  Forms render from `values.schema.json`; presentation projections live in
  `web/public/schemas/<chart>.ui.json` (views: order/routes/listeners/resources).
  Shared `ui.Select` defaults its placeholder to RU «Выберите…».
- UI/comments/docs are largely Russian — keep new user-facing text Russian.

## Don't

- Don't re-introduce charts into the repo, or flip `*_MODE` default back to fake.
- Don't run destructive stand ops (`stand-reset`, deletes) unless asked.
- Don't add `Co-Authored-By` to commits.

## Правила для Claude

- **Никогда не добавлять `Co-Authored-By` в коммиты.**
- **Никогда не добавлять `Generated with Claude Code` в PR.**
- **Не использовать длинное тире (em dash `—`) нигде** — ни в коде, ни в Markdown, ни в issue, PR, комментариях, ни в ответах. Вместо него: обычный дефис `-`, двоеточие или перестроить фразу.
- **Отвечать на русском.** Все ответы, комментарии и пояснения — на русском языке.
- **Комментарии в коде — только на английском.** Русский язык допустим только в Markdown-файлах (`.md`), issue, PR и коммитах. В исходниках (Go, TS, Python, Makefile, конфиги) — никакой кириллицы: редакторы и Gitea подсвечивают её как ambiguous Unicode.
- **Удалять артефакты сборки.** Если `go build` или другая команда создаёт бинарники (`.exe`, бинарные файлы), удалять их после проверки. Не оставлять в рабочей директории.
