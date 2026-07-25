// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package ccswitch

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVendorIsolationStatusRedactsSecrets(t *testing.T) {
	useTestWaveDataDir(t)
	configDir := filepath.Join(claudeVendorsRoot(), "vendor-a")
	writeTestFile(t, filepath.Join(configDir, "settings.json"), []byte(`{
  "env": {"ANTHROPIC_AUTH_TOKEN": "secret-token", "MODEL": "model-a"},
  "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "safe-command"}]}]},
  "nested": {"password": "secret-password"}
}`))
	status := readVendorIsolationStatus(CcSwitchProviderAppType, Vendor{
		ID: "vendor-a", Name: "Vendor A", ClaudeConfigDir: configDir,
	})
	if status.State != "ready" || status.EnvCount != 2 || status.HookEventCount != 1 {
		t.Fatalf("unexpected status: %#v", status)
	}
	if strings.Contains(status.RedactedJSON, "secret-token") || strings.Contains(status.RedactedJSON, "secret-password") {
		t.Fatalf("secret leaked in diagnostic preview: %s", status.RedactedJSON)
	}
	if !strings.Contains(status.RedactedJSON, redactedValue) || !strings.Contains(status.RedactedJSON, "safe-command") {
		t.Fatalf("unexpected redacted preview: %s", status.RedactedJSON)
	}
	var preview map[string]any
	if err := json.Unmarshal([]byte(status.RedactedJSON), &preview); err != nil {
		t.Fatal(err)
	}
}

func TestVendorIsolationStatusDoesNotExposeToml(t *testing.T) {
	useTestWaveDataDir(t)
	configDir := filepath.Join(codexVendorsRoot(), "vendor-a")
	writeTestFile(t, filepath.Join(configDir, "config.toml"), []byte(`api_key = "secret-key"`))
	writeTestFile(t, filepath.Join(configDir, "auth.json"), []byte(`{"OPENAI_API_KEY":"secret-key"}`))
	status := readVendorIsolationStatus(CcSwitchProviderAppTypeCodex, Vendor{
		ID: "vendor-a", Name: "Vendor A", CodexConfigDir: configDir,
	})
	if strings.Contains(status.RedactedJSON, "secret-key") || !strings.Contains(status.RedactedJSON, "CONTENT HIDDEN") {
		t.Fatalf("codex secret leaked in diagnostic preview: %s", status.RedactedJSON)
	}
	if _, err := os.Stat(filepath.Join(configDir, "config.toml")); err != nil {
		t.Fatalf("diagnostic modified config: %v", err)
	}
}
