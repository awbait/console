package cache

import (
	"context"
	"sort"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Presence is the "who was here, and when" capability of a cache backend: a set
// of members ordered by the time each was last seen. Redis has it natively as a
// sorted set; the in-memory backend keeps a map.
//
// It is deliberately not part of Cache. Cache is a TTL blob store and every
// value in it stands alone; presence is one key holding a whole population, and
// a caller that wants it asks for it (see internal/activity). Both backends
// implement it, so the assertion at wiring time never fails in practice.
//
// Nothing here is durable: presence is "who is around right now", and losing it
// with the cache is losing a fact that is minutes old by construction. The
// directory in Postgres is what survives a restart.
type Presence interface {
	// Touch records that member was seen at t, replacing any earlier time.
	Touch(ctx context.Context, key, member string, t time.Time) error
	// Since returns the members seen at or after cutoff, most recent first.
	Since(ctx context.Context, key string, cutoff time.Time) ([]Seen, error)
	// PruneBefore drops members last seen before cutoff. Without it the set
	// grows to every person who has ever signed in and never shrinks.
	PruneBefore(ctx context.Context, key string, cutoff time.Time) error
}

// Seen is one member of a presence set and when it was last there.
type Seen struct {
	Member string
	At     time.Time
}

var (
	_ Presence = (*Redis)(nil)
	_ Presence = (*Memory)(nil)
)

// A moment is scored as unix milliseconds. Seconds would round several
// requests of one person onto the same score (harmless but lossy), and
// nanoseconds do not survive a float64 score exactly.
func score(t time.Time) float64     { return float64(t.UnixMilli()) }
func scoreArg(t time.Time) string   { return strconv.FormatInt(t.UnixMilli(), 10) }
func fromScore(f float64) time.Time { return time.UnixMilli(int64(f)) }

func (r *Redis) Touch(ctx context.Context, key, member string, t time.Time) error {
	return r.cli.ZAdd(ctx, key, redis.Z{Score: score(t), Member: member}).Err()
}

func (r *Redis) Since(ctx context.Context, key string, cutoff time.Time) ([]Seen, error) {
	zs, err := r.cli.ZRangeByScoreWithScores(ctx, key, &redis.ZRangeBy{
		Min: scoreArg(cutoff), Max: "+inf",
	}).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Seen, 0, len(zs))
	// Redis returns the range ascending by score; the caller wants the most
	// recent first.
	for i := len(zs) - 1; i >= 0; i-- {
		member, _ := zs[i].Member.(string)
		out = append(out, Seen{Member: member, At: fromScore(zs[i].Score)})
	}
	return out, nil
}

func (r *Redis) PruneBefore(ctx context.Context, key string, cutoff time.Time) error {
	// "(" is Redis for an exclusive bound: a member seen exactly at the cutoff
	// is still inside the window.
	return r.cli.ZRemRangeByScore(ctx, key, "-inf", "("+scoreArg(cutoff)).Err()
}

func (m *Memory) Touch(ctx context.Context, key, member string, t time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.presence == nil {
		m.presence = map[string]map[string]time.Time{}
	}
	set, ok := m.presence[key]
	if !ok {
		set = map[string]time.Time{}
		m.presence[key] = set
	}
	set[member] = t
	return nil
}

func (m *Memory) Since(ctx context.Context, key string, cutoff time.Time) ([]Seen, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Seen
	for member, at := range m.presence[key] {
		if at.Before(cutoff) {
			continue
		}
		out = append(out, Seen{Member: member, At: at})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out, nil
}

func (m *Memory) PruneBefore(ctx context.Context, key string, cutoff time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for member, at := range m.presence[key] {
		if at.Before(cutoff) {
			delete(m.presence[key], member)
		}
	}
	return nil
}
