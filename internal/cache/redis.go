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

// NewRedis connects to Redis using a redis:// URL.
func NewRedis(url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &Redis{cli: redis.NewClient(opt)}, nil
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
