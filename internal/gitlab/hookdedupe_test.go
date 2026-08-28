package gitlab_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// hookStore is a stub GitLab group-hooks collection: what the API would hold,
// with the create/update/delete the client uses against it.
type hookStore struct {
	mu     sync.Mutex
	hooks  []map[string]any
	nextID int
	// blindGets is how many of the first GETs answer with an empty collection
	// whatever is really in it. That is what one replica sees while another is
	// creating: both list nothing, and both go on to create.
	blindGets int
	// puts and deletes record what the client did, by hook id.
	puts, deletes []int
}

func (s *hookStore) handler(t *testing.T) http.HandlerFunc {
	t.Helper()
	return func(w http.ResponseWriter, r *http.Request) {
		const hooks = "/api/v4/groups/7/hooks"
		switch {
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.EscapedPath(), "/api/v4/groups/managed-services"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 7, "full_path": "managed-services"})
		case r.Method == http.MethodGet && r.URL.Path == hooks:
			_ = json.NewEncoder(w).Encode(s.list())
		case r.Method == http.MethodPost && r.URL.Path == hooks:
			s.create(body(t, r)["url"].(string))
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, hooks+"/"):
			s.put(id(t, r.URL.Path))
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, hooks+"/"):
			s.remove(id(t, r.URL.Path))
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}
}

func (s *hookStore) list() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.blindGets > 0 {
		s.blindGets--
		return []map[string]any{}
	}
	out := make([]map[string]any, len(s.hooks))
	copy(out, s.hooks)
	return out
}

func (s *hookStore) create(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	s.hooks = append(s.hooks, map[string]any{"id": s.nextID, "url": url})
}

func (s *hookStore) put(hookID int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.puts = append(s.puts, hookID)
}

func (s *hookStore) remove(hookID int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deletes = append(s.deletes, hookID)
	kept := s.hooks[:0]
	for _, h := range s.hooks {
		if h["id"] != hookID {
			kept = append(kept, h)
		}
	}
	s.hooks = kept
}

// urls is what the collection holds now, for the assertions.
func (s *hookStore) urls() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.hooks))
	for _, h := range s.hooks {
		out = append(out, h["url"].(string))
	}
	return out
}

func (s *hookStore) ids() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]int, 0, len(s.hooks))
	for _, h := range s.hooks {
		out = append(out, h["id"].(int))
	}
	return out
}

func body(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	return m
}

func id(t *testing.T, path string) int {
	t.Helper()
	n, err := strconv.Atoi(path[strings.LastIndex(path, "/")+1:])
	if err != nil {
		t.Fatalf("hook id in %q: %v", path, err)
	}
	return n
}

// TestHookRegisteredOnceWhenReplicasRace is the reason the second pass exists.
// GitLab has no "create if absent", so replicas starting together all list an
// empty collection and all create. Whoever creates last lists again and leaves
// one hook standing.
func TestHookRegisteredOnceWhenReplicasRace(t *testing.T) {
	h := testHook()
	// Another replica has already created its hook; this one's first GET still
	// answers empty, exactly as it did a moment before that create landed.
	store := &hookStore{nextID: 4, blindGets: 1}
	store.create(h.URL)

	c, _ := newServer(t, store.handler(t))
	if err := c.EnsureGroupHook(context.Background(), gitopsGroup, h); err != nil {
		t.Fatalf("ensure group hook: %v", err)
	}

	if got := store.urls(); len(got) != 1 || got[0] != h.URL {
		t.Fatalf("collection holds %v, want exactly one hook on the portal's URL", got)
	}
	if got := store.ids(); got[0] != 5 {
		t.Fatalf("kept hook %d, want the oldest (5) so every replica keeps the same one", got[0])
	}
}

// TestExistingHookIsRewrittenNotDuplicated: the ordinary rerun. The token is
// never returned by GitLab, so the hook that is there is rewritten in place.
func TestExistingHookIsRewrittenNotDuplicated(t *testing.T) {
	h := testHook()
	store := &hookStore{}
	store.create(h.URL)

	c, _ := newServer(t, store.handler(t))
	if err := c.EnsureGroupHook(context.Background(), gitopsGroup, h); err != nil {
		t.Fatalf("ensure group hook: %v", err)
	}

	if got := store.urls(); len(got) != 1 {
		t.Fatalf("collection holds %v, want the one hook it started with", got)
	}
	if len(store.puts) != 1 || store.puts[0] != 1 {
		t.Fatalf("rewrote hooks %v, want the existing one (1)", store.puts)
	}
	if len(store.deletes) != 0 {
		t.Fatalf("deleted %v with nothing to tidy up", store.deletes)
	}
}

// TestDuplicatesFromAnEarlierRaceAreClearedUp: a collection that raced before
// this code existed is left with one hook on the next start.
func TestDuplicatesFromAnEarlierRaceAreClearedUp(t *testing.T) {
	h := testHook()
	store := &hookStore{}
	store.create(h.URL)                          // 1
	store.create(h.URL)                          // 2
	store.create("https://someone-else/webhook") // 3, not ours
	store.create(h.URL)                          // 4

	c, _ := newServer(t, store.handler(t))
	if err := c.EnsureGroupHook(context.Background(), gitopsGroup, h); err != nil {
		t.Fatalf("ensure group hook: %v", err)
	}

	if got := store.ids(); len(got) != 2 || got[0] != 1 || got[1] != 3 {
		t.Fatalf("collection holds %v, want the oldest of ours (1) and the hook that is not ours (3)", got)
	}
	if len(store.puts) != 1 || store.puts[0] != 1 {
		t.Fatalf("rewrote hooks %v, want the one being kept (1)", store.puts)
	}
}
