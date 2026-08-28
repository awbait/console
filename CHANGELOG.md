# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Fixed
- The branch of an order change is removed from the repository once it is
  merged. These branches used to pile up, one for every change of every service.

## [0.9.0] - 2026-08-28

A release about ordering one service in several namespaces and about the orders
table: it shows the namespace of every order and the name of its status. A
version of a service can be taken out of support, and the teams running on it
hear about it.

### Added
- The same product can now be ordered under one name into different
  namespaces.
- Added a Namespace column to the orders table.
- Added the status name next to its icon in the orders table.
- Added a hint to the order page on what to do next when the service is down or
  the order was rejected.
- Added a "Take out of support" button to the service management page that
  removes a version from the catalog with a reason.
- Added a notice to the order page when its version has been taken out of
  support, with the reason and the version to move to.
- Added a notification for the teams whose services run on a version taken out
  of support.
- Added a "Take from version" button to the version builder that fills the
  editor with the document of another version of the same chart.

### Changed
- Renamed the order statuses and described each of them in the "Statuses and
  deployment" help page.
- The orders table shows every column at any screen width: Status and Actions
  stay in place while the other columns scroll under them with the mouse wheel.

### Fixed
- Fixed opening an order whose version has left the catalog: the page shows the
  product tabs again and the values save.
- Fixed an order getting stuck in "Rejected" after the merge request for an edit
  or a deletion of the service was closed without merging.
- The add button in a list of plain values, such as a gateway's external
  addresses, creates a blank row. The new row used to arrive holding the text
  [object Object], which had to be erased.
- A row of such a list left empty is now marked as a required field. It used to
  disappear silently when the form was saved.

## [0.8.2] - 2026-08-27

A release about the order form: it asks only for what the values already picked
allow, spells out the choices in its lists, and takes a service name written as
a host address.

### Changed
- The order form hides fields that do not fit the values already picked. A point
  on TCP or UDP no longer asks for a domain: it cannot have one, and a domain
  filled in there kept the gateway from rolling out.
- A list in the order form names its choices. "Cluster" now reads "techsec-dev
  (tco)" instead of "tco", and the meaning of the codes no longer sits in the
  text under the field.
- A service name may contain a dot: "vault.idp.ecpk.test-vault" is accepted
  where only letters, digits and hyphens were before. A chart that names what it
  deploys after a host now orders under that name. The namespace of an order is
  unchanged and still takes no dots.

## [0.8.1] - 2026-08-24

A release about who owns a service: only the owning team manages it, a platform
admin can name that team, and where the platform team owns a service the portal
says so in words instead of a path out of the user directory.

### Fixed
- Where a service belongs to the platform team, the owner reads "Администратор
  платформы" instead of the group path in the directory. The catalog, the chart
  page, the approval cards and the admin tables all say it the same way, the way
  the profile menu already did.
- A platform admin can name the team that owns a service. "Владелец" on the
  management page offered only the teams the reader is in, and an admin is in
  none of them, so there was nothing to choose from. It now offers every team
  the portal knows.

### Security
- Only the owning team manages a service. Charts the portal found itself stayed
  open to any member of any team, who could also take such a service over.
  **Reported by:** DBA

## [0.8.0] - 2026-08-24

A release about the portal watching itself: "Конфигурация" now checks every
setting against the live systems, and the platform team hears when the setup
breaks on its own. The admin section also gained a page about the people using
the portal.

### Added
- "Конфигурация" now says whether each setting actually works, not only what it
  is set to. The portal checks them against the live systems and marks every
  setting on the right: whether the GitLab token may open merge requests,
  whether the webhooks are registered on both sides, whether the Harbor
  projects and the Argo CD project, cluster and namespace are there. Point at a
  mark to see what was seen and what to do about it. "Только проблемы" leaves
  the settings that need attention.
- "Проверить доставку" on that page asks GitLab to send the portal a sample
  notification and reports whether it arrived. This is the only way to find out
  that the two sides hold different secrets, which otherwise shows up as merged
  orders that never move on.
- The platform team is notified when the setup breaks by itself: the GitLab
  token expires or is withdrawn, GitLab switches the webhook off after failed
  deliveries, the webhook secret stops matching, a Harbor project or an Argo CD
  project or cluster disappears. Each of those arrives once, and a second
  message says when it is over. A token about to expire is announced a month
  and a week ahead.
- The platform team is notified when a deletion does not finish within fifteen
  minutes. Until it does, the order keeps showing "Удаляется".
- "Пользователи" is a new page in the admin section. It shows who is using the
  portal right now, who has been in over the last day and week, what teams they
  are from, and what people have been doing lately. Search finds a person by
  name, mail or team. Opening a person shows their card: teams, role, first
  visit and their own actions. Opening a team shows who is in it and everything
  its people have done. Every list of actions reads newest or oldest first and
  loads further on request. Trends over time are in Grafana, one link away from
  the page.

### Changed
- The portal's own update is announced to platform admins only. It used to
  arrive in everyone's bell on every release, and there was nothing to do with
  it: you did not choose the version and cannot choose the next one. The
  changelog on the About page still shows every release to everybody.

### Fixed
- Deleting a service takes it out of the cluster. The portal used to report the
  deletion while the service kept running, and somebody removed it by hand.
  Orders made earlier are deleted the same way. **Reported by:** obs
- "Изменение не удалось применить автоматически" no longer appears in an order's
  history while the change is on its way through. The portal now waits for the
  checks to finish before calling anything a problem, and a restart of the
  portal does not repeat what it has already said.
- That entry says what is actually in the way: a change waiting for approval, a
  check that did not pass, an open discussion. It used to be a bare line with
  nothing to act on.
- "Вход не завершён" no longer stops a sign-in that was going fine. When the
  portal was open in several tabs, an expired session sent every one of them to
  Keycloak at once and the attempts wrote over each other, so the one you
  finished was turned away. Each attempt now stands on its own.
- Every background loop on "Состояние платформы" is named in words, and says
  what stops happening if it fails. Two of them used to be shown as
  "chart-versions" and "notification-sweep".

### Security
- A sign-in is accepted once. Returning to a used sign-in address with the back
  button no longer signs you in again, and the sign-in pages are no longer kept
  in caches.

## [0.7.0] - 2026-08-21

A release about reading what changed: the portal's own changelog and a chart's
version history now open one version at a time. Ordering a service also got less
manual, with the portal preparing the team's place in GitLab itself.

### Added
- The portal creates a team's subgroup in GitLab itself, the first time that
  team orders a service. It used to be created by hand, and an order refused to
  go through until it was. Set `GITLAB_CREATE_TEAM_SUBGROUP=false` where
  subgroups come from somewhere else.
- The folder an ordered service gets in its repository can be named by a
  template: `GITLAB_INSTANCE_DIR_TEMPLATE`, for example
  `{{.Namespace}}-{{.ServiceName}}`. It knows the team, the chart, the service
  name, the namespace and the cluster, and empty keeps the service name alone.
  An order stays in the folder it was created in, so a new template only names
  the folders of new orders.

### Changed
- The changelog on the About page opens one version at a time. The newest one is
  open, the rest are folded into a line each: the number and the date. The
  version running in production is marked "Сейчас в проде". Opening a version
  brings its header to the top of the list, so the notes start where the
  reading does.
- Inside an open version "Добавлено", "Изменено" and "Исправлено" are told apart
  by colour, one per category.
- A chart's Changes tab reads like the portal's own changelog: every version a
  line of its own, one of them open.
- "Описание" and "Изменения" are tabs of one panel on the chart page. It used
  to be a strip of tabs above a separate full-screen frame, empty for
  three quarters of it. The panel takes the height its text needs, and the
  description is read in a column rather than across the whole monitor.
- A link to a chart page remembers what was being read: `?tab=changelog` opens
  the Changes tab, and `#release-2.3.0` opens that version and brings the list
  to it.
- The About page takes the full width of the window. It used to keep a width of
  its own, leaving half the screen empty once the menu was folded away.

### Fixed
- An order no longer stops silently where Argo CD runs outside the `argocd`
  namespace. Name the namespace it runs in with `ARGOCD_NAMESPACE`. The order
  used to reach Git and the service never came up.
- An order refused because the platform is not set up for the team no longer
  reads as an outage. The portal says a person has to finish the setup, and does
  not suggest trying again.
- Why a request failed now goes into the portal's log. It used to be shown only
  to the browser, so finding out took reproducing the failure with the developer
  console open.
- A version with nothing under it is no longer shown. After a release the
  changelog used to open with an empty "Готовится к выпуску" block.
- The text in the changelog no longer narrows when a version unfolds: the
  scrollbar keeps a column of its own instead of taking the width off the notes
  as it appears.
- Scrollbars in the portal are slim in every browser. Yandex Browser used to
  draw the wide system ones instead. Menus, wide tables and code blocks are slim
  now too.

## [0.6.0] - 2026-08-20

A release about the version constructor. The document is no longer written into
a blank field: the editor prompts with the chart's fields, explains the keys and
saves the draft on its own.

### Added
- The version constructor saves its draft on its own, a couple of seconds after
  you stop typing, and again when you leave the page. Next to the "Сохранить
  черновик" button it says where the work stands: saved, saving, or not saved.
  Closing a tab with unsaved edits no longer happens without a word.
- The version constructor prompts as you write. Ctrl+Space opens a list of what
  belongs where the cursor is: the keys of the document, and the fields of this
  chart version with the names the chart gives them. Where what you typed leaves
  a single field, the rest of it is shown in grey and taken with Tab.
- Hovering over a key in the version constructor explains what it is for, and a
  mistake is underlined on the line it is on instead of only appearing in the
  list under the editor.

### Changed
- The portal opens faster: its first load is a quarter lighter. The screens few
  people open are now fetched when they are opened: the admin, security and
  support sections, the documentation, the version constructor.
- The menu on the left folds itself once the window is narrower than 1024
  pixels, and the page gets the 200 pixels it needs more than the menu does. The
  folded menu is a little narrower than it was, too. It can still be unfolded
  there, by the button at its lower end. On a wide screen the portal remembers
  your choice as before.

### Fixed
- A field explains a refusal by the rule that was actually broken. The value
  `-abc` in a name used to be answered with the list of characters allowed,
  although the characters were right and the hyphen on the edge was not.
- Fields that have to start with a letter, and fields holding a path, now say so
  too. They used to stay silent and answer "Недопустимый формат" on a mistake.
- Removing a block from the middle of a list on the order form no longer
  disturbs the ones around it. The block that stays open is the one you opened,
  not the one that took its place.
- On the sign-in screen the "Войти через Keycloak" button goes out while the
  portal does not answer. Pressing it used to lead to a browser error page with
  no way back. The screen now says the portal is not answering and what to try.

## [0.5.0] - 2026-08-19

A release about notifications. The portal now says what happened to your
service, your order or your version, instead of waiting for you to open the
right page.

### Added
- Notifications. The portal sends one when something happens to your service or
  your order. The top bar gained a bell: while something is unread it carries a
  dot and swings gently. The whole history is on the "Уведомления" page, laid
  out day by day, with chips above the list for everything or unread only.
- A notification arrives when a service you ordered comes up, stops working, or
  cannot accept your change. Clicking it opens that order.
- The team publishing a service is notified what became of its version:
  approved or rejected. A rejection carries the reviewer's comment, which you
  used to have to open the version page to find.
- When a published version disappears from the registry, the portal tells the
  owning team and the admins. Such a version cannot be ordered, and in the
  catalog the service looks as if nobody ever published it. Clicking the
  notification opens that version.
- An admin is notified when a version of a service is sent for approval.
  Clicking it opens the page where the decision is made. The queue used to be
  visible only by opening the approvals section.
- An admin also hears about a service the portal found in the registry itself.
  Clicking it opens the service, to give it a category and an owner. Without
  those it never appears in the catalog.
- The portal sends a notification about its own update too. Clicking it opens
  the changelog at the section for that version.
- A notification can be marked read without opening it: point at it and press
  the tick. "Прочитать все" clears the count at once. Read notifications are
  kept for 90 days, unread ones are never deleted.

### Changed
- When the registry gets a new version of a service your team publishes, the
  portal sends a notification. Clicking it opens that version, to describe it
  and send it for approval. This used to be a message on the catalog page, and
  it is gone.
- The order form explains a refusal in the same words its hint used. Instead of
  "length must be >= 3, but got 2" the portal says "Не короче 3 символов", and a
  field you skipped is highlighted itself.
- An order the portal refuses explains why in Russian. A service name that does
  not fit names the characters it takes, and a version gone from the registry
  asks you to pick an available one.
- The order list and the order itself now have eight states instead of eleven:
  draft, saving, coming up, working, not working, rejected, deleting, deleted.
  The filter above the list offers the same names. Support and admins see the
  exact state in the order's history, under "Подробно".
- An order no longer talks about merge requests, branches or Git. While a change
  has not landed, the portal says the service is being saved. The link to the
  merge request is shown to support and admins only, in the order's history
  under "Подробно".

### Fixed
- The order list, an order and the notifications update themselves again after
  the portal restarts or the connection breaks. Updates used to stop and the
  page kept showing stale data until it was reloaded.

## [0.4.0] - 2026-08-18

A release about filling in the form: fields say what they take. The
documentation now covers the order form constructor.

### Added
- The documentation has an "Order form constructor" section. It walks through
  every block of a version document, with examples and screenshots.
- A service can require that every change is confirmed by a person, even where
  the portal is set to apply them itself. Its owner says so in the version
  document: `"approval": {"autoMerge": false}`. The portal still prepares the
  change so the reviewer only has to confirm it.
- The portal sets up the GitLab webhook that tells it about merges. Setting
  `GITLAB_WEBHOOK_URL` is enough, and the scope is set by
  `GITLAB_WEBHOOK_SCOPE`. The webhook used to be added by hand after an install.

### Changed
- Fields say what they take: which characters, what length, what range. Rules
  already satisfied are ticked off as you type.
- The window for drawing a connection on the map, and the one for adding a
  service to the catalog, report a bad value under the field as you type. The
  button stays off until the value is fixed.
- On the publication approvals page the title stays put and only the lists below
  it scroll. The services table gained the category and the date of the last
  change, and a service's actions open from its row.

### Fixed
- A change to a service no longer gets stuck behind somebody else's change. The
  portal merges the two field by field. It asks only about a field you both
  changed.
- A version deleted from the registry can no longer be ordered. An order running
  on it keeps working and can be moved to an available version.
- The order form opens on the service's recommended version.

## [0.3.0] - 2026-08-14

A release about approving versions and about graphs. A reviewer sees what a
version of a service does. The graph opens for a service that already runs.

### Added
- The graph opens from the page of an ordered service. Connections can be
  redrawn and saved. The portal remembers how the boxes are arranged.
- The portal can follow the theme of the operating system. A first visit starts
  with it.
- Every release carries images of the portal and the collector. They install
  where the image registry is out of reach.

### Changed
- A version of a service is approved on its own page. The order form and the
  product page it produces are shown beside it. Differences from the version in
  force have a tab of their own.
- The theme is picked in one switcher. The icon in the top bar shows which one
  is on.
- The order history takes as much room as its events need. It splits into pages
  only when they do not fit on the screen.
- The general information about an order is labelled in Russian. The chart, the
  ArgoCD application and the configuration moved under "Подробнее".
- The order's configuration opens from a button named after what it shows.

### Fixed
- The approval queue no longer counts one version twice.
- A chart the portal found itself is no longer credited to the administrators.
  Until somebody takes it on, it shows no owner.
- A service built on a graph can no longer be ordered empty. The portal asks for
  at least one connection.
- An order no longer stalls in silence. The portal stops retrying and writes to
  the history what is in the way.
- The placeholders shown while data loads are visible in the light theme.
- A failed sign-in returns to the sign-in screen and says what to do.
- Signing in no longer fails because the page stood open for a few minutes.

## [0.2.0] - 2026-08-10

This release takes the portal out of demonstration mode. The stand-in registry,
git server and delivery system are gone. The portal talks to the real ones and
will not start without their addresses and tokens.

### Added
- Several versions of one service. Each version has its own order form and its
  own approval. The order form lets you pick among them.
- An upgrade offers only the versions the service owner allowed.
- A network interaction map. You draw arrows between workloads and the map
  writes the values for the policies service. An example is included.
- Ordering straight from the map. The arrows are split into policy orders per
  namespace.
- Values written by hand can be pasted into the map and edited with the mouse.
- A Graph tab on the order form of the services that support it.
- A service version declares its own graph. A new version does not break the
  orders that stay on the old one.
- Search and a category filter in the catalog. A filtered catalog can be shared
  as a link.
- An Admin section: an overview, the approval queue, platform state and catalog
  categories.
- A Support section: the orders of every team, with filters by team and product.
- A service the platform found in the registry can be adopted by a team. Pick
  its category and owner and it is yours to publish.
- Categories carry an icon. A product shows the icon of its own chart.
- Documentation in the portal: the catalog, ordering, statuses, publishing,
  roles, sections and architecture.
- Platform state shows the health of the background cycles and links to Grafana.
- With webhooks configured, the portal reacts to a merge or a chart push at
  once, without waiting for the next poll.
- A service can name its namespace itself. The Namespace field then disappears
  from the order form, and the portal shows which namespace will be used.
- An order with a change on its way shows a banner and refuses further changes.
- The portal says when part of the platform is not responding. An icon in the
  top bar lists what works and what does not.
- Actions that cannot go through are switched off with an explanation. Drafts
  are still saved.
- A Configuration page in the Admin section. Passwords and tokens are never
  shown, only whether they are set.

### Changed
- The sign-in screen shows what the portal does instead of setting services up
  by hand. Signing in takes one click.
- An empty change is refused. The save button stays off until something really
  changes.
- The order history reads as a list of events: one line each, grouped by day,
  signed with the name of the person who acted.
- Failures are written for the reader: plain text, a hint and a retry button.
  When the chart registry is down, the portal says plainly that nothing can be
  ordered right now.
- While data loads, the portal shows an outline of it instead of the word
  "Loading". The page does not jump when the data arrives.
- A collapsed menu does not shift its icons, they stay on the same line. The
  portal remembers which sections were open.
- The dark themes are repainted: a neutral black page and a blue accent.
- Form dialogs open as a panel on the right. Dialogs and menus are animated.
- Field errors speak one language across the portal. Numeric fields accept only
  numbers.
- Charts are now the Catalog, and Approved is now Published. A chart's tabs are
  Description and Changes.
- The code editor is served by the portal itself. The publishing screens work
  with no access to the internet.
- Metrics are served on a port of their own (2112 by default, `METRICS_PORT`).
- A fresh installation starts with an empty catalog. Services enter it by
  registration or by adoption of what the platform finds.
- Statuses are updated in hybrid mode by default: webhooks make the portal
  quicker, polling stays as the safety net.
- The "Synchronize" action is called "Deploy from Git" and really re-reads Git.
- The changelog on the About page is the project's real changelog, not a
  forgotten copy.
- Platform state explains what users can do right now and what each external
  system is responsible for.

### Removed
- The fake registry, git server and delivery system. The portal will not start
  without the addresses and tokens of the real ones, so set them up first.
- The Applications page, which duplicated the order list.
- The demonstration services and categories of a fresh installation.

### Fixed
- A change that could not be applied on its own is now visible. An order used to
  stall in silence.
- The graph no longer drops values fields it does not know. Values it cannot
  express it refuses to draw instead of rewriting them.
- An unfinished view document breaks the preview panel only, not the whole
  editor page.
- A draft is no longer renamed on every save. A name already taken is answered
  with the order holding it.
- Table columns in a view document reach into nested lists and maps.
- Versions with a pre-release suffix are ordered correctly.
- A request that hangs is dropped after 30 seconds with a clear message.
- Services published version by version are visible in the menu and in the
  approval queue.
- The namespace of an order is checked as you type.
- In the dark themes the inputs and the selects no longer glow white.
- The editing panel on the right dims the page instead of covering it with a
  light veil.
- The picture on the sign-in screen no longer washes out in the light theme.

### Security
- Sessions are stored encrypted. A dump of the cache no longer exposes the
  tokens of everyone signed in.
- Signing in uses PKCE and verifies the token against the request that started
  it. A refreshed session recomputes the roles, so a revoked group takes effect
  at once.
- Administrator rights are granted only for the exact group path.
- A service hidden from a user cannot be opened by guessing its address.
- A downloaded chart is verified against its checksum before it is unpacked.
- Request size, header size, stream count and idle connections are bounded.
  Internal failures are no longer echoed back with their details.
- The session cookie is Secure with an explicit lifetime (`COOKIE_SECURE`). The
  portal refuses to start with the default session secret.
- The development sign-in shortcut is absent from the production build.

## [0.1.0] - 2026-06-19

The first release. The portal lets teams self-serve: order services from a
catalog, GitOps provisioning, approval of chart publications and OIDC sign-in.

### Added
- Ordering and upgrading products from a catalog. The portal provisions them
  through GitOps into Argo CD applications.
- Chart publications: categories, owners, a view document and approval.
- View documents: dynamic value lists, computed columns and document validation.
- Catalog: a chart is added by any Harbor path, with completeness checks.
- Builder: an editor for the view document and values.schema.json, with a
  preview of the order and the product.
- Sign-in through OIDC and Keycloak. Roles: member, admin, support and security.
- Metrics with a Grafana dashboard, and structured logs.
- Collector: snapshots Kubernetes state into Valkey for the console.
- The portal serves its own interface, with no nginx. An About page shows the
  build version.
- Standalone documentation pages.
- Builds and releases on GitHub Actions: PR checks, a tag and a GitHub Release,
  and images of the portal and the collector.

[Unreleased]: https://github.com/awbait/console/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/awbait/console/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/awbait/console/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/awbait/console/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/awbait/console/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/awbait/console/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/awbait/console/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/awbait/console/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/awbait/console/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/awbait/console/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/awbait/console/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/awbait/console/releases/tag/v0.1.0
