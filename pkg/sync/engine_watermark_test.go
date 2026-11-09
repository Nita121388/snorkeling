// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// memStore keeps its pre-watermark behaviour (everything is always pending, marking is a no-op)
// so the older engine tests keep testing the merge rules rather than the prefix of the pipeline.
func (s *memStore) PendingItems(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	return s.Items(ctx)
}

func (s *memStore) MarkSynced(ctx context.Context, results []syncproto.PushItemResult) error {
	return nil
}

// watermarkStore adds the item-level watermark the production store keeps in
// db_common_text_sync: a pending set plus the "highest rev the remote ever confirmed".
type watermarkStore struct {
	*memStore
	mu           sync.Mutex
	pending      map[string]bool
	maxSyncedRev float64
	marked       []syncproto.PushItemResult
	resetCount   int
}

func newWatermarkStore(t *testing.T, items ...syncproto.SnapshotItem) *watermarkStore {
	t.Helper()
	s := &watermarkStore{memStore: newMemStore(items...), pending: map[string]bool{}}
	for _, it := range items {
		s.pending[it.Id] = true
	}
	return s
}

func (s *watermarkStore) PendingItems(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	all, err := s.Items(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]syncproto.SnapshotItem, 0, len(all))
	for _, it := range all {
		if s.pending[it.Id] {
			out = append(out, it)
		}
	}
	return out, nil
}

func (s *watermarkStore) MarkSynced(ctx context.Context, results []syncproto.PushItemResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range results {
		if r.Status == syncproto.PushStatusConflict {
			continue
		}
		delete(s.pending, r.Id)
		if r.Rev > s.maxSyncedRev {
			s.maxSyncedRev = r.Rev
		}
	}
	s.marked = append(s.marked, results...)
	return nil
}

func (s *watermarkStore) MaxSyncedRev(ctx context.Context) (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.maxSyncedRev, nil
}

func (s *watermarkStore) ResetSyncWatermarks(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resetCount++
	s.maxSyncedRev = 0
	for id := range s.memStore.items {
		s.pending[id] = true
	}
	return nil
}

func (s *watermarkStore) isPending(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pending[id]
}

// recordingTransport records what the engine actually sent, so "only pending items were pushed"
// is an assertion about the wire payload rather than about internal state.
type recordingTransport struct {
	mu       sync.Mutex
	remote   []syncproto.SnapshotItem
	remoteRv float64
	pushed   []syncproto.SnapshotItem
	results  []syncproto.PushItemResult
	pullErr  error
}

func (r *recordingTransport) Id() TransportId { return TransportFolder }
func (r *recordingTransport) Caps() Caps      { return Caps{} }

func (r *recordingTransport) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pullErr != nil {
		return nil, r.pullErr
	}
	return &syncproto.Snapshot{Rev: r.remoteRv, Items: r.remote}, nil
}

func (r *recordingTransport) Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pushed = append(r.pushed, req.Items...)
	out := &PushOutcome{Rev: r.remoteRv + float64(len(req.Items))}
	for _, it := range req.Items {
		res := syncproto.PushItemResult{Id: it.Id, Rev: out.Rev, Status: syncproto.PushStatusApplied}
		for _, forced := range r.results {
			if forced.Id == it.Id {
				res = forced
			}
		}
		out.Items = append(out.Items, res)
		switch res.Status {
		case syncproto.PushStatusApplied:
			out.Applied++
		case syncproto.PushStatusUnchanged:
			out.Unchanged++
		case syncproto.PushStatusConflict:
			out.Conflicts = append(out.Conflicts, syncproto.Conflict{Id: it.Id, Fields: []string{"text"}})
		}
	}
	return out, nil
}

func (r *recordingTransport) pushedIds() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.pushed))
	for _, it := range r.pushed {
		out = append(out, it.Id)
	}
	return out
}

// The whole point of the watermark: a steady-state run uploads only what changed.
func TestEnginePushesOnlyPending(t *testing.T) {
	store := newWatermarkStore(t,
		syncproto.SnapshotItem{Id: "ct-dirty", Text: "new", UpdatedAt: 2000, Rev: 1},
		syncproto.SnapshotItem{Id: "ct-clean", Text: "old", UpdatedAt: 1000, Rev: 2},
	)
	store.mu.Lock()
	store.pending["ct-dirty"] = true
	store.pending["ct-clean"] = false
	store.maxSyncedRev = 2
	store.mu.Unlock()

	tr := &recordingTransport{remoteRv: 2}
	eng := NewEngine(store, tr, PolicyRowMerge, "dev-a", "A", nil)
	if _, err := eng.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("run: %v", err)
	}

	ids := tr.pushedIds()
	if len(ids) != 1 || ids[0] != "ct-dirty" {
		t.Fatalf("expected only the dirty item to be pushed, got %v", ids)
	}
	if store.isPending("ct-dirty") {
		t.Fatal("a pushed item must be marked synced")
	}
}

// Switching transports seeds the new remote, so it must push everything — the watermark must not
// hide already-synced items from a remote that has never seen them.
func TestEngineBaselineStillPushesAll(t *testing.T) {
	store := newWatermarkStore(t,
		syncproto.SnapshotItem{Id: "ct-a", Text: "a", UpdatedAt: 1000, Rev: 1},
		syncproto.SnapshotItem{Id: "ct-b", Text: "b", UpdatedAt: 1000, Rev: 2},
	)
	store.mu.Lock()
	store.pending["ct-a"] = false
	store.pending["ct-b"] = false
	store.mu.Unlock()

	tr := &recordingTransport{}
	eng := NewEngine(store, tr, PolicyRowMerge, "dev-a", "A", nil)
	if _, err := eng.RunWithBaseline(context.Background(), BaselineLocal, "transport-switch"); err != nil {
		t.Fatalf("baseline run: %v", err)
	}
	if ids := tr.pushedIds(); len(ids) != 2 {
		t.Fatalf("a baseline run must push every item, got %v", ids)
	}
}

// If the remote was reset (payload file deleted, moved folder, reinstalled peer) its rev drops to
// zero. Without this self-heal the pending filter would keep every local item local forever, with
// no error anywhere.
func TestEngineRemoteResetRepushesAll(t *testing.T) {
	store := newWatermarkStore(t,
		syncproto.SnapshotItem{Id: "ct-a", Text: "a", UpdatedAt: 1000, Rev: 9},
	)
	store.mu.Lock()
	store.pending["ct-a"] = false
	store.maxSyncedRev = 9
	store.mu.Unlock()

	tr := &recordingTransport{remoteRv: 0}
	eng := NewEngine(store, tr, PolicyRowMerge, "dev-a", "A", nil)
	if _, err := eng.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("run: %v", err)
	}
	if store.resetCount != 1 {
		t.Fatalf("expected watermarks to be reset once, got %d", store.resetCount)
	}
	if ids := tr.pushedIds(); len(ids) != 1 || ids[0] != "ct-a" {
		t.Fatalf("reset must re-push everything, got %v", ids)
	}
}

// Conflicts never count as synced: the remote kept a different version.
func TestEngineMarkSyncedFromPushOutcome(t *testing.T) {
	store := newWatermarkStore(t,
		syncproto.SnapshotItem{Id: "ct-ok", Text: "ok", UpdatedAt: 1000, Rev: 1},
		syncproto.SnapshotItem{Id: "ct-same", Text: "same", UpdatedAt: 1000, Rev: 1},
		syncproto.SnapshotItem{Id: "ct-bad", Text: "bad", UpdatedAt: 1000, Rev: 1},
	)
	tr := &recordingTransport{remoteRv: 0, results: []syncproto.PushItemResult{
		{Id: "ct-same", Rev: 3, Status: syncproto.PushStatusUnchanged},
		{Id: "ct-bad", Status: syncproto.PushStatusConflict},
	}}
	eng := NewEngine(store, tr, PolicyRowMerge, "dev-a", "A", nil)
	if _, err := eng.Run(context.Background(), TriggerManual); err != nil {
		t.Fatalf("run: %v", err)
	}

	if store.isPending("ct-ok") {
		t.Fatal("applied item must be marked synced")
	}
	if store.isPending("ct-same") {
		t.Fatal("unchanged item must be marked synced")
	}
	if !store.isPending("ct-bad") {
		t.Fatal("conflicted item must stay pending")
	}
}

// An error while reading the pending set must fail the run instead of silently pushing nothing.
func TestEngineWatermarkPendingErrorFailsRun(t *testing.T) {
	store := &brokenPendingStore{memStore: newMemStore()}
	eng := NewEngine(store, &recordingTransport{}, PolicyRowMerge, "dev-a", "A", nil)
	if _, err := eng.Run(context.Background(), TriggerManual); err == nil {
		t.Fatal("a broken pending read must surface as a run error")
	}
}

type brokenPendingStore struct {
	*memStore
}

func (s *brokenPendingStore) PendingItems(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	return nil, errors.New("db unavailable")
}

func (s *brokenPendingStore) MarkSynced(ctx context.Context, results []syncproto.PushItemResult) error {
	return nil
}
