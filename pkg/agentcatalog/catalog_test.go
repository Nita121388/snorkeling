// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcatalog

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestListIncludesBuiltinProfiles(t *testing.T) {
	withSettings(t, wconfig.SettingsType{}, func(s wconfig.SettingsType) {
		profiles := ListWithSettings(s)
		if len(profiles) != len(builtinProfiles) {
			t.Fatalf("expected %d builtin profiles, got %d", len(builtinProfiles), len(profiles))
		}
		names := make(map[string]ProfileInfo, len(profiles))
		for _, p := range profiles {
			names[p.Name] = p
		}
		pi, ok := names["pi"]
		if !ok {
			t.Fatal("pi profile missing")
		}
		if pi.Cmd != "pi" || pi.ModelFlag != "--model" || pi.Label != "Pi" {
			t.Fatalf("unexpected pi profile: %#v", pi)
		}
		if len(pi.Models) != 0 || pi.DefaultModel != "" {
			t.Fatalf("pi should start with no discovered models: %#v", pi)
		}
		if names["codex"].DefaultModel != "" || len(names["codex"].Models) != 0 {
			t.Fatalf("codex should start with no models: %#v", names["codex"])
		}
	})
}

func TestResolveOverridesBuiltin(t *testing.T) {
	withSettings(t, wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"pi": {
				Label:     "Pi Custom",
				Cmd:       "/opt/pi/bin/pi",
				ModelFlag: "-m",
				Args:      []string{"--mode", "rpc"},
				Model:     "gpt-5",
			},
		},
	}, func(s wconfig.SettingsType) {
		pi := ResolveWithSettings("pi", s)
		if pi.Cmd != "/opt/pi/bin/pi" {
			t.Fatalf("cmd = %q", pi.Cmd)
		}
		if pi.ModelFlag != "-m" {
			t.Fatalf("modelflag = %q", pi.ModelFlag)
		}
		if pi.Label != "Pi Custom" {
			t.Fatalf("label = %q", pi.Label)
		}
		if pi.Source != "config" {
			t.Fatalf("source = %q", pi.Source)
		}
		if len(pi.Args) != 2 || pi.Args[0] != "--mode" || pi.Args[1] != "rpc" {
			t.Fatalf("args = %#v", pi.Args)
		}
		// With no discovery the configured profile.model is the only model.
		if pi.DefaultModel != "gpt-5" {
			t.Fatalf("default model = %q", pi.DefaultModel)
		}
		if len(pi.Models) != 1 || pi.Models[0].Id != "gpt-5" || !pi.Models[0].Default {
			t.Fatalf("models = %#v", pi.Models)
		}
	})
}

func TestResolveCustomProfileWithoutModels(t *testing.T) {
	withSettings(t, wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"myagent": {Cmd: "myagent", Model: "custom-model-1"},
		},
	}, func(s wconfig.SettingsType) {
		p := ResolveWithSettings("myagent", s)
		if p.Source != "config" || p.Label != "myagent" {
			t.Fatalf("unexpected profile: %#v", p)
		}
		if len(p.Models) != 1 || p.Models[0].Id != "custom-model-1" {
			t.Fatalf("models = %#v", p.Models)
		}
		if p.DefaultModel != "custom-model-1" || !p.Models[0].Default {
			t.Fatalf("default not normalized: %#v", p)
		}
	})
}

func TestResolveConfiguredModelsDedupeAndDefault(t *testing.T) {
	withSettings(t, wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"codex": {
				Models: []wconfig.AgentModelConfigType{
					{Id: "gpt-5", Label: "GPT-5", Provider: "openai"},
					{Id: "gpt-5", Label: "Duplicate", Provider: "ignored"},
					{Id: "o3", Provider: "openai"},
					{Id: "", Label: "empty id is dropped"},
				},
				Model: "o3",
			},
		},
	}, func(s wconfig.SettingsType) {
		p := ResolveWithSettings("codex", s)
		if len(p.Models) != 2 {
			t.Fatalf("models = %#v", p.Models)
		}
		if p.Models[0].Id != "gpt-5" || p.Models[0].Label != "GPT-5" {
			t.Fatalf("first model = %#v", p.Models[0])
		}
		// label falls back to the id
		if p.Models[1].Id != "o3" || p.Models[1].Label != "o3" {
			t.Fatalf("second model = %#v", p.Models[1])
		}
		if p.Models[0].Source != "config" || p.Models[1].Source != "config" {
			t.Fatalf("sources = %q/%q", p.Models[0].Source, p.Models[1].Source)
		}
		// configured default wins over position
		if p.DefaultModel != "o3" || !p.Models[1].Default || p.Models[0].Default {
			t.Fatalf("defaults not normalized: %#v", p.Models)
		}
	})
}

func TestResolveExplicitDefaultFlagWins(t *testing.T) {
	withSettings(t, wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"claude": {
				Models: []wconfig.AgentModelConfigType{
					{Id: "a"},
					{Id: "b", Default: true},
				},
			},
		},
	}, func(s wconfig.SettingsType) {
		p := ResolveWithSettings("claude", s)
		if p.DefaultModel != "b" {
			t.Fatalf("default = %q", p.DefaultModel)
		}
	})
}

func TestResolveEmptyProfile(t *testing.T) {
	withSettings(t, wconfig.SettingsType{}, func(s wconfig.SettingsType) {
		p := ResolveWithSettings("brand-new-agent", s)
		if p.Cmd != "brand-new-agent" || p.ModelFlag != "--model" {
			t.Fatalf("unexpected fallback: %#v", p)
		}
		if len(p.Models) != 0 || p.DefaultModel != "" {
			t.Fatalf("expected no models: %#v", p)
		}
	})
}

func TestListSkipsCommandlessCustomProfile(t *testing.T) {
	withSettings(t, wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"broken": {Label: "no cmd"},
			"real":   {Cmd: "real"},
		},
	}, func(s wconfig.SettingsType) {
		names := []string{}
		for _, p := range ListWithSettings(s) {
			names = append(names, p.Name)
		}
		if len(names) != len(builtinProfiles)+1 {
			t.Fatalf("names = %v", names)
		}
		for _, n := range names {
			if n == "broken" {
				t.Fatal("profile without cmd should not be listed")
			}
		}
	})
}

func TestResolverExtensionPoint(t *testing.T) {
	RegisterModelResolver(func(name string, cfg wconfig.AgentProfileConfigType) []wconfig.AgentModelConfigType {
		if name != "gemini" {
			return nil
		}
		return []wconfig.AgentModelConfigType{{Id: "from-resolver", Default: true}}
	})
	defer func() {
		modelResolvers = nil
	}()
	withSettings(t, wconfig.SettingsType{}, func(s wconfig.SettingsType) {
		p := ResolveWithSettings("gemini", s)
		if len(p.Models) != 1 || p.Models[0].Id != "from-resolver" {
			t.Fatalf("models = %#v", p.Models)
		}
		if p.DefaultModel != "from-resolver" {
			t.Fatalf("default = %q", p.DefaultModel)
		}
	})
}

// withSettings runs fn against an in-memory settings snapshot and an empty,
// isolated home so per-agent file discovery never reads the developer machine.
func withSettings(t *testing.T, settings wconfig.SettingsType, fn func(wconfig.SettingsType)) {
	t.Helper()
	isolateAgentDirs(t)
	fn(settings)
}

// isolateAgentDirs points every supported agent's config directory at a fresh
// temp dir, so discovery returns nothing unless the test creates files.
func isolateAgentDirs(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	t.Setenv("CODEX_HOME", dir)
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("OPENCODE_HOME", dir)
	t.Setenv("GEMINI_CONFIG_DIR", dir)
	return dir
}

func TestListMarksDefaultProfile(t *testing.T) {
	withSettings(t, wconfig.SettingsType{AgentDefaultProfile: "codex"}, func(s wconfig.SettingsType) {
		for _, p := range ListWithSettings(s) {
			if want := p.Name == "codex"; p.Default != want {
				t.Fatalf("profile %q Default=%v, want %v", p.Name, p.Default, want)
			}
		}
	})
}

func TestListDefaultsToPiWhenUnset(t *testing.T) {
	withSettings(t, wconfig.SettingsType{}, func(s wconfig.SettingsType) {
		for _, p := range ListWithSettings(s) {
			if want := p.Name == "pi"; p.Default != want {
				t.Fatalf("profile %q Default=%v, want %v", p.Name, p.Default, want)
			}
		}
	})
}
