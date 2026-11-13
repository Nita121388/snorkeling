// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/hero"
)

func resetHeroRosterForTest() {
	heroRoster.mu.Lock()
	defer heroRoster.mu.Unlock()
	heroRoster.loadedAt = time.Time{}
	heroRoster.root = ""
	heroRoster.heroes = nil
}

func writeTestHero(t *testing.T, root string, id string, body string) {
	t.Helper()
	dir := filepath.Join(root, id, ".hero")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "hero.json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write hero.json: %v", err)
	}
}

func TestLoadHeroRosterFillsAndTrims(t *testing.T) {
	root := t.TempDir()
	writeTestHero(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","emoji":"🦊","role":"guard","createdAt":"2026-11-12T00:00:00Z","createdBy":{"kind":"agent"},"origin":{"platform":"darwin/arm64"}}`)
	writeTestHero(t, root, "beta", `{"schemaVersion":1,"id":"beta","name":"Beta","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)
	resetHeroRosterForTest()

	gotRoot, got := loadHeroRoster()
	if gotRoot != root {
		t.Fatalf("root = %q, want %q", gotRoot, root)
	}
	if len(got) != 2 {
		t.Fatalf("hero count = %d, want 2", len(got))
	}
	if got[0].ID != "alpha" || got[0].Name != "Alpha" || got[0].Emoji != "🦊" || got[0].Role != "guard" {
		t.Fatalf("alpha summary = %+v", got[0])
	}
	if got[1].ID != "beta" || got[1].Name != "Beta" {
		t.Fatalf("beta summary = %+v", got[1])
	}
}

func TestLoadHeroRosterDegradesWhenRootUnreadable(t *testing.T) {
	t.Setenv(hero.EnvRoot, filepath.Join(t.TempDir(), "does-not-exist"))
	resetHeroRosterForTest()

	gotRoot, got := loadHeroRoster()
	if gotRoot != "" {
		t.Fatalf("root = %q, want empty", gotRoot)
	}
	if got != nil {
		t.Fatalf("heroes = %+v, want nil", got)
	}
	// A second load (cached failure path) must stay degraded, not panic.
	gotRoot, got = loadHeroRoster()
	if gotRoot != "" || got != nil {
		t.Fatalf("cached failure changed: root=%q heroes=%+v", gotRoot, got)
	}
}

func TestLoadHeroRosterCachesWithinTTL(t *testing.T) {
	root := t.TempDir()
	writeTestHero(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)
	resetHeroRosterForTest()
	originalTTL := heroRosterTTL
	t.Cleanup(func() {
		heroRosterTTL = originalTTL
		resetHeroRosterForTest()
	})

	_, first := loadHeroRoster()
	if len(first) != 1 {
		t.Fatalf("first load count = %d, want 1", len(first))
	}

	// Within the TTL the roster is served from the cache even though the
	// directory changed on disk.
	writeTestHero(t, root, "beta", `{"schemaVersion":1,"id":"beta","name":"Beta","createdAt":"2026-11-12T00:00:00Z"}`)
	_, cached := loadHeroRoster()
	if len(cached) != 1 {
		t.Fatalf("cached load count = %d, want 1 (cache hit)", len(cached))
	}

	// Expire the cache by rewinding loadedAt: the next load re-reads the disk.
	heroRoster.mu.Lock()
	heroRoster.loadedAt = time.Now().Add(-originalTTL - time.Second)
	heroRoster.mu.Unlock()
	_, refreshed := loadHeroRoster()
	if len(refreshed) != 2 {
		t.Fatalf("refreshed load count = %d, want 2 (cache expired)", len(refreshed))
	}
}

func TestHeroRosterRPCReturnsRootAndProviderModel(t *testing.T) {
	root := t.TempDir()
	writeTestHero(t, root, "alpha", `{"schemaVersion":1,"id":"alpha","name":"Alpha","provider":"pi","model":"gpt-5.2","createdAt":"2026-11-12T00:00:00Z"}`)
	t.Setenv(hero.EnvRoot, root)
	resetHeroRosterForTest()

	svc := &AISessionsService{}
	resp, err := svc.HeroRoster(context.Background(), &AISessionsHeroRosterRequest{})
	if err != nil {
		t.Fatalf("HeroRoster: %v", err)
	}
	if resp.Root != root {
		t.Fatalf("root = %q, want %q", resp.Root, root)
	}
	if len(resp.Heroes) != 1 {
		t.Fatalf("heroes = %d, want 1", len(resp.Heroes))
	}
	p := resp.Heroes[0]
	if p.ID != "alpha" || p.Provider != "pi" || p.Model != "gpt-5.2" {
		t.Fatalf("summary = %+v, want provider/model passthrough", p)
	}
}

func TestHeroRosterRPCDegradesToEmpty(t *testing.T) {
	t.Setenv(hero.EnvRoot, filepath.Join(t.TempDir(), "nope"))
	resetHeroRosterForTest()

	svc := &AISessionsService{}
	resp, err := svc.HeroRoster(context.Background(), &AISessionsHeroRosterRequest{})
	if err != nil {
		t.Fatalf("HeroRoster on unreadable root: %v", err)
	}
	if resp.Root != "" || len(resp.Heroes) != 0 {
		t.Fatalf("resp = %+v, want empty degradation", resp)
	}
}

func TestDeriveHeroProps(t *testing.T) {
	root := filepath.ToSlash(t.TempDir())
	heroes := []HeroSummary{
		{ID: "backup", Name: "Backup"},
		{ID: "writer", Name: "Writer"},
	}
	mkRow := func(projectPath string, existing map[string]aisessions.PropertyCell) aisessions.SessionSummary {
		return aisessions.SessionSummary{ProjectPath: projectPath, Props: existing}
	}

	rows := []aisessions.SessionSummary{
		mkRow(root+"/backup", nil),               // home base itself
		mkRow(root+"/backup/work/notes.md", nil), // one level under it
		mkRow(root+"/backup-guard", nil),         // segment boundary: must NOT match backup
		mkRow(root+"/writer", nil),               // second hero
		mkRow("E:/some/real/project", nil),       // unrelated project
		mkRow(root+"/backup", map[string]aisessions.PropertyCell{ // explicit value wins
			"hero": {Value: "hand-written", Source: "user"},
		}),
	}
	deriveHeroProps(rows, root, heroes)

	if got := rows[0].Props["hero"]; got.Value != "backup" || got.Source != HeroDerivedSource {
		t.Fatalf("rows[0] = %+v, want derived backup", got)
	}
	if got := rows[1].Props["hero"]; got.Value != "backup" {
		t.Fatalf("rows[1] = %+v, want derived backup for nested path", got)
	}
	if _, ok := rows[2].Props["hero"]; ok {
		t.Fatalf("rows[2] segment boundary violated: %+v", rows[2].Props["hero"])
	}
	if got := rows[3].Props["hero"]; got.Value != "writer" {
		t.Fatalf("rows[3] = %+v, want derived writer", got)
	}
	if len(rows[4].Props) != 0 {
		t.Fatalf("rows[4] should stay untouched: %+v", rows[4].Props)
	}
	if got := rows[5].Props["hero"]; got.Value != "hand-written" {
		t.Fatalf("rows[5] explicit value overwritten: %+v", got)
	}
}

func TestDeriveHeroPropsNormalizesSeparatorsAndCase(t *testing.T) {
	heroes := []HeroSummary{{ID: "backup", Name: "Backup"}}
	rows := []aisessions.SessionSummary{
		{ProjectPath: `E:\Heroes\Backup\BACKUP\work`},
	}
	// Root declared with backslashes, mixed case AND a parent hop: the match
	// must still be segment-exact against the cleaned <root>/<id>.
	deriveHeroProps(rows, `e:/heroes/backup/../backup`, heroes)
	if got := rows[0].Props["hero"]; got.Value != "backup" {
		t.Fatalf("rows[0] = %+v, want derived backup across separators/case", got)
	}
}

func TestDeriveHeroPropsNoRosterIsNoop(t *testing.T) {
	rows := []aisessions.SessionSummary{{ProjectPath: "E:/anywhere"}}
	deriveHeroProps(rows, "", []HeroSummary{{ID: "backup"}})
	deriveHeroProps(rows, "E:/root", nil)
	if len(rows[0].Props) != 0 {
		t.Fatalf("no roster must be a no-op: %+v", rows[0].Props)
	}
}
