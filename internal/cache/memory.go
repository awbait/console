package cache

import (
	"context"
	"sync"
	"time"
)

type entry struct {
	val    []byte
	expire time.Time // zero = no expiry
}

// Memory is an in-memory Cache for tests and local fakes-only runs.
type Memory struct {
	mu    sync.Mutex
	items map[string]entry
	now   func() time.Time
}

var _ Cache = (*Memory)(nil)

// NewMemory returns an empty in-memory cache.
func NewMemory() *Memory {
	return &Memory{items: map[string]entry{}, now: time.Now}
}

func (m *Memory) Get(ctx context.Context, key string) ([]byte, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.items[key]
	if !ok {
		return nil, false, nil
	}
	if !e.expire.IsZero() && m.now().After(e.expire) {
		delete(m.items, key)
		return nil, false, nil
	}
	cp := make([]byte, len(e.val))
	copy(cp, e.val)
	return cp, true, nil
}

func (m *Memory) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := entry{val: append([]byte(nil), val...)}
	if ttl > 0 {
		e.expire = m.now().Add(ttl)
	}
	m.items[key] = e
	return nil
}

func (m *Memory) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.items, key)
	return nil
}

func (m *Memory) Ping(ctx context.Context) error { return nil }
func (m *Memory) Close()                          {}
