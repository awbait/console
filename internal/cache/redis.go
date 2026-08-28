package cache

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is a Cache backed by Redis. Also used as the session backend.
type Redis struct {
	cli *redis.Client
}

var _ Cache = (*Redis)(nil)

// NewClient opens the Redis connection from a redis:// URL. It is one client
// for the whole portal: the cache, the sessions, the events bus between
// replicas and the leader lease all go through it, so they share one connection
// pool and one address to be wrong about.
func NewClient(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opt), nil
}

// NewRedis wraps an open client as the cache. Closing it closes the client, so
// whoever else was handed it (see NewClient) is done with it too.
func NewRedis(cli *redis.Client) *Redis {
	return &Redis{cli: cli}
}

func (r *Redis) Get(ctx context.Context, key string) ([]byte, bool, error) {
	b, err := r.cli.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return b, true, nil
}

func (r *Redis) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	return r.cli.Set(ctx, key, val, ttl).Err()
}

func (r *Redis) Delete(ctx context.Context, key string) error {
	return r.cli.Del(ctx, key).Err()
}

func (r *Redis) Ping(ctx context.Context) error { return r.cli.Ping(ctx).Err() }
func (r *Redis) Close()                          { _ = r.cli.Close() }
