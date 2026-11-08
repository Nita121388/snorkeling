// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package syncconflict persists unresolved conflicts and renders them for a human or an agent.
//
// Two problems it solves:
//
//  1. A conflict that only exists inside one HTTP response disappears when the app restarts, so
//     "did I lose an edit?" has no answer. Conflicts live in a file until resolved.
//  2. A conflict list that only says "3 items conflict" is useless for resolution. Each entry keeps
//     BOTH versions and can be rendered as a self-contained markdown block with an explicit task
//     statement, so pasting it into an AI needs no further explanation.
package syncconflict

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Entry is one unresolved conflict.
type Entry struct {
	Id     string   `json:"id"`
	Fields []string `json:"fields"`
	// Local is this machine's version, Remote is the one the server kept.
	Local  *syncproto.SnapshotItem `json:"local,omitempty"`
	Remote *syncproto.SnapshotItem `json:"remote,omitempty"`
	// Title is copied out of the versions so a list can render without dereferencing both sides.
	Title string `json:"title,omitempty"`
	// DetectedAt is when this machine first saw the conflict (RFC3339).
	DetectedAt string `json:"detectedAt"`
	// DeviceName / Transport describe where the remote copy came from, for the report header.
	DeviceName string `json:"deviceName,omitempty"`
	Transport  string `json:"transport,omitempty"`
	// ResolvedAt is set when the user resolved it; kept briefly so a repeated sync does not
	// immediately re-report the same item.
	ResolvedAt string `json:"resolvedAt,omitempty"`
}

var mu sync.Mutex
var dirOverride string

// SetDirForTesting points the store at a temp directory. Production code must not call this.
func SetDirForTesting(dir string) {
	mu.Lock()
	defer mu.Unlock()
	dirOverride = dir
}

func storeDir() string {
	if dirOverride != "" {
		return dirOverride
	}
	return filepath.Join(wavebase.GetWaveDataDir(), "sync")
}

func storePath() string {
	return filepath.Join(storeDir(), "conflicts.json")
}

func readAll() ([]Entry, error) {
	raw, err := os.ReadFile(storePath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var entries []Entry
	if err := json.Unmarshal(raw, &entries); err != nil {
		// A corrupt store must not block syncing. Losing the conflict list is recoverable;
		// refusing to sync because of it is not.
		return nil, nil
	}
	return entries, nil
}

func writeAll(entries []Entry) error {
	dir := storeDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("creating sync dir: %w", err)
	}
	raw, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	tmp := storePath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, storePath())
}

// Record upserts conflicts learned from a push response. Re-recording the same id keeps the
// original DetectedAt so the list order stays stable across syncs.
func Record(conflicts []syncproto.Conflict, transport, deviceName string) error {
	if len(conflicts) == 0 {
		return nil
	}
	mu.Lock()
	defer mu.Unlock()

	entries, err := readAll()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	byId := make(map[string]int, len(entries))
	for i := range entries {
		byId[entries[i].Id] = i
	}
	for _, c := range conflicts {
		entry := Entry{
			Id:         c.Id,
			Fields:     c.Fields,
			Local:      c.Local,
			Remote:     c.Remote,
			DetectedAt: now,
			DeviceName: deviceName,
			Transport:  transport,
		}
		if c.Local != nil && c.Local.Title != "" {
			entry.Title = c.Local.Title
		} else if c.Remote != nil && c.Remote.Title != "" {
			entry.Title = c.Remote.Title
		}
		if idx, ok := byId[c.Id]; ok {
			entry.DetectedAt = entries[idx].DetectedAt // keep the original detection time
			entries[idx] = entry
		} else {
			byId[c.Id] = len(entries)
			entries = append(entries, entry)
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].DetectedAt < entries[j].DetectedAt })
	return writeAll(entries)
}

// List returns unresolved conflicts, oldest first.
func List() ([]Entry, error) {
	mu.Lock()
	defer mu.Unlock()
	entries, err := readAll()
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.ResolvedAt == "" {
			out = append(out, e)
		}
	}
	return out, nil
}

// MarkResolved records that an item was resolved. The entry is kept (not deleted) so the next push
// does not immediately re-record the same conflict while the server copy is catching up.
func MarkResolved(id string) error {
	mu.Lock()
	defer mu.Unlock()
	entries, err := readAll()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	found := false
	for i := range entries {
		if entries[i].Id == id {
			entries[i].ResolvedAt = now
			found = true
		}
	}
	if !found {
		return fmt.Errorf("no conflict recorded for id %q", id)
	}
	return writeAll(entries)
}

// Prune drops entries resolved more than olderThan ago.
func Prune(olderThan time.Duration) error {
	mu.Lock()
	defer mu.Unlock()
	entries, err := readAll()
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-olderThan)
	kept := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.ResolvedAt != "" {
			ts, err := time.Parse(time.RFC3339, e.ResolvedAt)
			if err == nil && ts.Before(cutoff) {
				continue
			}
		}
		kept = append(kept, e)
	}
	if len(kept) == len(entries) {
		return nil
	}
	return writeAll(kept)
}

// writeRaw is a test hook for simulating a corrupt store file.
func writeRaw(content string) error {
	mu.Lock()
	defer mu.Unlock()
	if err := os.MkdirAll(storeDir(), 0700); err != nil {
		return err
	}
	return os.WriteFile(storePath(), []byte(content), 0600)
}
