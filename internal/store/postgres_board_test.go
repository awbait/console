package store

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"console/pkg/models"
	"github.com/google/uuid"
)

// TestPostgresBoardHistory covers what the in-memory store cannot: the day of
// an event and of an hour of presence is cut in the reader's zone by SQL, the
// system actors are left out by SQL, and people are counted once per day.
// Everything happens in March 2001, far from anybody else's rows in a shared
// database. Requires a scratch Postgres: set STORE_TEST_URL.
func TestPostgresBoardHistory(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres board history test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	st := &models.Stand{ID: uuid.NewString(), Name: "board-" + uuid.NewString()[:8], DefaultCluster: "in-cluster"}
	if err := pg.CreateStand(ctx, st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r := &models.Request{
		ID: uuid.NewString(), CreatedBy: "u", CreatedByName: "U", Team: "core",
		ChartProject: "platform", ChartName: "postgres", ChartVersion: "1",
		ServiceName: "svc-" + uuid.NewString()[:8], StandID: st.ID, Cluster: "in-cluster",
		Namespace: "db", ValuesYAML: "{}", Status: models.StatusHealthy,
	}
	subjects := []string{"board-a-" + uuid.NewString()[:8], "board-b-" + uuid.NewString()[:8]}
	defer func() {
		_, _ = pg.pool.Exec(ctx, `DELETE FROM request_events WHERE request_id=$1`, r.ID)
		_, _ = pg.pool.Exec(ctx, `DELETE FROM requests WHERE id=$1`, r.ID)
		_, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE id=$1`, st.ID)
		_, _ = pg.pool.Exec(ctx, `DELETE FROM user_hours WHERE subject = ANY($1)`, subjects)
		_, _ = pg.pool.Exec(ctx, `DELETE FROM online_samples WHERE at < '2002-01-01'`)
	}()
	if err := pg.CreateRequest(ctx, r); err != nil {
		t.Fatalf("create: %v", err)
	}

	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// 22:30 UTC on the 10th is 01:30 in Moscow on the 11th.
	late := at("2001-03-10T22:30:00Z")
	for _, e := range []struct{ actor, typ string }{
		{"u", "created"}, {"u", "updated"}, {models.ActorSystem, "status_changed"}, {"", "drift_detected"},
	} {
		ev := &models.RequestEvent{RequestID: r.ID, Actor: e.actor, EventType: e.typ}
		if err := pg.AddEvent(ctx, ev); err != nil {
			t.Fatalf("event: %v", err)
		}
		if _, err := pg.pool.Exec(ctx, `UPDATE request_events SET created_at=$2 WHERE id=$1`, ev.ID, late); err != nil {
			t.Fatal(err)
		}
	}
	a, b := subjects[0], subjects[1]
	for _, h := range []struct {
		who  string
		hour string
	}{
		{a, "2001-03-10T20:00:00Z"}, // 23:00 in Moscow, still the 10th
		{a, "2001-03-10T21:00:00Z"}, // midnight in Moscow
		{a, "2001-03-11T10:00:00Z"},
		{b, "2001-03-11T10:00:00Z"},
	} {
		if err := pg.recordUserHour(ctx, h.who, at(h.hour).Add(17*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}

	byDay := func(loc *time.Location) map[string]models.DayCounts {
		got, err := pg.DailyCounts(ctx, at("2001-03-01T00:00:00Z"), loc)
		if err != nil {
			t.Fatalf("daily: %v", err)
		}
		out := map[string]models.DayCounts{}
		for _, c := range got {
			if strings.HasPrefix(c.Day, "2001-03") {
				out[c.Day] = *c
			}
		}
		return out
	}

	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	m := byDay(msk)
	if m["2001-03-10"] != (models.DayCounts{Day: "2001-03-10", ActiveUsers: 1}) {
		t.Fatalf("moscow 10th: %+v", m["2001-03-10"])
	}
	if m["2001-03-11"] != (models.DayCounts{Day: "2001-03-11", NewOrders: 1, Actions: 2, ActiveUsers: 2}) {
		t.Fatalf("moscow 11th: %+v", m["2001-03-11"])
	}
	u := byDay(time.UTC)
	if u["2001-03-10"] != (models.DayCounts{Day: "2001-03-10", NewOrders: 1, Actions: 2, ActiveUsers: 1}) {
		t.Fatalf("utc 10th: %+v", u["2001-03-10"])
	}
	if u["2001-03-11"] != (models.DayCounts{Day: "2001-03-11", ActiveUsers: 2}) {
		t.Fatalf("utc 11th: %+v", u["2001-03-11"])
	}

	// Online samples: a repeat of a moment replaces it, prune cuts by time.
	for _, s := range []struct {
		at string
		n  int
	}{{"2001-03-10T10:00:00Z", 3}, {"2001-03-10T10:05:00Z", 4}, {"2001-03-10T10:05:00Z", 5}} {
		if err := pg.RecordOnline(ctx, at(s.at), s.n); err != nil {
			t.Fatalf("online: %v", err)
		}
	}
	samples, err := pg.OnlineSamples(ctx, at("2001-03-10T00:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	var mine []*models.OnlineSample
	for _, s := range samples {
		if s.At.Year() == 2001 {
			mine = append(mine, s)
		}
	}
	if len(mine) != 2 || mine[0].Online != 3 || mine[1].Online != 5 {
		t.Fatalf("samples: %+v", mine)
	}
	if err := pg.PruneBoardHistory(ctx, at("2001-03-11T00:00:00Z"), at("2001-03-10T10:01:00Z")); err != nil {
		t.Fatalf("prune: %v", err)
	}
	var hours, left int
	if err := pg.pool.QueryRow(ctx, `SELECT count(*) FROM user_hours WHERE subject = ANY($1)`, subjects).Scan(&hours); err != nil {
		t.Fatal(err)
	}
	if err := pg.pool.QueryRow(ctx, `SELECT count(*) FROM online_samples WHERE at < '2002-01-01'`).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if hours != 2 || left != 1 {
		t.Fatalf("after prune: %d hours, %d samples", hours, left)
	}
}
