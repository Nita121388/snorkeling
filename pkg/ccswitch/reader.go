// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// CcSwitchProviderAppType is the value cc-switch stores in `providers.app_type` for Claude Code entries.
const CcSwitchProviderAppType = "claude"

// DefaultDBRelPath is the default location of the cc-switch SQLite DB relative to the user's home dir.
const DefaultDBRelPath = ".cc-switch/cc-switch.db"

// Vendor is a single cc-switch provider for Claude Code, with the env block extracted from settings_config.
//
// ClaudeConfigDir is the absolute path to a per-vendor CLAUDE_CONFIG_DIR we materialize on disk. Claude Code's
// startup resolves ~/.claude/settings.json and overrides the process env with whatever's in its "env" block —
// see https://code.claude.com/docs/en/env-vars: "When the same variable is set in both your shell and a settings
// file env block, the settings file value applies." That means an OS env we inject via cmd:env loses to whatever
// the user's global ~/.claude/settings.json already says. To give the per-block vendor selection real teeth, we
// point the spawned claude at this isolated directory via CLAUDE_CONFIG_DIR; its settings.json contains exactly the
// vendor's env and nothing else, so the global file no longer wins.
type Vendor struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Env             map[string]string `json:"env"`
	IsCurrent       bool              `json:"is_current"`
	ProviderType    string            `json:"provider_type"`
	Category        string            `json:"category"`
	ClaudeConfigDir string            `json:"claude_config_dir"`
}

// VendorList is the full RPC payload: vendors + metadata for the frontend (db path, whether the DB exists).
type VendorList struct {
	Vendors  []Vendor `json:"vendors"`
	DbPath   string   `json:"dbpath"`
	Detected bool     `json:"detected"`
}

// DBPath returns the resolved path to the cc-switch SQLite DB, expanding ~ via wavebase.ExpandHomeDir.
func DBPath() (string, error) {
	return wavebase.ExpandHomeDir("~/" + DefaultDBRelPath)
}

// settingsConfigShape is the JSON shape cc-switch stores in `providers.settings_config`:
//
//	{"env": {"ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "...", "ANTHROPIC_DEFAULT_*_MODEL": "..."}, ...}
type settingsConfigShape struct {
	Env map[string]string `json:"env"`
}

// openReadOnly opens the cc-switch DB read-only. Short-lived connection: caller closes it when done.
// We don't cache *sqlx.DB because cc-switch (the desktop app) owns this file and may rebuild it;
// a long-lived handle could end up pointing at a stale inode after cc-switch replaces the DB.
//
// We mirror pkg/aisessions/sqlite_index.go:63's DSN shape (`file:<path>?...`) rather than building a
// url.URL. url.URL{Scheme:"file", Path: filepath.ToSlash(path)} emits `file:C:/Users/...`, which the
// mattn driver parses with `C` as the URI authority → "invalid uri authority: C:" on Windows.
// Passing the raw backslash path keeps the same convention the rest of the repo uses for SQLite opens.
//
// mode=ro + _busy_timeout=5000 lets cc-switch write concurrently while we read.
// We must NOT set _journal_mode=WAL here: cc-switch's DB is delete-journal, and under mode=ro the
// driver would try to rewrite the DB header to switch journal modes → "attempt to write a readonly
// database" → PingContext fails → ListClaudeVendors soft-degrades to Detected=false and the UI never
// shows vendor chips. Read-only opens read fine on any journal mode when the timeout paces writers.
// SetMaxOpenConns(1) serializes this process's reads (same convention as pkg/aisessions/sqlite_index.go:67).
// Note: package aisessions uses mode=rwc, but that's because it *owns* and bootstraps the schema;
// cc-switch's DB is foreign — we must never write to it.
func openReadOnly(ctx context.Context, path string) (*sqlx.DB, error) {
	dsn := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=5000", path)
	db, err := sqlx.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("ccswitch: open %s: %w", path, err)
	}
	db.DB.SetMaxOpenConns(1)
	// Probe connection with a 3s timeout so we surface "no such table" / locked-since-close cleanly,
	// rather than letting the caller discover it later as a generic SQL error.
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := db.PingContext(probeCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// ListClaudeVendors reads all cc-switch providers where app_type='claude', extracting each one's env.
//
// Failure modes are soft:
//   - DB file missing → returns empty list + Detected=false + nil error (caller hides the UI)
//   - Table missing / JSON unparseable → that single row's env becomes empty + we still return the others
//
// We never return an error for "user just doesn't have cc-switch installed" — only for hard I/O failures
// during a probe, which would indicate something other than "not installed".
func ListClaudeVendors(ctx context.Context) (*VendorList, error) {
	path, err := DBPath()
	if err != nil {
		return nil, fmt.Errorf("ccswitch: resolve db path: %w", err)
	}
	info, statErr := os.Stat(path)
	if statErr != nil || info == nil || info.IsDir() {
		// Not installed / DB absent: soft-empty, no error
		return &VendorList{Vendors: []Vendor{}, DbPath: path, Detected: false}, nil
	}

	db, err := openReadOnly(ctx, path)
	if err != nil {
		// Could not open (locked beyond timeout, file corrupted, ...) — surface as Detected=false
		// rather than blocking the agent launcher; frontend will hide the vendor selector.
		return &VendorList{Vendors: []Vendor{}, DbPath: path, Detected: false}, nil
	}
	defer db.Close()

	type row struct {
		ID           string         `db:"id"`
		Name         string         `db:"name"`
		SettingsJSON string         `db:"settings_config"`
		IsCurrent    sql.NullBool   `db:"is_current"`
		ProviderType sql.NullString `db:"provider_type"`
		Category     sql.NullString `db:"category"`
	}
	const query = `SELECT id, name, settings_config, is_current, provider_type, category
		FROM providers
		WHERE app_type = ?
		ORDER BY sort_index, name`
	var rows []row
	if err := db.SelectContext(ctx, &rows, query, CcSwitchProviderAppType); err != nil {
		// table missing or cc-switch schema we don't recognize → soft-empty
		return &VendorList{Vendors: []Vendor{}, DbPath: path, Detected: false}, nil
	}

	vendors := make([]Vendor, 0, len(rows))
	for _, r := range rows {
		v := Vendor{
			ID:           r.ID,
			Name:         r.Name,
			Env:          map[string]string{},
			IsCurrent:    r.IsCurrent.Valid && r.IsCurrent.Bool,
			ProviderType: r.ProviderType.String,
			Category:     r.Category.String,
		}
		if r.SettingsJSON != "" {
			var sc settingsConfigShape
			if json.Unmarshal([]byte(r.SettingsJSON), &sc) == nil && sc.Env != nil {
				v.Env = sc.Env
			}
			// JSON parse failure for one row leaves that row's Env empty;
			// the user can still see the vendor name & pick it (it'll just inject no env).
		}
		// Materialize a vendor-scoped CLAUDE_CONFIG_DIR so the per-block vendor pick actually wins
		// against the user's global ~/.claude/settings.json env block (see Vendor doc comment).
		// Best-effort: a write failure here only means CLAUDE_CONFIG_DIR stays empty and we degrade
		// to the old OS-env-only injection; we don't fail the whole read.
		if ccd, _ := materializeClaudeConfigDir(v.ID, v.Env); ccd != "" {
			v.ClaudeConfigDir = ccd
		}
		vendors = append(vendors, v)
	}

	return &VendorList{Vendors: vendors, DbPath: path, Detected: true}, nil
}

// claudeVendorsRoot returns the per-waveDataDir directory that holds one subdirectory per vendor ID,
// each containing a settings.json the spawned claude will read via CLAUDE_CONFIG_DIR.
//
// Lives under GetWaveDataDir() so dev and prod instances (and remote vs local) stay isolated — dev runs
// never see or corrupt a prod install's vendor files, and vice versa.
func claudeVendorsRoot() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "claude-vendors")
}

// materializeClaudeConfigDir writes a vendor-scoped settings.json ({"env": <vendorEnv>}) into
// <waveDataDir>/claude-vendors/<vendorID>/settings.json and returns the directory path.
//
// Idempotent: if the existing file already serializes to the same JSON bytes, we skip the rewrite so
// concurrent readers don't churn the mtime or race each other. The directory is created 0700 because
// vendor env may carry auth tokens; we don't want the file world-readable on shared hosts.
//
// Returns ("", nil) on any I/O error — caller silently degrades to the old OS-env-only path.
func materializeClaudeConfigDir(vendorID string, vendorEnv map[string]string) (string, error) {
	if vendorID == "" {
		return "", nil
	}
	dir := filepath.Join(claudeVendorsRoot(), vendorID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	settingsPath := filepath.Join(dir, "settings.json")
	// Wrap vendorEnv in the {"env": {...}} shape Claude Code's settings.json spec expects.
	// We only ever populate the "env" key — no hooks/permissions/outputStyle — so the vendor
	// isolation never accidentally inherits or overrides other user preferences.
	settingsDoc := struct {
		Env map[string]string `json:"env"`
	}{Env: vendorEnv}
	newBytes, err := json.MarshalIndent(settingsDoc, "", "  ")
	if err != nil {
		return "", err
	}
	// Skip rewrite if unchanged.
	if existing, readErr := os.ReadFile(settingsPath); readErr == nil {
		if string(existing) == string(newBytes) {
			return dir, nil
		}
	}
	if err := os.WriteFile(settingsPath, newBytes, 0600); err != nil {
		return "", err
	}
	return dir, nil
}
