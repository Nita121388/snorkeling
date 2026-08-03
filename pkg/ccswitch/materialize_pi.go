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

// WHY this file exists: cc-switch (upstream farion1231/cc-switch, as of 2026-08-03) does NOT
// include "pi" in its VisibleApps type union — the supported app_types are
// claude/codex/gemini/grokbuild/opencode/openclaw/hermes. cc-switch therefore never stores a
// providers row with app_type='pi', so the case CcSwitchProviderAppTypePi branch in listVendors
// matches zero rows today and materializePiConfigDir is never invoked from the production read
// path. This code is kept anyway for plan-architectural completeness and forward compatibility:
// if cc-switch adds pi upstream (or a fork writes pi rows), Wave's per-vendor isolation for pi
// blocks already works without another code change here.

// piVendorsRoot returns the per-waveDataDir directory that holds one subdirectory per pi vendor
// ID, each containing a config.json the spawned pi agent reads via PI_CODING_AGENT_SESSION_DIR.
// Mirrors claudeVendorsRoot: lives under GetWaveDataDir() so dev/prod and local/remote instances
// stay isolated.
func piVendorsRoot() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "pi-vendors")
}

// materializePiConfigDir writes a vendor-scoped config.json ({"env": <vendorEnv>}) into
// <waveDataDir>/pi-vendors/<vendorID>/config.json and returns the directory path.
//
// Idempotent: if the existing file already serializes to the same JSON bytes, we skip the rewrite
// so concurrent readers don't churn the mtime or race each other. The directory is created 0700
// because vendor env may carry auth tokens; we don't want the file world-readable on shared hosts.
//
// Returns ("", nil) on any I/O error — caller silently degrades to the old OS-env-only path.
// Mirrors materializeOpenCodeConfigDir (which itself mirrors materializeClaudeConfigDir minus the
// hooks.json inheritance).
func materializePiConfigDir(vendorID string, vendorEnv map[string]string) (string, error) {
	if !validVendorID(vendorID) {
		return "", fmt.Errorf("invalid vendor id %q", vendorID)
	}
	dir := filepath.Join(piVendorsRoot(), vendorID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	settingsPath := filepath.Join(dir, "config.json")
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
