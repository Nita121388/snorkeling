// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/persona"
)

func resetPersonaRosterForTest() {
	personaRoster.mu.Lock()
	defer personaRoster.mu.Unlock()
	personaRoster.loadedAt = time.Time{}
	personaRoster.root = ""
	personaRoster.personas = nil
}

func writeTestPersona(t *testing.T, root string, id string, body string) {
	t.Helper()
	dir := filepath.Join(root, id, ".persona")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "persona.json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write persona.json: %v", err)
	}
}

func TestLoadPersonaRosterFillsAndTrims(t *testing.T) {
	root := t.TempDir()
	writeTestPersona(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","emoji":"🦊","role":"guard","createdAt":"2026-11-12T00:00:00Z","createdBy":{"kind":"agent"},"origin":{"platform":"darwin/arm64"}}`)
	writeTestPersona(t, root, "beta", `{"schemaVersion":1,"id":"beta","name":"Beta","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(persona.EnvRoot, root)
	resetPersonaRosterForTest()

	gotRoot, got := loadPersonaRoster()
	if gotRoot != root {
		t.Fatalf("root = %q, want %q", gotRoot, root)
	}
	if len(got) != 2 {
		t.Fatalf("persona count = %d, want 2", len(got))
	}
	if got[0].ID != "alpha" || got[0].Name != "Alpha" || got[0].Emoji != "🦊" || got[0].Role != "guard" {
		t.Fatalf("alpha summary = %+v", got[0])
	}
	if got[1].ID != "beta" || got[1].Name != "Beta" {
		t.Fatalf("beta summary = %+v", got[1])
	}
}

func TestLoadPersonaRosterDegradesWhenRootUnreadable(t *testing.T) {
	t.Setenv(persona.EnvRoot, filepath.Join(t.TempDir(), "does-not-exist"))
	resetPersonaRosterForTest()

	gotRoot, got := loadPersonaRoster()
	if gotRoot != "" {
		t.Fatalf("root = %q, want empty", gotRoot)
	}
	if got != nil {
		t.Fatalf("personas = %+v, want nil", got)
	}
	// A second load (cached failure path) must stay degraded, not panic.
	gotRoot, got = loadPersonaRoster()
	if gotRoot != "" || got != nil {
		t.Fatalf("cached failure changed: root=%q personas=%+v", gotRoot, got)
	}
}

func TestLoadPersonaRosterCachesWithinTTL(t *testing.T) {
	root := t.TempDir()
	writeTestPersona(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(persona.EnvRoot, root)
	resetPersonaRosterForTest()
	originalTTL := personaRosterTTL
	t.Cleanup(func() {
		personaRosterTTL = originalTTL
		resetPersonaRosterForTest()
	})

	_, first := loadPersonaRoster()
	if len(first) != 1 {
		t.Fatalf("first load count = %d, want 1", len(first))
	}

	// Within the TTL the roster is served from the cache even though the
	// directory changed on disk.
	writeTestPersona(t, root, "beta", `{"schemaVersion":1,"id":"beta","name":"Beta","createdAt":"2026-11-12T00:00:00Z"}`)
	_, cached := loadPersonaRoster()
	if len(cached) != 1 {
		t.Fatalf("cached load count = %d, want 1 (cache hit)", len(cached))
	}

	// Expire the cache by rewinding loadedAt: the next load re-reads the disk.
	personaRoster.mu.Lock()
	personaRoster.loadedAt = time.Now().Add(-originalTTL - time.Second)
	personaRoster.mu.Unlock()
	_, refreshed := loadPersonaRoster()
	if len(refreshed) != 2 {
		t.Fatalf("refreshed load count = %d, want 2 (cache expired)", len(refreshed))
	}
}
