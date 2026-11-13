// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package hero

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRosterDormantMarker covers design §5/§7: a hero whose last-active
// proxy (max journal mtime, hero.json createdAt) is older than 90 days
// gets a 💤 prefix in the roster; a fresh one does not.
func TestRosterDormantMarker(t *testing.T) {
	root := t.TempDir()
	if _, err := Create(Options{Root: root, Name: "fresh", Now: time.Now}); err != nil {
		t.Fatal(err)
	}
	// 120 days ago: both the createdAt and the journal mtime are old
	old := time.Now().Add(-120 * 24 * time.Hour)
	if _, err := Create(Options{Root: root, Name: "old", Now: func() time.Time { return old }}); err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(root, "old", ".hero", "MEMORY", "journal.md")
	if err := os.Chtimes(journal, old, old); err != nil {
		t.Fatal(err)
	}
	// rescan so the marker reflects the aged mtime
	if _, err := WriteRoster(root); err != nil {
		t.Fatal(err)
	}
	rosterPath, err := RosterPath(root)
	if err != nil {
		t.Fatal(err)
	}
	roster, err := os.ReadFile(rosterPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(roster), "\n")
	var freshLine, oldLine string
	for _, line := range lines {
		if strings.Contains(line, "| ./fresh") {
			freshLine = line
		}
		if strings.Contains(line, "| ./old") {
			oldLine = line
		}
	}
	if freshLine == "" || oldLine == "" {
		t.Fatalf("roster must list both heroes:\n%s", roster)
	}
	if strings.HasPrefix(freshLine, "💤") {
		t.Fatalf("a fresh hero must not be dormant: %q", freshLine)
	}
	if !strings.HasPrefix(oldLine, "💤") {
		t.Fatalf("a 90+ day hero must carry the 💤 prefix: %q", oldLine)
	}
	// the dormant marker must never collide with the id cell used elsewhere
	if strings.HasPrefix(oldLine, "💤 💤") {
		t.Fatalf("dormant marker must be applied once: %q", oldLine)
	}
}
