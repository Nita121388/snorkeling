// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/hero"
)

func writeHeroJSON(t *testing.T, root string, id string, body string) {
	t.Helper()
	dir := filepath.Join(root, id, ".hero")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "hero.json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write hero.json: %v", err)
	}
}

func TestResolveHeroForSummaryExplicitPropWins(t *testing.T) {
	root := t.TempDir()
	writeHeroJSON(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","emoji":"🦊","createdAt":"2026-11-12T00:00:00Z"}`)
	writeHeroJSON(t, root, "beta", `{"schemaVersion":1,"id":"beta","name":"Beta","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)

	// The cwd lives under beta's home base, but the explicit props.hero is
	// alpha: the explicit value must win, mirroring deriveHeroProps.
	summary := &aisessions.SessionSummary{
		Key:         "pi:local:local:pi::s1",
		ID:          "s1",
		Source:      "pi",
		ProjectPath: filepath.Join(root, "beta", "work"),
		Props:       map[string]aisessions.PropertyCell{"hero": {Value: "alpha", Type: "text", Source: "user"}},
	}
	got := ResolveHeroForSummary(summary)
	if got.ID != "alpha" || got.Name != "Alpha" || got.Emoji != "🦊" {
		t.Fatalf("got = %+v, want alpha identity", got)
	}
}

func TestResolveHeroForSummaryDerivesFromProjectPath(t *testing.T) {
	root := t.TempDir()
	writeHeroJSON(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","emoji":"🦊","createdAt":"2026-11-12T00:00:00Z"}`)
	writeHeroJSON(t, root, "backup", `{"schemaVersion":1,"id":"backup","name":"Backup","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)

	cases := []struct {
		name        string
		projectPath string
		wantID      string
	}{
		{"home base", filepath.Join(root, "alpha"), "alpha"},
		{"nested under home base", filepath.Join(root, "alpha", "work", "x.md"), "alpha"},
		{"segment boundary", filepath.Join(root, "backup-guard"), ""},
		{"unrelated project", "/somewhere/else", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			summary := &aisessions.SessionSummary{
				Key:         "pi:local:local:pi::s1",
				ID:          "s1",
				Source:      "pi",
				ProjectPath: tc.projectPath,
			}
			got := ResolveHeroForSummary(summary)
			if got.ID != tc.wantID {
				t.Fatalf("ResolveHeroForSummary(projectPath=%q).ID = %q, want %q", tc.projectPath, got.ID, tc.wantID)
			}
		})
	}
}

func TestResolveHeroForSummaryNameFallbackAndEmojiTrim(t *testing.T) {
	root := t.TempDir()
	writeHeroJSON(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"","emoji":"  🦊  ","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)

	summary := &aisessions.SessionSummary{
		Key:         "pi:local:local:pi::s1",
		ID:          "s1",
		Source:      "pi",
		ProjectPath: filepath.Join(root, "alpha"),
	}
	got := ResolveHeroForSummary(summary)
	if got.ID != "alpha" {
		t.Fatalf("ID = %q, want alpha", got.ID)
	}
	if got.Name != "alpha" {
		t.Fatalf("Name = %q, want id fallback (plain name, no emoji prefix)", got.Name)
	}
	if got.Emoji != "🦊" {
		t.Fatalf("Emoji = %q, want trimmed emoji", got.Emoji)
	}
}

func TestResolveHeroForSummaryDegradesWithoutPanic(t *testing.T) {
	// Unreadable root: zero value, no panic, no error to the caller.
	t.Setenv(hero.EnvRoot, filepath.Join(t.TempDir(), "does-not-exist"))
	got := ResolveHeroForSummary(&aisessions.SessionSummary{
		Key:         "pi:local:local:pi::s1",
		ID:          "s1",
		Source:      "pi",
		ProjectPath: "/anywhere",
	})
	if got.ID != "" || got.Name != "" || got.Emoji != "" {
		t.Fatalf("got = %+v, want zero hero", got)
	}

	// Empty roster (root exists but holds no heroes).
	emptyRoot := t.TempDir()
	t.Setenv(hero.EnvRoot, emptyRoot)
	got = ResolveHeroForSummary(&aisessions.SessionSummary{
		Key:         "pi:local:local:pi::s1",
		ID:          "s1",
		Source:      "pi",
		ProjectPath: filepath.Join(emptyRoot, "alpha"),
	})
	if got.ID != "" {
		t.Fatalf("got = %+v, want zero hero on empty roster", got)
	}

	// Unknown explicit hero id: zero value, not a lookup error.
	emptyRoot2 := t.TempDir()
	writeHeroJSON(t, emptyRoot2, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, emptyRoot2)
	got = ResolveHeroForSummary(&aisessions.SessionSummary{
		Key:         "pi:local:local:pi::s1",
		ID:          "s1",
		Source:      "pi",
		ProjectPath: "/anywhere",
		Props:       map[string]aisessions.PropertyCell{"hero": {Value: "ghost", Type: "text", Source: "user"}},
	})
	if got.ID != "" {
		t.Fatalf("got = %+v, want zero hero for unknown explicit id", got)
	}

	// Nil summary must not panic either.
	got = ResolveHeroForSummary(nil)
	if got.ID != "" {
		t.Fatalf("got = %+v, want zero hero for nil summary", got)
	}
}
