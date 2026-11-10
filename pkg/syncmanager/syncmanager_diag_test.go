// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package syncmanager

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncjournal"
)

// FormatEventLine must read exactly like `wsh commontext-sync log`; these goldens pin the format
// so a self-diagnosis payload pasted to an agent matches what the user could have produced in a
// terminal. If the CLI's writeEventLine changes, these fail and both sides get updated together.
func TestFormatEventLineGolden(t *testing.T) {
	cases := []struct {
		event syncjournal.Event
		want  string
	}{
		{
			event: syncjournal.Event{TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventRunStart, Trigger: "manual"},
			want:  "run start (manual)",
		},
		{
			event: syncjournal.Event{TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventPull, Items: 3, Since: 7},
			want:  "pull   3 item(s) since rev 7",
		},
		{
			event: syncjournal.Event{TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventPush, Items: 2, Rev: 9},
			want:  "push   2 item(s) → rev 9",
		},
		{
			event: syncjournal.Event{
				TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventConflict,
				Id: "ct1", Fields: []string{"text", "tags"}, Resolved: "kept local",
			},
			want: "conflict  ct1 (text,tags) → kept local",
		},
		{
			event: syncjournal.Event{
				TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventError,
				Phase: "pull", Msg: "connection refused",
			},
			want: "ERROR  pull: connection refused",
		},
		{
			event: syncjournal.Event{TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventRunEnd, OK: true, Ms: 420},
			want:  "run end  ok (420ms)",
		},
		{
			event: syncjournal.Event{TS: "2026-11-10T10:00:00Z", Type: syncjournal.EventRunEnd, OK: false, Ms: 80},
			want:  "run end  failed (80ms)",
		},
	}
	// The timestamp prefix depends on the local zone; assert the fixed suffix instead of pinning TZ.
	for _, tc := range cases {
		line := FormatEventLine(tc.event)
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 {
			t.Fatalf("line must be `time  detail`, got %q", line)
		}
		if parts[1] != tc.want {
			t.Fatalf("event %s detail drift:\n got: %q\nwant: %q", tc.event.Type, parts[1], tc.want)
		}
	}
}

func TestJournalTailClamps(t *testing.T) {
	dir := t.TempDir()
	syncjournal.SetDirForTesting(dir)
	t.Cleanup(func() { syncjournal.SetDirForTesting("") })

	// Seed more events than the cap so the clamp is observable.
	for i := 0; i < 120; i++ {
		if err := syncjournal.Append(syncjournal.Event{Type: syncjournal.EventRunStart, Trigger: "timer"}); err != nil {
			t.Fatalf("append: %v", err)
		}
	}

	events, err := JournalTail(0)
	if err != nil {
		t.Fatalf("JournalTail(0): %v", err)
	}
	if len(events) != 20 {
		t.Fatalf("n<=0 must default to 20, got %d", len(events))
	}

	events, err = JournalTail(5000)
	if err != nil {
		t.Fatalf("JournalTail(5000): %v", err)
	}
	if len(events) != 100 {
		t.Fatalf("n>100 must clamp to 100, got %d", len(events))
	}

	events, err = JournalTail(7)
	if err != nil {
		t.Fatalf("JournalTail(7): %v", err)
	}
	if len(events) != 7 {
		t.Fatalf("n=7 must return 7, got %d", len(events))
	}
}
