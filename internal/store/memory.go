package store

import (
	"context"
	"sort"
	"sync"
	"time"

	"console/pkg/models"
)

// Memory is an in-memory Store for tests and local fakes-only runs.
type Memory struct {
	mu            sync.Mutex
	requests      map[string]*models.Request
	mrs           map[string]*models.RequestMR
	events        []*models.RequestEvent
	eventSeq      int64
	categories    map[string]*models.Category
	pubs          map[string]*models.ChartPublication
	pubVersions   map[string]*models.PublicationVersion // keyed by version ID
	pubEvents     []*models.PublicationEvent
	pubEventSeq   int64
	users         map[string]*models.PlatformUser // sign-in directory, keyed by OIDC subject
	notifications []*models.Notification
	notifRead     map[string]map[string]bool // subject -> notification id -> read
	notifCursor   map[string]time.Time       // subject -> "everything before this is read"
	// notifSince is the floor under each reader's feed: when the portal first
	// saw them in an audience (see RecordAudiences).
	notifSince map[string]map[audienceRef]time.Time
	now        func() time.Time
	lastStamp  time.Time
}

var _ Store = (*Memory)(nil)

// NewMemory returns an empty in-memory store.
func NewMemory() *Memory {
	return &Memory{
		requests:    map[string]*models.Request{},
		mrs:         map[string]*models.RequestMR{},
		categories:  map[string]*models.Category{},
		pubs:        map[string]*models.ChartPublication{},
		pubVersions: map[string]*models.PublicationVersion{},
		users:       map[string]*models.PlatformUser{},
		notifRead:   map[string]map[string]bool{},
		notifCursor: map[string]time.Time{},
		notifSince:  map[string]map[audienceRef]time.Time{},
		now:         time.Now,
	}
}

func clone[T any](v *T) *T { cp := *v; return &cp }

// listed clones an order the way a list query returns it: without the editor
// state, which Postgres reads only for a single order (it can be large).
func listed(r *models.Request) *models.Request {
	cp := clone(r)
	cp.EditorState = nil
	return cp
}

// stamp returns a strictly increasing timestamp so insertion order is
// recoverable even when the wall clock has coarse resolution (e.g. Windows,
// where two quick calls can return the same time). Callers must hold m.mu.
func (m *Memory) stamp() time.Time {
	t := m.now()
	if !t.After(m.lastStamp) {
		t = m.lastStamp.Add(time.Nanosecond)
	}
	m.lastStamp = t
	return t
}

// activeKey is the uniqueness key for non-deleted requests. The namespace is
// part of it: one team may run the same service of the same chart in two
// namespaces (dev and stage of one thing), and only a second order into the
// same namespace is a collision. Compared by the effective namespace, so an
// order that left the field empty lands on the same key as one that named the
// service's own namespace outright.
func activeKey(r *models.Request) string {
	return r.Team + "\x00" + r.ChartName + "\x00" + r.ServiceName + "\x00" + r.Cluster +
		"\x00" + r.DestNamespace()
}

// namespaceKey mirrors the partial unique index uniq_active_namespace_identity:
// two orders of one chart must not render colliding resource names into the same
// namespace. Only meaningful when both namespace and resource_identity are set
// (see namespaceGuarded).
func namespaceKey(r *models.Request) string {
	return r.Cluster + "\x00" + r.Namespace + "\x00" + r.ChartName + "\x00" + r.ResourceIdentity
}

// namespaceGuarded reports whether r participates in the namespace-identity
// uniqueness check (matches the index WHERE clause).
func namespaceGuarded(r *models.Request) bool {
	return r.Namespace != "" && r.ResourceIdentity != ""
}

func (m *Memory) CreateRequest(ctx context.Context, r *models.Request) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r.DeletedAt == nil {
		for _, ex := range m.requests {
			if ex.DeletedAt != nil {
				continue
			}
			if activeKey(ex) == activeKey(r) {
				return models.ErrConflict
			}
			if namespaceGuarded(r) && namespaceKey(ex) == namespaceKey(r) {
				return models.ErrConflict
			}
		}
	}
	if r.Version == 0 {
		r.Version = 1
	}
	now := m.stamp()
	if r.CreatedAt.IsZero() {
		r.CreatedAt = now
	}
	r.UpdatedAt = now
	m.requests[r.ID] = clone(r)
	return nil
}

func (m *Memory) GetRequest(ctx context.Context, id string) (*models.Request, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.requests[id]
	if !ok {
		return nil, models.ErrNotFound
	}
	return clone(r), nil
}

func (m *Memory) ListRequests(ctx context.Context, f RequestFilter) ([]*models.Request, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.Request
	for _, r := range m.requests {
		if !f.IncludeDeleted && r.DeletedAt != nil {
			continue
		}
		if !f.Admin && len(f.Teams) > 0 && !contains(f.Teams, r.Team) {
			continue
		}
		if f.Team != "" && r.Team != f.Team {
			continue
		}
		if f.Status != "" && r.Status != f.Status {
			continue
		}
		if f.Chart != "" && r.ChartName != f.Chart {
			continue
		}
		out = append(out, listed(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (m *Memory) UpdateRequest(ctx context.Context, r *models.Request) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.requests[r.ID]
	if !ok {
		return models.ErrNotFound
	}
	if cur.Version != r.Version {
		return models.ErrStaleVersion
	}
	// Identity may change while a DRAFT; guard against colliding with another
	// active order (mirrors the partial unique indexes in Postgres: the
	// team/chart/service key and the namespace/identity key).
	if r.DeletedAt == nil {
		for id, ex := range m.requests {
			if id == r.ID || ex.DeletedAt != nil {
				continue
			}
			if activeKey(ex) == activeKey(r) {
				return models.ErrConflict
			}
			if namespaceGuarded(r) && namespaceKey(ex) == namespaceKey(r) {
				return models.ErrConflict
			}
		}
	}
	r.Version = cur.Version + 1
	r.UpdatedAt = m.stamp()
	r.CreatedAt = cur.CreatedAt
	// Mirror Postgres: no editor state passed means keep the stored one (list
	// reads carry none), an explicit JSON null clears it.
	if r.EditorState == nil {
		r.EditorState = cur.EditorState
	}
	m.requests[r.ID] = clone(r)
	return nil
}

// SetDrift updates only the drift fields (no version bump), matching Postgres.
func (m *Memory) SetDrift(ctx context.Context, id string, drifted bool, detail string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.requests[id]
	if !ok {
		return models.ErrNotFound
	}
	r.Drifted = drifted
	r.DriftDetail = detail
	return nil
}

func (m *Memory) ListActive(ctx context.Context) ([]*models.Request, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.Request
	for _, r := range m.requests {
		if r.DeletedAt != nil {
			continue
		}
		if isTerminal(r.Status) {
			continue
		}
		out = append(out, listed(r))
	}
	return out, nil
}

func (m *Memory) AddMR(ctx context.Context, mr *models.RequestMR) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mr.CreatedAt.IsZero() {
		mr.CreatedAt = m.stamp()
	}
	m.mrs[mr.ID] = clone(mr)
	return nil
}

func (m *Memory) UpdateMR(ctx context.Context, mr *models.RequestMR) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.mrs[mr.ID]; !ok {
		return models.ErrNotFound
	}
	m.mrs[mr.ID] = clone(mr)
	return nil
}

func (m *Memory) ListMRs(ctx context.Context, requestID string) ([]*models.RequestMR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.RequestMR
	for _, mr := range m.mrs {
		if mr.RequestID == requestID {
			out = append(out, clone(mr))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (m *Memory) GetOpenMR(ctx context.Context, requestID string) (*models.RequestMR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, mr := range m.mrs {
		if mr.RequestID == requestID && mr.Status == models.MROpened {
			return clone(mr), nil
		}
	}
	return nil, models.ErrNotFound
}

func (m *Memory) AddEvent(ctx context.Context, e *models.RequestEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.eventSeq++
	e.ID = m.eventSeq
	if e.CreatedAt.IsZero() {
		e.CreatedAt = m.stamp()
	}
	m.events = append(m.events, clone(e))
	return nil
}

func (m *Memory) ListEvents(ctx context.Context, requestID string) ([]*models.RequestEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.RequestEvent
	for _, e := range m.events {
		if e.RequestID == requestID {
			out = append(out, clone(e))
		}
	}
	return out, nil
}

// Tx runs fn against the same in-memory store. It is NOT a real transaction:
// the memory backend has no rollback, so a mid-fn failure leaves earlier writes
// applied. Adequate for tests/local; the production Postgres store is atomic.
// --- Notifications ---

func (m *Memory) AddNotification(ctx context.Context, n *models.Notification) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if n.DedupKey != "" {
		for _, ex := range m.notifications {
			if ex.DedupKey == n.DedupKey {
				return nil // already said once
			}
		}
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = m.stamp()
	}
	m.notifications = append(m.notifications, clone(n))
	return nil
}

// audienceRef is one audience a reader belongs to: the rule and what it names.
type audienceRef struct {
	audience models.NotificationAudience
	key      string
}

func (m *Memory) RecordAudiences(ctx context.Context, subject string, teams []string, role string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recordAudiences(subject, teams, role, at)
	return nil
}

// recordAudiences is RecordAudiences with m.mu held.
func (m *Memory) recordAudiences(subject string, teams []string, role string, at time.Time) {
	if subject == "" {
		return
	}
	if at.IsZero() {
		at = m.stamp()
	}
	since := m.notifSince[subject]
	if since == nil {
		since = map[audienceRef]time.Time{}
		m.notifSince[subject] = since
	}
	// First sighting only: the floor marks when somebody turned up in an
	// audience, so a later appearance must not move it forward over news they
	// were there for.
	remember := func(a models.NotificationAudience, key string) {
		if _, ok := since[audienceRef{a, key}]; !ok {
			since[audienceRef{a, key}] = at
		}
	}
	remember(models.AudienceAll, "")
	if role != "" {
		remember(models.AudienceRole, role)
	}
	for _, t := range teams {
		remember(models.AudienceTeam, t)
	}
}

// afterFloor answers whether this notification is at least as new as the moment
// the reader turned up in the audience it addresses (callers hold m.mu).
//
// A notification addressed to one person is exempt: it names them, so it cannot
// predate them. And a reader nobody has recorded has no floor at all - see
// Store.RecordAudiences.
func (m *Memory) afterFloor(n *models.Notification, f NotificationFilter) bool {
	if n.Audience == models.AudienceUser {
		return true
	}
	since, ok := m.notifSince[f.Subject][audienceRef{n.Audience, n.AudienceKey}]
	return !ok || !n.CreatedAt.Before(since)
}

// visible answers the audience rule for one reader (callers hold m.mu).
func visible(n *models.Notification, f NotificationFilter) bool {
	switch n.Audience {
	case models.AudienceAll:
		return true
	case models.AudienceUser:
		return n.AudienceKey == f.Subject
	case models.AudienceRole:
		return n.AudienceKey == f.Role
	case models.AudienceTeam:
		return contains(f.Teams, n.AudienceKey)
	}
	return false
}

// readBy answers whether this reader has seen a notification: either marked
// individually, or covered by the cursor a "read all" left behind.
func (m *Memory) readBy(n *models.Notification, subject string) bool {
	if m.notifRead[subject][n.ID] {
		return true
	}
	cleared, ok := m.notifCursor[subject]
	return ok && !n.CreatedAt.After(cleared)
}

func (m *Memory) ListNotifications(ctx context.Context, f NotificationFilter) ([]*models.Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.Notification
	for _, n := range m.notifications {
		if !visible(n, f) || !m.afterFloor(n, f) {
			continue
		}
		if !f.Before.IsZero() && !n.CreatedAt.Before(f.Before) {
			continue
		}
		cp := clone(n)
		cp.Read = m.readBy(n, f.Subject)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if f.Limit > 0 && len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out, nil
}

func (m *Memory) CountUnread(ctx context.Context, f NotificationFilter) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, n := range m.notifications {
		if visible(n, f) && m.afterFloor(n, f) && !m.readBy(n, f.Subject) {
			count++
		}
	}
	return count, nil
}

func (m *Memory) MarkRead(ctx context.Context, id, subject string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.notifRead[subject] == nil {
		m.notifRead[subject] = map[string]bool{}
	}
	m.notifRead[subject][id] = true
	return nil
}

func (m *Memory) MarkAllRead(ctx context.Context, subject string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifCursor[subject] = m.stamp()
	return nil
}

func (m *Memory) LatestNotification(ctx context.Context, subjectType, subjectID string) (*models.Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var latest *models.Notification
	for _, n := range m.notifications {
		if n.SubjectType != subjectType || n.SubjectID != subjectID {
			continue
		}
		// Not before, so that the last of several stamped the same moment wins:
		// they are stored in the order they were sent.
		if latest == nil || !n.CreatedAt.Before(latest.CreatedAt) {
			latest = n
		}
	}
	if latest == nil {
		return nil, models.ErrNotFound
	}
	return clone(latest), nil
}

func (m *Memory) DeleteReadNotificationsBefore(ctx context.Context, cutoff time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.notifications[:0]
	gone := 0
	for _, n := range m.notifications {
		if n.CreatedAt.Before(cutoff) && len(m.readersOf(n.ID)) > 0 {
			gone++
			continue
		}
		kept = append(kept, n)
	}
	m.notifications = kept
	return gone, nil
}

// readersOf lists who marked a notification read (callers hold m.mu).
func (m *Memory) readersOf(id string) []string {
	var out []string
	for subject, ids := range m.notifRead {
		if ids[id] {
			out = append(out, subject)
		}
	}
	return out
}

func (m *Memory) Tx(ctx context.Context, fn func(Store) error) error {
	return fn(m)
}

func (m *Memory) Ping(ctx context.Context) error { return nil }
func (m *Memory) Close()                         {}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// isTerminal reports whether a status needs no further status polling.
func isTerminal(s models.RequestStatus) bool {
	switch s {
	case models.StatusDeleted, models.StatusMRClosed:
		return true
	default:
		return false
	}
}
