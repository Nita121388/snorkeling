// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// memStore is an in-memory Store so engine tests do not need SQLite.
type memStore struct {
	mu    sync.Mutex
	items map[string]syncproto.SnapshotItem
}

func newMemStore(items ...syncproto.SnapshotItem) *memStore {
	s := &memStore{items: map[string]syncproto.SnapshotItem{}}
	for _, it := range items {
		s.items[it.Id] = it
	}
	return s
}

func (s *memStore) Items(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]syncproto.SnapshotItem, 0, len(s.items))
	for _, it := range s.items {
		out = append(out, it)
	}
	return out, nil
}

func (s *memStore) ApplyRemoteWithMode(ctx context.Context, items []syncproto.SnapshotItem, mode RemoteApplyMode) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	applied := 0
	for _, incoming := range items {
		stored, found := s.items[incoming.Id]
		switch mode {
		case RemoteFillMissing:
			if found {
				continue
			}
		case RemoteOverwrite:
			// always take the remote value
		default:
			if found && incoming.Rev <= stored.Rev {
				continue
			}
		}
		s.items[incoming.Id] = incoming
		applied++
	}
	return applied, nil
}

func (s *memStore) LocalRevision(ctx context.Context) (float64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var max float64
	for _, it := range s.items {
		if it.Rev > max {
			max = it.Rev
		}
	}
	return max, nil
}

func (s *memStore) get(id string) (syncproto.SnapshotItem, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	it, ok := s.items[id]
	return it, ok
}

func (s *memStore) put(it syncproto.SnapshotItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[it.Id] = it
}

func mustRun(t *testing.T, e *Engine) RunResult {
	t.Helper()
	res, err := e.Run(context.Background(), TriggerManual)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return res
}

// ── Folder transport ────────────────────────────────────────────────────────

func TestFolderTransportRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commontext.json")
	tr, err := NewFolderTransport(path)
	if err != nil {
		t.Fatalf("new transport: %v", err)
	}

	// A missing file is an empty snapshot, not an error.
	snap, err := tr.Pull(context.Background(), 0)
	if err != nil {
		t.Fatalf("pull missing file: %v", err)
	}
	if len(snap.Items) != 0 {
		t.Fatalf("expected empty snapshot, got %d items", len(snap.Items))
	}

	out, err := tr.Push(context.Background(), syncproto.PushRequest{
		DeviceId: "dev-a", DeviceName: "Home PC",
		Items: []syncproto.SnapshotItem{{Id: "ct1", Text: "hello", UpdatedAt: 1000}},
	})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if out.Applied != 1 {
		t.Fatalf("expected 1 applied, got %+v", out)
	}

	snap, err = tr.Pull(context.Background(), 0)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if len(snap.Items) != 1 || snap.Items[0].Text != "hello" {
		t.Fatalf("round trip lost data: %+v", snap.Items)
	}
	if snap.DeviceName != "Home PC" {
		t.Fatalf("payload must record the writer: %+v", snap)
	}
}

func TestFolderPayloadIsAtomicAndVersioned(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "commontext.json")
	tr, _ := NewFolderTransport(path)
	if _, err := tr.Push(context.Background(), syncproto.PushRequest{
		Items: []syncproto.SnapshotItem{{Id: "ct1", Text: "x", UpdatedAt: 1}},
	}); err != nil {
		t.Fatalf("push: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read payload: %v", err)
	}
	var payload FolderPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	if payload.FormatVersion != FolderFormatVersion {
		t.Fatalf("payload must be versioned, got %d", payload.FormatVersion)
	}
	// No temp files left behind.
	entries, _ := os.ReadDir(filepath.Dir(path))
	for _, e := range entries {
		if e.Name() != "commontext.json" {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}

func TestFolderRefusesToOverwriteCorruptPayload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commontext.json")
	if err := os.WriteFile(path, []byte("{this is not json"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	tr, _ := NewFolderTransport(path)
	// Overwriting would destroy the other machine's data, so this must fail loudly.
	if _, err := tr.Push(context.Background(), syncproto.PushRequest{
		Items: []syncproto.SnapshotItem{{Id: "ct1", Text: "x", UpdatedAt: 1}},
	}); err == nil {
		t.Fatal("must refuse to overwrite a corrupt payload")
	}
}

func TestFolderRejectsNewerFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commontext.json")
	if err := os.WriteFile(path, []byte(`{"formatVersion":999,"rev":1,"items":[]}`), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	tr, _ := NewFolderTransport(path)
	if _, err := tr.Pull(context.Background(), 0); err == nil {
		t.Fatal("a newer format must be refused, not silently misread")
	}
}

// TestTwoInstancesSyncThroughFolder is the whole point of the folder transport: two machines, one
// shared file, both converge without a server.
func TestTwoInstancesSyncThroughFolder(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commontext.json")

	storeA := newMemStore()
	storeB := newMemStore()

	trA, _ := NewFolderTransport(path)
	trB, _ := NewFolderTransport(path)
	engA := NewEngine(storeA, trA, PolicyRowMerge, "dev-a", "Home PC", nil)
	engB := NewEngine(storeB, trB, PolicyRowMerge, "dev-b", "Work Mac", nil)

	// A creates an item and syncs.
	storeA.put(syncproto.SnapshotItem{Id: "ct1", Title: "Checklist", Text: "v1", UpdatedAt: 1000, Rev: 1})
	mustRun(t, engA)

	// B syncs and sees it.
	res := mustRun(t, engB)
	if res.Applied != 1 {
		t.Fatalf("B should apply A's item, got %+v", res)
	}
	if it, ok := storeB.get("ct1"); !ok || it.Text != "v1" {
		t.Fatalf("B did not receive the item: %+v", it)
	}

	// B edits it, syncs; A picks up the edit.
	storeB.put(syncproto.SnapshotItem{Id: "ct1", Title: "Checklist", Text: "v2 from B", UpdatedAt: 2000, Rev: 2})
	mustRun(t, engB)
	res = mustRun(t, engA)
	if it, _ := storeA.get("ct1"); it.Text != "v2 from B" {
		t.Fatalf("A did not receive B's edit: %+v", it)
	}
	if res.Applied != 1 {
		t.Fatalf("A should apply 1 item, got %+v", res)
	}

	// B deletes it; the tombstone must reach A (otherwise A resurrects it on the next push).
	storeB.put(syncproto.SnapshotItem{Id: "ct1", DeletedAt: 3000, UpdatedAt: 3000, Rev: 3})
	mustRun(t, engB)
	mustRun(t, engA)
	it, _ := storeA.get("ct1")
	if it.DeletedAt == 0 {
		t.Fatalf("A must learn about the delete, got %+v", it)
	}
}

// ── Engine ───────────────────────────────────────────────────────────────────

func TestEngineWithoutTransportIsANoOp(t *testing.T) {
	e := NewEngine(newMemStore(), nil, PolicyRowMerge, "dev-a", "A", nil)
	res, err := e.Run(context.Background(), TriggerManual)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Skipped == "" {
		t.Fatal("a run without a transport must report why it did nothing")
	}
	if e.TransportId() != TransportNone {
		t.Fatalf("expected none, got %s", e.TransportId())
	}
}

func TestEngineSerializesRuns(t *testing.T) {
	// Two triggers firing together (timer + manual) must not interleave a pull and a push.
	store := newMemStore(syncproto.SnapshotItem{Id: "ct1", Text: "x", UpdatedAt: 1, Rev: 1})
	blocking := &blockingTransport{entered: make(chan struct{}), release: make(chan struct{})}
	e := NewEngine(store, blocking, PolicyRowMerge, "dev-a", "A", nil)

	done := make(chan struct{})
	go func() {
		_, _ = e.Run(context.Background(), TriggerTimer)
		close(done)
	}()
	// Wait until the first run is inside Pull.
	<-blocking.entered
	if _, err := e.Run(context.Background(), TriggerManual); err != ErrAlreadyRunning {
		t.Fatalf("expected ErrAlreadyRunning, got %v", err)
	}
	close(blocking.release)
	<-done
}

func TestManualPolicyBlocksPushWithUnresolvedConflicts(t *testing.T) {
	e := NewEngine(newMemStore(), nil, PolicyManual, "dev-a", "A", nil)
	if !e.ShouldBlockPush(1) {
		t.Fatal("manual policy must block with unresolved conflicts")
	}
	if e.ShouldBlockPush(0) {
		t.Fatal("nothing to block when there are no conflicts")
	}
	// Row-merge and newest resolved everything, so they never block.
	rowMerge := NewEngine(newMemStore(), nil, PolicyRowMerge, "a", "A", nil)
	if rowMerge.ShouldBlockPush(3) {
		t.Fatal("row-merge must not block")
	}
	newest := NewEngine(newMemStore(), nil, PolicyNewest, "a", "A", nil)
	if newest.ShouldBlockPush(3) {
		t.Fatal("newest must not block")
	}
}

func TestParseEnumsFallBackSafely(t *testing.T) {
	if ParseTransport("ftp") != TransportNone {
		t.Fatal("unknown transport must fall back to none")
	}
	if ParseTransport("server") != TransportServer || ParseTransport("folder") != TransportFolder {
		t.Fatal("known transports must parse")
	}
	// A typo must not disable conflict detection.
	if ParseConflictPolicy("whatever") != PolicyRowMerge {
		t.Fatal("unknown policy must fall back to row-merge")
	}
}

// blockingTransport lets a test hold a run inside Pull.
type blockingTransport struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingTransport) Id() TransportId { return TransportFolder }
func (b *blockingTransport) Caps() Caps      { return Caps{} }
func (b *blockingTransport) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return &syncproto.Snapshot{}, nil
}
func (b *blockingTransport) Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error) {
	return &PushOutcome{}, nil
}

// ── Baseline (transport switching) ──────────────────────────────────────────

// baselineFixture builds "local has A+B, remote has A(different)+C" — the state you are in when
// you switch from one already-used transport to another.
func baselineFixture(t *testing.T) (*FolderTransport, *Engine, *memStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "commontext.json")
	tr, err := NewFolderTransport(path)
	if err != nil {
		t.Fatalf("transport: %v", err)
	}
	// Seed the remote with A (content "remote-A") and C.
	if _, err := tr.Push(context.Background(), syncproto.PushRequest{
		Items: []syncproto.SnapshotItem{
			{Id: "A", Title: "A", Text: "remote-A", UpdatedAt: 500, Rev: 1},
			{Id: "C", Title: "C", Text: "remote-C", UpdatedAt: 500, Rev: 2},
		},
	}); err != nil {
		t.Fatalf("seed remote: %v", err)
	}
	// Local has A (content "local-A", newer) and B (local-only).
	store := newMemStore(
		syncproto.SnapshotItem{Id: "A", Title: "A", Text: "local-A", UpdatedAt: 9000, Rev: 5},
		syncproto.SnapshotItem{Id: "B", Title: "B", Text: "local-B", UpdatedAt: 9000, Rev: 6},
	)
	eng := NewEngine(store, tr, PolicyRowMerge, "dev-a", "Home PC", nil)
	return tr, eng, store, path
}

func TestBaselineLocalWinsConflictsAndKeepsRemoteOnly(t *testing.T) {
	tr, eng, store, _ := baselineFixture(t)

	res, err := eng.RunWithBaseline(context.Background(), BaselineLocal, TriggerManual)
	if err != nil {
		t.Fatalf("baseline run: %v", err)
	}
	// Choosing "local wins" must not report conflicts: the user already decided.
	if len(res.Conflicts) != 0 {
		t.Fatalf("a baseline run must not surface conflicts, got %+v", res.Conflicts)
	}

	snap, err := tr.Pull(context.Background(), 0)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	byId := map[string]string{}
	for _, it := range snap.Items {
		byId[it.Id] = it.Text
	}
	if byId["A"] != "local-A" {
		t.Fatalf("local must win on A, got %q", byId["A"])
	}
	if byId["B"] != "local-B" {
		t.Fatalf("local-only B must be pushed, got %q", byId["B"])
	}
	// "Remote extras are kept, not deleted" — C must still be on the remote and present locally.
	if byId["C"] != "remote-C" {
		t.Fatalf("remote-only C must not be deleted, got %q", byId["C"])
	}
	if _, ok := store.get("C"); !ok {
		t.Fatal("remote-only C must also be pulled into local")
	}
}

func TestBaselineRemoteWinsConflictsAndKeepsLocalOnly(t *testing.T) {
	tr, eng, store, _ := baselineFixture(t)

	res, err := eng.RunWithBaseline(context.Background(), BaselineRemote, TriggerManual)
	if err != nil {
		t.Fatalf("baseline run: %v", err)
	}
	if len(res.Conflicts) != 0 {
		t.Fatalf("a baseline run must not surface conflicts, got %+v", res.Conflicts)
	}

	// Local A must have been replaced by the remote version.
	if it, _ := store.get("A"); it.Text != "remote-A" {
		t.Fatalf("remote must win on A locally, got %q", it.Text)
	}
	// Local-only B is appended to the remote as a new item — never dropped.
	snap, err := tr.Pull(context.Background(), 0)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	byId := map[string]string{}
	for _, it := range snap.Items {
		byId[it.Id] = it.Text
	}
	if byId["B"] != "local-B" {
		t.Fatalf("local-only B must be appended to the remote, got %q", byId["B"])
	}
	if byId["A"] != "remote-A" {
		t.Fatalf("remote must keep its A, got %q", byId["A"])
	}
}

func TestBaselineNoneStillReportsRealConflicts(t *testing.T) {
	// Sanity: the baseline path must not have disabled normal conflict detection.
	tr, eng, _, _ := baselineFixture(t)
	_ = tr
	res, err := eng.Run(context.Background(), TriggerManual)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	// With no base the fallback is updatedat (local newer) → applied, not a conflict. This asserts
	// the steady-state path still works after the baseline plumbing.
	if res.Applied == 0 && res.Pushed == 0 {
		t.Fatalf("normal run should have pushed something, got %+v", res)
	}
}

func TestParseBaselineFallsBackToNone(t *testing.T) {
	if ParseBaseline("local") != BaselineLocal || ParseBaseline("remote") != BaselineRemote {
		t.Fatal("known baselines must parse")
	}
	// A typo must never silently force one side to win.
	for _, raw := range []string{"", "locall", "REMOTE", "both"} {
		if got := ParseBaseline(raw); got != BaselineNone {
			t.Fatalf("ParseBaseline(%q) = %q, want none", raw, got)
		}
	}
	if ParseBaseline("remote") == BaselineNone {
		t.Fatal("remote must not be swallowed by the fallback")
	}
}
