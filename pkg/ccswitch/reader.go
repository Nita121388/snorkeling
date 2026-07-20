// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/wave/pkg/wavebase"
)

// CcSwitchProviderAppType is the value cc-switch stores in `providers.app_type` for Claude Code entries.
const CcSwitchProviderAppType = "claude"

// DefaultDBRelPath is the default location of the cc-switch SQLite DB relative to the user's home dir.
const DefaultDBRelPath = ".cc-switch/cc-switch.db"

// Vendor is a single cc-switch provider for Claude Code, with the env block extracted from settings_config.
type Vendor struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Env          map[string]string `json:"env"`
	IsCurrent    bool              `json:"is_current"`
	ProviderType string            `json:"provider_type"`
	Category     string            `json:"category"`
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
// mode=ro + WAL + _busy_timeout=5000 lets cc-switch write concurrently while we read.
// SetMaxOpenConns(1) serializes this process's reads (same convention as pkg/aisessions/sqlite_index.go:67).
// Note: package aisessions uses mode=rwc, but that's because it *owns* and bootstraps the schema;
// cc-switch's DB is foreign — we must never write to it.
func openReadOnly(ctx context.Context, path string) (*sqlx.DB, error) {
	u := &url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	q := u.Query()
	q.Set("mode", "ro")
	q.Set("_journal_mode", "WAL")
	q.Set("_busy_timeout", "5000")
	u.RawQuery = q.Encode()
	dsn := u.String()
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
		vendors = append(vendors, v)
	}

	return &VendorList{Vendors: vendors, DbPath: path, Detected: true}, nil
}
