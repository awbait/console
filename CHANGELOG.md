# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- The graph opens straight from the page of an ordered service, in a window
  nearly the size of the screen, for the services that support it: you can see
  what talks to what, redraw the arrows and save them. How the boxes are arranged
  is remembered on its own.
- The portal can follow the appearance of the operating system: the theme menu
  has an option for it, it is what a first visit starts with, and the portal
  turns dark or light along with the desktop.

### Changed
- The theme is picked in a single switcher: every option is in view at once, the
  chosen one is lit, and the icon in the top bar shows which one it is.
- The order history takes only the room its events need, and splits into pages
  only once they would not fit down to the bottom of the screen.
- The general information about an order is labelled in Russian and keeps to the
  six facts about the service itself; the chart it came from, its application in
  ArgoCD and its configuration wait under "Подробнее", which opens in place.
- The order's configuration opens from a button named after what it shows, and
  the name of the file it comes from stays in the window's own header.

### Fixed
- A chart the portal found on its own is no longer credited to the
  administrators: its card says it has no owner yet instead of naming a team
  that does not own it.
- A service built on a graph can no longer be ordered empty: the portal asks for
  at least one connection, because without them the service gets no rules at all.
- An order no longer stalls in silence when its change cannot be applied on its
  own: the portal stops retrying, and the order's history records what happened
  and what is in the way.
- The placeholders that stand in for data while it loads are visible in the
  light theme instead of melting into the card they sit on.
- A sign-in that does not go through comes back to the sign-in screen and says
  what happened and what to do, instead of leaving the person on a page with an
  error message meant for nobody.
- Signing in no longer fails just because the sign-in page stood open for a few
  minutes: there is now time for a password, a second factor and a reset along
  the way.

## [0.2.0] - 2026-08-10

This release takes the portal out of demonstration mode. The stand-in registry,
git server and delivery system are gone, so an installation talks to the real
ones from the first start and will not run without their addresses and tokens.
Alongside that: services published version by version, network policies drawn as
a map instead of written by hand, sections for administrators and for support,
and a portal that says out loud when part of the platform is not answering.

### Added
- Several versions of one service. A service is published version by version:
  each version has its own order form and is approved on its own, the catalog
  card shows the recommended one and how many more are available, and the order
  form lets you pick among them.
- An upgrade offers only the versions the service owner allowed.
- A network interaction map. Draw arrows between workloads of different
  namespaces and the map writes the values for the network policies service,
  with an example scenario to start from.
- Ordering straight from the map: the drawn arrows are split into policy orders
  per namespace, the first one opens in the order form and the rest wait as
  drafts.
- Values written by hand can be pasted into the map to be drawn and edited.
- A Graph tab on the order form of the services that support it, kept in sync
  with the form and the raw values.
- A service version can declare its graph itself, so a new version can change
  the shape of its values without breaking the orders that stay on the old one.
- Search and a category filter in the catalog, both kept in the page address so
  a filtered catalog can be shared as a link.
- An Admin section: an overview, the approval queue, platform state and the
  catalog categories.
- A Support section with the orders of every team and filters by team and
  product.
- A service found in the registry by the platform can be adopted by a team:
  pick its category and owner, and it becomes yours to publish.
- Categories carry an icon, and a product shows the icon of its own chart.
- Documentation in the portal: the catalog, ordering, statuses, publishing,
  roles, sections, architecture and the roadmap.
- Platform state shows the health of the background cycles and links to Grafana.
- The portal reacts to a merge or a chart push at once instead of waiting for
  the next poll, when the webhooks are configured.
- A service can name its namespace itself, and the order form then drops the
  Namespace field and shows the namespace the chart will use.
- An order with an open merge request shows a banner linking to it and refuses
  further changes until it is closed.
- The portal says when part of the platform is not responding: a message above
  the page names what is unavailable right now, and a state icon in the top bar
  lists what works and what does not.
- Actions that cannot go through are switched off with an explanation instead of
  failing halfway: signing in while the sign-in service is down, ordering or
  changing a service while the platform cannot accept it. Drafts are still saved.
- A Configuration page in the Admin section: every setting the portal runs with,
  what it accepts and what it falls back to. Read-only, and passwords and tokens
  are never shown - only whether they are set.

### Changed
- The sign-in screen shows what the portal does instead of setting services up
  by hand, and asks for one click to sign in.
- Refusing an empty change: saving an order without editing anything no longer
  opens a merge request with nothing in it, and the save button stays off until
  something really changes.
- The order history reads as a list of events, one line each, grouped by day and
  signed with the name of the person who acted. The transitions the pipeline
  makes on its own are folded away under a details view.
- Failures are written for the reader: a message instead of an error code, a hint
  and a retry button, and a plain answer when the chart registry is unavailable,
  saying that nothing can be ordered while it is down but existing orders still
  open.
- Waiting looks like the content that is coming, not like the English word
  "Loading", so the page no longer jumps when the data lands.
- The navigation menu keeps one geometry when it collapses, its rows carry
  tooltips, and it remembers what was folded and what was open.
- The dark themes are repainted: a neutral black page, cards a step above it,
  and the blue accent as the only saturated colour.
- Form dialogs open as a panel on the right, and every dialog and menu is
  animated.
- Field errors speak one language across the portal, numeric fields accept only
  numbers, and an error inside a folded section highlights and opens it.
- Catalog wording: Charts became the Catalog, Approved became Published, and a
  chart's tabs are now Description and Changes.
- The code editor is served by the portal itself, so the publishing screens work
  in a network with no access to the internet.
- Metrics are served on a port of their own (2112 by default, `METRICS_PORT`) so
  they are not reachable through the application ingress.
- A fresh installation starts with an empty catalog: services enter it by
  registration or by adoption of what the platform finds.
- The status update mode is now hybrid by default: webhooks speed the portal up,
  polling stays as the safety net.
- The "Synchronize" action is called "Deploy from Git" and now really re-reads
  Git instead of reporting success without deploying anything.
- The changelog on the About page reads the way a service's changes do -
  categories as coloured marks, versions set apart - and it is the project's
  real changelog rather than a forgotten copy that stopped being updated.
- Platform state fills the page and explains itself: what users can do right
  now, what each external system is responsible for, and what the background
  tasks actually keep up to date.

### Removed
- The fake registry, git server and delivery system are gone from the running
  portal: it always talks to the real ones and refuses to start without their
  addresses and tokens. Before starting a new installation, set them up.
- The Applications page, which had no entry in the menu and duplicated the order
  list.
- The demonstration services and categories a fresh installation used to be
  seeded with.

### Fixed
- A merge request that fails to merge on its own is now visible instead of
  leaving an order silently stuck.
- The graph no longer drops the values fields it does not know about, and it
  refuses to draw values it cannot express instead of quietly rewriting them.
- An unfinished view document degrades the preview panel only, instead of
  breaking the whole editor page, and the publishing screens no longer scroll as
  a whole.
- A draft is no longer renamed on every save, and a service name that is already
  taken is answered with the name, the cluster and the order holding it.
- Table columns in a view document reach into nested lists and maps and can show
  their keys, their values or a chosen element.
- Versions with a pre-release suffix are ordered correctly.
- A request that hangs is dropped after 30 seconds with a clear message, and
  errors arrive as a notification instead of a browser alert box.
- Services published version by version are visible in the menu and read as
  published in the approval queue.
- The namespace of an order is checked as you type.
- In the dark themes the inputs and the select triggers no longer glow white:
  they take the colour of the card, and the border is what makes them a field.
- The editing panel on the right dims the page instead of covering it with a
  light veil in the dark themes.
- The picture on the sign-in screen no longer washes out in the light theme: the
  backdrop, the cards and both sides of the comparison read as clearly as they
  do in the dark one.

### Security
- Sessions are stored encrypted, so a dump of the cache no longer exposes the
  tokens of everyone signed in.
- Signing in uses PKCE and verifies the identity token against the request that
  started it, and a refreshed session recomputes the roles, so a revoked group
  takes effect at once.
- Administrator rights are granted only for the exact group path: a nested
  subgroup no longer escalates.
- A service hidden from a user cannot be opened by guessing its address.
- A chart downloaded from the registry is verified against its checksum before
  it is unpacked, and the names it carries are validated before they are used.
- Request size, header size, stream count and idle connections are bounded, and
  internal failures are no longer echoed back with their details.
- The session cookie is Secure and same-site strict with an explicit lifetime
  (`COOKIE_SECURE`), a re-login drops the previous session, and the portal
  refuses to start with the default session secret.
- The development sign-in shortcut is physically absent from the production
  build.

## [0.1.0] - 2026-06-19

First tagged release. The platform console (portal) lets teams self-serve
deployments from a chart catalog, with GitOps provisioning, an approval flow for
chart publications, OIDC auth, and observability.

### Added
- Self-service portal: order and upgrade products from a catalog, with GitOps
  provisioning into Argo CD applications and per-namespace resource identity
  uniqueness.
- Chart publications: categories, owners and a view document stored in the
  database, an approval state machine (submit, withdraw, revoke), and
  category/owner changes routed through approval.
- View documents: dynamic enums and computed columns, document validation, and a
  single canonical order view per chart.
- Catalog: add a chart by an arbitrary Harbor path with completeness checks,
  publication status on catalog cards, and a menu/catalog driven by publications.
- Builder UI: view-document and values.schema.json editor with a real order/
  product preview and inline format help.
- Auth: OIDC login via Keycloak, RP-initiated logout, return-to-page after
  re-login on 401, and RBAC roles (member, admin, support, security with an
  InfoSec section).
- Observability: platform metrics with a Grafana dashboard and structured,
  component-tagged logging.
- Collector: snapshots Kubernetes state into Valkey for the console.
- Portal serves the embedded SPA directly (nginx dropped) and exposes an About
  page with build version and links.
- Standalone documentation pages.
- CI/release pipeline on GitHub Actions: PR checks, tag + GitHub Release on
  merging a `release/*` PR, and multi-arch image publish to GHCR for portal and
  collector on `v*` tags.

[Unreleased]: https://github.com/awbait/console/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/awbait/console/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/awbait/console/releases/tag/v0.1.0
