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
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// AppType values cc-switch stores in `providers.app_type`.
const (
	CcSwitchProviderAppType         = "claude" // legacy alias, kept for back-compat with the original commit
	CcSwitchProviderAppTypeCodex    = "codex"
	CcSwitchProviderAppTypeOpenCode = "opencode"
	CcSwitchProviderAppTypePi       = "pi"
)

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
	Model           string            `json:"model,omitempty"`
	IsCurrent       bool              `json:"is_current"`
	ProviderType    string            `json:"provider_type"`
	Category        string            `json:"category"`
	ClaudeConfigDir string            `json:"claude_config_dir,omitempty"`
	// CodexConfigDir is the absolute path to a per-vendor CODEX_HOME we materialize on disk for codex
	// blocks. Like ClaudeConfigDir for claude: the spawned codex reads auth.json + config.toml out of
	// this directory instead of ~/.codex/. Empty when the vendor is codex-official / has no auth+config
	// (in which case launching against it inherits the user's global ~/.codex/ — official-login semantics).
	CodexConfigDir string `json:"codex_config_dir,omitempty"`
	// OpencodeConfigDir is the absolute path to a per-vendor OPENCODE_HOME we materialize on disk for opencode blocks.
	OpencodeConfigDir string `json:"opencode_config_dir,omitempty"`
	// PiConfigDir is the absolute path to a per-vendor PI_CODING_AGENT_SESSION_DIR we materialize on disk for pi blocks.
	PiConfigDir string `json:"pi_config_dir,omitempty"`
}

func claudeVendorModel(env map[string]string) string {
	if model := strings.TrimSpace(env["ANTHROPIC_MODEL"]); model != "" {
		return model
	}
	models := make(map[string]struct{})
	for key, value := range env {
		if !strings.HasPrefix(key, "ANTHROPIC_DEFAULT_") || !strings.HasSuffix(key, "_MODEL") {
			continue
		}
		if model := strings.TrimSpace(value); model != "" {
			models[model] = struct{}{}
		}
	}
	if len(models) != 1 {
		return ""
	}
	for model := range models {
		return model
	}
	return ""
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

type claudeVendorSettingsDoc struct {
	Env   map[string]string `json:"env"`
	Hooks json.RawMessage   `json:"hooks,omitempty"`
}

// codexSettingsConfigShape is the JSON shape cc-switch stores in `providers.settings_config` for codex:
//
//	{
//	  "auth": {"OPENAI_API_KEY": "sk-..."},
//	  "config": "<raw TOML — codex's ~/.codex/config.toml body>",
//	  "modelCatalog": {...}  // optional, dropped verbatim into <CODEX_HOME>/cc-switch-model-catalog.json
//	}
//
// cc-switch writes the *current* codex provider out to disk (~/.codex/config.toml + ~/.codex/auth.json)
// and leaves that row's settings_config empty in the DB; we don't materialize those (see listVendors).
type codexSettingsConfigShape struct {
	Auth         map[string]string `json:"auth"`
	Config       string            `json:"config"`
	ModelCatalog json.RawMessage   `json:"modelCatalog,omitempty"`
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

// ListClaudeVendors reads all cc-switch providers where app_type='claude', extracting each one's env
// and materializing a per-vendor CLAUDE_CONFIG_DIR.
//
// Failure modes are soft:
//   - DB file missing → returns empty list + Detected=false + nil error (caller hides the UI)
//   - Table missing / JSON unparseable → that single row's env becomes empty + we still return the others
//
// We never return an error for "user just doesn't have cc-switch installed" — only for hard I/O failures
// during a probe, which would indicate something other than "not installed".
func ListClaudeVendors(ctx context.Context) (*VendorList, error) {
	vl, err := listVendors(ctx, CcSwitchProviderAppType)
	if err == nil && vl != nil && vl.Detected {
		gcVendors(ctx, CcSwitchProviderAppType, vl.Vendors)
	}
	return vl, err
}

// ListCodexVendors reads all cc-switch providers where app_type='codex', extracting each one's
// OPENAI_API_KEY (into Vendor.Env) and materializing a per-vendor CODEX_HOME containing auth.json,
// config.toml, the verbatim modelCatalog blob, and a copy of the user's ~/.codex/hooks.json.
//
// Mirrors ListClaudeVendors' soft-failure contract (DB-missing → Detected=false, nil err).
func ListCodexVendors(ctx context.Context) (*VendorList, error) {
	vl, err := listVendors(ctx, CcSwitchProviderAppTypeCodex)
	if err == nil && vl != nil && vl.Detected {
		gcVendors(ctx, CcSwitchProviderAppTypeCodex, vl.Vendors)
	}
	return vl, err
}

// ListOpenCodeVendors reads all cc-switch providers where app_type='opencode', extracting each one's env
// and materializing a per-vendor OpenCodeCodeConfigDir containing opencode.json with just the vendor env.
// Mirrors ListClaudeVendors' soft-failure contract (DB-missing → Detected=false, nil err) — never blocks agent launch.
func ListOpenCodeVendors(ctx context.Context) (*VendorList, error) {
	vl, err := listVendors(ctx, CcSwitchProviderAppTypeOpenCode)
	if err == nil && vl != nil && vl.Detected {
		gcVendors(ctx, CcSwitchProviderAppTypeOpenCode, vl.Vendors)
	}
	return vl, err
}

// ListPiVendors reads all cc-switch providers where app_type='pi', extracting each one's env and
// materializing a per-vendor PiConfigDir containing config.json with just the vendor env.
// Mirrors ListClaudeVendors' soft-failure contract (DB-missing → Detected=false, nil err) — never blocks agent launch.
func ListPiVendors(ctx context.Context) (*VendorList, error) {
	vl, err := listVendors(ctx, CcSwitchProviderAppTypePi)
	if err == nil && vl != nil && vl.Detected {
		gcVendors(ctx, CcSwitchProviderAppTypePi, vl.Vendors)
	}
	return vl, err
}

// listVendors is the shared implementation behind ListClaudeVendors / ListCodexVendors. Same row schema
// for both app_types (see openReadOnly's doc comment); only the per-row settings_config interpretation
// and the materialized config dir differ.
func listVendors(ctx context.Context, appType string) (*VendorList, error) {
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
	if err := db.SelectContext(ctx, &rows, query, appType); err != nil {
		// table missing or cc-switch schema we don't recognize → soft-empty
		return &VendorList{Vendors: []Vendor{}, DbPath: path, Detected: false}, nil
	}

	var globalClaudeHooks json.RawMessage
	if appType == CcSwitchProviderAppType {
		globalClaudeHooks, err = readGlobalClaudeHooks()
		if err != nil {
			fmt.Printf("ccswitch: unable to read global Claude hooks: %v\n", err)
		}
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
		switch appType {
		case CcSwitchProviderAppType:
			// Claude settings_config: {"env": {...}}.
			if r.SettingsJSON != "" {
				var sc settingsConfigShape
				if json.Unmarshal([]byte(r.SettingsJSON), &sc) == nil && sc.Env != nil {
					v.Env = sc.Env
					v.Model = claudeVendorModel(sc.Env)
				}
				// JSON parse failure leaves that row's Env empty; the user can still pick it,
				// it'll just inject no env.
			}
			// Materialize a vendor-scoped CLAUDE_CONFIG_DIR so the per-block vendor pick actually
			// wins against the user's global ~/.claude/settings.json env block (see Vendor doc).
			// Best-effort: a write failure only means CLAUDE_CONFIG_DIR stays empty and we degrade
			// to the old OS-env-only injection; we don't fail the whole read.
			//
			// Skip rows whose env is empty — cc-switch ships placeholder rows like `claude-official`
			// with no env content; materializing them just leaves inert empty claude-vendors/<id>/
			// dirs on disk. Launching against an empty-env row falls back to the user's global
			// ~/.claude/settings.json (the same path codex-official takes below).
			shouldMaterialize := false
			for _, val := range v.Env {
				if strings.TrimSpace(val) != "" {
					shouldMaterialize = true
					break
				}
			}
			if shouldMaterialize {
				if ccd, materializeErr := materializeClaudeConfigDir(v.ID, v.Env, globalClaudeHooks); materializeErr != nil {
					fmt.Printf("ccswitch: unable to materialize Claude vendor %q: %v\n", v.ID, materializeErr)
				} else if ccd != "" {
					v.ClaudeConfigDir = ccd
				}
			}
		case CcSwitchProviderAppTypeCodex:
			// Codex settings_config: {"auth": {"OPENAI_API_KEY": ...}, "config": "<TOML>", "modelCatalog": ...}.
			// cc-switch blanks the current row's settings_config (it already wrote ~/.codex/ live);
			// for such rows we just render the chip with no env and no CODEX_HOME — the user picking
			// it inherits their global ~/.codex/ (mirrors claude's is_current chip rendering).
			if r.SettingsJSON != "" {
				var cs codexSettingsConfigShape
				if json.Unmarshal([]byte(r.SettingsJSON), &cs) == nil {
					// Whitelist: only OPENAI_API_KEY flows into cmd:env. Other auth keys (if any appear
					// in future cc-switch versions) are NOT exported as env — codex itself reads no other
					// env keys, and base_url is a config.toml resource (exporting it via env would make
					// codex silently override the TOML's [model_providers] base_url — see plan §细节).
					authKey, hasKey := cs.Auth["OPENAI_API_KEY"]
					if hasKey && authKey != "" {
						v.Env["OPENAI_API_KEY"] = authKey
					}
					// Materialize a CODEX_HOME only when this row carries real content (key+config or a
					// non-empty config). codex-official / blank rows never get one, so launching against
					// them falls back to the user's global ~/.codex/ (official OAuth login path).
					shouldMaterialize := hasKey && authKey != "" || strings.TrimSpace(cs.Config) != ""
					if shouldMaterialize {
						if cod, _ := materializeCodexConfigDir(v.ID, cs.Auth, cs.Config, cs.ModelCatalog); cod != "" {
							v.CodexConfigDir = cod
						}
					}
				}
			}
		case CcSwitchProviderAppTypeOpenCode:
			// OpenCode settings_config: {"env": {...}}. Same shape as claude — opencode's
			// settings.json equivalent is opencode.json, which only carries the vendor env.
			if r.SettingsJSON != "" {
				var sc settingsConfigShape
				if json.Unmarshal([]byte(r.SettingsJSON), &sc) == nil && sc.Env != nil {
					v.Env = sc.Env
				}
			}
			shouldMaterialize := false
			for _, val := range v.Env {
				if strings.TrimSpace(val) != "" {
					shouldMaterialize = true
					break
				}
			}
			if shouldMaterialize {
				if ocd, materializeErr := materializeOpenCodeConfigDir(v.ID, v.Env); materializeErr != nil {
					fmt.Printf("ccswitch: unable to materialize OpenCode vendor %q: %v\n", v.ID, materializeErr)
				} else if ocd != "" {
					v.OpencodeConfigDir = ocd
				}
			}
		case CcSwitchProviderAppTypePi:
			// Pi settings_config: {"env": {...}}. Same shape as claude/opencode — pi's
			// settings.json equivalent is config.json, which only carries the vendor env.
			if r.SettingsJSON != "" {
				var sc settingsConfigShape
				if json.Unmarshal([]byte(r.SettingsJSON), &sc) == nil && sc.Env != nil {
					v.Env = sc.Env
				}
			}
			shouldMaterialize := false
			for _, val := range v.Env {
				if strings.TrimSpace(val) != "" {
					shouldMaterialize = true
					break
				}
			}
			if shouldMaterialize {
				if pcd, materializeErr := materializePiConfigDir(v.ID, v.Env); materializeErr != nil {
					fmt.Printf("ccswitch: unable to materialize Pi vendor %q: %v\n", v.ID, materializeErr)
				} else if pcd != "" {
					v.PiConfigDir = pcd
				}
			}
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

func ClaudeVendorProjectDirs() []string {
	root := claudeVendorsRoot()
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	dirs := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !validVendorID(entry.Name()) {
			continue
		}
		projectsDir := filepath.Join(root, entry.Name(), "projects")
		info, err := os.Lstat(projectsDir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		dirs = append(dirs, projectsDir)
	}
	return dirs
}

func ResolveClaudeVendorSessionPath(path string) (vendorID string, configDir string, ok bool) {
	root, err := filepath.Abs(filepath.Clean(claudeVendorsRoot()))
	if err != nil {
		return "", "", false
	}
	rootInfo, err := os.Lstat(root)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return "", "", false
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", "", false
	}
	rel, err := filepath.Rel(root, absPath)
	if err != nil {
		return "", "", false
	}
	parts := strings.Split(rel, string(filepath.Separator))
	if len(parts) < 3 || !validVendorID(parts[0]) || parts[1] != "projects" {
		return "", "", false
	}
	configDir = filepath.Join(root, parts[0])
	info, err := os.Lstat(configDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", "", false
	}
	projectsDir := filepath.Join(configDir, "projects")
	realProjectsDir, err := filepath.EvalSymlinks(projectsDir)
	if err != nil {
		return "", "", false
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return "", "", false
	}
	realRel, err := filepath.Rel(realProjectsDir, realPath)
	if err != nil || realRel == "." || realRel == ".." || strings.HasPrefix(realRel, ".."+string(filepath.Separator)) {
		return "", "", false
	}
	return parts[0], configDir, true
}

// vendorsRoot returns the per-waveDataDir directory holding one subdirectory per vendor ID for
// the given appType — claude-vendors/ for claude, codex-vendors/ for codex,
// opencode-vendors/ for opencode, pi-vendors/ for pi. Lives under GetWaveDataDir()
// so dev/prod and local/remote instances stay isolated.
func vendorsRoot(appType string) string {
	switch appType {
	case CcSwitchProviderAppTypeCodex:
		return codexVendorsRoot()
	case CcSwitchProviderAppTypeOpenCode:
		return opencodeVendorsRoot()
	case CcSwitchProviderAppTypePi:
		return piVendorsRoot()
	default:
		return claudeVendorsRoot()
	}
}

// gcVendors removes only Wave-owned credential/config files for vendors no longer present in cc-switch.
// Claude and Codex write session history and other user data below the same config directory, so the
// directory must never be removed recursively. An orphan directory is removed only when it becomes empty.
func gcVendors(ctx context.Context, appType string, liveVendors []Vendor) {
	root := vendorsRoot(appType)
	entries, err := os.ReadDir(root)
	if err != nil {
		// Missing root dir is normal (no vendors ever materialized yet) — nothing to GC.
		return
	}
	liveIDs := make(map[string]struct{}, len(liveVendors))
	for _, v := range liveVendors {
		if v.ID != "" {
			liveIDs[v.ID] = struct{}{}
		}
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirName := entry.Name()
		if _, ok := liveIDs[dirName]; ok {
			continue
		}
		orphanPath := filepath.Join(root, dirName)
		removedConfig := false
		for _, name := range vendorOwnedConfigFiles(appType) {
			configPath := filepath.Join(orphanPath, name)
			if removeErr := os.Remove(configPath); removeErr == nil {
				removedConfig = true
			} else if !os.IsNotExist(removeErr) {
				fmt.Printf("ccswitch: gcVendors: unable to remove orphan %s config %s: %v\n", appType, name, removeErr)
			}
		}
		if removeErr := os.Remove(orphanPath); removeErr == nil {
			fmt.Printf("ccswitch: gcVendors: removed empty orphan %s vendor %q\n", appType, dirName)
		} else if removedConfig {
			fmt.Printf("ccswitch: gcVendors: retained orphan %s vendor %q because it contains non-config data\n", appType, dirName)
		}
	}
}

func vendorOwnedConfigFiles(appType string) []string {
	switch appType {
	case CcSwitchProviderAppTypeCodex:
		return []string{"auth.json", "config.toml", "hooks.json", "cc-switch-model-catalog.json"}
	case CcSwitchProviderAppTypeOpenCode:
		return []string{"opencode.json"}
	case CcSwitchProviderAppTypePi:
		return []string{"config.json"}
	default:
		return []string{"settings.json"}
	}
}

func liveClaudeSettingsPath() (string, error) {
	dir, err := wavebase.ExpandHomeDir("~/.claude")
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

func readGlobalClaudeHooks() (json.RawMessage, error) {
	path, err := liveClaudeSettingsPath()
	if err != nil {
		return nil, err
	}
	return readClaudeHooks(path)
}

func readClaudeHooks(path string) (json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	hooks := settings["hooks"]
	if len(hooks) == 0 || string(hooks) == "null" {
		return nil, nil
	}
	return hooks, nil
}

func validVendorID(vendorID string) bool {
	return vendorID != "" && vendorID != "." && vendorID != ".." && filepath.Base(vendorID) == vendorID &&
		!strings.ContainsAny(vendorID, `/\`)
}

// materializeClaudeConfigDir writes a vendor-scoped settings.json ({"env": <vendorEnv>, "hooks": ...}) into
// <waveDataDir>/claude-vendors/<vendorID>/settings.json and returns the directory path.
//
// Idempotent: if the existing file already serializes to the same JSON bytes, we skip the rewrite so
// concurrent readers don't churn the mtime or race each other. The directory is created 0700 because
// vendor env may carry auth tokens; we don't want the file world-readable on shared hosts.
//
// Returns ("", nil) on any I/O error — caller silently degrades to the old OS-env-only path.
func materializeClaudeConfigDir(vendorID string, vendorEnv map[string]string, hooks json.RawMessage) (string, error) {
	if !validVendorID(vendorID) {
		return "", fmt.Errorf("invalid vendor id %q", vendorID)
	}
	dir := filepath.Join(claudeVendorsRoot(), vendorID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	settingsPath := filepath.Join(dir, "settings.json")
	settingsDoc := claudeVendorSettingsDoc{Env: vendorEnv, Hooks: hooks}
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

// codexVendorsRoot returns the per-waveDataDir directory that holds one subdirectory per codex vendor ID,
// each containing the auth.json + config.toml (+ hooks.json + cc-switch-model-catalog.json) the spawned
// codex reads via CODEX_HOME. Mirrors claudeVendorsRoot: lives under GetWaveDataDir() so dev/prod and
// local/remote instances stay isolated.
func codexVendorsRoot() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "codex-vendors")
}

// liveCodexHooksPath returns the user's global ~/.codex/hooks.json, written by Wave's
// pkg/agentstatus.InstallCodexHooks (snorkeling-agent-status integration). The hooks.json content is a
// fixed script path that points back at Wave's data dir — it is NOT vendor-private — so copying it
// verbatim into each materialized CODEX_HOME lets the agent-status event hook fire on isolated codex
// blocks just like it does for the global install. Returns "" if the file is absent (user hasn't run
// InstallCodexHooks yet) — materializeCodexConfigDir silently skips the copy in that case.
func liveCodexHooksPath() (string, error) {
	home, err := wavebase.ExpandHomeDir("~/.codex")
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "hooks.json"), nil
}

// liveCodexCatalogPath returns the user's global ~/.codex/cc-switch-model-catalog.json. Older
// cc-switch rows store a stripped-down catalog shape (`{"models":[{"model":...,"displayName":...}]}`)
// that lacks the `slug` field modern codex requires; when such a stale blob would otherwise be
// dropped verbatim into CODEX_HOME, we fall back to copying this file instead (see
// materializeCodexConfigDir) — same best-effort contract as the hooks.json copy. Returns "" if the
// global file is absent.
func liveCodexCatalogPath() (string, error) {
	home, err := wavebase.ExpandHomeDir("~/.codex")
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "cc-switch-model-catalog.json"), nil
}

// catalogBlobHasSlug reports whether a modelCatalog blob carries the modern codex schema, indicated
// by a `slug` key on at least one model entry. Returns false on any parse failure or `slug` absence,
// so the caller treats unparseable blobs the same as malformed ones (fallback to the global catalog).
func catalogBlobHasSlug(blob json.RawMessage) bool {
	var probe struct {
		Models []map[string]json.RawMessage `json:"models"`
	}
	if json.Unmarshal(blob, &probe) != nil {
		return false
	}
	for _, m := range probe.Models {
		if _, ok := m["slug"]; ok {
			return true
		}
	}
	return false
}

// materializeCodexConfigDir writes a vendor-scoped CODEX_HOME containing auth.json + config.toml
// (+ hooks.json copied from the user's global ~/.codex + the verbatim modelCatalog blob) into
// <waveDataDir>/codex-vendors/<vendorID>/ and returns the directory path.
//
// Idempotent (byte comparison skips rewrites, mirroring materializeClaudeConfigDir). The directory is
// 0700 because auth.json carries the vendor's OPENAI_API_KEY. Best-effort: returns ("", nil) on any
// I/O error, caller silently degrades to no CODEX_HOME injection (codex then falls back to ~/.codex).
//
// Note: modelCatalog and hooks.json are dropped verbatim — we don't parse or interpret them. The
// hooks.json copy is critical for Wave's own agent-status integration to keep working under the
// isolated CODEX_HOME (see liveCodexHooksPath). hooks.json copy failure is non-fatal: we still return
// the dir path so CODEX_HOME injection happens, agent-status just won't fire on this block.
//
// Caller must guard: only invoke this when the row has real content (a non-empty OPENAI_API_KEY or a
// non-empty config). codex-official / blank rows skip it entirely (they inherit the user's ~/.codex/).
func materializeCodexConfigDir(vendorID string, auth map[string]string, configTOML string, modelCatalog json.RawMessage) (string, error) {
	if vendorID == "" {
		return "", nil
	}
	dir := filepath.Join(codexVendorsRoot(), vendorID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}

	// auth.json: only when OPENAI_API_KEY is present (codex-official has empty auth → no auth.json,
	// the spawned codex prompts the user to log in via OAuth against the official endpoint).
	if key, ok := auth["OPENAI_API_KEY"]; ok && key != "" {
		authPath := filepath.Join(dir, "auth.json")
		authDoc, err := json.MarshalIndent(map[string]string{"OPENAI_API_KEY": key}, "", "  ")
		if err != nil {
			return "", err
		}
		if existing, readErr := os.ReadFile(authPath); readErr == nil && string(existing) == string(authDoc) {
			// unchanged, skip
		} else if err := os.WriteFile(authPath, authDoc, 0600); err != nil {
			return "", err
		}
	}

	// config.toml: verbatim TOML from cc-switch (codex's ~/.codex/config.toml body — model_provider,
	// base_url under [model_providers.<name>], mcp_servers, etc). We never set OPENAI_BASE_URL in
	// cmd:env because base_url is owned here; an env override would silently clobber this TOML.
	if strings.TrimSpace(configTOML) != "" {
		cfgPath := filepath.Join(dir, "config.toml")
		if existing, readErr := os.ReadFile(cfgPath); readErr == nil && string(existing) == configTOML {
			// unchanged, skip
		} else if err := os.WriteFile(cfgPath, []byte(configTOML), 0600); err != nil {
			return "", err
		}
	}

	// cc-switch-model-catalog.json: optional pre-curated model list. cc-switch vendors reference it
	// from config.toml's `model_catalog_json = "cc-switch-model-catalog.json"`; codex reads it relative
	// to CODEX_HOME. Without it, codex startup can fail to resolve the configured `model`. We drop the
	// raw blob through verbatim when it carries the modern schema (models[].slug present). Older
	// cc-switch rows stored a stripped shape (`{"models":[{"model":...,"displayName":...}]}`) that modern
	// codex rejects with `missing field 'slug'` — for those we fall back to the user's global
	// ~/.codex/cc-switch-model-catalog.json (mirrors the hooks.json copy) so a stale row can't break the
	// launch. config.toml unconditionally points at the catalog file, so we must write *something*
	// matching the schema — skipping the write entirely would also break codex.
	catalogToWrite := modelCatalog
	if len(catalogToWrite) > 0 && string(catalogToWrite) != "null" && !catalogBlobHasSlug(catalogToWrite) {
		if globalCatPath, gerr := liveCodexCatalogPath(); gerr == nil {
			if globalBytes, rerr := os.ReadFile(globalCatPath); rerr == nil && catalogBlobHasSlug(globalBytes) {
				catalogToWrite = globalBytes
			}
		}
	}
	if len(catalogToWrite) > 0 && string(catalogToWrite) != "null" {
		catPath := filepath.Join(dir, "cc-switch-model-catalog.json")
		if existing, readErr := os.ReadFile(catPath); readErr == nil && string(existing) == string(catalogToWrite) {
			// unchanged, skip
		} else if err := os.WriteFile(catPath, catalogToWrite, 0600); err != nil {
			// non-fatal — codex may still start without the catalog, but model resolution could fail;
			// we keep going rather than tear down the whole CODEX_HOME.
		}
	}

	// hooks.json: copy from the user's global ~/.codex/hooks.json so Wave's agent-status hook keeps
	// firing on isolated blocks. Best-effort — absence just means agent-status events don't surface.
	if hooksPath, err := liveCodexHooksPath(); err == nil {
		if srcBytes, readErr := os.ReadFile(hooksPath); readErr == nil && len(srcBytes) > 0 {
			destHooks := filepath.Join(dir, "hooks.json")
			if existing, readErr := os.ReadFile(destHooks); readErr == nil && string(existing) == string(srcBytes) {
				// unchanged, skip
			} else if err := os.WriteFile(destHooks, srcBytes, 0600); err != nil {
				// non-fatal — fail silently, agent-status integration won't fire for this block.
			}
		}
	}

	return dir, nil
}
