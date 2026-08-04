// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// opencodeVendorsRoot returns the per-waveDataDir directory that holds one subdirectory per
// opencode vendor ID, each containing an opencode.json the spawned opencode reads via
// OPENCODE_HOME. Mirrors claudeVendorsRoot: lives under GetWaveDataDir() so dev/prod and
// local/remote instances stay isolated.
func opencodeVendorsRoot() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "opencode-vendors")
}

// materializeOpenCodeConfigDir writes a vendor-scoped opencode.json ({"env": <vendorEnv>}) into
// <waveDataDir>/opencode-vendors/<vendorID>/opencode.json and returns the directory path.
//
// Idempotent: if the existing file already serializes to the same JSON bytes, we skip the rewrite
// so concurrent readers don't churn the mtime or race each other. The directory is created 0700
// because vendor env may carry auth tokens; we don't want the file world-readable on shared hosts.
//
// Returns ("", nil) on any I/O error — caller silently degrades to the old OS-env-only path.
// Mirrors materializeClaudeConfigDir minus the hooks.json inheritance (opencode has no
// equivalent of Claude's global ~/.claude/settings.json hooks block to inherit).
func materializeOpenCodeConfigDir(vendorID string, vendorEnv map[string]string) (string, error) {
	if !validVendorID(vendorID) {
		return "", fmt.Errorf("invalid vendor id %q", vendorID)
	}
	dir := filepath.Join(opencodeVendorsRoot(), vendorID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	settingsPath := filepath.Join(dir, "opencode.json")
	settingsDoc := map[string]any{"env": vendorEnv}
	newBytes, err := json.MarshalIndent(settingsDoc, "", "  ")
	if err != nil {
		return "", err
	}
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
