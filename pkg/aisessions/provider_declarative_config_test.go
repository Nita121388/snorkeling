// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// isolateHome points ~ at a temp dir so the built-in entry's "~" expansion is
// deterministic (Windows reads USERPROFILE, POSIX reads HOME).
func isolateHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func TestMergeSessionProviderConfigsBuiltinDefault(t *testing.T) {
	home := isolateHome(t)

	merged := mergeSessionProviderConfigs(wconfig.SettingsType{})
	cfg, ok := merged[SourceAntigravity]
	if !ok {
		t.Fatalf("built-in %q entry missing from the merge result", SourceAntigravity)
	}
	if cfg.Label != "Antigravity" {
		t.Errorf("label = %q, want Antigravity", cfg.Label)
	}
	if cfg.Type != SessionProviderTypeSQLite {
		t.Errorf("type = %q, want sqlite", cfg.Type)
	}
	if cfg.Table != "conversation_summaries" {
		t.Errorf("table = %q", cfg.Table)
	}
	wantDB := filepath.Join(home, ".gemini", "antigravity-cli", "conversation_summaries.db")
	if cfg.DB != wantDB {
		t.Errorf("db = %q, want %q (~ must be expanded to an absolute path)", cfg.DB, wantDB)
	}
	wantColumns := defaultSessionProviderColumns()
	if cfg.Columns != wantColumns {
		t.Errorf("columns = %+v, want %+v", cfg.Columns, wantColumns)
	}
	if cfg.Disabled {
		t.Error("built-in entry must not be disabled by default")
	}
	if cfg.ListLimit != declarativeDefaultListLimit {
		t.Errorf("listLimit = %d, want the default %d", cfg.ListLimit, declarativeDefaultListLimit)
	}
}

func TestMergeSessionProviderConfigsUserOverride(t *testing.T) {
	isolateHome(t)
	customDB := filepath.Join(t.TempDir(), "custom.db")

	merged := mergeSessionProviderConfigs(wconfig.SettingsType{
		AgentSessionProviders: map[string]wconfig.AgentSessionProviderConfigType{
			// Same key as a built-in entry: only the given fields override.
			SourceAntigravity: {
				Label: "Anti-G",
				DB:    customDB,
				Columns: wconfig.AgentSessionProviderColumnsType{
					Title: "summary_title",
				},
			},
			// Brand new key: user provides everything.
			"myagent": {
				Label:   "My Agent",
				Type:    "sqlite",
				DB:      customDB,
				Table:   "sessions",
				Columns: wconfig.AgentSessionProviderColumnsType{ID: "sid", Updated: "updated_at"},
			},
		},
	})

	antigravity, ok := merged[SourceAntigravity]
	if !ok {
		t.Fatalf("overridden built-in entry disappeared")
	}
	if antigravity.Label != "Anti-G" {
		t.Errorf("label = %q, want the user override", antigravity.Label)
	}
	if antigravity.DB != customDB {
		t.Errorf("db = %q, want %q", antigravity.DB, customDB)
	}
	// Fields the user did not mention keep the built-in value.
	if antigravity.Table != "conversation_summaries" {
		t.Errorf("table = %q, want the built-in table to survive a partial override", antigravity.Table)
	}
	if antigravity.Columns.ID != "conversation_id" {
		t.Errorf("id column = %q, want the built-in mapping", antigravity.Columns.ID)
	}
	if antigravity.Columns.Title != "summary_title" {
		t.Errorf("title column = %q, want the user override", antigravity.Columns.Title)
	}

	myagent, ok := merged["myagent"]
	if !ok {
		t.Fatalf("custom key missing from the merge result")
	}
	if myagent.Label != "My Agent" || myagent.Table != "sessions" || myagent.Columns.ID != "sid" {
		t.Errorf("custom entry not preserved: %+v", myagent)
	}
	if myagent.ListLimit != declarativeDefaultListLimit {
		t.Errorf("custom listLimit = %d, want the default", myagent.ListLimit)
	}
}

func TestMergeSessionProviderConfigsDisabled(t *testing.T) {
	isolateHome(t)
	merged := mergeSessionProviderConfigs(wconfig.SettingsType{
		AgentSessionProviders: map[string]wconfig.AgentSessionProviderConfigType{
			SourceAntigravity: {Disabled: true},
		},
	})
	if _, ok := merged[SourceAntigravity]; ok {
		t.Fatalf("disabled entry %q must be removed from the merge result", SourceAntigravity)
	}
}

func TestMergeSessionProviderConfigsInvalidSkipped(t *testing.T) {
	isolateHome(t)
	dbPath := createDeclarativeFixtureDB(t)

	merged := mergeSessionProviderConfigs(wconfig.SettingsType{
		AgentSessionProviders: map[string]wconfig.AgentSessionProviderConfigType{
			// No db.
			"nodb": {Type: "sqlite", Table: "t", Columns: wconfig.AgentSessionProviderColumnsType{ID: "id"}},
			// No table.
			"notable": {Type: "sqlite", DB: dbPath, Columns: wconfig.AgentSessionProviderColumnsType{ID: "id"}},
			// Unimplemented backend type (jsonl is out of scope this period).
			"jsonlonly": {Type: "jsonl", DB: dbPath, Table: "t", Columns: wconfig.AgentSessionProviderColumnsType{ID: "id"}},
			// Blank key is dropped, it cannot be a source id.
			"  ": {Type: "sqlite", DB: dbPath, Table: "t", Columns: wconfig.AgentSessionProviderColumnsType{ID: "id"}},
			// Valid control entry.
			"ok": {Type: "sqlite", DB: dbPath, Table: "t", Columns: wconfig.AgentSessionProviderColumnsType{ID: "id"}},
		},
	})

	for _, name := range []string{"nodb", "notable", "jsonlonly"} {
		if _, ok := merged[name]; ok {
			t.Errorf("invalid entry %q must be skipped", name)
		}
	}
	if _, ok := merged["ok"]; !ok {
		t.Errorf("valid entry should survive")
	}
	for name := range merged {
		if strings.TrimSpace(name) == "" {
			t.Errorf("blank config key leaked into the merge result")
		}
	}
}

func TestNormalizeSessionProviderConfigDefaults(t *testing.T) {
	isolateHome(t)
	cfg := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		DB:    "relative/path.db",
		Table: "t",
	})
	if cfg.Type != SessionProviderTypeSQLite {
		t.Errorf("type = %q, want the only implemented backend as the default", cfg.Type)
	}
	if cfg.Columns.ID != "id" {
		t.Errorf("id column = %q, want the \"id\" fallback", cfg.Columns.ID)
	}
	if cfg.ListLimit != declarativeDefaultListLimit {
		t.Errorf("listLimit = %d", cfg.ListLimit)
	}
	if !filepath.IsAbs(cfg.DB) {
		t.Errorf("db = %q, want an absolute path", cfg.DB)
	}
	// An unimplemented type is never silently coerced to sqlite.
	jsonl := normalizeSessionProviderConfig(wconfig.AgentSessionProviderConfigType{}, wconfig.AgentSessionProviderConfigType{
		Type: "jsonl", DB: "x.db", Table: "t",
	})
	if jsonl.Type != "jsonl" {
		t.Errorf("type = %q, want the user value preserved for the validity check", jsonl.Type)
	}
	if isValidSessionProviderConfig(jsonl) {
		t.Error("jsonl entries must stay unregistrable this period")
	}
}
