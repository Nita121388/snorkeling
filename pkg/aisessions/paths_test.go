// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultProviders_RegistersOpenCodeAndPi(t *testing.T) {
	// Set env vars to valid temp paths so the helpers return them.
	opencodeDB := filepath.Join(t.TempDir(), "opencode.db")
	piDir := filepath.Join(t.TempDir(), "pi-sessions")
	// Create the files/dirs so the existence check passes.
	if err := os.WriteFile(opencodeDB, []byte("placeholder"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(piDir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENCODE_DB", opencodeDB)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", piDir)

	providers := DefaultProviders()

	var foundOpenCode, foundPi bool
	for _, p := range providers {
		switch p.Source() {
		case SourceOpenCode:
			foundOpenCode = true
		case SourcePi:
			foundPi = true
		}
	}
	if !foundOpenCode {
		t.Error("expected OpenCode provider to be registered in DefaultProviders")
	}
	if !foundPi {
		t.Error("expected Pi provider to be registered in DefaultProviders")
	}
}

func TestDefaultProviders_OpenCodeMissingDBNotRegistered(t *testing.T) {
	// Env is set to a path that does not exist on disk.
	t.Setenv("OPENCODE_DB", filepath.Join(t.TempDir(), "nonexistent.db"))
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", filepath.Join(t.TempDir(), "nonexistent-pi"))

	providers := DefaultProviders()
	for _, p := range providers {
		if p.Source() == SourceOpenCode {
			t.Error("OpenCode provider should not be registered when DB file does not exist")
		}
		if p.Source() == SourcePi {
			t.Error("Pi provider should not be registered when sessions dir does not exist")
		}
	}
}
