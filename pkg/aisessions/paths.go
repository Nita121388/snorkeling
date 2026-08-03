// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"os"
	"path/filepath"
	"runtime"

	"github.com/wavetermdev/waveterm/pkg/ccswitch"
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

// userCacheDir returns the OS cache dir, or "" when unavailable. OpenCode stores
// its sqlite db under <userCacheDir>/opencode/opencode.db by default.
func userCacheDir() string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		return ""
	}
	return dir
}

// DefaultOpenCodeDBPath returns the configured/default OpenCode sqlite db path,
// or "" when neither env nor a cache dir is available.
func DefaultOpenCodeDBPath() string {
	if envPath := os.Getenv("OPENCODE_DB"); envPath != "" {
		return envPath
	}
	cache := userCacheDir()
	if cache == "" {
		return ""
	}
	return filepath.Join(cache, "opencode", "opencode.db")
}

func DefaultProviders() []Provider {
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
	return providers
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
