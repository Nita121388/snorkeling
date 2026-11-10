// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package syncmanager owns the process-wide sync engine: one transport, one timer, one status.
//
// The engine itself (pkg/sync) is deliberately UI-agnostic and stateless across runs. This layer
// adds what a running app needs:
//
//   - a single engine instance (two engines would race on the same files/rows);
//   - a timer that re-reads settings and restarts when the transport config changes, so the
//     Settings panel's Save takes effect without a restart;
//   - a status snapshot the UI can render (last sync, item counts, unresolved conflicts).
package syncmanager

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/commontextstore"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	ctsync "github.com/wavetermdev/waveterm/pkg/sync"
	"github.com/wavetermdev/waveterm/pkg/syncclient"
	"github.com/wavetermdev/waveterm/pkg/syncconflict"
	"github.com/wavetermdev/waveterm/pkg/syncjournal"
	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// Settings keys owned by the sync feature (mirrors pkg/wconfig/settingsconfig.go).
const (
	keyTransport      = "commontext:sync:transport"
	keyConflictPolicy = "commontext:sync:conflictpolicy"
	keyDeviceName     = "commontext:sync:devicename"
	keyDeviceId       = "commontext:sync:deviceid"
	keyFolderPath     = "commontext:sync:folder:path"
	keyServerUrl      = "commontext:sync:server:url"
	keyServerInsecure = "commontext:sync:server:allowinsecure"
	keyGitRemote      = "commontext:sync:git:remote"
)

// DefaultInterval is how often the timer syncs. Chosen to match the git transport's documented
// default; a user-visible interval setting is out of scope for this pass.
const DefaultInterval = 5 * time.Minute

// Status is the UI-facing snapshot. All fields are read-only projections.
type Status struct {
	Transport  string `json:"transport"`
	Configured bool   `json:"configured"`
	// Problem explains why syncing cannot run (empty when configured).
	Problem   string `json:"problem,omitempty"`
	Running   bool   `json:"running"`
	LastRunAt string `json:"lastRunAt,omitempty"`
	LastError string `json:"lastError,omitempty"`
	// LastResult counters from the most recent successful run.
	LastPulled  int `json:"lastPulled"`
	LastApplied int `json:"lastApplied"`
	LastPushed  int `json:"lastPushed"`
	Conflicts   int `json:"conflicts"`
	// Pending is how many items the remote has not confirmed yet. It is the item-level answer to
	// "is everything uploaded?" that the four counters above cannot give.
	Pending int `json:"pending"`
	// IntervalSeconds is informational, so the UI can say "every 5 minutes".
	IntervalSeconds int `json:"intervalSeconds"`
}

var mu sync.Mutex
var engine *engineHandle
var timer *time.Timer
var started bool
var lastResult runSummary
// lastError is a CONFIGURATION/BUILD error (reload could not construct the transport). reload()
// owns it and clears it once the transport builds again.
var lastError string
// lastRunError is the most recent RUN failure. It must not share lastError: GetStatus calls
// reload(), and clearing a run error on every reload would erase the failure the user needs to see
// (and hand to an agent) the moment they open the panel. 2026-11-10 found by the sync-diagnostics
// verify bench: the failed run was journaled but the panel showed "pulled 0 · applied 0" instead.
var lastRunError string
var lastRunAt time.Time

type runSummary struct {
	Pulled  int
	Applied int
	Pushed  int
}

// startOnce guards the timer against double-start when both the app and a test trigger it.
var startOnce sync.Once

// Start begins the background loop. Safe to call multiple times.
func Start() {
	startOnce.Do(func() {
		mu.Lock()
		started = true
		mu.Unlock()
		reload()
		go loop()
	})
}

// Stop cancels the timer (used by tests and on shutdown).
func Stop() {
	mu.Lock()
	started = false
	if timer != nil {
		timer.Stop()
		timer = nil
	}
	mu.Unlock()
}

func loop() {
	for {
		mu.Lock()
		if !started {
			mu.Unlock()
			return
		}
		interval := DefaultInterval
		mu.Unlock()

		time.Sleep(interval)
		mu.Lock()
		stillStarted := started
		mu.Unlock()
		if !stillStarted {
			return
		}
		// Re-read settings each tick: the transport may have been switched or reconfigured.
		reload()
		if _, err := SyncNow(context.Background(), "timer"); err != nil && !errors.Is(err, ErrNotConfigured) {
			log.Printf("commontext sync (timer): %v", err)
		}
	}
}

// reload rebuilds the engine when the relevant settings changed. Called on start and each tick, so
// a Settings-panel Save takes effect without restarting the app.
func reload() {
	settings, err := currentSettings()
	if err != nil {
		mu.Lock()
		lastError = err.Error()
		mu.Unlock()
		return
	}
	transportId := parseTransport(settingString(settings, keyTransport))
	if transportId == "none" {
		mu.Lock()
		engine = nil
		mu.Unlock()
		return
	}
	tr, buildErr := buildTransport(settings, transportId)
	if buildErr != nil {
		mu.Lock()
		engine = nil
		lastError = buildErr.Error()
		mu.Unlock()
		return
	}
	devName := settingString(settings, keyDeviceName)
	handle := &engineHandle{
		transportId: ctsync.TransportId(transportId),
		deviceName:  devName,
		engine: ctsync.NewEngine(
			storeAdapter{},
			tr,
			ctsync.ParseConflictPolicy(settingString(settings, keyConflictPolicy)),
			settingString(settings, keyDeviceId),
			devName,
			journalAppend,
		),
	}
	mu.Lock()
	engine = handle
	lastError = ""
	mu.Unlock()
}

// SyncNow runs one sync immediately. trigger names the cause (manual | timer | startup).
func SyncNow(ctx context.Context, trigger string) (Status, error) {
	reload()

	mu.Lock()
	eng := engine
	if eng == nil {
		mu.Unlock()
		return currentStatusLocked(), ErrNotConfigured
	}
	// Mark running before releasing the lock so the UI cannot miss it.
	mu.Unlock()

	res, err := eng.engine.Run(ctx, trigger)
	mu.Lock()
	lastRunAt = time.Now()
	if err != nil {
		lastRunError = err.Error()
	} else {
		lastRunError = ""
		lastResult = runSummary{Pulled: res.Pulled, Applied: res.Applied, Pushed: res.Pushed}
	}
	mu.Unlock()

	if len(res.Conflicts) > 0 {
		// Persist so the status panel and `conflicts --copy` see them.
		if recErr := syncconflict.Record(res.Conflicts, string(eng.transportId), eng.deviceName); recErr != nil {
			log.Printf("commontext sync: recording conflicts: %v", recErr)
		}
	}
	// Watermarks live in the database, not in settings.json, so no file event fires for them.
	// Re-broadcast the hydrated config or the open Common Text window keeps showing the pre-sync
	// pending dots until it is reopened.
	wconfig.BroadcastConfigUpdate()
	return currentStatusLocked(), err
}

// ErrNotConfigured means no transport is set up; the UI shows this as "local only", not as an error.
var ErrNotConfigured = errors.New("sync is not configured")

// SwitchTransport changes the active transport, running a full re-sync with an explicit baseline
// first.
//
// Order matters and is the whole safety property of this operation:
//  1. build the NEW transport from the pending settings (nothing written yet)
//  2. run one baseline sync against it
//  3. only then persist the settings
//
// If step 2 fails, the user's existing configuration is untouched — a failed switch must never
// leave them pointing at a half-configured transport with the old one already forgotten.
//
// `patch` carries the whole pending transport configuration (path / remote / url + token flags),
// not just the id, because the backend must build the new transport before saving.
func SwitchTransport(ctx context.Context, patch map[string]any, baselineRaw string) (Status, error) {
	// Build the target settings = current settings overlaid with the pending patch.
	current, err := currentSettings()
	if err != nil {
		return currentStatusLocked(), err
	}
	target := overlaySettings(current, patch)
	targetId := parseTransport(settingString(target, keyTransport))
	if targetId == "none" {
		// Switching to "off" needs no baseline: the target side is empty, so there is nothing to
		// reconcile into. Demanding one here would be pure noise.
		if saveErr := saveSettings(patch); saveErr != nil {
			return currentStatusLocked(), saveErr
		}
		reload()
		return currentStatusLocked(), nil
	}

	// Every other switch has data on both sides, and their rev numbers come from different
	// transports, so no comparison is meaningful. Refuse to guess.
	baseline := ctsync.ParseBaseline(baselineRaw)
	if baseline == ctsync.BaselineNone {
		return currentStatusLocked(), errors.New("switching transports needs an explicit baseline (local or remote)")
	}

	tr, buildErr := buildTransport(target, targetId)
	if buildErr != nil {
		return currentStatusLocked(), buildErr
	}

	handle := &engineHandle{
		transportId: ctsync.TransportId(targetId),
		deviceName:  settingString(target, keyDeviceName),
		engine: ctsync.NewEngine(
			storeAdapter{},
			tr,
			ctsync.ParseConflictPolicy(settingString(target, keyConflictPolicy)),
			settingString(target, keyDeviceId),
			settingString(target, keyDeviceName),
			journalAppend,
		),
	}

	res, runErr := handle.engine.RunWithBaseline(ctx, baseline, "transport-switch")
	mu.Lock()
	lastRunAt = time.Now()
	if runErr != nil {
		lastRunError = runErr.Error()
	} else {
		lastRunError = ""
		lastResult = runSummary{Pulled: res.Pulled, Applied: res.Applied, Pushed: res.Pushed}
	}
	mu.Unlock()
	if runErr != nil {
		// Nothing persisted: the user stays on the previous transport.
		return currentStatusLocked(), fmt.Errorf("baseline sync failed, transport not switched: %w", runErr)
	}

	if saveErr := saveSettings(patch); saveErr != nil {
		return currentStatusLocked(), saveErr
	}
	reload()
	return currentStatusLocked(), nil
}

// overlaySettings returns a copy of settings with the pending patch applied, so buildTransport can
// see the target configuration before it is persisted.
func overlaySettings(settings wconfig.SettingsType, patch map[string]any) wconfig.SettingsType {
	out := settings
	for key, raw := range patch {
		if value, ok := raw.(string); ok {
			switch key {
			case keyTransport:
				out.CommonTextSyncTransport = value
			case keyConflictPolicy:
				out.CommonTextSyncConflictPolicy = value
			case keyDeviceName:
				out.CommonTextSyncDeviceName = value
			case keyFolderPath:
				out.CommonTextSyncFolderPath = value
			case keyServerUrl:
				out.CommonTextSyncServerUrl = value
			case keyGitRemote:
				out.CommonTextSyncGitRemote = value
			}
			continue
		}
		if value, ok := raw.(bool); ok {
			v := value
			switch key {
			case keyServerInsecure:
				out.CommonTextSyncServerInsecure = &v
			}
		}
	}
	return out
}

// saveSettings merges the patch into settings.json. SetBaseConfigValue is a merge write, so keys not
// present in the patch keep their current value.
func saveSettings(patch map[string]any) error {
	meta := waveobj.MetaMapType(patch)
	if err := wconfig.SetBaseConfigValue(meta); err != nil {
		return fmt.Errorf("saving sync settings: %w", err)
	}
	return nil
}

// GetStatus returns the UI-facing snapshot.
func GetStatus() Status {
	reload()
	return currentStatusLocked()
}

// ── sync diagnostics (copy-for-agent data sources) ─────────────────────────────

// JournalTail returns up to n recent journal events (same order as ReadRecent), capped at 100
// so a self-diagnosis payload cannot grow without bound. n <= 0 falls back to 20, the same
// default as `wsh commontext-sync log`.
func JournalTail(n int) ([]syncjournal.Event, error) {
	if n <= 0 {
		n = 20
	}
	if n > 100 {
		n = 100
	}
	return syncjournal.ReadRecent(n)
}

// shortTimeStr renders an event timestamp the way the CLI does ("01-02 15:04:05", local time).
// Kept beside FormatEventLine so the two never drift.
func shortTimeStr(rfc3339 string) string {
	t, err := time.Parse(time.RFC3339Nano, rfc3339)
	if err != nil {
		return rfc3339
	}
	return t.Local().Format("01-02 15:04:05")
}

// FormatEventLine renders one journal event. It mirrors `wsh commontext-sync log`'s
// writeEventLine byte for byte (cmd/wsh/cmd/wshcmd-commontext-sync.go); any change there must be
// mirrored here — a self-diagnosis payload the user pastes must read like the CLI output they
// could have produced themselves. Pinned by golden tests (syncmanager_diag_test.go).
func FormatEventLine(ev syncjournal.Event) string {
	switch ev.Type {
	case syncjournal.EventRunStart:
		return fmt.Sprintf("%s  run start (%s)", shortTimeStr(ev.TS), ev.Trigger)
	case syncjournal.EventPull:
		return fmt.Sprintf("%s  pull   %d item(s) since rev %.0f", shortTimeStr(ev.TS), ev.Items, ev.Since)
	case syncjournal.EventPush:
		return fmt.Sprintf("%s  push   %d item(s) → rev %.0f", shortTimeStr(ev.TS), ev.Items, ev.Rev)
	case syncjournal.EventConflict:
		return fmt.Sprintf("%s  conflict  %s (%s) → %s", shortTimeStr(ev.TS), ev.Id,
			strings.Join(ev.Fields, ","), ev.Resolved)
	case syncjournal.EventError:
		return fmt.Sprintf("%s  ERROR  %s: %s", shortTimeStr(ev.TS), ev.Phase, ev.Msg)
	case syncjournal.EventRunEnd:
		status := "ok"
		if !ev.OK {
			status = "failed"
		}
		return fmt.Sprintf("%s  run end  %s (%dms)", shortTimeStr(ev.TS), status, ev.Ms)
	default:
		return fmt.Sprintf("%s  %s", shortTimeStr(ev.TS), ev.Type)
	}
}

// ProbeConfiguredServer runs the same diagnostics `wsh commontext-sync doctor` runs, using the
// same settings + secret the configured server transport would use. It is only meaningful for
// the server transport; the caller decides what "no server configured" renders as.
func ProbeConfiguredServer(ctx context.Context) (*syncclient.Probe, error) {
	settings, err := currentSettings()
	if err != nil {
		return nil, err
	}
	url := settingString(settings, keyServerUrl)
	if strings.TrimSpace(url) == "" {
		return nil, errors.New("server transport needs a URL")
	}
	token, err := serverToken()
	if err != nil {
		return nil, err
	}
	return syncclient.Diagnose(ctx, url, token, settingBool(settings, keyServerInsecure)), nil
}

// engineHandle bundles the engine with the metadata the status panel needs.
type engineHandle struct {
	transportId ctsync.TransportId
	deviceName  string
	engine      *ctsync.Engine
}

func currentStatusLocked() Status {
	mu.Lock()
	transportId := "none"
	configured := false
	problem := ""
	if engine != nil {
		transportId = string(engine.transportId)
		configured = true
	} else if lastError != "" {
		problem = lastError
	}
	status := Status{
		Transport:       transportId,
		Configured:      configured,
		Problem:         problem,
		LastError:       firstNonEmpty(lastRunError, lastError),
		LastPulled:      lastResult.Pulled,
		LastApplied:     lastResult.Applied,
		LastPushed:      lastResult.Pushed,
		IntervalSeconds: int(DefaultInterval / time.Second),
	}
	if !lastRunAt.IsZero() {
		status.LastRunAt = lastRunAt.UTC().Format(time.RFC3339)
	}
	mu.Unlock()

	// Conflict count comes from the persisted store so it survives a restart.
	if entries, err := syncconflict.List(); err == nil {
		status.Conflicts = len(entries)
	}
	// Pending count is a database read: the status must never claim "all uploaded" while items are
	// waiting, so a failure here reports 0 only after logging (the caller shows lastError anyway).
	if pending, err := commontextstore.PendingItems(context.Background()); err == nil {
		status.Pending = len(pending)
	} else {
		log.Printf("commontext sync: counting pending items: %v", err)
	}
	return status
}

// ── local store adapter ─────────────────────────────────────────────────────

// storeAdapter binds the engine's Store port to the real Common Text database.
//
// It goes through commontextstore directly (in-process), not through the config RPC: the app's
// backend may call this from the same process, and routing through RPC would add a serialization
// round trip plus a second validation layer for no benefit.
type storeAdapter struct{}

func (storeAdapter) Items(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	// Include tombstones: a delete must be pushed or the remote resurrects the item.
	items, err := commontextstore.List(ctx, commontextstore.ListOptions{IncludeDeleted: true})
	if err != nil {
		return nil, err
	}
	out := make([]syncproto.SnapshotItem, 0, len(items))
	for _, it := range items {
		out = append(out, snapshotFromItem(it))
	}
	return out, nil
}

func (storeAdapter) ApplyRemoteWithMode(ctx context.Context, incoming []syncproto.SnapshotItem, mode ctsync.RemoteApplyMode) (int, error) {
	if len(incoming) == 0 {
		return 0, nil
	}
	local, err := commontextstore.List(ctx, commontextstore.ListOptions{IncludeDeleted: true})
	if err != nil {
		return 0, err
	}
	byId := make(map[string]wconfig.CommonTextItemType, len(local))
	for _, it := range local {
		byId[it.Id] = it
	}
	merged := make([]wconfig.CommonTextItemType, 0, len(local)+len(incoming))
	merged = append(merged, local...)
	applied := 0
	for _, remote := range incoming {
		if existing, ok := byId[remote.Id]; ok {
			switch mode {
			case ctsync.RemoteFillMissing:
				// "This device wins": keep the local copy of anything already present.
				continue
			case ctsync.RemoteOverwrite:
				// "Remote wins": take it regardless of rev. Rev numbers come from different
				// transports and are not comparable across a switch.
			default:
				// Steady state: only a higher rev replaces the local copy, otherwise a pull would
				// clobber a local edit that has not been pushed yet.
				if remote.Rev <= existing.Rev {
					continue
				}
			}
			for idx := range merged {
				if merged[idx].Id == remote.Id {
					merged[idx] = itemFromSnapshot(remote)
					break
				}
			}
		} else {
			merged = append(merged, itemFromSnapshot(remote))
		}
		applied++
	}
	if applied == 0 {
		return 0, nil
	}
	return applied, commontextstore.SaveAll(ctx, merged)
}

func (storeAdapter) PendingItems(ctx context.Context) ([]syncproto.SnapshotItem, error) {
	items, err := commontextstore.PendingItems(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]syncproto.SnapshotItem, 0, len(items))
	for _, it := range items {
		out = append(out, snapshotFromItem(it))
	}
	return out, nil
}

func (storeAdapter) MarkSynced(ctx context.Context, results []syncproto.PushItemResult) error {
	return commontextstore.MarkSynced(ctx, results)
}

func (storeAdapter) MaxSyncedRev(ctx context.Context) (float64, error) {
	return commontextstore.MaxSyncedRev(ctx)
}

func (storeAdapter) ResetSyncWatermarks(ctx context.Context) error {
	return commontextstore.ResetSyncWatermarks(ctx)
}

func (storeAdapter) LocalRevision(ctx context.Context) (float64, error) {
	items, err := commontextstore.List(ctx, commontextstore.ListOptions{IncludeDeleted: true})
	if err != nil {
		return 0, err
	}
	var max float64
	for _, it := range items {
		if it.Rev > max {
			max = it.Rev
		}
	}
	return max, nil
}

func snapshotFromItem(it wconfig.CommonTextItemType) syncproto.SnapshotItem {
	out := syncproto.SnapshotItem{
		Id: it.Id, Title: it.Title, Text: it.Text, Shortcut: it.Shortcut, Tags: it.Tags,
		Pinned: it.Pinned, CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt,
		LastUsedAt: it.LastUsedAt, UsageCount: it.UsageCount, Emoji: it.Emoji,
		Rev: it.Rev, DeletedAt: it.DeletedAt,
	}
	if it.CreatedBy != nil {
		out.CreatedBy = &syncproto.Author{Kind: it.CreatedBy.Kind, Name: it.CreatedBy.Name}
	}
	if it.Origin != nil {
		out.Origin = &syncproto.Origin{
			DeviceId: it.Origin.DeviceId, DeviceName: it.Origin.DeviceName, Platform: it.Origin.Platform,
		}
	}
	return out
}

func itemFromSnapshot(it syncproto.SnapshotItem) wconfig.CommonTextItemType {
	out := wconfig.CommonTextItemType{
		Id: it.Id, Title: it.Title, Text: it.Text, Shortcut: it.Shortcut, Tags: it.Tags,
		Pinned: it.Pinned, CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt,
		LastUsedAt: it.LastUsedAt, UsageCount: it.UsageCount, Emoji: it.Emoji,
		Rev: it.Rev, DeletedAt: it.DeletedAt,
	}
	if it.CreatedBy != nil {
		out.CreatedBy = &wconfig.CommonTextCreatedByType{Kind: it.CreatedBy.Kind, Name: it.CreatedBy.Name}
	}
	if it.Origin != nil {
		out.Origin = &wconfig.CommonTextOriginType{
			DeviceId: it.Origin.DeviceId, DeviceName: it.Origin.DeviceName, Platform: it.Origin.Platform,
		}
	}
	return out
}

// ── settings helpers ────────────────────────────────────────────────────────

func currentSettings() (wconfig.SettingsType, error) {
	full := wconfig.GetWatcher().GetFullConfig()
	return full.Settings, nil
}

func settingString(settings wconfig.SettingsType, key string) string {
	switch key {
	case keyTransport:
		return settings.CommonTextSyncTransport
	case keyConflictPolicy:
		return settings.CommonTextSyncConflictPolicy
	case keyDeviceName:
		return settings.CommonTextSyncDeviceName
	case keyDeviceId:
		return settings.CommonTextSyncDeviceId
	case keyFolderPath:
		return settings.CommonTextSyncFolderPath
	case keyServerUrl:
		return settings.CommonTextSyncServerUrl
	case keyGitRemote:
		return settings.CommonTextSyncGitRemote
	}
	return ""
}

func settingBool(settings wconfig.SettingsType, key string) bool {
	switch key {
	case keyServerInsecure:
		return settings.CommonTextSyncServerInsecure != nil && *settings.CommonTextSyncServerInsecure
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func parseTransport(raw string) string {
	switch strings.TrimSpace(raw) {
	case "folder", "git", "server":
		return strings.TrimSpace(raw)
	default:
		return "none"
	}
}

// journalAppend writes through to the shared journal.
func journalAppend(ev syncjournal.Event) error {
	return syncjournal.Append(ev)
}

// buildTransport constructs the configured transport. A missing prerequisite is returned as an
// error so the status panel can show the reason instead of silently not syncing.
func buildTransport(settings wconfig.SettingsType, transportId string) (ctsync.Transport, error) {
	switch ctsync.TransportId(transportId) {
	case ctsync.TransportFolder:
		path := settingString(settings, keyFolderPath)
		if strings.TrimSpace(path) == "" {
			return nil, errors.New("folder transport needs a file path")
		}
		return ctsync.NewFolderTransport(expandHome(path))
	case ctsync.TransportServer:
		url := settingString(settings, keyServerUrl)
		if strings.TrimSpace(url) == "" {
			return nil, errors.New("server transport needs a URL")
		}
		token, err := serverToken()
		if err != nil {
			return nil, err
		}
		return ctsync.NewServerTransport(url, token, settingBool(settings, keyServerInsecure))
	case ctsync.TransportGit:
		remote := settingString(settings, keyGitRemote)
		if strings.TrimSpace(remote) == "" {
			return nil, errors.New("git transport needs a remote URL")
		}
		token, found, tokErr := secretstore.GetSecret("commontext_sync_git_token")
		if tokErr != nil || !found {
			token = ""
		}
		// The clone is owned by the app under the data dir: never a repository the user already has,
		// because reusing one would commit sync payloads into their working tree.
		repoDir, dirErr := gitRepoDir()
		if dirErr != nil {
			return nil, dirErr
		}
		return ctsync.NewGitTransport(remote, repoDir, token)
	default:
		return nil, errors.New("unknown transport")
	}
}

// expandHome resolves a leading ~ that users type into the settings field.
func expandHome(path string) string {
	if !strings.HasPrefix(path, "~") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	if strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		return filepath.Join(home, path[2:])
	}
	return path
}

// serverToken reads the server token from the secrets store (secrets.enc).
//
// A missing token is not an error here: the transport will fail at request time with a clear 401,
// and doctor reports it precisely. Returning an error now would hide the "reachable but needs a
// token" distinction the status panel can show.
func serverToken() (string, error) {
	value, found, err := secretstore.GetSecret("commontext_sync_server_token")
	if err != nil {
		return "", nil
	}
	if !found {
		return "", nil
	}
	return value, nil
}

// gitRepoDir is the local clone the git transport manages. It lives under the app data dir so the
// transport never touches a repository the user already has.
func gitRepoDir() (string, error) {
	dataDir := wavebase.GetWaveDataDir()
	if dataDir == "" {
		return "", errors.New("cannot locate the app data directory for the git sync clone")
	}
	return filepath.Join(dataDir, "sync", "git-repo"), nil
}
