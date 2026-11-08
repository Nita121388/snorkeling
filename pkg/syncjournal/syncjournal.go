// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package syncjournal records what syncing actually did, so "did my edit reach the other
// machine?" has an answer that does not require reading source code.
//
// This is a product feature, not a debug switch: `pkg/pslog` only writes when WAVETERM_PSLOG=1
// is set and is meant for tracing a pubsub chain. Sync history must be available to a normal
// user, so it always writes.
//
// Format is JSONL (one event per line) split by day:
//
//	<datadir>/sync/journal-20261107.jsonl
//
// JSONL because every reader (UI, CLI, an agent grepping, `jq`) can consume it without a parser,
// and a truncated final line only loses the last event instead of the whole file.
package syncjournal

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// EventType enumerates what a journal line can be. Kept as strings so the file stays readable
// and unknown types from a newer build do not break an older reader.
type EventType string

const (
	EventRunStart EventType = "run_start"
	EventPull     EventType = "pull"
	EventPush     EventType = "push"
	EventConflict EventType = "conflict"
	EventError    EventType = "error"
	EventRunEnd   EventType = "run_end"
)

// Event is one journal line. Fields are omitempty so each event type stays small and readable.
type Event struct {
	TS   string    `json:"ts"`
	Type EventType `json:"type"`
	// Trigger is why a run started: manual | timer | fsnotify | startup.
	Trigger string `json:"trigger,omitempty"`
	// Direction-less counters (pull/push share the shape so a UI table can show both).
	Items int     `json:"items,omitempty"`
	Since float64 `json:"since,omitempty"`
	Rev   float64 `json:"rev,omitempty"`
	Bytes int     `json:"bytes,omitempty"`
	// Conflict detail.
	Id       string   `json:"id,omitempty"`
	Fields   []string `json:"fields,omitempty"`
	Resolved string   `json:"resolved,omitempty"`
	// Error detail.
	Phase string `json:"phase,omitempty"`
	Msg   string `json:"msg,omitempty"`
	// Run end.
	OK bool  `json:"ok,omitempty"`
	Ms int64 `json:"ms,omitempty"`
}

// RetentionDays is how long journals are kept. Old files are pruned opportunistically on write
// rather than by a scheduled job: a sync that has not run for a month does not need pruning, and
// a timer would be a second thing to get wrong.
const RetentionDays = 30

var mu sync.Mutex

// dirOverride is for tests; empty means the real data dir.
var dirOverride string

// SetDirForTesting points the journal at a temp directory. Production code must not call this.
func SetDirForTesting(dir string) {
	mu.Lock()
	defer mu.Unlock()
	dirOverride = dir
}

func journalDir() string {
	if dirOverride != "" {
		return dirOverride
	}
	return filepath.Join(wavebase.GetWaveDataDir(), "sync")
}

func journalPath(t time.Time) string {
	return filepath.Join(journalDir(), fmt.Sprintf("journal-%s.jsonl", t.Format("20060102")))
}

// Append writes one event. Failures are returned rather than swallowed so a CLI can report them,
// but callers on the sync path should log and continue: losing a journal line must never abort a
// sync that is otherwise fine.
func Append(ev Event) error {
	if ev.TS == "" {
		ev.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	line, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("encoding journal event: %w", err)
	}

	mu.Lock()
	defer mu.Unlock()

	dir := journalDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("creating journal dir: %w", err)
	}
	f, err := os.OpenFile(journalPath(time.Now()), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("opening journal: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("writing journal: %w", err)
	}
	return nil
}

// ReadRecent returns up to limit most recent events, newest last.
//
// It walks files newest-first so a long history does not have to be fully parsed to answer
// "what happened in the last 20 syncs".
func ReadRecent(limit int) ([]Event, error) {
	if limit <= 0 {
		return nil, nil
	}
	mu.Lock()
	dir := journalDir()
	mu.Unlock()

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading journal dir: %w", err)
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "journal-") || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		files = append(files, e.Name())
	}
	// Filenames embed the date in sortable form, so lexical sort is chronological.
	sort.Sort(sort.Reverse(sort.StringSlice(files)))

	var collected []Event
	for _, name := range files {
		events, err := readFile(filepath.Join(dir, name))
		if err != nil {
			// A partially-written or removed file must not hide the rest of the history.
			continue
		}
		// Prepend this file's events (older than what we already have is impossible because we
		// walk newest-first, so the current file's events go before the collected ones).
		collected = append(events, collected...)
		if len(collected) >= limit {
			break
		}
	}
	if len(collected) > limit {
		collected = collected[len(collected)-limit:]
	}
	return collected, nil
}

func readFile(path string) ([]Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// Journal lines carry item ids and short messages; 1MB is far above any real line and keeps
	// a corrupted giant line from aborting the read.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []Event
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev Event
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			// Malformed line (e.g. process killed mid-write): skip it, keep the rest.
			continue
		}
		events = append(events, ev)
	}
	return events, scanner.Err()
}

// Prune removes journal files older than RetentionDays. Called opportunistically after a run.
func Prune(now time.Time) error {
	mu.Lock()
	dir := journalDir()
	mu.Unlock()

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cutoff := now.AddDate(0, 0, -RetentionDays)
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, "journal-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		datePart := strings.TrimSuffix(strings.TrimPrefix(name, "journal-"), ".jsonl")
		day, err := time.ParseInLocation("20060102", datePart, time.Local)
		if err != nil {
			continue
		}
		if day.Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return nil
}
