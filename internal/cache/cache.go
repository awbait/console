// Package cache defines the cache port (Redis in production, in-memory for
// tests/local). Sessions reuse the same backend with their own key prefix.
package cache

import (
	"context"
	"time"
)

// Cache is a simple TTL byte-blob cache.
type Cache interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration) error
	Delete(ctx context.Context, key string) error
	Ping(ctx context.Context) error
	Close()
}
