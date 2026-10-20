package api

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"console/internal/checks"
	"console/internal/store"
	"console/pkg/models"
)

// The admin duty board (issue #469): one read that answers "do I have to do
// something right now, and what". Everything on it is put together here from
// the sources the other admin pages read one by one - orders, stand checks,
// the component monitor, the background loops, configuration checks,
// maintenance, the approval queue and the activity feed - so the board cannot
// say "all is well" next to a page that says otherwise.
//
// The payload carries codes and facts, not sentences: what a person reads is
// chosen by the interface from the code (see web/src/features/board).

// Board is the whole board.
type Board struct {
	GeneratedAt time.Time               `json:"generated_at"`
	Tiles       BoardTiles              `json:"tiles"`
	Attention   []BoardAttention        `json:"attention"`
	Components  []BoardComponent        `json:"components"`
	InProgress  []BoardWork             `json:"in_progress"`
	Queue       []BoardQueueItem        `json:"queue"`
	Events      []*models.ActivityEvent `json:"events"`
}

// BoardPoint is one point of a trend: a day ("2006-01-02") for the daily
// tiles, an hour (RFC 3339) for the online one.
type BoardPoint struct {
	At    string `json:"at"`
	Value int    `json:"value"`
}

// BoardTiles is the top row of numbers.
type BoardTiles struct {
	Online  BoardCount `json:"online"`
	Users   BoardCount `json:"users"`
	Orders  BoardCount `json:"orders"`
	Actions BoardCount `json:"actions"`
}

// BoardCount is one tile: the number now (online) or today, the whole it is
// part of when there is one, and the trend behind it.
type BoardCount struct {
	Value  int          `json:"value"`
	Total  *int         `json:"total,omitempty"`
	Series []BoardPoint `json:"series"`
}

// Severity of a problem on the board.
const (
	SeverityCritical = "critical"
	SeverityWarning  = "warning"
)

// BoardAttention is one problem. Code says what it is (order_degraded,
// stand_checks_failed, integration_down...), Kind what it is about, and the
// rest names it: only the fields that apply are set.
type BoardAttention struct {
	ID       string     `json:"id"`
	Severity string     `json:"severity"`
	Kind     string     `json:"kind"`
	Code     string     `json:"code"`
	Since    *time.Time `json:"since,omitempty"`

	OrderID   string   `json:"order_id,omitempty"`
	Service   string   `json:"service,omitempty"`
	Team      string   `json:"team,omitempty"`
	StandID   string   `json:"stand_id,omitempty"`
	Stand     string   `json:"stand,omitempty"`
	Component string   `json:"component,omitempty"`
	Check     string   `json:"check,omitempty"`
	Job       string   `json:"job,omitempty"`
	Variables []string `json:"variables,omitempty"`
	// Until is when a maintenance window starts (scheduled) or is planned to
	// end (active).
	Until *time.Time `json:"until,omitempty"`
}

// BoardComponent is one line of the platform state. ID is the component
// (gitlab, argocd, harbor, keycloak) or one of storage, stands, jobs.
type BoardComponent struct {
	ID    string     `json:"id"`
	State string     `json:"state"` // ok | down
	Since *time.Time `json:"since,omitempty"`
}

// BoardWork is one thing under way: an order on its way somewhere, or a job
// running over a stand's orders.
type BoardWork struct {
	Kind    string    `json:"kind"` // order | stand_job
	Since   time.Time `json:"since"`
	OrderID string    `json:"order_id,omitempty"`
	Service string    `json:"service,omitempty"`
	Team    string    `json:"team,omitempty"`
	StandID string    `json:"stand_id,omitempty"`
	Stand   string    `json:"stand,omitempty"`
	Status  string    `json:"status,omitempty"`
	JobKind string    `json:"job_kind,omitempty"`
	ToMode  string    `json:"to_mode,omitempty"`
	Done    int       `json:"done,omitempty"`
	Total   int       `json:"total,omitempty"`
	By      string    `json:"by,omitempty"`
}

// BoardQueueItem is one decision waiting in the approval queue: a version
// submitted for review, or a publication's category or owner.
type BoardQueueItem struct {
	Kind          string    `json:"kind"` // version | publication
	PublicationID string    `json:"publication_id"`
	ChartProject  string    `json:"chart_project"`
	ChartName     string    `json:"chart_name"`
	Version       string    `json:"version,omitempty"`
	Team          string    `json:"team"`
	Since         time.Time `json:"since"`
}

const (
	// boardDays is how many days the daily trends cover, today included.
	boardDays = 14
	// boardHours is how far back the online trend looks.
	boardHours = 24
	// boardEvents is how many recent events the board lists.
	boardEvents = 8
	// deployingTooLong is when an order still deploying becomes a problem. An
	// apply takes a minute or two; a quarter of an hour means it is stuck, and
	// a first look earlier would only report the normal wait (see backend.md:
	// the first answer of an asynchronous upstream is "not yet", not "no").
	deployingTooLong = 15 * time.Minute
)

// inProgress are the order states that are on their way somewhere.
var inProgress = map[models.RequestStatus]bool{
	models.StatusMRCreated:       true,
	models.StatusMRMerged:        true,
	models.StatusDeploying:       true,
	models.StatusDeleteRequested: true,
	models.StatusDeleteMRMerged:  true,
}

func (s *Server) handleAdminBoard(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r, "the duty board") {
		return
	}
	// Days are the reader's: the browser sends its zone, and a zone the server
	// does not know falls back to UTC rather than failing the page.
	loc := time.UTC
	if tz := r.URL.Query().Get("tz"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	b, err := s.buildBoard(r.Context(), time.Now(), loc)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

// buildBoard reads every source once. A source that fails costs the board its
// part, not the whole page, except the orders: without them there is no board.
func (s *Server) buildBoard(ctx context.Context, now time.Time, loc *time.Location) (*Board, error) {
	b := &Board{
		GeneratedAt: now,
		Attention:   []BoardAttention{},
		Components:  []BoardComponent{},
		InProgress:  []BoardWork{},
		Queue:       []BoardQueueItem{},
		Events:      []*models.ActivityEvent{},
	}

	stands, err := s.Store.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	standName := make(map[string]string, len(stands))
	for _, st := range stands {
		standName[st.ID] = st.Name
	}
	users, err := s.Store.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	userName := make(map[string]string, len(users))
	for _, u := range users {
		userName[u.Subject] = u.Name
	}

	if err := s.boardTiles(ctx, b, now, loc, len(users)); err != nil {
		return nil, err
	}
	if err := s.boardOrders(ctx, b, now, standName); err != nil {
		return nil, err
	}
	standsState := s.boardStands(ctx, b)
	s.boardComponents(b, standsState)
	s.boardChecks(b)
	s.boardMaintenance(ctx, b)
	s.boardJobs(ctx, b, standName, userName)
	s.boardQueue(ctx, b)
	if ev, err := s.Store.ListActivity(ctx, store.ActivityFilter{Limit: boardEvents}); err == nil {
		// An empty feed comes back nil; the board sends an empty list.
		if ev != nil {
			b.Events = ev
		}
	} else {
		s.logger().Warn("board: activity feed failed", "err", err)
	}

	sortAttention(b.Attention)
	sort.SliceStable(b.InProgress, func(i, j int) bool { return b.InProgress[i].Since.After(b.InProgress[j].Since) })
	return b, nil
}

// boardTiles fills the four numbers and their trends.
func (s *Server) boardTiles(ctx context.Context, b *Board, now time.Time, loc *time.Location, totalUsers int) error {
	today := now.In(loc)
	first := time.Date(today.Year(), today.Month(), today.Day()-(boardDays-1), 0, 0, 0, 0, loc)
	counts, err := s.Store.DailyCounts(ctx, first, loc)
	if err != nil {
		return err
	}
	byDay := make(map[string]*models.DayCounts, len(counts))
	for _, c := range counts {
		byDay[c.Day] = c
	}
	var orders, actions, people []BoardPoint
	for i := 0; i < boardDays; i++ {
		d := first.AddDate(0, 0, i).Format("2006-01-02")
		c := byDay[d]
		if c == nil {
			c = &models.DayCounts{Day: d}
		}
		orders = append(orders, BoardPoint{At: d, Value: c.NewOrders})
		actions = append(actions, BoardPoint{At: d, Value: c.Actions})
		people = append(people, BoardPoint{At: d, Value: c.ActiveUsers})
	}
	last := func(p []BoardPoint) int { return p[len(p)-1].Value }

	totalOrders, err := s.Store.CountLiveOrders(ctx)
	if err != nil {
		return err
	}
	b.Tiles.Orders = BoardCount{Value: last(orders), Total: &totalOrders, Series: orders}
	b.Tiles.Actions = BoardCount{Value: last(actions), Series: actions}
	b.Tiles.Users = BoardCount{Value: last(people), Total: &totalUsers, Series: people}

	// Online: the live number from presence, the trend from the leader's
	// samples, the busiest reading of each hour. Hours with no sample (before
	// the history began, or while no leader ran) are left out rather than
	// drawn as nobody.
	online := 0
	if s.Activity != nil {
		if seen, err := s.Activity.Online(ctx); err == nil {
			online = len(seen)
		} else {
			s.logger().Warn("board: presence unavailable", "err", err)
		}
	}
	samples, err := s.Store.OnlineSamples(ctx, now.Add(-boardHours*time.Hour).Truncate(time.Hour))
	if err != nil {
		return err
	}
	peak := map[time.Time]int{}
	var hours []time.Time
	for _, sm := range samples {
		h := sm.At.UTC().Truncate(time.Hour)
		if _, ok := peak[h]; !ok {
			hours = append(hours, h)
		}
		if sm.Online > peak[h] {
			peak[h] = sm.Online
		}
	}
	series := make([]BoardPoint, 0, len(hours))
	for _, h := range hours {
		series = append(series, BoardPoint{At: h.Format(time.RFC3339), Value: peak[h]})
	}
	b.Tiles.Online = BoardCount{Value: online, Series: series}
	return nil
}

// boardOrders finds the orders in trouble and the ones under way.
func (s *Server) boardOrders(ctx context.Context, b *Board, now time.Time, standName map[string]string) error {
	orders, err := s.Store.ListActive(ctx)
	if err != nil {
		return err
	}
	for _, o := range orders {
		since := o.UpdatedAt
		item := func(severity, code string) BoardAttention {
			return BoardAttention{
				ID: code + ":" + o.ID, Severity: severity, Kind: "order", Code: code, Since: &since,
				OrderID: o.ID, Service: o.ServiceName, Team: o.Team, StandID: o.StandID, Stand: standName[o.StandID],
			}
		}
		switch o.Status {
		case models.StatusDegraded:
			b.Attention = append(b.Attention, item(SeverityCritical, "order_degraded"))
		case models.StatusArgoMissing:
			b.Attention = append(b.Attention, item(SeverityCritical, "order_argo_missing"))
		case models.StatusDeploying:
			if now.Sub(o.UpdatedAt) > deployingTooLong {
				b.Attention = append(b.Attention, item(SeverityWarning, "order_deploying_long"))
			}
		case models.StatusMRCreated:
			// The reconciler records why a merge does not go through; an open
			// MR without a reason is an ordinary wait for review.
			if mr, err := s.Store.GetOpenMR(ctx, o.ID); err == nil && mr.BlockedReason != "" {
				b.Attention = append(b.Attention, item(SeverityWarning, "order_merge_blocked"))
			} else if err != nil && !errors.Is(err, models.ErrNotFound) {
				s.logger().Warn("board: open MR lookup failed", "order", o.ID, "err", err)
			}
		}
		if o.Drifted {
			b.Attention = append(b.Attention, item(SeverityWarning, "order_drifted"))
		}
		if inProgress[o.Status] {
			b.InProgress = append(b.InProgress, BoardWork{
				Kind: "order", Since: o.UpdatedAt, OrderID: o.ID, Service: o.ServiceName, Team: o.Team,
				StandID: o.StandID, Stand: standName[o.StandID], Status: string(o.Status),
			})
		}
	}
	return nil
}

// boardStands turns failed stand checks into problems and returns the state
// of the stands line: down when any stand fails a check.
func (s *Server) boardStands(ctx context.Context, b *Board) string {
	if s.Prov == nil {
		return "ok"
	}
	sums, err := s.Prov.StandChecksSummary(ctx)
	if err != nil {
		s.logger().Warn("board: stand checks failed", "err", err)
		return "ok"
	}
	state := "ok"
	for _, sum := range sums {
		var code, severity string
		switch checks.Verdict(sum.Worst) {
		case checks.VerdictFail:
			code, severity, state = "stand_checks_failed", SeverityCritical, "down"
		case checks.VerdictWarn:
			code, severity = "stand_checks_warn", SeverityWarning
		default:
			continue
		}
		var failed string
		var since *time.Time
		for _, c := range sum.Results {
			if c.Verdict == sum.Worst {
				if failed == "" {
					failed = c.ID
				}
				at := c.CheckedAt
				if since == nil || at.Before(*since) {
					since = &at
				}
			}
		}
		b.Attention = append(b.Attention, BoardAttention{
			ID: code + ":" + sum.Stand.ID, Severity: severity, Kind: "stand", Code: code, Since: since,
			StandID: sum.Stand.ID, Stand: sum.Stand.Name, Check: failed,
		})
	}
	return state
}

// boardComponents lists the integrations, the storage, the stands and the
// background loops, each as one line, and the ones down as problems too.
func (s *Server) boardComponents(b *Board, standsState string) {
	storage := BoardComponent{ID: "storage", State: "ok"}
	for _, c := range s.componentStates() {
		var since *time.Time
		if !c.Since.IsZero() {
			at := c.Since
			since = &at
		}
		state := "ok"
		if !c.OK {
			state = "down"
		}
		if c.Kind == "storage" {
			if state == "down" {
				storage.State, storage.Since = "down", since
				b.Attention = append(b.Attention, BoardAttention{
					ID: "storage_down:" + c.Name, Severity: SeverityCritical, Kind: "integration",
					Code: "storage_down", Since: since, Component: c.Name,
				})
			}
			continue
		}
		b.Components = append(b.Components, BoardComponent{ID: c.Name, State: state, Since: since})
		if state == "down" {
			b.Attention = append(b.Attention, BoardAttention{
				ID: "integration_down:" + c.Name, Severity: SeverityCritical, Kind: "integration",
				Code: "integration_down", Since: since, Component: c.Name,
			})
		}
	}
	b.Components = append(b.Components, storage, BoardComponent{ID: "stands", State: standsState})

	// The loops report only on the replica that runs them; elsewhere the line
	// is left out rather than claiming they are fine.
	recs := s.reconcilerStatuses()
	if recs == nil {
		return
	}
	jobs := BoardComponent{ID: "jobs", State: "ok"}
	for _, rc := range recs {
		if rc.Status != "failing" {
			continue
		}
		jobs.State = "down"
		b.Attention = append(b.Attention, BoardAttention{
			ID: "job_failing:" + rc.Name, Severity: SeverityWarning, Kind: "job", Code: "job_failing", Job: rc.Name,
		})
	}
	b.Components = append(b.Components, jobs)
}

// boardChecks adds the configuration checks that found a problem.
func (s *Server) boardChecks(b *Board) {
	if s.Checks == nil {
		return
	}
	snap := s.Checks.Snapshot()
	var since *time.Time
	if !snap.CheckedAt.IsZero() {
		at := snap.CheckedAt
		since = &at
	}
	for _, c := range snap.Results {
		var code, severity string
		switch c.Verdict {
		case checks.VerdictFail:
			code, severity = "config_fail", SeverityCritical
		case checks.VerdictWarn:
			code, severity = "config_warn", SeverityWarning
		default:
			continue
		}
		b.Attention = append(b.Attention, BoardAttention{
			ID: code + ":" + c.ID, Severity: severity, Kind: "config", Code: code, Since: since,
			Component: c.Component, Check: c.ID, Variables: c.Vars,
		})
	}
}

// boardMaintenance reports a window that is announced, under way or late.
func (s *Server) boardMaintenance(ctx context.Context, b *Board) {
	if s.Maintenance == nil {
		return
	}
	st := s.Maintenance.Status(ctx)
	if st.Window == nil {
		return
	}
	w := st.Window
	at := w.UpdatedAt
	item := BoardAttention{Kind: "maintenance", Since: &at}
	switch {
	case st.State == models.MaintenanceActive && st.Overdue:
		item.Code, item.Severity, item.Until = "maintenance_overdue", SeverityCritical, w.EndsAt
	case st.State == models.MaintenanceActive:
		item.Code, item.Severity, item.Until = "maintenance_active", SeverityWarning, w.EndsAt
	case st.State == models.MaintenanceScheduled:
		starts := w.StartsAt
		item.Code, item.Severity, item.Until = "maintenance_scheduled", SeverityWarning, &starts
	default:
		return
	}
	item.ID = item.Code + ":" + w.ID
	b.Attention = append(b.Attention, item)
}

// boardJobs adds the jobs running over stands' orders to the work under way.
func (s *Server) boardJobs(ctx context.Context, b *Board, standName, userName map[string]string) {
	jobs, err := s.Store.ListRunningStandJobs(ctx)
	if err != nil {
		s.logger().Warn("board: stand jobs failed", "err", err)
		return
	}
	for _, j := range jobs {
		b.InProgress = append(b.InProgress, BoardWork{
			Kind: "stand_job", Since: j.CreatedAt, StandID: j.StandID, Stand: standName[j.StandID],
			JobKind: j.Kind, ToMode: j.ToMode, Done: j.Done, Total: j.Total, By: userName[j.CreatedBy],
		})
	}
}

// boardQueue lists what waits for an approval decision: versions under
// review and publications whose category or owner is.
func (s *Server) boardQueue(ctx context.Context, b *Board) {
	if s.Pubs == nil {
		return
	}
	if pending, err := s.Pubs.PendingVersions(ctx); err == nil {
		for _, p := range pending {
			b.Queue = append(b.Queue, BoardQueueItem{
				Kind: "version", PublicationID: p.Publication.ID, ChartProject: p.Publication.ChartProject,
				ChartName: p.Publication.ChartName, Version: p.Version.ChartVersion, Team: p.Publication.OwnerTeam,
				Since: p.Version.UpdatedAt,
			})
		}
	} else {
		s.logger().Warn("board: pending versions failed", "err", err)
	}
	if pubs, err := s.Pubs.List(ctx, store.PublicationFilter{Status: models.PubPending}); err == nil {
		for _, p := range pubs {
			b.Queue = append(b.Queue, BoardQueueItem{
				Kind: "publication", PublicationID: p.ID, ChartProject: p.ChartProject,
				ChartName: p.ChartName, Team: p.OwnerTeam, Since: p.UpdatedAt,
			})
		}
	} else {
		s.logger().Warn("board: pending publications failed", "err", err)
	}
	sort.SliceStable(b.Queue, func(i, j int) bool { return b.Queue[i].Since.Before(b.Queue[j].Since) })
}

// sortAttention puts failures first, and within a severity the newest first:
// what just broke is what somebody opening the board wants to see.
func sortAttention(items []BoardAttention) {
	sort.SliceStable(items, func(i, j int) bool {
		a, c := items[i], items[j]
		if a.Severity != c.Severity {
			return a.Severity == SeverityCritical
		}
		switch {
		case a.Since == nil:
			return false
		case c.Since == nil:
			return true
		}
		return a.Since.After(*c.Since)
	})
}
