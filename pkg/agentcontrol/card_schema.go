// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Property scope support for the Agent Control Surface.
//
// Scope has two shapes on purpose:
//   - API/CLI/MCP side: "session" (default/empty) | "agent" | "all"
//   - settings side:    "" (global template) | "agent:<source>"
//
// A session property *value* is always written per-session by the data patch
// pipeline. Only the definition visibility (agent:propertyschema) is updated
// here, and only after a real (non dry-run) apply succeeded.
package agentcontrol

import (
	"fmt"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentdata"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// schemaScopeFor translates the API scope into a schema Scope string.
// update=false means "session-scoped: do not touch the template".
func schemaScopeFor(apiScope string, sessionKey string) (schemaScope string, update bool, err error) {
	switch strings.ToLower(strings.TrimSpace(apiScope)) {
	case "", "session":
		return "", false, nil
	case "all":
		return "", true, nil
	case "agent":
		provider := providerOfSessionKey(sessionKey)
		if provider == "" {
			return "", false, fmt.Errorf("scope agent needs a provider in the session key %q", sessionKey)
		}
		return "agent:" + provider, true, nil
	default:
		return "", false, fmt.Errorf("invalid scope %q: expected session, agent or all", apiScope)
	}
}

// providerOfSessionKey extracts the provider prefix ("pi", "codex", ...).
func providerOfSessionKey(key string) string {
	if idx := strings.Index(key, ":"); idx > 0 {
		return strings.ToLower(strings.TrimSpace(key[:idx]))
	}
	return ""
}

// appendSchemaOptions merges addOptions into an existing option list. When
// nothing new arrives the original list is returned untouched (byte-identical
// settings on idempotent re-runs).
func appendSchemaOptions(existing []string, addOptions []string) []string {
	if len(addOptions) == 0 {
		return existing
	}
	merged := agentdata.MergePropertyOptions(existing, addOptions)
	if len(merged) == len(existing) {
		return existing
	}
	return merged
}

// upsertSchemaDef inserts or replaces one definition, preserving unrelated
// definitions and their order. A key is unique per template: changing scope on
// an existing key overwrites it (v1 simplification, documented in design.md).
// addOptions appends new option values (never removes existing ones);
// nil/empty addOptions leaves Options exactly as before.
func upsertSchemaDef(current []wconfig.AgentPropertyDefType, key string, name string, propType string, scope string, addOptions []string) []wconfig.AgentPropertyDefType {
	next := make([]wconfig.AgentPropertyDefType, 0, len(current)+1)
	found := false
	for _, def := range current {
		if strings.EqualFold(strings.TrimSpace(def.Key), key) {
			def.Key = key
			if name != "" {
				def.Name = name
			}
			if propType != "" {
				def.Type = propType
			}
			def.Scope = scope
			def.Options = appendSchemaOptions(def.Options, addOptions)
			next = append(next, def)
			found = true
			continue
		}
		next = append(next, def)
	}
	if !found {
		next = append(next, wconfig.AgentPropertyDefType{
			Key:     key,
			Name:    name,
			Type:    propType,
			Options: appendSchemaOptions(nil, addOptions),
			Order:   len(current) + 1,
			Scope:   scope,
		})
	}
	return next
}

// filterSchemaForSession keeps only the definitions this session may see:
// global ones (empty scope) plus the ones scoped to its own agent.
func filterSchemaForSession(defs []wconfig.AgentPropertyDefType, provider string) []wconfig.AgentPropertyDefType {
	provider = strings.ToLower(strings.TrimSpace(provider))
	out := make([]wconfig.AgentPropertyDefType, 0, len(defs))
	for _, def := range defs {
		scope := strings.ToLower(strings.TrimSpace(def.Scope))
		if scope == "" {
			out = append(out, def)
			continue
		}
		if provider != "" && scope == "agent:"+provider {
			out = append(out, def)
		}
	}
	return out
}

// syncPropertySchema upserts the definitions requested by agent/all scoped
// props. It is a no-op when every prop is session-scoped, so the legacy
// "no --prop-scope" call writes nothing outside the session (byte-identical
// behaviour to before this feature).
func syncPropertySchema(sessionKey string, props map[string]wshrpc.AgentCardPropPatch) error {
	type pendingDef struct {
		key        string
		name       string
		propType   string
		scope      string
		addOptions []string
	}
	keys := make([]string, 0, len(props))
	for key := range props {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var pending []pendingDef
	for _, key := range keys {
		prop := props[key]
		scope, update, err := schemaScopeFor(prop.Scope, sessionKey)
		if err != nil {
			return err
		}
		if !update {
			continue
		}
		pending = append(pending, pendingDef{
			key:        key,
			name:       prop.Name,
			propType:   prop.Type,
			scope:      scope,
			addOptions: prop.AddOptions,
		})
	}
	if len(pending) == 0 {
		return nil
	}

	next := wconfig.ReadFullConfig().Settings.AgentPropertySchema
	for _, def := range pending {
		next = upsertSchemaDef(next, def.key, def.name, def.propType, def.scope, def.addOptions)
	}
	return writePropertySchema(next)
}

func writePropertySchema(defs []wconfig.AgentPropertyDefType) error {
	err := wconfig.SetBaseConfigValue(waveobj.MetaMapType{
		wconfig.ConfigKey_AgentPropertySchema: defs,
	})
	if err != nil {
		return err
	}
	wconfig.BroadcastConfigUpdate()
	return nil
}

// validateCardPropScopes rejects unknown scopes before anything is written.
func validateCardPropScopes(props map[string]wshrpc.AgentCardPropPatch) error {
	keys := make([]string, 0, len(props))
	for key := range props {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !agentdata.ValidPropertyScope(props[key].Scope) {
			return fmt.Errorf("invalid scope %q for property %q: expected session, agent or all", props[key].Scope, key)
		}
	}
	return nil
}

// schemaSyncMessages reports which definitions were published, so a real apply
// is as transparent as the dry-run preview.
func schemaSyncMessages(sessionKey string, props map[string]wshrpc.AgentCardPropPatch) []string {
	keys := make([]string, 0, len(props))
	for key := range props {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var messages []string
	for _, key := range keys {
		scope, update, err := schemaScopeFor(props[key].Scope, sessionKey)
		if err != nil || !update {
			continue
		}
		label := "global template"
		if scope != "" {
			label = scope
		}
		message := key + ": definition published to agent:propertyschema (" + label + ")"
		if len(props[key].AddOptions) > 0 {
			message += " + options: " + strings.Join(agentdata.MergePropertyOptions(nil, props[key].AddOptions), ", ")
		}
		messages = append(messages, message)
	}
	return messages
}

// validateCardPropAddOptions rejects option appends outside agent/all scopes:
// appended options live in the schema definition, so a session-scoped call
// would have to silently drop them. The CLI surfaces this as E_USAGE.
func validateCardPropAddOptions(props map[string]wshrpc.AgentCardPropPatch) error {
	keys := make([]string, 0, len(props))
	for key := range props {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if len(props[key].AddOptions) == 0 {
			continue
		}
		if !agentdata.ValidPropertyScope(props[key].Scope) {
			return fmt.Errorf("invalid scope %q for property %q: expected session, agent or all", props[key].Scope, key)
		}
		switch strings.ToLower(strings.TrimSpace(props[key].Scope)) {
		case "agent", "all":
		default:
			return fmt.Errorf("property %q cannot add options with scope %q: options only apply to agent/all definitions", key, props[key].Scope)
		}
	}
	return nil
}
