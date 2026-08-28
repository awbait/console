package leader

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// DefaultKey is the Redis key the lease lives under.
const DefaultKey = "console:leader"

// keepScript extends the lease only while it is still ours. Read and write in
// one step, because between a GET and a PEXPIRE the key can expire and be taken
// by another replica, and we would then be extending its lease instead.
var keepScript = redis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`)

// releaseScript hands the lease back, again only if it is still ours.
var releaseScript = redis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`)

// redisLease is a Lease in Redis: one key holding the identity of the replica
// that leads, with an expiry it has to outrun.
type redisLease struct {
	cli    *redis.Client
	key    string
	holder string
}

var _ Lease = redisLease{}

// NewRedis builds an election over a lease in Redis. holder identifies this
// replica and must differ between them; key may be empty for the default.
func NewRedis(cli *redis.Client, key, holder string, log *slog.Logger) *Election {
	if key == "" {
		key = DefaultKey
	}
	return New(redisLease{cli: cli, key: key, holder: holder}, log)
}

func (l redisLease) Take(ctx context.Context, ttl time.Duration) (bool, error) {
	ok, err := l.cli.SetNX(ctx, l.key, l.holder, ttl).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (l redisLease) Keep(ctx context.Context, ttl time.Duration) (bool, error) {
	n, err := keepScript.Run(ctx, l.cli, []string{l.key}, l.holder, ttl.Milliseconds()).Int64()
	if err != nil {
		return false, err
	}
	return n != 0, nil
}

func (l redisLease) Release(ctx context.Context) error {
	return releaseScript.Run(ctx, l.cli, []string{l.key}, l.holder).Err()
}
