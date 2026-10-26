package cache

import (
	"bytes"
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Leases is the "one at a time" capability of a cache backend: a key held by
// one owner until the owner lets go or stops renewing it. The portal uses it
// where two people must not work on the same thing at once (a version document
// in the constructor, see internal/publications), and where the thing being
// protected is a few minutes of somebody's attention, not a row that has to
// survive a restart.
//
// Like Presence it is deliberately not part of Cache: a lease is a decision
// between owners, and every method takes the owner's name so the backend can
// make that decision in one step. Both backends implement it, so the assertion
// at wiring time never fails in practice.
//
// Nothing here is durable. A lease lost with the cache is a lease somebody
// renews on their next heartbeat, and the worst case is one more person
// editing for the few seconds until then.
type Leases interface {
	// Acquire takes key for owner for ttl when nobody holds it, and renews it
	// (replacing the payload and the expiry) when owner already does. It
	// reports whether owner holds the key on return; when somebody else does,
	// current says who, and the key is left as it was.
	Acquire(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) (held bool, current *Lease, err error)
	// Seize takes key for owner for ttl whoever holds it. It is the forced
	// hand-over, and the caller decides who may force it.
	Seize(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) error
	// Release drops key if owner holds it. False means it was not owner's to
	// drop: either nobody holds it or somebody else does.
	Release(ctx context.Context, key, owner string) (bool, error)
	// Holder returns who holds key and what they put there, nil when nobody.
	Holder(ctx context.Context, key string) (*Lease, error)
}

// Lease is the holder of a key and the payload they attached when taking it.
// The payload is the backend's to carry and the caller's to interpret: who the
// owner is for display, since when, until when.
type Lease struct {
	Owner   string
	Payload []byte
}

var (
	_ Leases = (*Redis)(nil)
	_ Leases = (*Memory)(nil)
)

// leaseSep separates the owner from the payload in the value Redis stores. A
// NUL cannot appear in an owner (subjects are printable identifiers), so the
// first one is always the boundary.
const leaseSep = "\x00"

// acquireScript takes or renews in one step: between a GET and a SET the key
// can expire and be taken by somebody else, and we would then be renewing
// their lease under our name. It returns an empty string when owner holds the
// key on return, and the current value when somebody else does.
var acquireScript = redis.NewScript(`
local v = redis.call("get", KEYS[1])
if v then
  local sep = string.find(v, "\0", 1, true)
  local owner = v
  if sep then owner = string.sub(v, 1, sep - 1) end
  if owner ~= ARGV[1] then
    return v
  end
end
redis.call("set", KEYS[1], ARGV[2], "px", ARGV[3])
return ""
`)

// releaseLeaseScript drops the key only while it is still owner's.
var releaseLeaseScript = redis.NewScript(`
local v = redis.call("get", KEYS[1])
if not v then
  return 0
end
local sep = string.find(v, "\0", 1, true)
local owner = v
if sep then owner = string.sub(v, 1, sep - 1) end
if owner == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`)

func encodeLease(owner string, payload []byte) []byte {
	b := make([]byte, 0, len(owner)+1+len(payload))
	b = append(b, owner...)
	b = append(b, leaseSep...)
	return append(b, payload...)
}

func decodeLease(raw []byte) *Lease {
	owner, payload, found := bytes.Cut(raw, []byte(leaseSep))
	if !found {
		return &Lease{Owner: string(raw)}
	}
	return &Lease{Owner: string(owner), Payload: append([]byte(nil), payload...)}
}

func (r *Redis) Acquire(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) (bool, *Lease, error) {
	cur, err := acquireScript.Run(ctx, r.cli, []string{key}, owner, encodeLease(owner, payload), ttl.Milliseconds()).Text()
	if err != nil {
		return false, nil, err
	}
	if cur == "" {
		return true, nil, nil
	}
	return false, decodeLease([]byte(cur)), nil
}

func (r *Redis) Seize(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) error {
	return r.cli.Set(ctx, key, encodeLease(owner, payload), ttl).Err()
}

func (r *Redis) Release(ctx context.Context, key, owner string) (bool, error) {
	n, err := releaseLeaseScript.Run(ctx, r.cli, []string{key}, owner).Int64()
	if err != nil {
		return false, err
	}
	return n != 0, nil
}

func (r *Redis) Holder(ctx context.Context, key string) (*Lease, error) {
	raw, err := r.cli.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return decodeLease(raw), nil
}

// memLease is one held key in the in-memory backend.
type memLease struct {
	owner   string
	payload []byte
	expire  time.Time
}

// lease returns the live lease under key, dropping an expired one on the way.
// The caller holds m.mu.
func (m *Memory) lease(key string) (memLease, bool) {
	l, ok := m.leases[key]
	if !ok {
		return memLease{}, false
	}
	if !l.expire.IsZero() && m.now().After(l.expire) {
		delete(m.leases, key)
		return memLease{}, false
	}
	return l, true
}

func (m *Memory) put(key, owner string, payload []byte, ttl time.Duration) {
	l := memLease{owner: owner, payload: append([]byte(nil), payload...)}
	if ttl > 0 {
		l.expire = m.now().Add(ttl)
	}
	if m.leases == nil {
		m.leases = map[string]memLease{}
	}
	m.leases[key] = l
}

func (m *Memory) Acquire(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) (bool, *Lease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if l, ok := m.lease(key); ok && l.owner != owner {
		return false, &Lease{Owner: l.owner, Payload: append([]byte(nil), l.payload...)}, nil
	}
	m.put(key, owner, payload, ttl)
	return true, nil, nil
}

func (m *Memory) Seize(ctx context.Context, key, owner string, payload []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.put(key, owner, payload, ttl)
	return nil
}

func (m *Memory) Release(ctx context.Context, key, owner string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.lease(key)
	if !ok || l.owner != owner {
		return false, nil
	}
	delete(m.leases, key)
	return true, nil
}

func (m *Memory) Holder(ctx context.Context, key string) (*Lease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.lease(key)
	if !ok {
		return nil, nil
	}
	return &Lease{Owner: l.owner, Payload: append([]byte(nil), l.payload...)}, nil
}
