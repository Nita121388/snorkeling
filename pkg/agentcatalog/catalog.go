// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentcatalog is the single source of truth for "which agents exist and
// which models each agent can run". It merges built-in agent profiles with the
// user's `agent:profiles` settings and is consumed by:
//
//   - the scheduled-task editor (AgentProfileListCommand)
//   - the headless task runner (model flag + default model resolution)
//   - wsh agent list (so arbitrary agents can discover the same catalog)
//
// It only reads configuration; it never probes external CLIs or writes user data.
package agentcatalog

import (
	"sort"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// ModelInfo is one selectable model for an agent profile.
type ModelInfo struct {
	Id       string `json:"id"`
	Label    string `json:"label"`
	Provider string `json:"provider,omitempty"`
	Default  bool   `json:"default,omitempty"`
	// Source records where this entry came from: "config", "builtin", or "profile-model".
	Source string `json:"source"`
}

// ProfileInfo is the resolved agent profile. The same shape is returned by the
// RPC, `wsh agent list --json`, and (in the future) agent-block creation.
type ProfileInfo struct {
	Name         string      `json:"name"`
	Label        string      `json:"label"`
	Cmd          string      `json:"cmd"`
	Args         []string    `json:"args,omitempty"`
	ModelFlag    string      `json:"modelflag,omitempty"`
	DefaultModel string      `json:"defaultModel,omitempty"`
	Models       []ModelInfo `json:"models"`
	// Source is "builtin" for built-in profiles and "config" for user-defined ones.
	Source string `json:"source"`
}

type builtinProfile struct {
	Label     string
	Cmd       string
	ModelFlag string
	Models    []wconfig.AgentModelConfigType
}

// builtinModelCatalogs holds the models we can safely advertise for an agent
// without probing the machine. Only IDs we are confident about are listed; an
// empty list means "let the user type a model / configure one in settings".
var builtinModelCatalogs = map[string][]wconfig.AgentModelConfigType{
	"pi": {
		{Id: "deepseek-v4-pro", Label: "DeepSeek V4 Pro", Provider: "deepseek", Default: true},
		{Id: "gpt-5", Label: "GPT-5", Provider: "openai"},
		{Id: "claude-sonnet-4", Label: "Claude Sonnet 4", Provider: "anthropic"},
		{Id: "gemini-2.5-pro", Label: "Gemini 2.5 Pro", Provider: "google"},
	},
	// codex/claude/gemini/opencode intentionally start empty: the UI falls back
	// to free text until the user configures `models` in settings.
}

var builtinProfiles = map[string]builtinProfile{
	"codex":    {Label: "Codex", Cmd: "codex", ModelFlag: "--model"},
	"claude":   {Label: "Claude Code", Cmd: "claude", ModelFlag: "--model"},
	"gemini":   {Label: "Gemini", Cmd: "gemini", ModelFlag: "--model"},
	"opencode": {Label: "OpenCode", Cmd: "opencode", ModelFlag: "--model"},
	"pi":       {Label: "Pi", Cmd: "pi", ModelFlag: "--model", Models: builtinModelCatalogs["pi"]},
}

// ModelResolver is the extension point for future dynamic model discovery
// (cc-switch vendors, `agent --list-models`, ...). Resolvers are consulted only
// when the user has not configured `models` for the profile.
type ModelResolver func(name string, cfg wconfig.AgentProfileConfigType) []wconfig.AgentModelConfigType

var modelResolvers []ModelResolver

// RegisterModelResolver appends a resolver. Intended for future extension points;
// no resolver is registered today.
func RegisterModelResolver(r ModelResolver) {
	if r != nil {
		modelResolvers = append(modelResolvers, r)
	}
}

// List returns every known profile, sorted by name.
func List() []ProfileInfo {
	settings := wconfig.ReadFullConfig().Settings
	return ListWithSettings(settings)
}

// ListWithSettings is List for an already-loaded settings snapshot. Tests and RPC
// callers that already hold a config can use it to avoid a second read.
func ListWithSettings(settings wconfig.SettingsType) []ProfileInfo {
	configured := settings.AgentProfiles

	names := make([]string, 0, len(builtinProfiles)+len(configured))
	seen := make(map[string]bool, len(builtinProfiles)+len(configured))
	for name := range builtinProfiles {
		names = append(names, name)
		seen[name] = true
	}
	for name, cfg := range configured {
		if name == "" || seen[name] {
			continue
		}
		// A profile with no command cannot be launched, so it is not advertised.
		if cfg.Cmd == "" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	result := make([]ProfileInfo, 0, len(names))
	for _, name := range names {
		result = append(result, resolveWithConfig(name, configured[name]))
	}
	return result
}

// Resolve returns the merged profile for a single agent name. Unknown names fall
// back to "run this binary with --model", which matches the previous runner behavior.
func Resolve(name string) ProfileInfo {
	return ResolveWithSettings(name, wconfig.ReadFullConfig().Settings)
}

// ResolveWithSettings is Resolve for an already-loaded settings snapshot.
func ResolveWithSettings(name string, settings wconfig.SettingsType) ProfileInfo {
	var cfg wconfig.AgentProfileConfigType
	if settings.AgentProfiles != nil {
		cfg = settings.AgentProfiles[name]
	}
	return resolveWithConfig(name, cfg)
}

func resolveWithConfig(name string, cfg wconfig.AgentProfileConfigType) ProfileInfo {
	builtin, hasBuiltin := builtinProfiles[name]
	info := ProfileInfo{
		Name:   name,
		Source: "config",
	}
	if hasBuiltin {
		info.Source = "builtin"
		info.Cmd = builtin.Cmd
		info.ModelFlag = builtin.ModelFlag
		info.Label = builtin.Label
	}
	if cfg.Cmd != "" {
		info.Cmd = cfg.Cmd
		info.Source = "config"
	}
	if cfg.ModelFlag != "" {
		info.ModelFlag = cfg.ModelFlag
	}
	if cfg.Label != "" {
		info.Label = cfg.Label
	}
	if info.Label == "" {
		info.Label = name
	}
	if info.Cmd == "" {
		info.Cmd = name
	}
	if info.ModelFlag == "" {
		info.ModelFlag = "--model"
	}
	info.Args = append([]string(nil), cfg.Args...)

	models := resolveModels(name, cfg, builtin.Models)
	info.DefaultModel = pickDefaultModel(models, cfg.Model)
	normalizeDefaults(models, info.DefaultModel)
	info.Models = models
	return info
}

// resolveModels applies the precedence: explicit config models -> builtin
// catalog -> registered resolvers -> single profile.model -> empty.
func resolveModels(name string, cfg wconfig.AgentProfileConfigType, builtinModels []wconfig.AgentModelConfigType) []ModelInfo {
	var source []wconfig.AgentModelConfigType
	sourceName := ""
	switch {
	case len(cfg.Models) > 0:
		source = cfg.Models
		sourceName = "config"
	case len(builtinModels) > 0:
		source = builtinModels
		sourceName = "builtin"
	default:
		for _, resolver := range modelResolvers {
			if resolved := resolver(name, cfg); len(resolved) > 0 {
				source = resolved
				sourceName = "resolver"
				break
			}
		}
	}

	models := make([]ModelInfo, 0, len(source)+1)
	index := make(map[string]int, len(source)+1)
	for _, m := range source {
		if m.Id == "" {
			continue
		}
		if _, ok := index[m.Id]; ok {
			continue
		}
		label := m.Label
		if label == "" {
			label = m.Id
		}
		index[m.Id] = len(models)
		models = append(models, ModelInfo{
			Id:       m.Id,
			Label:    label,
			Provider: m.Provider,
			Default:  m.Default,
			Source:   sourceName,
		})
	}

	// A configured default model must always be selectable, even when it is not
	// part of the configured/builtin list.
	if cfg.Model != "" {
		if _, ok := index[cfg.Model]; !ok {
			models = append([]ModelInfo{{
				Id:     cfg.Model,
				Label:  cfg.Model,
				Source: "profile-model",
			}}, models...)
		}
	}
	return models
}

func pickDefaultModel(models []ModelInfo, configuredModel string) string {
	// An explicit `default: true` on a user-configured model is the strongest signal.
	for _, m := range models {
		if m.Default && m.Source == "config" {
			return m.Id
		}
	}
	// The profile-level `model` then wins over a built-in default, so changing
	// `agent:profiles.<name>.model` actually changes the default model.
	if configuredModel != "" {
		return configuredModel
	}
	for _, m := range models {
		if m.Default {
			return m.Id
		}
	}
	if len(models) > 0 {
		return models[0].Id
	}
	return ""
}

// normalizeDefaults makes exactly one model carry Default=true so the UI and
// runner agree on the default without re-deriving it.
func normalizeDefaults(models []ModelInfo, defaultModel string) {
	for i := range models {
		models[i].Default = models[i].Id == defaultModel && defaultModel != ""
	}
}
