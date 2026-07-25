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

func DefaultProviders() []Provider {
	var providers []Provider
	if dir := DefaultCodexSessionsDir(); dir != "" {
		providers = append(providers, NewCodexProvider(dir))
	}
	if dirs := DefaultClaudeProjectDirs(); len(dirs) > 0 {
		providers = append(providers, NewClaudeProvider(dirs))
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
