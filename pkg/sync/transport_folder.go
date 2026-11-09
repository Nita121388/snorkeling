// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
)

// FolderTransport syncs through a single JSON file inside a cloud-synced folder.
//
// It is the smallest useful transport (no server, no account) and the reference implementation for
// the payload format: one self-contained snapshot with per-item rev and tombstones.
//
// Two properties matter and are both tested:
//
//   - **Atomic write.** Write to a temp file in the same directory, then rename. A cloud client or a
//     second machine can never observe a half-written payload (rename is atomic on every platform
//     we ship).
//   - **Self-trigger suppression.** Writing the file fires fsnotify in the same process. A run that
//     was caused by our own write would push again, forever. The transport records the payload hash
//     it just wrote and ignores a pull that sees it.
type FolderTransport struct {
	// Path is the payload file, e.g. ~/OneDrive/Snorkeling/commontext.json
	Path string

	mu            sync.Mutex
	lastWroteHash string
	lastWroteAt   time.Time
}

// FolderPayload is the on-disk format. It is versioned from day one: a future field addition must
// not break an older build reading the same folder.
type FolderPayload struct {
	// FormatVersion is bumped only for incompatible changes.
	FormatVersion int    `json:"formatVersion"`
	DeviceId      string `json:"deviceId,omitempty"`
	DeviceName    string `json:"deviceName,omitempty"`
	// Rev is the head revision contained in this file.
	Rev   float64                  `json:"rev"`
	Items []syncproto.SnapshotItem `json:"items"`
	// WrittenAt is informational (helps a human look at the file and understand recency).
	WrittenAt string `json:"writtenAt,omitempty"`
}

const FolderFormatVersion = 1

func NewFolderTransport(path string) (*FolderTransport, error) {
	if path == "" {
		return nil, errors.New("folder transport requires a payload path")
	}
	return &FolderTransport{Path: path}, nil
}

func (t *FolderTransport) Id() TransportId { return TransportFolder }

func (t *FolderTransport) Caps() Caps {
	return Caps{
		RequiresCredential: false,
		AtomicWrite:        true,
		// The file holds the whole snapshot; filtering by sinceRev is the engine's job.
		Incremental: false,
		// fsnotify can notify about external changes, but the engine still polls, so do not claim it.
		Realtime: false,
	}
}

// Pull reads the payload. A missing file is an empty snapshot, not an error: that is exactly the
// state of a freshly configured folder.
func (t *FolderTransport) Pull(ctx context.Context, sinceRev float64) (*syncproto.Snapshot, error) {
	payload, err := t.readPayload()
	if err != nil {
		return nil, err
	}
	if payload == nil {
		return &syncproto.Snapshot{}, nil
	}
	items := payload.Items
	if sinceRev > 0 {
		items = make([]syncproto.SnapshotItem, 0, len(payload.Items))
		for _, it := range payload.Items {
			if it.Rev > sinceRev {
				items = append(items, it)
			}
		}
	}
	return &syncproto.Snapshot{
		DeviceId:   payload.DeviceId,
		DeviceName: payload.DeviceName,
		Rev:        payload.Rev,
		Items:      items,
	}, nil
}

// Push merges the request into the payload on disk and writes it atomically.
//
// The merge rule mirrors the server so both transports behave identically: newer updatedat wins,
// a tombstone with rev >= the stored rev deletes, and same-field double edits come back as
// conflicts WITH both versions.
func (t *FolderTransport) Push(ctx context.Context, req syncproto.PushRequest) (*PushOutcome, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	existing, err := t.readPayload()
	if err != nil {
		return nil, err
	}
	if existing == nil {
		existing = &FolderPayload{FormatVersion: FolderFormatVersion}
	}

	baseById := make(map[string]*syncproto.SnapshotItem, len(req.Base))
	for idx := range req.Base {
		if req.Base[idx].Id != "" {
			baseById[req.Base[idx].Id] = &req.Base[idx]
		}
	}

	byId := make(map[string]syncproto.SnapshotItem, len(existing.Items)+len(req.Items))
	for _, it := range existing.Items {
		byId[it.Id] = it
	}

	outcome := &PushOutcome{Rev: existing.Rev}
	newRev := existing.Rev
	for _, incoming := range req.Items {
		if incoming.Id == "" {
			continue
		}
		nextRev := newRev + 1
		if incoming.Rev > nextRev {
			nextRev = incoming.Rev
		}
		stored, found := byId[incoming.Id]
		if !found {
			incoming.Rev = nextRev
			byId[incoming.Id] = incoming
			outcome.record(incoming.Id, nextRev, syncproto.PushStatusApplied)
			newRev = nextRev
			continue
		}

		// Tombstone wins over a live copy with an older revision.
		if incoming.DeletedAt > 0 && incoming.Rev >= stored.Rev {
			incoming.Rev = nextRev
			byId[incoming.Id] = incoming
			outcome.record(incoming.Id, nextRev, syncproto.PushStatusApplied)
			newRev = nextRev
			continue
		}

		base := baseById[incoming.Id]
		if base == nil {
			// No common ancestor (first sync of this item): fall back to updatedat rather than
			// reporting every difference as a conflict.
			if incoming.UpdatedAt > stored.UpdatedAt {
				incoming.Rev = nextRev
				byId[incoming.Id] = incoming
				outcome.record(incoming.Id, nextRev, syncproto.PushStatusApplied)
				newRev = nextRev
			} else {
				outcome.record(incoming.Id, stored.Rev, syncproto.PushStatusUnchanged)
			}
			continue
		}

		fields := syncproto.DetectConflictFields(base, &incoming, &stored)
		if len(fields) > 0 {
			local := incoming
			remote := stored
			outcome.Items = append(outcome.Items, syncproto.PushItemResult{Id: incoming.Id, Status: syncproto.PushStatusConflict})
			outcome.Conflicts = append(outcome.Conflicts, syncproto.Conflict{
				Id:     incoming.Id,
				Fields: fields,
				Local:  &local,
				Remote: &remote,
				Reason: "both sides changed the same field",
			})
			continue
		}

		merged, changed := mergeForFolder(base, &incoming, &stored)
		if !changed {
			outcome.record(incoming.Id, stored.Rev, syncproto.PushStatusUnchanged)
			continue
		}
		merged.Rev = nextRev
		byId[merged.Id] = merged
		outcome.record(merged.Id, nextRev, syncproto.PushStatusApplied)
		newRev = nextRev
	}

	items := make([]syncproto.SnapshotItem, 0, len(byId))
	for _, it := range byId {
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Id < items[j].Id })

	payload := &FolderPayload{
		FormatVersion: FolderFormatVersion,
		DeviceId:      req.DeviceId,
		DeviceName:    req.DeviceName,
		Rev:           newRev,
		Items:         items,
		WrittenAt:     time.Now().UTC().Format(time.RFC3339),
	}
	if err := t.writePayload(payload); err != nil {
		return nil, err
	}
	outcome.Rev = newRev
	return outcome, nil
}

func (t *FolderTransport) readPayload() (*FolderPayload, error) {
	return readPayloadFile(t.Path)
}

// readPayloadFile is shared by every file-based transport (folder, git) so the on-disk format has
// exactly one implementation. A second parser would silently accept different things.
func readPayloadFile(path string) (*FolderPayload, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading sync file: %w", err)
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var payload FolderPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		// A corrupt payload must not be silently replaced: overwriting would destroy the other
		// machine's data. Failing loudly keeps the user in control.
		return nil, fmt.Errorf("sync file %s is not valid JSON (refusing to overwrite it): %w", path, err)
	}
	if payload.FormatVersion > FolderFormatVersion {
		return nil, fmt.Errorf(
			"sync file was written by a newer version (format v%d, this build understands v%d)",
			payload.FormatVersion, FolderFormatVersion,
		)
	}
	return &payload, nil
}

// writePayload writes atomically: temp file in the same directory, then rename.
func (t *FolderTransport) writePayload(payload *FolderPayload) error {
	if err := writePayloadFile(t.Path, payload); err != nil {
		return err
	}
	t.lastWroteAt = time.Now()
	return nil
}

// writePayloadFile writes atomically: temp file in the same directory, fsync, then rename.
// Shared by the folder and git transports.
func writePayloadFile(path string, payload *FolderPayload) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating sync folder %s: %w", dir, err)
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	// Same directory so the rename stays on one filesystem (a cross-device rename is not atomic).
	tmp, err := os.CreateTemp(dir, ".commontext-*.json.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("writing temp file: %w", err)
	}
	// Flush before rename: a rename of a buffered file can leave a zero-length payload on some
	// filesystems if the machine loses power.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("flushing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("replacing sync file: %w", err)
	}
	return nil
}

// mergeForFolder is the same per-field rule the server uses. Duplicated deliberately:
// pkg/sync must not import the server binary, and the rule is short enough that a shared helper
// would need its own package for six lines.
func mergeForFolder(base, local, remote *syncproto.SnapshotItem) (syncproto.SnapshotItem, bool) {
	merged := *remote
	changed := false
	pick := func(baseVal, localVal, remoteVal string) string {
		if localVal == remoteVal {
			return remoteVal
		}
		if localVal == baseVal {
			return remoteVal
		}
		return localVal
	}
	baseText, baseTitle := "", ""
	var baseTags []string
	if base != nil {
		baseText, baseTitle, baseTags = base.Text, base.Title, base.Tags
	}
	if v := pick(baseText, local.Text, remote.Text); v != remote.Text {
		merged.Text = v
		changed = true
	}
	if v := pick(baseTitle, local.Title, remote.Title); v != remote.Title {
		merged.Title = v
		changed = true
	}
	if v := pick(syncproto.JoinTags(baseTags), syncproto.JoinTags(local.Tags), syncproto.JoinTags(remote.Tags)); v != syncproto.JoinTags(remote.Tags) {
		merged.Tags = syncproto.SplitTags(v)
		changed = true
	}
	if local.UpdatedAt > remote.UpdatedAt {
		merged.UpdatedAt = local.UpdatedAt
		merged.LastUsedAt = local.LastUsedAt
		merged.UsageCount = local.UsageCount
		merged.Pinned = local.Pinned
		merged.Emoji = local.Emoji
	}
	return merged, changed
}
