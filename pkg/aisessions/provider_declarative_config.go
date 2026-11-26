// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	// SourceAntigravity is the source id of the built-in declarative provider
	// entry (config key under "agent:sessionproviders"). First beneficiary of
	// the declarative channel: its conversation list lives in a sqlite file
	// with a stable schema, while its message body is a protobuf blob with no
	// public schema (so LoadMessages is intentionally empty — detail view
	// degrades to header + placeholder).
	SourceAntigravity = "antigravity"

	// SessionProviderTypeSQLite is the only declarative backend type this
	// period: a fixed table + column mapping, never arbitrary SQL. "jsonl" and
	// external-process providers are future work (see task
	// 11-26-aisessions-declarative-provider design.md §2).
	SessionProviderTypeSQLite = "sqlite"

	// declarativeDefaultListLimit caps one List() query so a misdeclared table
	// cannot pull an unbounded number of rows into one scan (aisessions-scan
	// contract: list queries are bounded).
	declarativeDefaultListLimit = 2000
)

// declarativeConvDir is the sibling directory Antigravity-style CLIs use for
// per-conversation dbs. When <dbDir>/conversations/<id>.db exists it becomes the
// session's FilePath (the "session file" is the conversation, not the summary
// index); otherwise the summary db carries an "#<id>" suffix like the opencode
// provider so multiple sessions keep distinct file paths.
const declarativeConvDir = "conversations"

// defaultSessionProviderColumns returns the built-in Antigravity column
// mapping. User config may override any of these per-field.
func defaultSessionProviderColumns() wconfig.AgentSessionProviderColumnsType {
	return wconfig.AgentSessionProviderColumnsType{
		ID:       "conversation_id",
		Title:    "title",
		Updated:  "last_modified_time",
		Created:  "last_user_input_time",
		Project:  "workspace_uris",
		ParentID: "parent_conversation_id",
	}
}

// builtinSessionProviderConfigs returns the compile-time default entries of
// the "agent:sessionproviders" config section. Keep this list tiny: new agents
// that need message-body parsing stay compile-time providers; declarative
// entries are list-only readers.
func builtinSessionProviderConfigs() map[string]wconfig.AgentSessionProviderConfigType {
	return map[string]wconfig.AgentSessionProviderConfigType{
		SourceAntigravity: {
			Label:   "Antigravity",
			Type:    SessionProviderTypeSQLite,
			DB:      "~/.gemini/antigravity-cli/conversation_summaries.db",
			Table:   "conversation_summaries",
			Columns: defaultSessionProviderColumns(),
		},
	}
}

// mergeSessionProviderConfigs merges the built-in default entries with the
// user's "agent:sessionproviders" settings (same builtin ∪ config semantics as
// agent:profiles): same key = the user entry overrides the built-in fields
// individually (unset fields keep the built-in value), "disabled": true removes
// the entry, and entries that are still invalid after the merge (missing db /
// table / id column, or an unimplemented backend type) are dropped from the
// result rather than failing the whole section. "~" in db is expanded to the
// home directory.
func mergeSessionProviderConfigs(settings wconfig.SettingsType) map[string]wconfig.AgentSessionProviderConfigType {
	merged := make(map[string]wconfig.AgentSessionProviderConfigType, len(builtinSessionProviderConfigs())+len(settings.AgentSessionProviders))
	for name, cfg := range builtinSessionProviderConfigs() {
		merged[name] = normalizeSessionProviderConfig(cfg, cfg)
	}
	for name, userCfg := range settings.AgentSessionProviders {
		key := strings.TrimSpace(name)
		if key == "" {
			continue
		}
		// Same-key user entries override the built-in one field-by-field so
		// `{"antigravity": {"disabled": true}}` or `{"antigravity": {"db": "..."}}`
		// do not silently lose the built-in table/column mapping.
		base := merged[key]
		merged[key] = normalizeSessionProviderConfig(base, userCfg)
	}
	for name, cfg := range merged {
		if !isValidSessionProviderConfig(cfg) {
			delete(merged, name)
		}
	}
	return merged
}

// normalizeSessionProviderConfig overlays override onto base (empty override
// fields keep the base value) and fills in defaults: label falls back to the
// config key, type defaults to the only implemented backend, the id column
// mapping defaults to "id", and db gets its "~" expanded to an absolute path.
func normalizeSessionProviderConfig(base, override wconfig.AgentSessionProviderConfigType) wconfig.AgentSessionProviderConfigType {
	out := base
	if v := strings.TrimSpace(override.Label); v != "" {
		out.Label = v
	}
	if v := strings.TrimSpace(override.Type); v != "" {
		out.Type = strings.ToLower(v)
	}
	if v := strings.TrimSpace(override.DB); v != "" {
		out.DB = v
	}
	if v := strings.TrimSpace(override.Table); v != "" {
		out.Table = v
	}
	out.Disabled = base.Disabled || override.Disabled
	if override.Columns != (wconfig.AgentSessionProviderColumnsType{}) {
		out.Columns = mergeSessionProviderColumns(out.Columns, override.Columns)
	}
	if out.Columns.ID == "" {
		out.Columns.ID = "id"
	}
	if override.ListLimit > 0 {
		out.ListLimit = override.ListLimit
	}
	if out.ListLimit <= 0 {
		out.ListLimit = declarativeDefaultListLimit
	}
	if out.Type == "" {
		out.Type = SessionProviderTypeSQLite
	}
	out.DB = ExpandOriginPath(out.DB)
	return out
}

// mergeSessionProviderColumns overlays non-empty override column names onto
// base. Missing columns are allowed by design (schema drift upstream loses one
// field, not the scan); only "id" is required by the caller.
func mergeSessionProviderColumns(base, override wconfig.AgentSessionProviderColumnsType) wconfig.AgentSessionProviderColumnsType {
	out := base
	if v := strings.TrimSpace(override.ID); v != "" {
		out.ID = v
	}
	if v := strings.TrimSpace(override.Title); v != "" {
		out.Title = v
	}
	if v := strings.TrimSpace(override.Updated); v != "" {
		out.Updated = v
	}
	if v := strings.TrimSpace(override.Created); v != "" {
		out.Created = v
	}
	if v := strings.TrimSpace(override.Project); v != "" {
		out.Project = v
	}
	if v := strings.TrimSpace(override.ParentID); v != "" {
		out.ParentID = v
	}
	return out
}

// isValidSessionProviderConfig reports whether the (normalized) entry is
// registrable: an implemented backend type, a db file and a table, and an id
// column mapping.
func isValidSessionProviderConfig(cfg wconfig.AgentSessionProviderConfigType) bool {
	if cfg.Disabled {
		return false
	}
	if cfg.Type != SessionProviderTypeSQLite {
		return false
	}
	if strings.TrimSpace(cfg.DB) == "" || strings.TrimSpace(cfg.Table) == "" {
		return false
	}
	return strings.TrimSpace(cfg.Columns.ID) != ""
}

// sortedSessionProviderNames returns the merge result's keys in stable order
// so provider registration (and logs) do not depend on map iteration order.
func sortedSessionProviderNames(cfgs map[string]wconfig.AgentSessionProviderConfigType) []string {
	names := make([]string, 0, len(cfgs))
	for name := range cfgs {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
