// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcatalog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func writeFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestDiscoverPiUsesModelsAndSettings(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "models.json", `{
	  "providers": {
	    "deepseek": { "name": "mydeepseek", "models": [
	      { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
	      { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" }
	    ]},
	    "openai": { "models": [ { "id": "gpt-4" } ] }
	  }
	}`)
	writeFile(t, dir, "settings.json", `{"defaultProvider":"deepseek","defaultModel":"deepseek-v4-pro"}`)

	models := discoverModels("pi")
	if len(models) != 3 {
		t.Fatalf("models = %#v", models)
	}
	if models[0].Id != "deepseek-v4-pro" || models[0].Provider != "deepseek" || !models[0].Default {
		t.Fatalf("default provider should come first: %#v", models[0])
	}
	if models[2].Label != "gpt-4" {
		t.Fatalf("label fallback = %q", models[2].Label)
	}
}

func TestDiscoverCodexCacheAndRootModel(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "models_cache.json", `{"models":[
	  {"slug":"gpt-5.5","display_name":"GPT-5.5","visibility":"list"},
	  {"slug":"internal","display_name":"Internal","visibility":"hide"}
	]}`)
	writeFile(t, dir, "config.toml", `model = "gpt-5.4"
model_reasoning_effort = "high"

[model_providers.custom]
model = "should-be-ignored"
`)

	models := discoverModels("codex")
	if len(models) != 2 {
		t.Fatalf("models = %#v", models)
	}
	if models[0].Id != "gpt-5.4" || !models[0].Default {
		t.Fatalf("configured model should be default: %#v", models[0])
	}
	if models[1].Id != "gpt-5.5" || models[1].Label != "GPT-5.5" || models[1].Default {
		t.Fatalf("cache entry = %#v", models[1])
	}
}

func TestDiscoverCodexRootModelOnly(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "config.toml", `model = "custom-provider-model"
`)
	models := discoverModels("codex")
	if len(models) != 1 || models[0].Id != "custom-provider-model" || !models[0].Default {
		t.Fatalf("models = %#v", models)
	}
}

func TestDiscoverClaudeEnvModels(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "settings.json", `{"env":{
	  "ANTHROPIC_MODEL":"glm-5.3",
	  "ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.3",
	  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":"GLM 5.3",
	  "ANTHROPIC_DEFAULT_HAIKU_MODEL":"claude-haiku-4-5"
	}}`)

	models := discoverModels("claude")
	if len(models) != 2 {
		t.Fatalf("models = %#v", models)
	}
	if models[0].Id != "glm-5.3" || !models[0].Default {
		t.Fatalf("ANTHROPIC_MODEL should be first/default: %#v", models[0])
	}
	if models[1].Id != "claude-haiku-4-5" {
		t.Fatalf("second = %#v", models[1])
	}
}

func TestDiscoverOpencodeJSONC(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "opencode.jsonc", `{
	  // comment
	  "model": "openai/gpt-5",
	  "provider": {
	    "openai": { "models": { "gpt-5": { "name": "GPT-5" }, }, },
	    "local": { "models": { "llama-local": {} } },
	  },
	}`)

	models := discoverModels("opencode")
	if len(models) != 2 {
		t.Fatalf("models = %#v", models)
	}
	var gpt5 *wconfig.AgentModelConfigType
	for i := range models {
		if models[i].Id == "gpt-5" {
			gpt5 = &models[i]
		}
	}
	if gpt5 == nil || gpt5.Label != "GPT-5" || !gpt5.Default {
		t.Fatalf("gpt-5 entry = %#v", gpt5)
	}
}

func TestDiscoverGeminiSettings(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "settings.json", `{"model":{"name":"gemini-2.5-pro"}}`)
	models := discoverModels("gemini")
	if len(models) != 1 || models[0].Id != "gemini-2.5-pro" || !models[0].Default {
		t.Fatalf("models = %#v", models)
	}
}

func TestConfigModelsOverrideDiscovery(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "models.json", `{"providers":{"deepseek":{"models":[{"id":"from-discovery"}]}}}`)

	p := ResolveWithSettings("pi", wconfig.SettingsType{
		AgentProfiles: map[string]wconfig.AgentProfileConfigType{
			"pi": {Models: []wconfig.AgentModelConfigType{{Id: "from-config", Default: true}}},
		},
	})
	if len(p.Models) != 1 || p.Models[0].Id != "from-config" || p.Models[0].Source != "config" {
		t.Fatalf("config models should win: %#v", p.Models)
	}
}

func TestDiscoverySourceIsReported(t *testing.T) {
	dir := isolateAgentDirs(t)
	writeFile(t, dir, "models.json", `{"providers":{"deepseek":{"models":[{"id":"deepseek-v4-pro"}]}}}`)
	p := ResolveWithSettings("pi", wconfig.SettingsType{})
	if len(p.Models) != 1 || p.Models[0].Source != "discovery" {
		t.Fatalf("models = %#v", p.Models)
	}
}

func TestStripJSONComments(t *testing.T) {
	in := "{\n // x\n \"a\": \"http://keep//me\", /* c */ \"b\": [1,2,],\n}"
	out := stripJSONComments(in)
	if out != "{\n \n \"a\": \"http://keep//me\",  \"b\": [1,2]\n}" {
		t.Fatalf("out = %q", out)
	}
}
