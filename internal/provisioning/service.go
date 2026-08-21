// Package provisioning owns the order lifecycle: form -> MR -> ArgoCD.
package provisioning

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"gopkg.in/yaml.v3"
	"console/internal/argocd"
	"console/internal/catalog"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/observability"
	"console/internal/store"
	"console/internal/views"
	"console/pkg/models"
)

var nameRe = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)

var allDigitsRe = regexp.MustCompile(`^[0-9]+$`)

// validNamespace: DNS-1123 label and not purely numeric (a numeric namespace
// is almost certainly a typo, and some tools choke on such a name).
func validNamespace(ns string) bool {
	return nameRe.MatchString(ns) && len(ns) <= 63 && !allDigitsRe.MatchString(ns)
}

// Service is the provisioning domain.
type Service struct {
	store          store.Store
	gl             gitlab.Port
	argo           argocd.Port
	catalog        *catalog.Service
	gitops         *GitOps
	bus            *events.Bus
	defaultCluster string
	defaultBranch  string
	// autoMerge makes the poller merge open portal MRs itself (no human gate).
	// Convenient for local/demo against real GitLab; off in production.
	autoMerge bool
	// mergeBlocked remembers, per MR record, the reason auto-merge last gave up
	// on it. The poller revisits every open MR each tick, so without this the
	// same wedged order would log, count and journal itself every few seconds.
	// Process-local on purpose: a restart re-reports once, which is cheaper than
	// carrying the bookkeeping in the database.
	mergeBlocked map[string]string
	// mergeRetries counts, per order, how often the portal has rewritten its
	// change onto a moved branch (see maxMergeRetries). Guarded by the same mutex.
	mergeRetries   map[string]int
	mergeBlockedMu sync.Mutex
	// Log is the structured logger; wired by main. Nil-safe via logger().
	Log *slog.Logger
	// Hooks keeps the portal's merge-request webhook registered in GitLab. Wired
	// by main only when the webhook is configured; nil (and nil-safe) otherwise,
	// which is the local/fakes case.
	Hooks *gitlab.HookManager
	// notify tells the person who ordered a service what became of it. Optional:
	// nil in tests, where nobody is listening.
	notify Notifier
}

// Notifier is what provisioning needs of the notification domain: an order got
// somewhere, and its owner should hear about it. An interface rather than the
// package itself so a test can watch what would be sent without a store behind
// it.
type Notifier interface {
	OrderHealthy(ctx context.Context, st store.Store, r *models.Request, from string)
	OrderDegraded(ctx context.Context, st store.Store, r *models.Request, detail string)
	OrderChangeBlocked(ctx context.Context, st store.Store, r *models.Request, reason string)
}

// SetNotifier wires the notification domain in (main does it after both exist).
func (s *Service) SetNotifier(n Notifier) { s.notify = n }

// logger returns the configured logger, or the default if none was wired (tests).
func (s *Service) logger() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// New builds a provisioning service.
func New(st store.Store, gl gitlab.Port, argo argocd.Port, cat *catalog.Service,
	g *GitOps, bus *events.Bus, defaultCluster, defaultBranch string, autoMerge bool) *Service {
	return &Service{store: st, gl: gl, argo: argo, catalog: cat, gitops: g,
		bus: bus, defaultCluster: defaultCluster, defaultBranch: defaultBranch, autoMerge: autoMerge,
		mergeBlocked: map[string]string{}, mergeRetries: map[string]int{}}
}

// CreateInput is the payload for a new order.
type CreateInput struct {
	ChartProject string
	ChartName    string
	Version      string
	Team         string
	ServiceName  string
	DisplayName  string // optional; cosmetic. Defaults to ServiceName when empty.
	Cluster      string // ArgoCD destination cluster; defaults to the configured cluster when empty.
	Namespace    string // ArgoCD destination namespace; defaults to ServiceName when empty.
	Values       map[string]any
	// EditorState is the opaque UI state of the visual editor that produced the
	// values (see models.Request.EditorState). Stored as given, never inspected.
	EditorState json.RawMessage
	// Draft persists the order in DRAFT without opening an MR. Its values may be
	// incomplete (schema validation is deferred to Submit).
	Draft bool
}

// maxEditorState bounds the opaque editor state: a policies canvas is a few KB,
// so this only stops a client from parking megabytes on an order.
const maxEditorState = 256 << 10

// checkEditorState rejects oversized or malformed state. Empty is always fine -
// it means the client sent none.
func checkEditorState(b json.RawMessage) error {
	if len(b) == 0 {
		return nil
	}
	if len(b) > maxEditorState {
		return &ValidationError{Message: MsgEditorTooBig}
	}
	if !json.Valid(b) {
		return &ValidationError{Message: MsgEditorBadJSON}
	}
	return nil
}

// UpdateInput patches an existing order. ServiceName/DisplayName are honoured
// only while the order is still a DRAFT (the deploy identity is immutable once
// an MR exists).
type UpdateInput struct {
	Version     string // optional new chart version
	ServiceName string // draft only: change the deploy identity
	DisplayName string // draft only: change the cosmetic name
	Cluster     string // draft only: change the destination cluster
	Namespace   string // draft only: change the destination namespace
	Values      map[string]any
	// EditorState replaces the stored editor state; nil leaves it untouched, so
	// a client that does not use the visual editor cannot drop what it holds.
	EditorState json.RawMessage
}

// canView / canEdit hold for admins and support across every team, and for
// members within their own team. canEdit gates value changes on an existing
// order (update, rename, upgrade).
func canView(u *models.User, team string) bool {
	return u.IsAdmin() || u.IsSupport() || u.InTeam(team)
}
func canEdit(u *models.User, team string) bool {
	return u.IsAdmin() || u.IsSupport() || u.InTeam(team)
}

// canProvision gates lifecycle actions that create or destroy an instance
// (create, submit, delete). Support is intentionally excluded: it operates on
// existing orders but does not stand up or tear down services.
func canProvision(u *models.User, team string) bool {
	return u.IsAdmin() || u.InTeam(team)
}

func shortID() string { return uuid.NewString()[:8] }

// newID returns a UUIDv7 (time-ordered) for DB primary keys: better B-tree
// index locality and roughly creation-sortable, unlike random v4.
func newID() string { return uuid.Must(uuid.NewV7()).String() }

// orderView returns the approved view to build an order of (chart, version)
// from: the selected version's view, falling back to the highest published
// version's view when the order's exact version has no row (e.g. an old order
// on a version published before version management). Nil when there is no
// published view (no publication, or nothing approved yet).
func (s *Service) orderView(ctx context.Context, chartProject, chartName, version string) []byte {
	pub, err := s.store.GetPublicationByChart(ctx, chartProject, chartName)
	if err != nil || pub == nil {
		return nil
	}
	if version != "" {
		if v, verr := s.store.GetVersion(ctx, pub.ID, version); verr == nil && v.Published() {
			return v.ApprovedViewJSON
		}
	}
	versions, lerr := s.store.ListVersions(ctx, pub.ID)
	if lerr != nil {
		return nil
	}
	var best *models.PublicationVersion
	for _, v := range versions {
		if v.Published() && (best == nil || models.CompareChartVersions(best.ChartVersion, v.ChartVersion) < 0) {
			best = v
		}
	}
	if best == nil {
		return nil
	}
	return best.ApprovedViewJSON
}

// ensureOrderable rejects an order whose version is not an orderable+APPROVED
// version of the publication. Charts without a publication, or publications
// with nothing published at all, are not restricted, so the guard only bites
// once a service has at least one orderable version.
func (s *Service) ensureOrderable(ctx context.Context, chartProject, chartName, version string) error {
	// The registry decides what exists, this database only what is allowed. A
	// version deleted from the registry cannot be deployed whatever the allowlist
	// says, and its schema is gone with it - so accepting the change would also
	// mean writing values nothing has checked.
	if version != "" {
		if _, err := s.catalog.GetVersion(ctx, chartProject, chartName, version); err != nil {
			if errors.Is(err, models.ErrNotFound) {
				return &ValidationError{
					Message: "версии " + version + " больше нет в реестре чартов. Выберите доступную версию сервиса.",
				}
			}
			return fmt.Errorf("%w: harbor: %v", ErrUpstream, err)
		}
	}
	pub, err := s.store.GetPublicationByChart(ctx, chartProject, chartName)
	if err != nil || pub == nil {
		return nil // no publication: provisioning is not restricted
	}
	if version != "" {
		if v, verr := s.store.GetVersion(ctx, pub.ID, version); verr == nil && v.Published() {
			return nil // requested version is orderable+APPROVED
		}
	}
	versions, lerr := s.store.ListVersions(ctx, pub.ID)
	if lerr != nil {
		return nil // best-effort; do not block on a store hiccup
	}
	for _, v := range versions {
		if v.Published() {
			return &ValidationError{Message: "выбранная версия чарта недоступна для заказа, выберите доступную версию"}
		}
	}
	return nil // nothing orderable at all (unpublished): leave to existing checks
}

// resourceIdentity resolves the per-order identity used to detect resource-name
// collisions within a namespace. It reads the order version's approved order view
// for the "identity" JSON pointer and resolves it against the order's values,
// falling back to serviceName when no view/identity is published or the pointer
// does not resolve (still a usable, unique-per-service discriminator).
func (s *Service) resourceIdentity(ctx context.Context, chartProject, chartName, version, serviceName string, values map[string]any) string {
	view := s.orderView(ctx, chartProject, chartName, version)
	if len(view) == 0 {
		return serviceName
	}
	ptr := views.OrderIdentity(view)
	if ptr == "" {
		return serviceName
	}
	if v, ok := views.ResolvePointer(values, ptr); ok && v != "" {
		return v
	}
	return serviceName
}

// resolveNamespace computes an order's ArgoCD destination namespace from the
// order version's approved view: the "namespace" directive decides the source
// (the form field, a values field the chart names itself by, or a fixed
// constant). ArgoCD always requires a destination namespace, so an empty result
// falls back to serviceName - it is never blank. The result is validated as a
// Kubernetes name. orderNamespace is the form input (source=field); values are
// the order's values (source=values).
func (s *Service) resolveNamespace(ctx context.Context, chartProject, chartName, version, orderNamespace, serviceName string, values map[string]any) (string, error) {
	rule := views.OrderNamespaceRule(s.orderView(ctx, chartProject, chartName, version))
	ns := views.ResolveDestinationNamespace(rule, orderNamespace, values)
	if ns == "" {
		ns = serviceName
	}
	if !validNamespace(ns) {
		return "", &ValidationError{Message: "namespace должен быть валидным именем Kubernetes и не может быть числом"}
	}
	return ns, nil
}

// applyViewStamps stamps order-time values from the order version's approved
// view into values: the "defaults" block (JSON pointer -> fixed value, e.g.
// namespace.creator=console) and the "namespace" binding (mirrors the order's
// destination namespace into the values field a self-provisioning chart names it
// by, e.g. managed-namespace's /namespace/namespaceName). Both overwrite any
// present value. Chart-agnostic: the rules live in the chart's view document, not
// here. A missing view/publication leaves values as-is.
func (s *Service) applyViewStamps(ctx context.Context, chartProject, chartName, version, namespace string, values map[string]any) map[string]any {
	view := s.orderView(ctx, chartProject, chartName, version)
	if len(view) == 0 {
		return values
	}
	values = views.ApplyDefaults(values, view)
	return views.BindNamespace(values, view, namespace)
}

// checkNamespaceIdentity returns a friendly ValidationError when another active
// order of the same chart already deploys the same resource identity into the
// same namespace+cluster. The DB partial unique index is the race-safe backstop;
// this pre-check exists only to turn a bare 409 into an actionable message.
// checkServiceName mirrors the uniq_active_service index (team, chart_name,
// service_name, cluster among active orders). Without it the collision surfaces
// as the index's bare "conflict", which tells the user nothing - and for a chart
// whose view sources the identity from the values (the policies graph names the
// order after its first policy) it is not even obvious which field to change.
func (s *Service) checkServiceName(ctx context.Context, r *models.Request) error {
	if r.ServiceName == "" {
		return nil
	}
	list, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Team: r.Team, Chart: r.ChartName})
	if err != nil {
		return nil // best-effort; the unique index still guards
	}
	for _, ex := range list {
		if ex.ID == r.ID || ex.DeletedAt != nil {
			continue
		}
		if ex.Cluster == r.Cluster && ex.ServiceName == r.ServiceName {
			return conflict(
				"имя %q уже занято другим заказом этого продукта в кластере %q (%q). Выберите другое имя",
				r.ServiceName, r.Cluster, ex.DisplayName)
		}
	}
	return nil
}

func (s *Service) checkNamespaceIdentity(ctx context.Context, r *models.Request) error {
	if r.Namespace == "" || r.ResourceIdentity == "" {
		return nil
	}
	list, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Chart: r.ChartName})
	if err != nil {
		return nil // best-effort; the unique index still guards
	}
	for _, ex := range list {
		if ex.ID == r.ID || ex.DeletedAt != nil {
			continue
		}
		if ex.Cluster == r.Cluster && ex.Namespace == r.Namespace && ex.ResourceIdentity == r.ResourceIdentity {
			return conflict(
				"в namespace %q уже есть инстанс чарта %q с идентификатором %q (заказ %q). Выберите другой идентификатор или добавьте ресурс в существующий заказ",
				r.Namespace, r.ChartName, r.ResourceIdentity, ex.ServiceName)
		}
	}
	return nil
}

// --- reads ---

// Get returns an order the user is allowed to see.
func (s *Service) Get(ctx context.Context, u *models.User, id string) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canView(u, r.Team) {
		return nil, ErrForbidden
	}
	return r, nil
}

// List returns orders visible to the user (scoped to their teams unless admin).
func (s *Service) List(ctx context.Context, u *models.User, f store.RequestFilter) ([]*models.Request, error) {
	seesAll := u.IsAdmin() || u.IsSupport()
	// No scope -> no orders. The store filter treats an empty Teams set as
	// "unfiltered", so without this guard a role with no team (security/auditor)
	// would list every order - inconsistent with Get, which denies them.
	if !seesAll && len(u.Teams) == 0 {
		return []*models.Request{}, nil
	}
	f.Teams = u.Teams
	// Support sees every team's orders, same as admin (read/edit, not provision).
	f.Admin = seesAll
	return s.store.ListRequests(ctx, f)
}

// ListMRs / ListEvents expose order details.
func (s *Service) ListMRs(ctx context.Context, id string) ([]*models.RequestMR, error) {
	return s.store.ListMRs(ctx, id)
}
func (s *Service) ListEvents(ctx context.Context, id string) ([]*models.RequestEvent, error) {
	return s.store.ListEvents(ctx, id)
}

// --- create ---

// Create validates input and persists a DRAFT. Unless in.Draft is set it then
// opens the create MR and advances the order to MR_CREATED.
func (s *Service) Create(ctx context.Context, u *models.User, in CreateInput) (*models.Request, error) {
	if !canProvision(u, in.Team) {
		return nil, ErrForbidden
	}
	if !nameRe.MatchString(in.ServiceName) || len(in.ServiceName) > 63 {
		return nil, &ValidationError{Message: MsgServiceName}
	}
	if in.Namespace != "" && !validNamespace(in.Namespace) {
		return nil, &ValidationError{Message: "namespace должен быть валидным именем Kubernetes и не может быть числом"}
	}
	if err := checkEditorState(in.EditorState); err != nil {
		return nil, err
	}
	if _, err := s.catalog.GetChart(ctx, in.ChartProject, in.ChartName); err != nil {
		if errors.Is(err, models.ErrNotFound) {
			return nil, &ValidationError{Message: MsgUnknownChart}
		}
		return nil, fmt.Errorf("%w: harbor: %v", ErrUpstream, err)
	}
	// The version has to exist in the registry and be an orderable+APPROVED one
	// (multi-version publications); the registry half applies to every chart, the
	// allowlist half is a no-op for legacy single-view publications.
	if err := s.ensureOrderable(ctx, in.ChartProject, in.ChartName, in.Version); err != nil {
		return nil, err
	}
	// Destination namespace: the view's "namespace" directive picks the source
	// (form field / values field / fixed). Falls back to service_name so it is
	// never empty. Charts that self-provision or are cluster-scoped hide the form
	// field and source it from values or a constant instead.
	namespace, err := s.resolveNamespace(ctx, in.ChartProject, in.ChartName, in.Version, in.Namespace, in.ServiceName, in.Values)
	if err != nil {
		return nil, err
	}
	// A draft may hold incomplete values; defer schema validation to Submit.
	// namespace is passed so a view "namespace" mirror can stamp it into values.
	valuesYAML, err := s.validateAndMarshal(ctx, in.ChartProject, in.ChartName, in.Version, namespace, in.Values, !in.Draft)
	if err != nil {
		return nil, err
	}

	displayName := in.DisplayName
	if displayName == "" {
		displayName = in.ServiceName
	}
	cluster := in.Cluster
	if cluster == "" {
		cluster = s.defaultCluster
	}
	// Cluster lands in commit paths ({cluster}/{service}) and the rendered
	// application.yaml destination; validate it like service_name so it cannot
	// carry "../" or newlines into Git paths/manifests.
	if !nameRe.MatchString(cluster) || len(cluster) > 63 {
		return nil, &ValidationError{Message: MsgCluster}
	}
	r := &models.Request{
		ID:            newID(),
		CreatedBy:     u.Subject,
		CreatedByName: u.Name,
		Team:          in.Team,
		ChartProject:  in.ChartProject,
		ChartName:     in.ChartName,
		ChartVersion:  in.Version,
		ServiceName:   in.ServiceName,
		DisplayName:   displayName,
		Cluster:       cluster,
		Namespace:     namespace,
		ValuesYAML:    valuesYAML,
		EditorState:   in.EditorState,
		Status:        models.StatusDraft,
	}
	r.ArgoCDAppName = s.gitops.AppName(r.Team, r.ChartName, r.ServiceName) // computed once
	r.ResourceIdentity = s.resourceIdentity(ctx, r.ChartProject, r.ChartName, r.ChartVersion, r.ServiceName, in.Values)
	if err := s.checkServiceName(ctx, r); err != nil {
		return nil, err
	}
	if err := s.checkNamespaceIdentity(ctx, r); err != nil {
		return nil, err
	}

	if err := s.store.CreateRequest(ctx, r); err != nil {
		return nil, err // ErrConflict -> 409
	}
	// A draft and an order are the same row at this point, but not the same
	// event to the person reading the history later: one is "I started filling
	// this in", the other is "I ordered it". The type carries that apart -
	// nothing downstream can reconstruct it from the row, because a draft that
	// was later submitted looks exactly like an order that never was one.
	if in.Draft {
		s.event(ctx, r, byUser(u), "draft_created", "", "")
		return r, nil // stays DRAFT until Submit
	}
	s.event(ctx, r, byUser(u), "created", "", "")

	proj, err := s.ensureRepo(ctx, r.Team, r.ChartName)
	if err != nil {
		return r, err // DRAFT persists; caller sees upstream error
	}
	appYAML, _ := s.gitops.RenderApplication(r, proj.WebURL)
	actions := []gitlab.FileAction{
		{Action: "create", FilePath: s.gitops.AppPath(r.Cluster, r.ServiceName), Content: appYAML},
		{Action: "create", FilePath: s.gitops.ValuesPath(r.Cluster, r.ServiceName), Content: valuesYAML},
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionCreate, actions); err != nil {
		return r, err
	}
	if err := s.transition(ctx, r, models.StatusMRCreated, byUser(u)); err != nil {
		return r, err
	}
	return r, nil
}

// --- submit ---

// Submit promotes a DRAFT order: it re-validates the stored values against the
// chart schema, opens the create MR, and advances to MR_CREATED.
func (s *Service) Submit(ctx context.Context, u *models.User, id string) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canProvision(u, r.Team) {
		return nil, ErrForbidden
	}
	if r.DeletedAt != nil {
		return nil, models.ErrNotFound
	}
	if r.Status != models.StatusDraft {
		return nil, &ValidationError{Message: MsgNotDraft}
	}
	if !nameRe.MatchString(r.ServiceName) || len(r.ServiceName) > 63 {
		return nil, &ValidationError{Message: MsgServiceName}
	}
	var values map[string]any
	if uerr := yaml.Unmarshal([]byte(r.ValuesYAML), &values); uerr != nil {
		return nil, &ValidationError{Message: MsgBadValues + uerr.Error()}
	}
	valuesYAML, err := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, r.ChartVersion, r.Namespace, values, true)
	if err != nil {
		return nil, err
	}
	r.ValuesYAML = valuesYAML

	proj, err := s.ensureRepo(ctx, r.Team, r.ChartName)
	if err != nil {
		return r, err
	}
	appYAML, _ := s.gitops.RenderApplication(r, proj.WebURL)
	actions := []gitlab.FileAction{
		{Action: "create", FilePath: s.gitops.AppPath(r.Cluster, r.ServiceName), Content: appYAML},
		{Action: "create", FilePath: s.gitops.ValuesPath(r.Cluster, r.ServiceName), Content: valuesYAML},
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionCreate, actions); err != nil {
		return r, err
	}
	if err := s.transition(ctx, r, models.StatusMRCreated, byUser(u)); err != nil {
		return r, err
	}
	return r, nil
}

// --- update ---

// Update patches an existing order. For a DRAFT it persists the form (values,
// version, and the still-mutable identity/display name) without an MR; for a
// live order it opens an update MR and advances to MR_CREATED.
func (s *Service) Update(ctx context.Context, u *models.User, id string, in UpdateInput) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canEdit(u, r.Team) {
		return nil, ErrForbidden
	}
	if r.DeletedAt != nil {
		return nil, models.ErrNotFound
	}
	if err := checkEditorState(in.EditorState); err != nil {
		return nil, err
	}
	if r.Status == models.StatusDraft {
		return s.updateDraft(ctx, u, r, in)
	}
	// Guard the FSM edge BEFORE touching Git: a live order can be edited only from
	// a state that may advance to MR_CREATED (i.e. once the create MR is merged).
	// Checking first avoids opening an update MR we then can't transition into,
	// which would leave a dangling open MR (mirrors the delete guard).
	if !CanTransition(r.Status, models.StatusMRCreated) {
		return nil, &ValidationError{Message: MsgNotLiveEdit}
	}
	if err := s.guardOpenMR(ctx, id); err != nil {
		return nil, err
	}

	version := r.ChartVersion
	if in.Version != "" {
		version = in.Version
	}
	if err := s.ensureOrderable(ctx, r.ChartProject, r.ChartName, version); err != nil {
		return nil, err
	}
	valuesYAML, err := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, version, r.Namespace, in.Values, true)
	if err != nil {
		return nil, err
	}

	// An update with nothing in it: the form was opened and saved as it was. A
	// merge request for that diff is empty, and it is not harmless - the order
	// sits in MR_CREATED waiting on a review of nothing, and every real edit is
	// refused until someone closes it. Compared after marshalling, so a change
	// the schema normalises away (reordered keys, a value respelled into the
	// same YAML) counts as no change, which is what it is in Git.
	//
	// The visual editor's own state is not in Git at all - a moved node or a
	// workload parked outside the values is still worth persisting, it just
	// does not need a merge request.
	if valuesYAML == r.ValuesYAML && version == r.ChartVersion {
		if len(in.EditorState) > 0 && !bytes.Equal(in.EditorState, r.EditorState) {
			r.EditorState = in.EditorState
			if err := s.store.UpdateRequest(ctx, r); err != nil {
				return nil, err
			}
			return r, nil
		}
		return nil, &ValidationError{
			Message: "в заказе ничего не изменилось, отправлять на согласование нечего",
		}
	}

	proj, err := s.ensureRepo(ctx, r.Team, r.ChartName)
	if err != nil {
		return nil, err
	}
	r.ChartVersion = version
	r.ValuesYAML = valuesYAML
	r.EditorState = in.EditorState // nil keeps what the store already holds
	appYAML, _ := s.gitops.RenderApplication(r, proj.WebURL)
	actions := []gitlab.FileAction{
		{Action: "update", FilePath: s.gitops.AppPath(r.Cluster, r.ServiceName), Content: appYAML},
		{Action: "update", FilePath: s.gitops.ValuesPath(r.Cluster, r.ServiceName), Content: valuesYAML},
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionUpdate, actions); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, r, models.StatusMRCreated, byUser(u)); err != nil {
		return nil, err
	}
	return r, nil
}

// updateDraft persists draft edits (values, version, identity, display name)
// without opening an MR. Values may be incomplete, so schema validation is
// deferred to Submit.
func (s *Service) updateDraft(ctx context.Context, u *models.User, r *models.Request, in UpdateInput) (*models.Request, error) {
	if in.Version != "" && in.Version != r.ChartVersion {
		if _, err := s.catalog.GetVersion(ctx, r.ChartProject, r.ChartName, in.Version); err != nil {
			if errors.Is(err, models.ErrNotFound) {
				return nil, &ValidationError{Message: MsgUnknownChart}
			}
			return nil, fmt.Errorf("%w: harbor: %v", ErrUpstream, err)
		}
		if err := s.ensureOrderable(ctx, r.ChartProject, r.ChartName, in.Version); err != nil {
			return nil, err
		}
		r.ChartVersion = in.Version
	}
	if in.ServiceName != "" && in.ServiceName != r.ServiceName {
		if !nameRe.MatchString(in.ServiceName) || len(in.ServiceName) > 63 {
			return nil, &ValidationError{Message: MsgServiceName}
		}
		r.ServiceName = in.ServiceName
		r.ArgoCDAppName = s.gitops.AppName(r.Team, r.ChartName, r.ServiceName)
	}
	if in.DisplayName != "" {
		r.DisplayName = in.DisplayName
	}
	if in.Cluster != "" {
		if !nameRe.MatchString(in.Cluster) || len(in.Cluster) > 63 {
			return nil, &ValidationError{Message: MsgCluster}
		}
		r.Cluster = in.Cluster
	}
	// Recompute the destination namespace from the (possibly changed) values and
	// the view directive: a source=values/fixed chart has no form field, so it
	// cannot come from in.Namespace. For source=field the form input wins, else
	// the current value is kept.
	orderNS := in.Namespace
	if orderNS == "" {
		orderNS = r.Namespace
	}
	ns, err := s.resolveNamespace(ctx, r.ChartProject, r.ChartName, r.ChartVersion, orderNS, r.ServiceName, in.Values)
	if err != nil {
		return nil, err
	}
	r.Namespace = ns
	valuesYAML, err := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, r.ChartVersion, r.Namespace, in.Values, false)
	if err != nil {
		return nil, err
	}
	r.ValuesYAML = valuesYAML
	r.EditorState = in.EditorState // nil keeps what the store already holds
	r.ResourceIdentity = s.resourceIdentity(ctx, r.ChartProject, r.ChartName, r.ChartVersion, r.ServiceName, in.Values)
	if err := s.checkServiceName(ctx, r); err != nil {
		return nil, err
	}
	if err := s.checkNamespaceIdentity(ctx, r); err != nil {
		return nil, err
	}
	if err := s.store.UpdateRequest(ctx, r); err != nil {
		return nil, err // ErrConflict (identity collision) / ErrStaleVersion
	}
	s.event(ctx, r, byUser(u), "draft_updated", "", "")
	return r, nil
}

// Rename changes only the cosmetic display name. It never opens an MR and works
// in any non-deleted status - the display name doesn't affect the deployment.
func (s *Service) Rename(ctx context.Context, u *models.User, id, displayName string) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canEdit(u, r.Team) {
		return nil, ErrForbidden
	}
	if r.DeletedAt != nil {
		return nil, models.ErrNotFound
	}
	// Name unchanged - write nothing and don't emit a "renamed" event.
	if displayName == r.DisplayName {
		return r, nil
	}
	r.DisplayName = displayName
	if err := s.store.UpdateRequest(ctx, r); err != nil {
		return nil, err
	}
	s.event(ctx, r, byUser(u), "renamed", "", "")
	return r, nil
}

// --- delete (soft) ---

// Delete opens an MR removing the instance folder and marks DELETE_REQUESTED.
func (s *Service) Delete(ctx context.Context, u *models.User, id string) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canProvision(u, r.Team) {
		return nil, ErrForbidden
	}
	if r.DeletedAt != nil {
		return nil, models.ErrNotFound
	}
	// A draft has nothing in Git yet: discard it directly, no delete MR.
	if r.Status == models.StatusDraft {
		now := time.Now()
		r.DeletedAt = &now
		r.Status = models.StatusDeleted
		if err := s.store.UpdateRequest(ctx, r); err != nil {
			return nil, err
		}
		s.event(ctx, r, byUser(u), "draft_discarded", "", "")
		return r, nil
	}
	// Guard the FSM edge BEFORE touching Git: delete is only valid once the create
	// MR is merged (MR_MERGED/DEPLOYING/HEALTHY/DEGRADED/ARGO_MISSING), never while
	// the create MR is still open (MR_CREATED). Checking first avoids opening a
	// delete MR we then can't transition into DELETE_REQUESTED, which would leave a
	// dangling open MR the poller never auto-merges.
	if !CanTransition(r.Status, models.StatusDeleteRequested) {
		return nil, &ValidationError{Message: MsgNotLiveDelete}
	}
	if err := s.guardOpenMR(ctx, id); err != nil {
		return nil, err
	}
	proj, err := s.ensureRepo(ctx, r.Team, r.ChartName)
	if err != nil {
		return nil, err
	}
	// delete every file in the instance folder
	files, terr := s.gl.ListTree(ctx, proj.ID, s.defaultBranch, s.gitops.InstanceDir(r.Cluster, r.ServiceName))
	if terr != nil {
		return nil, gitopsErr("list tree", terr)
	}
	if len(files) == 0 {
		// Nothing committed in Git for this instance - the manifests were removed
		// outside the portal (e.g. an imported order whose files are gone, or a
		// reset repo). There's no delete MR to open; close the order out directly
		// rather than committing a delete of files that don't exist (GitLab 400).
		now := time.Now()
		r.DeletedAt = &now
		r.Status = models.StatusDeleted
		if err := s.store.UpdateRequest(ctx, r); err != nil {
			return nil, err
		}
		s.event(ctx, r, byUser(u), "deleted", "", models.StatusDeleted)
		s.publishStatus(r.ID, string(models.StatusDeleted))
		return r, nil
	}
	actions := make([]gitlab.FileAction, 0, len(files))
	for _, f := range files {
		actions = append(actions, gitlab.FileAction{Action: "delete", FilePath: f})
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionDelete, actions); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, r, models.StatusDeleteRequested, byUser(u)); err != nil {
		return nil, err
	}
	return r, nil
}

// ForceSync triggers an ArgoCD sync (admin only). The sync hard-refreshes the
// app first so ArgoCD re-pulls the latest Git revision before applying it (a
// plain sync would only re-apply the cached, already-deployed manifests).
func (s *Service) ForceSync(ctx context.Context, u *models.User, id string) error {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return err
	}
	if !u.IsAdmin() {
		return ErrForbidden
	}
	start := time.Now()
	err = s.argo.Sync(ctx, r.ArgoCDAppName)
	observability.ObserveArgoSync(err)
	if err != nil {
		s.logger().Error("sync forced",
			"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName,
			"actor", u.Subject, "duration_ms", time.Since(start).Milliseconds(), "err", err)
		return fmt.Errorf("%w: argocd: %v", ErrUpstream, err)
	}
	s.logger().Info("sync forced",
		"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName,
		"actor", u.Subject, "duration_ms", time.Since(start).Milliseconds())
	s.event(ctx, r, byUser(u), "sync_forced", "", "")
	return nil
}

// --- helpers ---

func (s *Service) guardOpenMR(ctx context.Context, id string) error {
	if mr, err := s.store.GetOpenMR(ctx, id); err == nil {
		return &OpenMRError{URL: mr.MRURL, IID: mr.MRIID}
	} else if !errors.Is(err, models.ErrNotFound) {
		return err
	}
	return nil
}

// validateAndMarshal marshals values to YAML. When validate is true it first
// checks them against the chart's JSON schema (drafts pass false, since their
// values may still be incomplete).
func (s *Service) validateAndMarshal(ctx context.Context, project, name, version, namespace string, values map[string]any, validate bool) (string, error) {
	if values == nil {
		values = map[string]any{}
	}
	// Stamp order-time values the chart declares in its view: fixed "defaults"
	// (e.g. namespace.creator=console) and the "namespace" binding (mirror the
	// destination namespace into the field a self-provisioning chart names it by).
	// Applied before validation so the stamped values are schema-checked too.
	// Chart-agnostic: the rules live in the chart's view document, not here.
	values = s.applyViewStamps(ctx, project, name, version, namespace, values)
	if !validate {
		out, merr := yaml.Marshal(values)
		if merr != nil {
			return "", &ValidationError{Message: MsgBadValues + merr.Error()}
		}
		return string(out), nil
	}
	schemaBytes, err := s.catalog.GetSchema(ctx, project, name, version)
	if err == nil && len(schemaBytes) > 0 {
		c := jsonschema.NewCompiler()
		if aerr := c.AddResource("values.schema.json", bytes.NewReader(schemaBytes)); aerr == nil {
			if sch, cerr := c.Compile("values.schema.json"); cerr == nil {
				if verr := sch.Validate(values); verr != nil {
					return "", schemaValidationError(verr)
				}
			}
		}
	} else if err != nil && !errors.Is(err, models.ErrNotFound) {
		return "", fmt.Errorf("%w: harbor schema: %v", ErrUpstream, err)
	}
	if verr := s.checkGraphNotEmpty(ctx, project, name, version, values); verr != nil {
		return "", verr
	}
	out, merr := yaml.Marshal(values)
	if merr != nil {
		return "", &ValidationError{Message: MsgBadValues + merr.Error()}
	}
	return string(out), nil
}

// checkGraphNotEmpty refuses an order of a chart whose values are drawn as a
// graph when nothing is drawn. The schema cannot catch this: an empty list is a
// valid list, so the order goes through and deploys a service with no rules in
// it at all, which is never what anyone meant to ask for.
//
// Chart-agnostic, like the rest of the order path: the version's own view
// document says whether it has a graph and where its entries live.
func (s *Service) checkGraphNotEmpty(ctx context.Context, project, name, version string,
	values map[string]any) *ValidationError {

	mapping := views.ReadGraphMapping(s.orderView(ctx, project, name, version))
	if mapping == nil {
		return nil
	}
	if mapping.CountGraphRules(values) > 0 {
		return nil
	}
	return &ValidationError{
		Message: "Добавьте хотя бы одну связь. Без связей сервис не получит ни одного правила.",
	}
}

// schemaValidationError flattens a jsonschema failure into a ValidationError with
// a per-field breakdown (the leaf causes), so the UI can pinpoint bad fields.
func schemaValidationError(err error) *ValidationError {
	ve := &ValidationError{Message: "Значения не прошли проверку по схеме чарта"}
	var je *jsonschema.ValidationError
	if errors.As(err, &je) {
		collectSchemaLeaves(je, &ve.Fields)
	}
	if len(ve.Fields) == 0 {
		ve.Fields = []FieldError{{Message: err.Error()}}
	}
	return ve
}

// collectSchemaLeaves gathers the leaf validation errors (the actionable ones,
// each pinned to an instance location) from the error tree.
//
// Each leaf carries the keyword it broke, so the portal can say what the field
// takes in its own words rather than forward the validator's English. A missing
// property is split into one error per property, pinned to the field itself:
// "this object lacks a name" is about the name field, and that is where the
// form has to point.
func collectSchemaLeaves(e *jsonschema.ValidationError, out *[]FieldError) {
	if len(e.Causes) == 0 {
		kw := schemaKeyword(e.KeywordLocation)
		if kw == keywordRequired {
			if missing := missingProperties(e.Message); len(missing) > 0 {
				for _, name := range missing {
					*out = append(*out, FieldError{
						Path:    e.InstanceLocation + "/" + escapePointerToken(name),
						Message: e.Message,
						Keyword: kw,
					})
				}
				return
			}
		}
		*out = append(*out, FieldError{Path: e.InstanceLocation, Message: e.Message, Keyword: kw})
		return
	}
	for _, c := range e.Causes {
		collectSchemaLeaves(c, out)
	}
}

const keywordRequired = "required"

// schemaKeyword is the rule a leaf failure broke, read off the end of its
// keyword location ("/properties/port/minimum" -> "minimum"). A location that
// ends in a step through the schema rather than in a rule ("$ref", a branch
// index of anyOf) names no rule, and the portal falls back to a general
// complaint about the value.
func schemaKeyword(loc string) string {
	i := strings.LastIndex(loc, "/")
	if i < 0 {
		return ""
	}
	kw := loc[i+1:]
	if kw == "" || strings.HasPrefix(kw, "$") {
		return ""
	}
	if _, err := strconv.Atoi(kw); err == nil {
		return ""
	}
	return kw
}

// missingProperties reads the property names out of the validator's "required"
// message, which is the only place it puts them: "missing properties: 'a', 'b'"
// (see jsonschema/v5 schema.go). Returns nothing if the message is not in that
// shape, and the caller keeps the failure whole.
func missingProperties(msg string) []string {
	const prefix = "missing properties: "
	if !strings.HasPrefix(msg, prefix) {
		return nil
	}
	var out []string
	for part := range strings.SplitSeq(strings.TrimPrefix(msg, prefix), ", ") {
		name := strings.Trim(strings.TrimSpace(part), "'")
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}

// escapePointerToken encodes one JSON Pointer token (RFC 6901): a property name
// may itself contain "/" or "~".
func escapePointerToken(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

// ensureRepo verifies the (manually-created) team subgroup and idempotently
// creates the chart repo.
func (s *Service) ensureRepo(ctx context.Context, team, chart string) (*gitlab.Project, error) {
	subgroup := s.gitops.SubgroupPath(team)
	grp, err := s.gl.GetGroup(ctx, subgroup)
	if err != nil {
		if errors.Is(err, models.ErrNotFound) {
			return nil, fmt.Errorf("%w: team subgroup %q not found (must be created manually)", ErrUpstream, subgroup)
		}
		return nil, gitopsErr("group", err)
	}
	repoPath := s.gitops.RepoPath(team, chart)
	proj, err := s.gl.GetProject(ctx, repoPath)
	if errors.Is(err, models.ErrNotFound) {
		proj, err = s.gl.CreateProject(ctx, grp.ID, chart)
		if err != nil {
			return nil, gitopsErr("create repo", err)
		}
		// A group or system hook already covers the new repo; a per-repo one does
		// not exist yet. Never fail the order over it: a missing webhook only
		// delays the reaction to a merge until the next poll.
		if herr := s.Hooks.EnsureProject(ctx, proj.ID); herr != nil {
			s.logger().Warn("gitlab webhook not registered on new repo",
				"chart", chart, "gitlab_project_id", proj.ID, "err", herr)
		}
	} else if err != nil {
		return nil, gitopsErr("repo", err)
	}
	// A freshly created repo is empty (no default branch). The MR-based flow needs
	// a branch to open MRs against, so seed a single .gitkeep to establish it -
	// no README, keeping the repo otherwise empty. Idempotent: skip once a default
	// branch exists (also self-heals a repo left half-initialised by a past run).
	if proj.DefaultBranch == "" {
		seed := []gitlab.FileAction{{Action: "create", FilePath: ".gitkeep", Content: ""}}
		if cerr := s.gl.CommitFiles(ctx, proj.ID, s.defaultBranch, "chore: initialize repository", seed); cerr != nil {
			return nil, gitopsErr("init repo", cerr)
		}
		proj.DefaultBranch = s.defaultBranch
	}
	return proj, nil
}

// commitTitle builds a Conventional Commits message for a GitOps change (the
// commit subject). Scope is the instance, body names the chart.
func commitTitle(action models.MRAction, chart, service string) string {
	switch action {
	case models.ActionCreate:
		return fmt.Sprintf("feat(%s): add %s instance", service, chart)
	case models.ActionUpdate:
		return fmt.Sprintf("chore(%s): update %s values", service, chart)
	case models.ActionDelete:
		return fmt.Sprintf("chore(%s): remove %s instance", service, chart)
	default:
		return fmt.Sprintf("chore(%s): update", service)
	}
}

// mrTitle builds the merge-request title by a reviewer-friendly convention:
//
//	portal(<action>): <chart> "<service>" - <team>/<cluster>
//
// More descriptive than the bare commit subject so the MR list reads well in
// GitLab (what changed, which instance, which team/cluster).
func mrTitle(action models.MRAction, r *models.Request) string {
	verb := map[models.MRAction]string{
		models.ActionCreate: "deploy",
		models.ActionUpdate: "update",
		models.ActionDelete: "remove",
	}[action]
	if verb == "" {
		verb = "change"
	}
	return fmt.Sprintf("portal(%s): %s %q - %s/%s", verb, r.ChartName, r.ServiceName, r.Team, r.Cluster)
}

func (s *Service) openChange(ctx context.Context, r *models.Request, proj *gitlab.Project,
	action models.MRAction, actions []gitlab.FileAction) (*models.RequestMR, error) {

	commitMsg := commitTitle(action, r.ChartName, r.ServiceName)
	branch := fmt.Sprintf("portal/%s-%s-%s", action, r.ServiceName, shortID())
	if err := s.gl.CreateBranch(ctx, proj.ID, branch, s.defaultBranch); err != nil {
		return nil, gitopsErr("branch", err)
	}
	if err := s.gl.CommitFiles(ctx, proj.ID, branch, commitMsg, actions); err != nil {
		return nil, gitopsErr("commit", err)
	}
	mr, err := s.gl.CreateMR(ctx, proj.ID, branch, s.defaultBranch, mrTitle(action, r))
	if err != nil {
		return nil, gitopsErr("mr", err)
	}
	rec := &models.RequestMR{
		ID: newID(), RequestID: r.ID, GitLabProjectID: proj.ID,
		MRIID: mr.IID, MRURL: mr.WebURL, Status: mr.State, Action: action,
	}
	if err := s.store.AddMR(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// transition persists a status change with optimistic locking and emits events.
// actorRef is who an audit event is attributed to. The subject is what the
// trail is keyed by; the name rides along because the portal keeps no user
// directory to resolve it later, and the timeline has to show a person, not a
// UUID. bySystem leaves the name empty - that is how the UI tells "the platform
// did this" from "someone did this".
type actorRef struct {
	subject string
	name    string
}

func byUser(u *models.User) actorRef { return actorRef{subject: u.Subject, name: u.Name} }

func bySystem() actorRef { return actorRef{subject: "system"} }

func (s *Service) transition(ctx context.Context, r *models.Request, to models.RequestStatus, a actorRef) error {
	from := r.Status
	if !CanTransition(from, to) {
		return fmt.Errorf("invalid transition %s -> %s", from, to)
	}
	r.Status = to
	// Persist the status change and its audit event atomically: a failure between
	// them must not leave a transitioned order with no audit trail.
	if err := s.store.Tx(ctx, func(tx store.Store) error {
		if err := tx.UpdateRequest(ctx, r); err != nil {
			return err
		}
		return tx.AddEvent(ctx, &models.RequestEvent{
			RequestID: r.ID, Actor: a.subject, ActorName: a.name,
			EventType: "status_changed", FromStatus: from, ToStatus: to,
		})
	}); err != nil {
		return err
	}
	s.notifyStatus(ctx, r, from, to)
	s.publishStatus(r.ID, string(to))
	s.logger().Debug("order transition",
		"order_id", r.ID, "from", from, "to", to, "actor", a.subject)
	return nil
}

// notifyStatus tells the person who ordered the service what became of it. Only
// the two states they can act on: it works now, or it stopped working. The
// steps in between are the portal moving the order along, and the order page
// shows them to whoever is watching.
func (s *Service) notifyStatus(ctx context.Context, r *models.Request, from, to models.RequestStatus) {
	if s.notify == nil {
		return
	}
	switch to {
	case models.StatusHealthy:
		s.notify.OrderHealthy(ctx, nil, r, string(from))
	case models.StatusDegraded, models.StatusArgoMissing:
		s.notify.OrderDegraded(ctx, nil, r, r.DriftDetail)
	}
}

// publishStatus fans a status change out to the per-request topic (detail page)
// and the global "requests" topic (list views' live refresh).
func (s *Service) publishStatus(id, status string) {
	data := map[string]any{"id": id, "status": status}
	s.bus.Publish(events.Event{Topic: "request:" + id, Type: "status_changed", Data: data})
	s.bus.Publish(events.Event{Topic: "requests", Type: "status_changed", Data: data})
}

// event records a standalone audit entry for an action that has already been
// committed (create, rename, delete, ...). A failure here must not fail the
// action, but it is no longer swallowed silently: losing an audit row is logged
// at Warn so it is visible. Transitions use Tx (above) for atomicity instead.
func (s *Service) event(ctx context.Context, r *models.Request, a actorRef, typ string, from, to models.RequestStatus) {
	s.eventWith(ctx, r, a, typ, from, to, nil)
}

// eventWith is event with a payload: extra structured detail the timeline needs
// but the status columns cannot carry (why a merge was refused, for instance).
func (s *Service) eventWith(ctx context.Context, r *models.Request, a actorRef, typ string,
	from, to models.RequestStatus, payload map[string]any) {

	if err := s.store.AddEvent(ctx, &models.RequestEvent{
		RequestID: r.ID, Actor: a.subject, ActorName: a.name,
		EventType: typ, FromStatus: from, ToStatus: to, Payload: payload,
	}); err != nil {
		s.logger().Warn("audit event not recorded", "order_id", r.ID, "event_type", typ, "err", err)
	}
}
