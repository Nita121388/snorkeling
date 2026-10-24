// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcatalog

// Per-agent model discovery.
//
// The catalog must never invent model IDs. Each agent already stores the models
// the user actually configured, in a different place:
//
//   - pi:        <PI_CODING_AGENT_DIR>/models.json (+ settings.json default)
//   - codex:     <CODEX_HOME>/models_cache.json + config.toml `model`
//   - claude:    <CLAUDE_CONFIG_DIR>/settings.json env ANTHROPIC_*MODEL
//   - opencode:  <OPENCODE_HOME or XDG>/opencode.json[c]
//   - gemini:    <GEMINI_CONFIG_DIR>/settings.json
//
// Discovery is read-only and file-based: no subprocesses, no network, no writes.
// Slow CLI probes (`pi --list-models` ~11s, `opencode models` ~6s) are deliberately
// kept out of the synchronous RPC path.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func discoverModels(name string) []wconfig.AgentModelConfigType {
	switch name {
	case "pi":
		return discoverPi()
	case "codex":
		return discoverCodex()
	case "claude":
		return discoverClaude()
	case "opencode":
		return discoverOpencode()
	case "gemini":
		return discoverGemini()
	default:
		return nil
	}
}

// --- pi -------------------------------------------------------------------

type piModelsFile struct {
	Providers map[string]struct {
		Name   string `json:"name"`
		Models []struct {
			Id   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	} `json:"providers"`
}

type piSettingsFile struct {
	DefaultProvider string `json:"defaultProvider"`
	DefaultModel    string `json:"defaultModel"`
}

func discoverPi() []wconfig.AgentModelConfigType {
	dir := resolveConfigDir("PI_CODING_AGENT_DIR", ".pi", "agent")
	var modelsFile piModelsFile
	if !readJSONFile(filepath.Join(dir, "models.json"), &modelsFile) {
		return nil
	}
	var settings piSettingsFile
	readJSONFile(filepath.Join(dir, "settings.json"), &settings)

	providers := make([]string, 0, len(modelsFile.Providers))
	for provider := range modelsFile.Providers {
		providers = append(providers, provider)
	}
	sort.Strings(providers)
	// Put the default provider first so its default model wins dedupe.
	if settings.DefaultProvider != "" {
		sort.SliceStable(providers, func(i, j int) bool {
			return providers[i] == settings.DefaultProvider && providers[j] != settings.DefaultProvider
		})
	}

	var out []wconfig.AgentModelConfigType
	for _, provider := range providers {
		info := modelsFile.Providers[provider]
		for _, m := range info.Models {
			if strings.TrimSpace(m.Id) == "" {
				continue
			}
			label := m.Name
			if label == "" {
				label = m.Id
			}
			out = append(out, wconfig.AgentModelConfigType{
				Id:       m.Id,
				Label:    label,
				Provider: provider,
				Default:  provider == settings.DefaultProvider && m.Id == settings.DefaultModel,
			})
		}
	}
	return dedupeDiscoveryModels(out)
}

// --- codex ----------------------------------------------------------------

type codexModelsCache struct {
	Models []struct {
		Slug        string `json:"slug"`
		DisplayName string `json:"display_name"`
		Visibility  string `json:"visibility"`
	} `json:"models"`
}

func discoverCodex() []wconfig.AgentModelConfigType {
	dir := resolveConfigDir("CODEX_HOME", ".codex")
	defaultModel := readCodexDefaultModel(filepath.Join(dir, "config.toml"))

	var out []wconfig.AgentModelConfigType
	var cache codexModelsCache
	if readJSONFile(filepath.Join(dir, "models_cache.json"), &cache) {
		for _, m := range cache.Models {
			if m.Slug == "" {
				continue
			}
			// "hide" entries are internal/unlisted; only advertise listable ones.
			if m.Visibility != "" && m.Visibility != "list" {
				continue
			}
			label := m.DisplayName
			if label == "" {
				label = m.Slug
			}
			out = append(out, wconfig.AgentModelConfigType{
				Id:      m.Slug,
				Label:   label,
				Default: m.Slug == defaultModel,
			})
		}
	}
	// The configured model may be a custom provider model that is not in the
	// official cache; keep it selectable as the default.
	if defaultModel != "" && !containsModel(out, defaultModel) {
		out = append([]wconfig.AgentModelConfigType{{Id: defaultModel, Label: defaultModel, Default: true}}, out...)
	}
	return dedupeDiscoveryModels(out)
}

// readCodexDefaultModel parses the top-level `model = "..."` from config.toml.
// We deliberately avoid a TOML dependency: only the root table is relevant, and
// `model =` under [profiles.*] must not win.
func readCodexDefaultModel(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			break // tables have started; the root model has been passed
		}
		if !strings.HasPrefix(trimmed, "model") {
			continue
		}
		if v, ok := parseTOMLStringAssignment(trimmed, "model"); ok {
			return v
		}
	}
	return ""
}

func parseTOMLStringAssignment(line, key string) (string, bool) {
	rest := strings.TrimSpace(line[len(key):])
	if !strings.HasPrefix(rest, "=") {
		return "", false
	}
	value := strings.TrimSpace(rest[1:])
	if idx := strings.Index(value, "#"); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
		quote := value[0]
		if end := strings.IndexByte(value[1:], quote); end >= 0 {
			return value[1 : 1+end], true
		}
	}
	return "", false
}

// --- claude ---------------------------------------------------------------

func discoverClaude() []wconfig.AgentModelConfigType {
	dir := resolveConfigDir("CLAUDE_CONFIG_DIR", ".claude")
	var settings struct {
		Env map[string]string `json:"env"`
	}
	if !readJSONFile(filepath.Join(dir, "settings.json"), &settings) {
		return nil
	}
	env := settings.Env

	type slot struct{ modelKey, nameKey string }
	// Order matters: ANTHROPIC_MODEL is the active default, the tier models follow.
	slots := []slot{
		{"ANTHROPIC_MODEL", ""},
		{"ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"},
		{"ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME"},
		{"ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME"},
	}
	var out []wconfig.AgentModelConfigType
	for i, s := range slots {
		id := strings.TrimSpace(env[s.modelKey])
		if id == "" {
			continue
		}
		label := id
		if s.nameKey != "" {
			if name := strings.TrimSpace(env[s.nameKey]); name != "" {
				label = name
			}
		}
		out = append(out, wconfig.AgentModelConfigType{Id: id, Label: label, Default: i == 0})
	}
	return dedupeDiscoveryModels(out)
}

// --- opencode -------------------------------------------------------------

type opencodeConfig struct {
	Model    string `json:"model"`
	Provider map[string]struct {
		Models map[string]struct {
			Name string `json:"name"`
		} `json:"models"`
	} `json:"provider"`
}

func discoverOpencode() []wconfig.AgentModelConfigType {
	dir := resolveOpencodeDir()
	var cfg opencodeConfig
	loaded := readJSONCFile(filepath.Join(dir, "opencode.jsonc"), &cfg) ||
		readJSONFile(filepath.Join(dir, "opencode.json"), &cfg)
	if !loaded {
		return nil
	}

	providers := make([]string, 0, len(cfg.Provider))
	for p := range cfg.Provider {
		providers = append(providers, p)
	}
	sort.Strings(providers)

	var out []wconfig.AgentModelConfigType
	for _, p := range providers {
		ids := make([]string, 0, len(cfg.Provider[p].Models))
		for id := range cfg.Provider[p].Models {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			label := cfg.Provider[p].Models[id].Name
			if label == "" {
				label = id
			}
			out = append(out, wconfig.AgentModelConfigType{
				Id:       id,
				Label:    label,
				Provider: p,
				Default:  cfg.Model != "" && (cfg.Model == id || cfg.Model == p+"/"+id),
			})
		}
	}
	if cfg.Model != "" {
		id := cfg.Model
		if idx := strings.LastIndex(id, "/"); idx >= 0 {
			id = id[idx+1:]
		}
		if !containsModel(out, id) {
			out = append([]wconfig.AgentModelConfigType{{Id: id, Label: id, Default: true}}, out...)
		}
	}
	return dedupeDiscoveryModels(out)
}

func resolveOpencodeDir() string {
	if v := strings.TrimSpace(os.Getenv("OPENCODE_HOME")); v != "" {
		if abs, err := wavebase.ExpandHomeDir(v); err == nil {
			return abs
		}
	}
	if v := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); v != "" {
		if abs, err := wavebase.ExpandHomeDir(v); err == nil {
			return filepath.Join(abs, "opencode")
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "opencode")
}

// --- gemini ---------------------------------------------------------------

func discoverGemini() []wconfig.AgentModelConfigType {
	dir := resolveConfigDir("GEMINI_CONFIG_DIR", ".gemini")
	var settings map[string]any
	if !readJSONFile(filepath.Join(dir, "settings.json"), &settings) {
		return nil
	}
	id := ""
	for _, key := range []string{"model", "selectedModel"} {
		switch v := settings[key].(type) {
		case string:
			id = strings.TrimSpace(v)
		case map[string]any:
			if name, ok := v["name"].(string); ok {
				id = strings.TrimSpace(name)
			}
		}
		if id != "" {
			break
		}
	}
	if id == "" {
		return nil
	}
	return []wconfig.AgentModelConfigType{{Id: id, Label: id, Default: true}}
}

// --- helpers --------------------------------------------------------------

func resolveConfigDir(envVar string, homeParts ...string) string {
	if v := strings.TrimSpace(os.Getenv(envVar)); v != "" {
		if abs, err := wavebase.ExpandHomeDir(v); err == nil {
			return abs
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(append([]string{home}, homeParts...)...)
}

func readJSONFile(path string, target any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, target) == nil
}

func readJSONCFile(path string, target any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal([]byte(stripJSONComments(string(data))), target) == nil
}

// stripJSONComments removes // and /* */ comments and trailing commas from a
// JSONC document. Good enough for opencode.jsonc; strings are respected.
func stripJSONComments(src string) string {
	var b strings.Builder
	b.Grow(len(src))
	inString := false
	escaped := false
	for i := 0; i < len(src); i++ {
		c := src[i]
		if inString {
			b.WriteByte(c)
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			b.WriteByte(c)
		case c == '/' && i+1 < len(src) && src[i+1] == '/':
			for i < len(src) && src[i] != '\n' {
				i++
			}
			if i < len(src) {
				b.WriteByte('\n')
			}
		case c == '/' && i+1 < len(src) && src[i+1] == '*':
			i += 2
			for i+1 < len(src) && !(src[i] == '*' && src[i+1] == '/') {
				i++
			}
			i++ // skip closing '/'
		default:
			b.WriteByte(c)
		}
	}
	return removeTrailingCommas(b.String())
}

func removeTrailingCommas(src string) string {
	var b strings.Builder
	b.Grow(len(src))
	inString := false
	escaped := false
	for i := 0; i < len(src); i++ {
		c := src[i]
		if inString {
			b.WriteByte(c)
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			b.WriteByte(c)
			continue
		}
		if c == ',' {
			j := i + 1
			for j < len(src) && (src[j] == ' ' || src[j] == '\t' || src[j] == '\n' || src[j] == '\r') {
				j++
			}
			if j < len(src) && (src[j] == '}' || src[j] == ']') {
				continue
			}
		}
		b.WriteByte(c)
	}
	return b.String()
}

func containsModel(models []wconfig.AgentModelConfigType, id string) bool {
	for _, m := range models {
		if m.Id == id {
			return true
		}
	}
	return false
}

// dedupeDiscoveryModels drops duplicate ids while preserving order. A later
// entry that carries Default=true replaces an earlier non-default duplicate so
// the default provider's copy wins.
func dedupeDiscoveryModels(models []wconfig.AgentModelConfigType) []wconfig.AgentModelConfigType {
	out := make([]wconfig.AgentModelConfigType, 0, len(models))
	index := make(map[string]int, len(models))
	for _, m := range models {
		if m.Id == "" {
			continue
		}
		if pos, ok := index[m.Id]; ok {
			if m.Default && !out[pos].Default {
				out[pos] = m
			}
			continue
		}
		index[m.Id] = len(out)
		out = append(out, m)
	}
	return out
}
