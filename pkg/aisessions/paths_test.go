// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
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

// declarativeFixtureSettings builds settings whose "agent:sessionproviders"
// section points a custom key at a fixture db (real Antigravity shape).
func declarativeFixtureSettings(t *testing.T, mutate func(cfg *wconfig.AgentSessionProviderConfigType)) wconfig.SettingsType {
	t.Helper()
	cfg := wconfig.AgentSessionProviderConfigType{
		Label:   "My Agent",
		Type:    "sqlite",
		DB:      createDeclarativeFixtureDB(t),
		Table:   "conversation_summaries",
		Columns: defaultSessionProviderColumns(),
	}
	if mutate != nil {
		mutate(&cfg)
	}
	return wconfig.SettingsType{
		AgentSessionProviders: map[string]wconfig.AgentSessionProviderConfigType{
			"myagent": cfg,
		},
	}
}

func TestDefaultProviders_RegistersDeclarativeProviderFromSettings(t *testing.T) {
	settings := declarativeFixtureSettings(t, nil)

	var provider Provider
	for _, p := range defaultProvidersWithSettings(settings) {
		if p.Source() == "myagent" {
			provider = p
		}
	}
	if provider == nil {
		t.Fatal("declarative provider from settings not registered")
	}
	labeled, ok := provider.(LabeledProvider)
	if !ok {
		t.Fatalf("declarative provider must implement LabeledProvider")
	}
	if label := labeled.Label(); label != "My Agent" {
		t.Errorf("label = %q, want the configured label", label)
	}
	if _, err := provider.List(context.Background()); err != nil {
		t.Errorf("registered declarative provider cannot list its fixture db: %v", err)
	}
}

func TestDefaultProviders_DisabledDeclarativeProviderNotRegistered(t *testing.T) {
	settings := declarativeFixtureSettings(t, func(cfg *wconfig.AgentSessionProviderConfigType) {
		cfg.Disabled = true
	})
	for _, p := range defaultProvidersWithSettings(settings) {
		if p.Source() == "myagent" {
			t.Error("disabled declarative provider should not be registered")
		}
	}
}

func TestDefaultProviders_DeclarativeProviderMissingDBNotRegistered(t *testing.T) {
	settings := declarativeFixtureSettings(t, func(cfg *wconfig.AgentSessionProviderConfigType) {
		cfg.DB = filepath.Join(t.TempDir(), "nonexistent.db")
	})
	for _, p := range defaultProvidersWithSettings(settings) {
		if p.Source() == "myagent" {
			t.Error("declarative provider should not be registered when its db does not exist")
		}
	}
}

func TestDefaultProviders_RegistersBuiltinAntigravity(t *testing.T) {
	// Point ~ at a temp home containing the Antigravity summary db: the built-in
	// entry must register with zero user config.
	home := isolateHome(t)
	antigravityDir := filepath.Join(home, ".gemini", "antigravity-cli")
	if err := os.MkdirAll(antigravityDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(antigravityDir, "conversation_summaries.db"), []byte("placeholder"), 0o600); err != nil {
		t.Fatal(err)
	}

	var provider Provider
	for _, p := range defaultProvidersWithSettings(wconfig.SettingsType{}) {
		if p.Source() == SourceAntigravity {
			provider = p
		}
	}
	if provider == nil {
		t.Fatal("built-in antigravity entry not registered")
	}
	if label := ProviderLabel(provider); label != "Antigravity" {
		t.Errorf("label = %q, want Antigravity", label)
	}
}

func sourceStatusFor(statuses []SourceStatus, source string) (SourceStatus, bool) {
	for _, status := range statuses {
		if status.Source == source {
			return status, true
		}
	}
	return SourceStatus{}, false
}

func TestSourceStatuses_DeclarativeAvailableAndSorted(t *testing.T) {
	// The built-in antigravity entry with a real db behind it: available with
	// its configured label, and the whole list sorted by source id.
	home := isolateHome(t)
	antigravityDir := filepath.Join(home, ".gemini", "antigravity-cli")
	if err := os.MkdirAll(antigravityDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(antigravityDir, "conversation_summaries.db"), []byte("placeholder"), 0o600); err != nil {
		t.Fatal(err)
	}

	statuses := sourceStatusesWithSettings(wconfig.SettingsType{})
	antigravity, ok := sourceStatusFor(statuses, SourceAntigravity)
	if !ok {
		t.Fatal("built-in antigravity entry missing from source statuses")
	}
	if !antigravity.Available {
		t.Error("antigravity should be available when its db exists")
	}
	if antigravity.Label != "Antigravity" {
		t.Errorf("label = %q, want the built-in label Antigravity", antigravity.Label)
	}
	for i := 1; i < len(statuses); i++ {
		if statuses[i-1].Source >= statuses[i].Source {
			t.Errorf("source statuses not sorted by source: %q >= %q", statuses[i-1].Source, statuses[i].Source)
		}
	}
}

func TestSourceStatuses_MissingDBReportsUnavailable(t *testing.T) {
	// A machine without ~/.gemini: antigravity stays in the list (so the GUI
	// can grey it out) but is not registered.
	isolateHome(t)

	statuses := sourceStatusesWithSettings(wconfig.SettingsType{})
	antigravity, ok := sourceStatusFor(statuses, SourceAntigravity)
	if !ok {
		t.Fatal("built-in antigravity entry missing from source statuses")
	}
	if antigravity.Available {
		t.Error("antigravity should be unavailable when its db is missing")
	}
	if antigravity.Label != "Antigravity" {
		t.Errorf("label = %q, want the built-in label Antigravity", antigravity.Label)
	}
}

func TestSourceStatuses_UserOverrideLabelAndDisable(t *testing.T) {
	// A user entry pointing at a real fixture db: available with the user's
	// label; a disabled sibling entry disappears entirely.
	settings := declarativeFixtureSettings(t, nil)
	disabledCfg := settings.AgentSessionProviders["myagent"]
	disabledCfg.Disabled = true
	settings.AgentSessionProviders["myagent-disabled"] = disabledCfg

	statuses := sourceStatusesWithSettings(settings)
	entry, ok := sourceStatusFor(statuses, "myagent")
	if !ok {
		t.Fatal("user declarative entry missing from source statuses")
	}
	if !entry.Available {
		t.Error("user declarative entry should be available when its db exists")
	}
	if entry.Label != "My Agent" {
		t.Errorf("label = %q, want My Agent", entry.Label)
	}
	if _, ok := sourceStatusFor(statuses, "myagent-disabled"); ok {
		t.Error("disabled declarative entry should not appear in source statuses")
	}
}
