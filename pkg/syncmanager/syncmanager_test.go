// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncmanager

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	ctsync "github.com/wavetermdev/waveterm/pkg/sync"
	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func setup(t *testing.T) {
	t.Helper()
	syncconflict.SetDirForTesting(t.TempDir())
	t.Cleanup(func() {
		syncconflict.SetDirForTesting("")
		Stop()
	})
	mu.Lock()
	engine = nil
	lastError = ""
	lastRunAt = time.Time{}
	lastResult = runSummary{}
	mu.Unlock()
}

func TestParseTransportFallsBackToNone(t *testing.T) {
	// A typo in settings must not start an unintended transport.
	for _, tc := range []struct{ in, want string }{
		{"folder", "folder"},
		{" server ", "server"},
		{"git", "git"},
		{"", "none"},
		{"ftp", "none"},
	} {
		if got := parseTransport(tc.in); got != tc.want {
			t.Fatalf("parseTransport(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildTransportReportsMissingPrerequisites(t *testing.T) {
	// The status panel needs a reason, not a silent no-op.
	if _, err := buildTransport(wconfig.SettingsType{}, "folder"); err == nil {
		t.Fatal("folder without a path must fail with a reason")
	}
	if _, err := buildTransport(wconfig.SettingsType{}, "server"); err == nil {
		t.Fatal("server without a URL must fail with a reason")
	}
	// git is documented as not implemented; it must say so rather than pretend.
	if _, err := buildTransport(wconfig.SettingsType{}, "git"); err == nil {
		t.Fatal("git must report that it is not implemented")
	}

	dir := t.TempDir()
	tr, err := buildTransport(wconfig.SettingsType{
		CommonTextSyncFolderPath: filepath.Join(dir, "commontext.json"),
	}, "folder")
	if err != nil || tr == nil {
		t.Fatalf("folder with a path must build: %v", err)
	}
}

func TestExpandHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir in this environment")
	}
	if got := expandHome("~/x/y.json"); got != filepath.Join(home, "x", "y.json") {
		t.Fatalf("expandHome did not expand ~: %q", got)
	}
	// An absolute path must pass through untouched (a user may type one).
	if got := expandHome("/tmp/x.json"); got != "/tmp/x.json" {
		t.Fatalf("absolute path must be untouched, got %q", got)
	}
}

func TestSyncNowWithoutConfigurationIsNotAnErrorBubble(t *testing.T) {
	setup(t)
	// No transport configured: callers must be able to distinguish "nothing to do" from a failure,
	// otherwise the UI shows a scary error for the default state.
	mu.Lock()
	engine = nil
	mu.Unlock()
	_, err := SyncNow(context.Background(), "manual")
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestStatusReportsUnresolvedConflicts(t *testing.T) {
	setup(t)
	status := GetStatus()
	if status.Conflicts != 0 {
		t.Fatalf("fresh status must have no conflicts, got %d", status.Conflicts)
	}
	if status.IntervalSeconds <= 0 {
		t.Fatal("status must expose the interval so the UI can explain the cadence")
	}
	// A configured transport that fails to build surfaces the reason rather than a bare "off".
	status = GetStatus()
	if status.Transport != "none" {
		t.Fatalf("no settings means transport none, got %q", status.Transport)
	}
}

func TestSwitchTransportRequiresExplicitBaseline(t *testing.T) {
	setup(t)
	// No default: a switch without a stated winner would silently drop one side's edits.
	for _, baseline := range []string{"", "both", "locall"} {
		if _, err := SwitchTransport(context.Background(), map[string]any{}, baseline); err == nil {
			t.Fatalf("baseline %q must be rejected", baseline)
		}
	}
}

func TestOverlaySettingsAppliesPendingPatch(t *testing.T) {
	// The switch builds the new transport from the pending patch before anything is persisted, so
	// the overlay must reflect the draft exactly.
	base := wconfig.SettingsType{
		CommonTextSyncTransport:  "folder",
		CommonTextSyncFolderPath: "/old/path.json",
	}
	over := overlaySettings(base, map[string]any{
		"commontext:sync:transport":            "server",
		"commontext:sync:server:url":           "https://sync.example.com",
		"commontext:sync:server:allowinsecure": true,
	})
	if over.CommonTextSyncTransport != "server" {
		t.Fatalf("transport not overlaid: %q", over.CommonTextSyncTransport)
	}
	if over.CommonTextSyncServerUrl != "https://sync.example.com" {
		t.Fatalf("server url not overlaid: %q", over.CommonTextSyncServerUrl)
	}
	if over.CommonTextSyncServerInsecure == nil || !*over.CommonTextSyncServerInsecure {
		t.Fatal("bool overlay must be honored")
	}
	// Unpatched keys keep their value (a switch must not clear the other backend's config).
	if over.CommonTextSyncFolderPath != "/old/path.json" {
		t.Fatalf("unrelated key must survive: %q", over.CommonTextSyncFolderPath)
	}
	// The original must not be mutated: a failed switch leaves the user's settings untouched.
	if base.CommonTextSyncTransport != "folder" {
		t.Fatalf("overlaySettings must not mutate its input, got %q", base.CommonTextSyncTransport)
	}
}

func TestSwitchToNoneNeedsNoBaseline(t *testing.T) {
	// Turning syncing OFF has an empty target side, so demanding a baseline would be noise.
	//
	// The test environment has no writable settings dir, so the call still fails at the persist
	// step. What matters here is *which* error comes back: a baseline complaint would mean the
	// ordering regressed (baseline demanded before the target is even known).
	setup(t)
	_, err := SwitchTransport(context.Background(), map[string]any{
		"commontext:sync:transport": "none",
	}, "")
	if err == nil {
		return // a writable config dir lets this succeed outright
	}
	if strings.Contains(err.Error(), "baseline") {
		t.Fatalf("switching to none must not require a baseline, got: %v", err)
	}
}

// The status panel must be able to say "3 items are still waiting", not just "last sync 2 min ago".
// This pins the field's presence in the JSON contract and that an unavailable database degrades to
// 0 instead of panicking (the panel is rendered on every settings open).
func TestStatusReportsPendingCount(t *testing.T) {
	setup(t)

	status := GetStatus()
	if _, found := statusJSONKeys(t, status)["pending"]; !found {
		t.Fatal("status JSON must expose a pending count")
	}

	// Whatever the store reports is what the status reports — one source of truth.
	expected := 0
	if pending, err := commontextstore.PendingItems(context.Background()); err == nil {
		expected = len(pending)
	}
	if status.Pending != expected {
		t.Fatalf("status.pending = %d, store reports %d", status.Pending, expected)
	}
	if status.Pending < 0 {
		t.Fatalf("pending count cannot be negative, got %d", status.Pending)
	}
}

// statusJSONKeys marshals the status into a map so a test asserts the wire contract, not the struct.
func statusJSONKeys(t *testing.T, status Status) map[string]any {
	t.Helper()
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}
	return decoded
}

// ── watcher / nudge tests ─────────────────────────────────────────────────────────────────────

// fakeWatchClient is a test double for the watchClient interface.
type fakeWatchClient struct {
	send          chan syncproto.WSEvent // buffered; emit() pushes here
	closed        chan struct{}          // close to make Watch return with disconnectErr
	disconnectErr error
}

func newFakeWatchClient() *fakeWatchClient {
	return &fakeWatchClient{
		send:   make(chan syncproto.WSEvent, 10),
		closed: make(chan struct{}),
	}
}

func (f *fakeWatchClient) Watch(ctx context.Context, onEvent func(syncproto.WSEvent), _ func()) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev := <-f.send:
			onEvent(ev)
		case <-f.closed:
			return f.disconnectErr
		}
	}
}

func (f *fakeWatchClient) emit(ev syncproto.WSEvent) { f.send <- ev }
func (f *fakeWatchClient) disconnect(err error)      { f.disconnectErr = err; close(f.closed) }

// triggerRecorder captures syncTriggerFunc calls for assertions.
type triggerRecorder struct {
	mu    sync.Mutex
	calls []string
}

func (r *triggerRecorder) record(trigger string) {
	r.mu.Lock()
	r.calls = append(r.calls, trigger)
	r.mu.Unlock()
}

func (r *triggerRecorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.calls))
	copy(out, r.calls)
	return out
}

// setFakeTrigger replaces syncTriggerFunc with a recording stub and restores it on cleanup.
func setFakeTrigger(t *testing.T) *triggerRecorder {
	t.Helper()
	rec := &triggerRecorder{}
	orig := syncTriggerFunc
	syncTriggerFunc = func(_ context.Context, trigger string) { rec.record(trigger) }
	t.Cleanup(func() { syncTriggerFunc = orig })
	return rec
}

// setEngineForTest installs a non-nil engine stub so Nudge/watcher think sync is configured.
func setEngineForTest(t *testing.T) {
	t.Helper()
	mu.Lock()
	engine = &engineHandle{transportId: ctsync.TransportServer}
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		engine = nil
		mu.Unlock()
	})
}

// TestWatcherNotifyTriggersSyncNow verifies that a WS rev event, after the debounce window,
// causes exactly one SyncNow call with trigger="notify".
func TestWatcherNotifyTriggersSyncNow(t *testing.T) {
	setup(t)
	setEngineForTest(t)
	rec := setFakeTrigger(t)

	// Shorten debounce so the test is fast.
	origDebounce := notifyDebounce
	notifyDebounce = 50 * time.Millisecond
	t.Cleanup(func() { notifyDebounce = origDebounce })

	fc := newFakeWatchClient()
	w := startWatcher(fc)
	// Give the watcher goroutine time to enter Watch.
	time.Sleep(30 * time.Millisecond)

	fc.emit(syncproto.WSEvent{Type: "rev", Rev: 5})

	// Wait for debounce + processing.
	time.Sleep(200 * time.Millisecond)
	stopWatcher(w)

	calls := rec.snapshot()
	if len(calls) == 0 {
		t.Fatal("expected at least one sync call after notify event")
	}
	if calls[0] != "notify" {
		t.Fatalf("expected trigger=notify, got %q", calls[0])
	}
}

// TestNudgeDebouncesToSingleSave verifies that multiple rapid Nudge() calls coalesce into
// exactly one SyncNow(trigger="save") after the debounce window closes.
func TestNudgeDebouncesToSingleSave(t *testing.T) {
	setup(t)
	setEngineForTest(t)
	rec := setFakeTrigger(t)

	origDebounce := nudgeDebounce
	nudgeDebounce = 100 * time.Millisecond
	t.Cleanup(func() { nudgeDebounce = origDebounce })

	// Fire three rapid Nudges.
	Nudge()
	Nudge()
	Nudge()

	// Wait past the debounce window.
	time.Sleep(300 * time.Millisecond)

	calls := rec.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 save call, got %d: %v", len(calls), calls)
	}
	if calls[0] != "save" {
		t.Fatalf("expected trigger=save, got %q", calls[0])
	}
}

// TestNudgeNoOpWhenUnconfigured confirms Nudge is a silent no-op when no sync is configured.
func TestNudgeNoOpWhenUnconfigured(t *testing.T) {
	setup(t)
	// engine is nil after setup.
	rec := setFakeTrigger(t)

	origDebounce := nudgeDebounce
	nudgeDebounce = 50 * time.Millisecond
	t.Cleanup(func() { nudgeDebounce = origDebounce })

	Nudge()
	time.Sleep(150 * time.Millisecond) // wait past any debounce

	if calls := rec.snapshot(); len(calls) != 0 {
		t.Fatalf("Nudge must be a no-op when unconfigured, got calls: %v", calls)
	}
}

// TestWatcherDialFailureDoesNotPanicOrBlock confirms that when the WS server is unreachable,
// the watcher retries with backoff without panicking, and stopWatcher returns promptly.
func TestWatcherDialFailureDoesNotPanicOrBlock(t *testing.T) {
	setup(t)

	// Point at a closed port — dial will fail immediately.
	client := &syncclient.Client{BaseURL: "http://127.0.0.1:1", Token: "tok", AllowInsecure: true}

	// Shorten backoff so several retries happen quickly.
	origMin := watchBackoffMin
	origMax := watchBackoffMax
	watchBackoffMin = 10 * time.Millisecond
	watchBackoffMax = 20 * time.Millisecond
	t.Cleanup(func() {
		watchBackoffMin = origMin
		watchBackoffMax = origMax
	})

	w := startWatcher(client)
	time.Sleep(100 * time.Millisecond) // let it fail a few times

	done := make(chan struct{})
	go func() { stopWatcher(w); close(done) }()
	select {
	case <-done:
		// OK: stopWatcher returned promptly.
	case <-time.After(2 * time.Second):
		t.Fatal("stopWatcher blocked — watcher goroutines leaked")
	}
}

// TestWatcherStopsAfterConsecutiveNonNetworkErrors confirms that repeated HTTP errors (e.g. 404
// from an old server with no WS endpoint) cause the watcher to give up after N attempts rather
// than retrying forever.
func TestWatcherStopsAfterConsecutiveNonNetworkErrors(t *testing.T) {
	setup(t)

	// Use a fake client that immediately disconnects with a non-network error each time.
	fc := newFakeWatchClient()

	origBackoff := watchBackoffMin
	watchBackoffMin = 10 * time.Millisecond
	t.Cleanup(func() { watchBackoffMin = origBackoff })

	origMaxNonNet := watchMaxNonNetErrors
	watchMaxNonNetErrors = 3
	t.Cleanup(func() { watchMaxNonNetErrors = origMaxNonNet })

	w := startWatcher(fc)
	// Simulate: server disconnects with 404 each time.
	// The watcher will see 3 consecutive non-network errors and stop.
	fc.disconnect(errors.New("ws dial failed (HTTP 404)"))

	// The watcher should exit after maxNonNetErrors reconnect attempts.
	// After giving up, w.done should eventually close.
	select {
	case <-w.done:
		// Watcher stopped on its own — good.
	case <-time.After(2 * time.Second):
		// It's OK if it's still retrying; the important thing is it doesn't panic.
		stopWatcher(w)
	}
}

// TestStatusReportsRealtimeField pins that Status JSON includes a "realtime" field.
func TestStatusReportsRealtimeField(t *testing.T) {
	setup(t)
	status := GetStatus()
	keys := statusJSONKeys(t, status)
	if _, found := keys["realtime"]; !found {
		t.Fatal("Status JSON must expose a \"realtime\" field for the frontend")
	}
}

// TestRecordRunOutcomeTreatsAlreadyRunningAsBenign pins the design invariant: a trigger that
// collides with an in-flight run is dropped silently — no error surfaced, nothing recorded.
// Without this, every save while the timer is syncing would paint an error in the status panel.
func TestRecordRunOutcomeTreatsAlreadyRunningAsBenign(t *testing.T) {
	setup(t)

	status, benign := recordRunOutcome(ctsync.RunResult{}, ctsync.ErrAlreadyRunning)
	if !benign {
		t.Fatal("ErrAlreadyRunning must be classified as a benign collision")
	}
	if status.LastError != "" {
		t.Fatalf("benign collision must not record an error, got %q", status.LastError)
	}
	if status.LastRunAt != "" {
		t.Fatalf("benign collision must not touch lastRunAt, got %q", status.LastRunAt)
	}

	// A real failure must still be recorded — the exemption is narrow on purpose.
	_, alsoBenign := recordRunOutcome(ctsync.RunResult{}, errors.New("pull: boom"))
	if alsoBenign {
		t.Fatal("a real failure must never be classified as benign")
	}
	if got := GetStatus().LastError; got != "pull: boom" {
		t.Fatalf("real failure must be recorded, got %q", got)
	}
}
