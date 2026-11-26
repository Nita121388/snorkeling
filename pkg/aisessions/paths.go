// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/ccswitch"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func DefaultIndexPath() string {
	if envPath := os.Getenv("WAVETERM_AI_SESSIONS_INDEX"); envPath != "" {
		return envPath
	}
	home := homeDir()
	if home == "" {
		return filepath.Join(os.TempDir(), "snorkeling-ai-sessions-index.json")
	}
	return filepath.Join(home, ".snorkeling", "ai-sessions", "index.json")
}

func DefaultSQLiteIndexPath() string {
	if envPath := os.Getenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX"); envPath != "" {
		return envPath
	}
	return filepath.Join(filepath.Dir(DefaultIndexPath()), "index-v2.sqlite")
}

func DefaultMetaPath() string {
	if envPath := os.Getenv("WAVETERM_AI_SESSIONS_META"); envPath != "" {
		return envPath
	}
	home := homeDir()
	if home == "" {
		return filepath.Join(os.TempDir(), "snorkeling-ai-sessions-meta.json")
	}
	return filepath.Join(home, ".snorkeling", "ai-sessions", "meta.json")
}

func DefaultDeletedDir() string {
	if envDir := os.Getenv("WAVETERM_AI_SESSIONS_DELETED_DIR"); envDir != "" {
		return envDir
	}
	home := homeDir()
	if home == "" {
		return filepath.Join(os.TempDir(), "snorkeling-ai-sessions-deleted")
	}
	return filepath.Join(home, ".snorkeling", "ai-sessions", "deleted")
}

func DefaultCodexSessionsDir() string {
	home := homeDir()
	if home == "" {
		return ""
	}
	if envDir := os.Getenv("CODEX_HOME"); envDir != "" {
		return filepath.Join(envDir, "sessions")
	}
	return filepath.Join(home, ".codex", "sessions")
}

func DefaultClaudeProjectDirs() []string {
	home := homeDir()
	var dirs []string
	if envDir := os.Getenv("CLAUDE_CONFIG_DIR"); envDir != "" {
		dirs = append(dirs, filepath.Join(envDir, "projects"))
	}
	if home != "" {
		dirs = append(dirs, filepath.Join(home, ".claude", "projects"))
	}
	dirs = append(dirs, ccswitch.ClaudeVendorProjectDirs()...)
	if home != "" && runtime.GOOS != "windows" {
		dirs = append(dirs, filepath.Join(home, ".cache", "claude", "projects"))
	}
	return uniqueStrings(dirs)
}

func DefaultPiSessionsDir() string {
	home := homeDir()
	if home == "" {
		return ""
	}
	if envDir := os.Getenv("PI_CODING_AGENT_SESSION_DIR"); envDir != "" {
		return envDir
	}
	return filepath.Join(home, ".pi", "agent", "sessions")
}

// userCacheDir returns the OS cache dir, or "" when unavailable. Some older
// Linux opencode installs stored the sqlite db under <userCacheDir>/opencode.
func userCacheDir() string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		return ""
	}
	return dir
}

// openCodeDBCandidates returns db-path candidates (excluding the OPENCODE_DB
// override) in priority order. OpenCode stores its sqlite db under the XDG data
// home rather than the cache dir, which is where the historical code looked.
// "opencode debug paths" confirms: data=%USERPROFILE%\.local\share\opencode.
func openCodeDBCandidates() []string {
	var out []string
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		out = append(out, filepath.Join(xdg, "opencode", "opencode.db"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		out = append(out, filepath.Join(home, ".local", "share", "opencode", "opencode.db"))
	}
	// Legacy cache-dir fallback kept last so it never masks the real path.
	if cache := userCacheDir(); cache != "" {
		out = append(out, filepath.Join(cache, "opencode", "opencode.db"))
	}
	return out
}

// DefaultOpenCodeDBPath returns the OpenCode sqlite db path.
//
// OPENCODE_DB is authoritative when set (returned even if the file is currently
// missing): DefaultProviders gates registration on os.Stat, and an explicit user
// override must never silently fall back to a different DB elsewhere on disk.
// When it is unset, the first existing candidate among XDG data home /
// ~/.local/share / legacy cache dir is returned, or "" when none exists.
func DefaultOpenCodeDBPath() string {
	if envPath := os.Getenv("OPENCODE_DB"); envPath != "" {
		return envPath
	}
	for _, p := range openCodeDBCandidates() {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p
		}
	}
	return ""
}

// DefaultProviders returns the scan providers for this machine: the four
// compile-time providers plus every registered declarative provider (config
// section "agent:sessionproviders", merged with the built-in entries).
//
// Declarative providers are an additive channel: they go through the exact same
// Manager scan pipeline (single-flight, budgets, SQLite index) — no separate
// scan entry point.
func DefaultProviders() []Provider {
	return defaultProvidersWithSettings(wconfig.ReadFullConfig().Settings)
}

// defaultProvidersWithSettings is the injectable form of DefaultProviders so
// tests can exercise the config-declared branch without touching the user's
// settings.json.
func defaultProvidersWithSettings(settings wconfig.SettingsType) []Provider {
	var providers []Provider
	if dir := DefaultCodexSessionsDir(); dir != "" {
		providers = append(providers, NewCodexProvider(dir))
	}
	if dirs := DefaultClaudeProjectDirs(); len(dirs) > 0 {
		providers = append(providers, NewClaudeProvider(dirs))
	}
	// Gated on os.Stat (unlike codex/claude above) because the default OpenCode
	// DB path may not exist on machines that never ran OpenCode; List() would
	// otherwise surface a misleading "no such file" error on every scan.
	if dbPath := DefaultOpenCodeDBPath(); dbPath != "" {
		if _, err := os.Stat(dbPath); err == nil {
			providers = append(providers, NewOpenCodeProvider(dbPath))
		}
	}
	// Gated on os.Stat for the same reason: only register Pi when its dir actually
	// exists, so machines that never ran Pi get a clean empty list rather than an error.
	if piDir := DefaultPiSessionsDir(); piDir != "" {
		if info, err := os.Stat(piDir); err == nil && info.IsDir() {
			providers = append(providers, NewPiProvider(piDir))
		}
	}
	// Declarative providers last: pure config, no compile-time knowledge of the
	// agent. Same os.Stat gate as opencode/pi — a machine without the agent gets
	// a clean empty list instead of a scan error on every refresh.
	sessionProviders := mergeSessionProviderConfigs(settings)
	for _, name := range sortedSessionProviderNames(sessionProviders) {
		cfg := sessionProviders[name]
		if cfg.Disabled || strings.ToLower(cfg.Type) != SessionProviderTypeSQLite {
			continue
		}
		if info, err := os.Stat(cfg.DB); err != nil || info.IsDir() {
			continue
		}
		providers = append(providers, NewDeclarativeSQLiteProvider(name, cfg))
	}
	return providers
}

// SourceStatus describes one potential session source for the GUI source
// filter / source badge: its id, its user-facing label, and whether it is
// currently registered (the os.Stat gate passed).
type SourceStatus struct {
	Source    string `json:"source"`
	Label     string `json:"label"`
	Available bool   `json:"available"`
}

// SourceStatuses enumerates every potential session source — the four
// compile-time providers plus every registrable declarative config entry —
// in stable source-lexicographic order. Unregistered sources are reported
// with Available=false instead of being hidden, so the frontend can decide
// whether to grey them out; the frontend keeps its built-in label/icon table
// for ids the backend labels with the bare source id (the compile-time
// providers do not implement LabeledProvider).
func SourceStatuses() []SourceStatus {
	return sourceStatusesWithSettings(wconfig.ReadFullConfig().Settings)
}

// sourceStatusesWithSettings is the injectable form of SourceStatuses so
// tests can exercise the config-declared branch without touching the user's
// settings.json.
func sourceStatusesWithSettings(settings wconfig.SettingsType) []SourceStatus {
	registered := make(map[string]Provider)
	for _, p := range defaultProvidersWithSettings(settings) {
		registered[p.Source()] = p
	}
	seen := make(map[string]bool)
	var out []SourceStatus
	add := func(source, label string, available bool) {
		if source == "" || seen[source] {
			return
		}
		seen[source] = true
		out = append(out, SourceStatus{Source: source, Label: label, Available: available})
	}
	for _, id := range []string{SourceClaude, SourceCodex, SourceOpenCode, SourcePi} {
		label := id
		if p, ok := registered[id]; ok {
			// ProviderLabel falls back to the source id for the compile-time
			// providers: the frontend's CHAT_SOURCES table owns their labels.
			label = ProviderLabel(p)
		}
		add(id, label, registered[id] != nil)
	}
	merged := mergeSessionProviderConfigs(settings)
	for _, name := range sortedSessionProviderNames(merged) {
		label := strings.TrimSpace(merged[name].Label)
		if label == "" {
			label = name
		}
		if p, ok := registered[name]; ok {
			label = ProviderLabel(p)
		}
		add(name, label, registered[name] != nil)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Source < out[j].Source })
	return out
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool)
	var rtn []string
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		rtn = append(rtn, value)
	}
	return rtn
}
