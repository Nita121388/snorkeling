// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"testing"
)

// sqliteEmojiTableNames returns the table set of the index database.
func sqliteEmojiTableNames(idx *SQLiteIndex, t *testing.T) map[string]bool {
	t.Helper()
	var names []string
	if err := idx.db.Select(&names, `SELECT name FROM sqlite_master WHERE type='table'`); err != nil {
		t.Fatal(err)
	}
	set := make(map[string]bool, len(names))
	for _, name := range names {
		set[name] = true
	}
	return set
}

// TestSQLiteIndexEmojiTablesCreatedIdempotently verifies the two emoji tables
// are created for old databases (only the legacy tables exist) and that
// reopening never fails: CREATE TABLE IF NOT EXISTS runs on every startup.
func TestSQLiteIndexEmojiTablesCreatedIdempotently(t *testing.T) {
	dir := t.TempDir()
	sqlitePath := filepath.Join(dir, "index.sqlite")
	metaPath := filepath.Join(dir, "meta.json")

	// Simulate an old database: current schema except the two new emoji tables.
	idx, err := OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.db.Exec(`DROP TABLE ai_emoji_prefs; DROP TABLE ai_emoji_recommendations;`); err != nil {
		t.Fatal(err)
	}
	names := sqliteEmojiTableNames(idx, t)
	if names["ai_emoji_prefs"] || names["ai_emoji_recommendations"] {
		t.Fatal("test setup failed: emoji tables still present after drop")
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}

	// Old library starts up: both tables must be created, no error.
	idx, err = OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatalf("open old database: %v", err)
	}
	names = sqliteEmojiTableNames(idx, t)
	if !names["ai_emoji_prefs"] {
		t.Fatal("ai_emoji_prefs missing after old-database startup")
	}
	if !names["ai_emoji_recommendations"] {
		t.Fatal("ai_emoji_recommendations missing after old-database startup")
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}

	// Repeated startup is a no-op and must not error.
	idx, err = OpenSQLiteIndex(sqlitePath, metaPath)
	if err != nil {
		t.Fatalf("reopen database: %v", err)
	}
	defer idx.Close()
	names = sqliteEmojiTableNames(idx, t)
	if !names["ai_emoji_prefs"] || !names["ai_emoji_recommendations"] {
		t.Fatal("emoji tables missing after repeated startup")
	}
}

func TestIsValidEmojiPrefDim(t *testing.T) {
	for _, dim := range []string{EmojiPrefDimProject, EmojiPrefDimPersona, EmojiPrefDimGlobal} {
		if !IsValidEmojiPrefDim(dim) {
			t.Errorf("IsValidEmojiPrefDim(%q): want true", dim)
		}
	}
	for _, dim := range []string{"", "provider", "session", "Project", "global "} {
		if IsValidEmojiPrefDim(dim) {
			t.Errorf("IsValidEmojiPrefDim(%q): want false", dim)
		}
	}
}

func TestNormalizeEmojiPrefDimKey(t *testing.T) {
	// project: clean + forward slashes (Windows paths collapse to one key);
	// lowercase only on Windows.
	got := NormalizeEmojiPrefDimKey(EmojiPrefDimProject, `C:\Work\Repo\`)
	want := "C:/Work/Repo"
	if runtime.GOOS == "windows" {
		want = "c:/work/repo"
	}
	if got != want {
		t.Errorf("project dim key = %q, want %q", got, want)
	}
	if got := NormalizeEmojiPrefDimKey(EmojiPrefDimProject, "/tmp/a/../b"); got != "/tmp/b" {
		t.Errorf("project dim key not cleaned: %q", got)
	}
	// global: always the single "" bucket.
	if got := NormalizeEmojiPrefDimKey(EmojiPrefDimGlobal, "anything"); got != "" {
		t.Errorf("global dim key = %q, want \"\"", got)
	}
	// persona: hero id or "provider:<name>", trimmed as-is.
	if got := NormalizeEmojiPrefDimKey(EmojiPrefDimPersona, "  hero-feaa3f86 "); got != "hero-feaa3f86" {
		t.Errorf("persona dim key = %q", got)
	}
}

func TestSQLiteIndexBumpEmojiPrefUpsertAndFloor(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	// +1, +1 → count 2; version tracks every pref change.
	for i := 0; i < 2; i++ {
		if err := idx.BumpEmojiPref(ctx, EmojiPrefDimProject, "/tmp/work", "🛡️", 1); err != nil {
			t.Fatal(err)
		}
	}
	prefs, err := idx.EmojiPrefsForDim(ctx, EmojiPrefDimProject, "/tmp/work/")
	if err != nil {
		t.Fatal(err)
	}
	if len(prefs) != 1 || prefs["🛡️"] != 2 {
		t.Fatalf("prefs = %#v, want {🛡️: 2} (dim key normalization must collapse the trailing slash)", prefs)
	}
	version, err := idx.EmojiPrefVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Fatalf("pref version = %d, want 2", version)
	}

	// Negative signal decrements with a floor at 0; the row is kept, not deleted.
	if err := idx.BumpEmojiPref(ctx, EmojiPrefDimProject, "/tmp/work", "🛡️", -5); err != nil {
		t.Fatal(err)
	}
	prefs, err = idx.EmojiPrefsForDim(ctx, EmojiPrefDimProject, "/tmp/work")
	if err != nil {
		t.Fatal(err)
	}
	if len(prefs) != 0 {
		t.Fatalf("prefs = %#v, want empty (count-0 rows are omitted from reads)", prefs)
	}
	var count int
	if err := idx.db.Get(&count, `SELECT count FROM ai_emoji_prefs WHERE dim = 'project' AND dim_key = '/tmp/work' AND emoji = '🛡️'`); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("stored count = %d, want 0 (floor, row kept)", count)
	}
	// A new positive signal revives the counter from the kept row.
	if err := idx.BumpEmojiPref(ctx, EmojiPrefDimProject, "/tmp/work", "🛡️", 1); err != nil {
		t.Fatal(err)
	}
	if prefs, err = idx.EmojiPrefsForDim(ctx, EmojiPrefDimProject, "/tmp/work"); err != nil {
		t.Fatal(err)
	}
	if prefs["🛡️"] != 1 {
		t.Fatalf("revived count = %#v, want {🛡️: 1}", prefs)
	}

	// Invalid dim / invalid emoji are rejected with sentinel errors.
	if err := idx.BumpEmojiPref(ctx, "provider", "", "🛡️", 1); !errors.Is(err, ErrInvalidEmojiPrefDim) {
		t.Fatalf("invalid dim error = %v, want ErrInvalidEmojiPrefDim", err)
	}
	if err := idx.BumpEmojiPref(ctx, EmojiPrefDimGlobal, "", "42", 1); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("invalid emoji error = %v, want ErrInvalidEmoji", err)
	}
	if _, err := idx.EmojiPrefsForDim(ctx, "session", ""); !errors.Is(err, ErrInvalidEmojiPrefDim) {
		t.Fatalf("read invalid dim error = %v, want ErrInvalidEmojiPrefDim", err)
	}

	// The global dim is a single "" bucket regardless of the passed key.
	if err := idx.BumpEmojiPref(ctx, EmojiPrefDimGlobal, "ignored", "🦊", 1); err != nil {
		t.Fatal(err)
	}
	if prefs, err = idx.EmojiPrefsForDim(ctx, EmojiPrefDimGlobal, ""); err != nil {
		t.Fatal(err)
	}
	if prefs["🦊"] != 1 {
		t.Fatalf("global bucket = %#v, want {🦊: 1}", prefs)
	}
}
