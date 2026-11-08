// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sync is the Common Text sync engine: it owns the loop that pulls, three-way merges,
// pushes and records what happened.
//
// Design boundaries worth keeping:
//
//   - **One active transport at a time.** Two transports writing the same items would fork the
//     data with no way to reconcile. `Engine` therefore holds exactly one transport and switching
//     is an explicit, full-resync operation.
//   - **Transport is dumb, engine is smart.** A transport only moves snapshots (`Pull`/`Push`).
//     Merging, conflict policy and journaling live here, so every backend behaves identically.
//   - **Every run is observable.** Each run writes journal events (including failures), so
//     "did my edit reach the other machine?" is answerable without reading source.
package sync

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncjournal"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// TransportId is the closed set of transports. Compile-time enum, not a plugin loader: see
// design/prototypes/commontext-cloud-sync-notion README D5 for why.
type TransportId string

const (
	TransportNone   TransportId = "none"
	TransportFolder TransportId = "folder"
	TransportGit    TransportId = "git"
	TransportServer TransportId = "server"
)

// Caps describes what a transport can do, so the engine can pick behaviour instead of guessing
// from the transport's name.
type Caps struct {
	// RequiresCredential means Pull/Push will fail without a token.
	RequiresCredential bool
	// AtomicWrite means a concurrent reader never sees a half-written payload.
	AtomicWrite bool
	// Incremental means Pull(sinceRev) is cheaper than a full snapshot.
	Incremental bool
	// Realtime means the transport can notify about remote changes without polling.
	Realtime bool
}

// Transport moves snapshots. It must be safe to call from one goroutine at a time (the engine
// serializes calls); implementations do not need their own locking.
type Transport interface {
	Id() TransportId
	Caps() Caps
	// Pull returns items with Rev > sinceRev. A full snapshot when sinceRev is 0.
	Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error)
	// Push sends local changes. base is what this machine last synced, used for three-way merge.
	Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error)
}

// PushOutcome is the transport-independent result of a push.
type PushOutcome struct {
	// Applied counts items the remote accepted (new or updated).
	Applied int
	// Unchanged counts items that matched what the remote already had.
	Unchanged int
	// Conflicts are items the remote refused and returned both versions for.
	Conflicts []syncproto.Conflict
	// Rev is the remote head revision after the push.
	Rev float64
	// StaleBase means the remote moved on; the caller must pull and retry rather than push blindly.
	StaleBase bool
	// Current is the remote snapshot when StaleBase is set.
	Current *syncproto.Snapshot
}

// Store is the local side of a sync run: the engine never touches the database directly.
type Store interface {
	// Items returns every local item INCLUDING tombstones (a delete must be pushed, otherwise the
	// remote resurrects it).
	Items(ctx context.Context) ([]syncproto.SnapshotItem, error)
	// ApplyRemoteWithMode writes items learned from the remote into the local database, using the
	// mode to decide what a collision means.
	ApplyRemoteWithMode(ctx context.Context, items []syncproto.SnapshotItem, mode RemoteApplyMode) (applied int, err error)
	// LocalRevision is the highest rev this machine has stored; used as `sinceRev` on pull and as
	// the base for the next push.
	LocalRevision(ctx context.Context) (float64, error)
}

// RemoteApplyMode decides what happens when a remote item collides with a local one.
type RemoteApplyMode string

const (
	// RemoteMerge takes the remote copy only when it carries a higher rev. Correct for steady-state
	// sync within one transport.
	RemoteMerge RemoteApplyMode = "merge"
	// RemoteFillMissing only adds ids the local store does not have, never overwriting an existing
	// item. Used for the "this device wins" baseline.
	RemoteFillMissing RemoteApplyMode = "fill-missing"
	// RemoteOverwrite forces the remote value for every id the remote knows about. Used for the
	// "remote wins" baseline.
	RemoteOverwrite RemoteApplyMode = "overwrite"
)

// remoteApplyModeFor maps a baseline to how remote items should be applied locally.
func remoteApplyModeFor(baseline Baseline) RemoteApplyMode {
	switch baseline {
	case BaselineLocal:
		return RemoteFillMissing
	case BaselineRemote:
		return RemoteOverwrite
	default:
		return RemoteMerge
	}
}

// ConflictPolicy mirrors the settings enum.
type ConflictPolicy string

const (
	// PolicyRowMerge reports a conflict only when both sides changed the same field.
	PolicyRowMerge ConflictPolicy = "row-merge"
	// PolicyNewest takes the newer updatedat and never asks.
	PolicyNewest ConflictPolicy = "newest"
	// PolicyManual stops pushing when a conflict appears.
	PolicyManual ConflictPolicy = "manual"
)

// ParseConflictPolicy maps a settings string to the enum, defaulting to row-merge for unknown
// values (a typo must not disable conflict detection).
func ParseConflictPolicy(raw string) ConflictPolicy {
	switch ConflictPolicy(strings.TrimSpace(raw)) {
	case PolicyNewest:
		return PolicyNewest
	case PolicyManual:
		return PolicyManual
	default:
		return PolicyRowMerge
	}
}

// ParseTransport maps a settings string to the enum, defaulting to none.
func ParseTransport(raw string) TransportId {
	switch TransportId(strings.TrimSpace(raw)) {
	case TransportFolder:
		return TransportFolder
	case TransportGit:
		return TransportGit
	case TransportServer:
		return TransportServer
	default:
		return TransportNone
	}
}

// Engine owns the single active transport and runs syncs.
//
// All mutable state is behind mu; Run serializes so two triggers (timer + manual) cannot interleave
// a pull and a push into an inconsistent intermediate state.
type Engine struct {
	mu         sync.Mutex
	transport  Transport
	store      Store
	policy     ConflictPolicy
	deviceId   string
	deviceName string
	journal    func(syncjournal.Event) error
	running    bool
}

// NewEngine builds an engine. journal may be nil (tests) in which case events are dropped.
func NewEngine(store Store, transport Transport, policy ConflictPolicy, deviceId, deviceName string,
	journalFn func(syncjournal.Event) error) *Engine {
	if journalFn == nil {
		journalFn = func(syncjournal.Event) error { return nil }
	}
	return &Engine{
		store:      store,
		transport:  transport,
		policy:     policy,
		deviceId:   deviceId,
		deviceName: deviceName,
		journal:    journalFn,
	}
}

// SetTransport swaps the active transport. Passing nil disables syncing.
//
// Switching is deliberately explicit rather than automatic: the caller must decide what to do with
// data that exists on both sides, because guessing would either drop remote items or fork them.
func (e *Engine) SetTransport(t Transport) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.transport = t
}

// TransportId reports the active transport (for the status panel).
func (e *Engine) TransportId() TransportId {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.transport == nil {
		return TransportNone
	}
	return e.transport.Id()
}

// RunResult summarises one sync.
type RunResult struct {
	Pulled    int
	Applied   int
	Pushed    int
	Unchanged int
	Conflicts []syncproto.Conflict
	// StaleBase means the remote moved during our push; a follow-up Run will reconcile.
	StaleBase bool
	// Skipped is set when the run did nothing (no transport, or manual policy blocked by conflicts).
	Skipped string
	Ms      int64
}

// Trigger names why a run started: manual | timer | fsnotify | startup.
const (
	TriggerManual   = "manual"
	TriggerTimer    = "timer"
	TriggerFsnotify = "fsnotify"
	TriggerStartup  = "startup"
)

// ErrAlreadyRunning is returned when a sync is in flight. Callers should drop the trigger rather
// than queue it: a second immediate run would re-push the same snapshot for nothing.
var ErrAlreadyRunning = errors.New("sync already running")

// Run performs one sync: pull → merge into local → push local changes → journal.
//
// The order matters. Pulling first means the merge sees remote changes before we push, so a
// conflict is detected in one round trip instead of after a rejection.
func (e *Engine) Run(ctx context.Context, trigger string) (RunResult, error) {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return RunResult{}, ErrAlreadyRunning
	}
	transport := e.transport
	if transport == nil {
		e.mu.Unlock()
		return RunResult{Skipped: "no transport configured"}, nil
	}
	e.running = true
	e.mu.Unlock()

	start := time.Now()
	defer func() {
		e.mu.Lock()
		e.running = false
		e.mu.Unlock()
	}()

	_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunStart, Trigger: trigger})

	result, err := e.runOnce(ctx, transport, BaselineNone)
	result.Ms = time.Since(start).Milliseconds()

	if err != nil {
		_ = e.journal(syncjournal.Event{
			Type: syncjournal.EventError, Phase: "run", Msg: err.Error(), Ms: result.Ms,
		})
		_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunEnd, OK: false, Ms: result.Ms})
		return result, err
	}
	_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunEnd, OK: true, Ms: result.Ms})
	return result, nil
}

func (e *Engine) runOnce(ctx context.Context, transport Transport, baseline Baseline) (RunResult, error) {
	var result RunResult

	localRev, err := e.store.LocalRevision(ctx)
	if err != nil {
		return result, fmt.Errorf("reading local revision: %w", err)
	}

	// ── 1. Pull ──────────────────────────────────────────────────────────────
	// A baseline run must pull EVERYTHING: rev numbers are per-transport (each backend counts its
	// own), so a `sinceRev` from the old transport filters out the entire new remote. This was a
	// real bug: switching transports pulled nothing and then pushed local over the remote.
	sinceRev := localRev
	if baseline != BaselineNone {
		sinceRev = 0
	}
	remote, err := transport.Pull(ctx, sinceRev)
	if err != nil {
		return result, fmt.Errorf("pull: %w", err)
	}
	var remoteItems []syncproto.SnapshotItem
	if remote != nil {
		remoteItems = remote.Items
	}
	if len(remoteItems) > 0 {
		result.Pulled = len(remoteItems)
		_ = e.journal(syncjournal.Event{
			Type: syncjournal.EventPull, Items: len(remoteItems), Since: sinceRev, Rev: remote.Rev,
		})
		applied, applyErr := e.store.ApplyRemoteWithMode(ctx, remoteItems, remoteApplyModeFor(baseline))
		if applyErr != nil {
			return result, fmt.Errorf("applying remote items: %w", applyErr)
		}
		result.Applied = applied
	}

	// ── 2. Collect local changes and push ────────────────────────────────────
	items, err := e.store.Items(ctx)
	if err != nil {
		return result, fmt.Errorf("reading local items: %w", err)
	}
	if len(items) == 0 {
		return result, nil
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Id < items[j].Id })

	// The base is "what this machine last synced". Without a stored base we send none, and the
	// remote falls back to updatedat — see syncproto.DetectConflictFields for the reasoning.
	//
	// A baseline choice is expressed entirely through this field, so every transport gets the same
	// behaviour without transport-specific code:
	//   BaselineLocal  → send the REMOTE snapshot as base, so from the transport's point of view
	//                    local always diverged from base and therefore wins every field.
	//   BaselineRemote → send the LOCAL items as base, so local "did not change" and the remote
	//                    value is kept.
	pushBase := e.baseForBaseline(baseline, items, remoteItems)
	outcome, err := transport.Push(ctx, syncproto.PushRequest{
		BaseRev:    localRev,
		Items:      items,
		Base:       pushBase,
		DeviceId:   e.deviceId,
		DeviceName: e.deviceName,
	})
	if err != nil {
		return result, fmt.Errorf("push: %w", err)
	}
	if outcome == nil {
		return result, nil
	}
	result.Pushed = outcome.Applied
	result.Unchanged = outcome.Unchanged
	result.StaleBase = outcome.StaleBase
	result.Conflicts = outcome.Conflicts
	if outcome.Applied > 0 {
		_ = e.journal(syncjournal.Event{Type: syncjournal.EventPush, Items: outcome.Applied, Rev: outcome.Rev})
	}

	// ── 3. Journal conflicts ─────────────────────────────────────────────────
	for _, c := range outcome.Conflicts {
		_ = e.journal(syncjournal.Event{
			Type: syncjournal.EventConflict, Id: c.Id, Fields: c.Fields,
			Resolved: string(e.policy), Msg: c.Reason,
		})
	}
	return result, nil
}

// ShouldBlockPush reports whether the manual policy should stop the next push because unresolved
// conflicts exist. Row-merge and newest never block: they either resolved it or keep both copies.
func (e *Engine) ShouldBlockPush(unresolvedCount int) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.policy == PolicyManual && unresolvedCount > 0
}

// Baseline is the "which side do I believe" choice made when switching between transports.
//
// Switching transports is the only operation where two independent datasets meet with no shared
// history: everything local was produced under transport A, everything remote under transport B.
// Guessing (by updatedat) would silently drop whichever side happened to be older, so the user
// must choose. `none` means "normal sync", not "no data".
type Baseline string

const (
	// BaselineNone is the ordinary steady-state sync (three-way merge, ask on real conflicts).
	BaselineNone Baseline = ""
	// BaselineLocal means this device's items win every conflicting field. Remote-only items are
	// still pulled in (nothing is deleted).
	BaselineLocal Baseline = "local"
	// BaselineRemote means the remote's items win every conflicting field. Local-only items are
	// still pushed as new items (nothing is deleted).
	BaselineRemote Baseline = "remote"
)

// ParseBaseline maps a request string to the enum; anything unrecognised means "no baseline" so a
// typo cannot accidentally force one side to win.
func ParseBaseline(raw string) Baseline {
	switch Baseline(strings.TrimSpace(raw)) {
	case BaselineLocal:
		return BaselineLocal
	case BaselineRemote:
		return BaselineRemote
	default:
		return BaselineNone
	}
}

// baseForBaseline turns the baseline choice into the `Base` field of a push.
//
// This is where "local wins" and "remote wins" are implemented, and doing it here (rather than in
// each transport) means folder, git and server all behave identically without any transport code
// knowing a baseline exists.
func (e *Engine) baseForBaseline(baseline Baseline, localItems, remoteItems []syncproto.SnapshotItem) []syncproto.SnapshotItem {
	switch baseline {
	case BaselineLocal:
		// Claim the remote snapshot as "what I last synced", so every local difference reads as
		// "only local changed" → local wins every field, and no conflict is reported.
		return remoteItems
	case BaselineRemote:
		// Claim the local snapshot as the base, so from the transport's view local never changed
		// and the remote value is kept. Local-only ids still arrive as inserts.
		out := make([]syncproto.SnapshotItem, len(localItems))
		copy(out, localItems)
		return out
	default:
		return nil
	}
}

// RunWithBaseline performs one sync with an explicit winner. It is used when switching transports
// and must not become the steady state: after it succeeds the caller drops back to BaselineNone.
func (e *Engine) RunWithBaseline(ctx context.Context, baseline Baseline, trigger string) (RunResult, error) {
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return RunResult{}, ErrAlreadyRunning
	}
	transport := e.transport
	if transport == nil {
		e.mu.Unlock()
		return RunResult{Skipped: "no transport configured"}, nil
	}
	e.running = true
	e.mu.Unlock()

	start := time.Now()
	defer func() {
		e.mu.Lock()
		e.running = false
		e.mu.Unlock()
	}()

	_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunStart, Trigger: trigger})

	result, err := e.runOnce(ctx, transport, baseline)
	result.Ms = time.Since(start).Milliseconds()
	if err != nil {
		_ = e.journal(syncjournal.Event{
			Type: syncjournal.EventError, Phase: "baseline-resync", Msg: err.Error(), Ms: result.Ms,
		})
		_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunEnd, OK: false, Ms: result.Ms})
		return result, err
	}
	_ = e.journal(syncjournal.Event{Type: syncjournal.EventRunEnd, OK: true, Ms: result.Ms})
	return result, nil
}
