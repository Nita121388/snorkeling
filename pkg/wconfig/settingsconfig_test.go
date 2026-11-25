// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// The agentstatus:osnotify* keys are written by the Wave Config "Agent Notifications" panel
// (frontend/app/view/waveconfig/agentnotifysettings.tsx) through SetConfigCommand, which lands in
// SetBaseConfigValue. That path resolves the key against SettingsType first and rejects unknown
// keys, so a typo in a json tag would silently break the settings UI. These tests pin the
// contract between the frontend key names and the Go struct.
func TestAgentStatusOsNotifyConfigKeyTypes(t *testing.T) {
	boolPtr := reflect.TypeOf((*bool)(nil))
	int64Ptr := reflect.TypeOf((*int64)(nil))

	cases := []struct {
		key  string
		want reflect.Type
	}{
		{"agentstatus:osnotify", boolPtr},
		{"agentstatus:osnotifydone", boolPtr},
		{"agentstatus:osnotifyblocked", boolPtr},
		{"agentstatus:osnotifywhenfocused", boolPtr},
		{"agentstatus:osnotifyblockedminms", int64Ptr},
		{"agentstatus:osnotifyidleminms", int64Ptr},
		{"agentstatus:osnotifycooldownms", int64Ptr},
	}
	for _, tc := range cases {
		got := getConfigKeyType(tc.key)
		if got == nil {
			t.Fatalf("config key %q is not registered in SettingsType", tc.key)
		}
		if got != tc.want {
			t.Fatalf("config key %q has type %v, want %v", tc.key, got, tc.want)
		}
	}
}

func TestTabAgentStatusModeConfigKeyType(t *testing.T) {
	got := getConfigKeyType("tab:agent-status-mode")
	if got == nil {
		t.Fatal("config key tab:agent-status-mode is not registered in SettingsType")
	}
	if got != reflect.TypeOf("") {
		t.Fatalf("config key tab:agent-status-mode has type %v, want string", got)
	}
}

// A value that comes over the wire as a JSON number must convert into the *int64 field, which is
// what the settings panel writes for the idle threshold and the cooldown.
func TestConvertConfigValueForAgentOsNotifyNumbers(t *testing.T) {
	ctype := getConfigKeyType("agentstatus:osnotifyidleminms")
	if ctype == nil {
		t.Fatal("agentstatus:osnotifyidleminms is not registered in SettingsType")
	}
	converted, err := convertConfigValue(json.Number("30000"), ctype)
	if err != nil {
		t.Fatalf("convertConfigValue failed: %v", err)
	}
	ptr, ok := converted.(*int64)
	if !ok {
		t.Fatalf("converted value has type %T, want *int64", converted)
	}
	if *ptr != 30000 {
		t.Fatalf("converted value is %d, want 30000", *ptr)
	}
}

func TestConvertConfigValueForAgentOsNotifyBooleans(t *testing.T) {
	ctype := getConfigKeyType("agentstatus:osnotify")
	if ctype == nil {
		t.Fatal("agentstatus:osnotify is not registered in SettingsType")
	}
	converted, err := convertConfigValue(false, ctype)
	if err != nil {
		t.Fatalf("convertConfigValue failed: %v", err)
	}
	ptr, ok := converted.(*bool)
	if !ok {
		t.Fatalf("converted value has type %T, want *bool", converted)
	}
	if *ptr {
		t.Fatal("converted value is true, want false")
	}
}

// aiprompts.json is read through FullConfigType's json tag by ReadFullConfig, so
// the tag is the whole registration. Pin it (and the wire shape) so a rename
// cannot silently disable user prompt overrides.
func TestAIPromptsConfigShape(t *testing.T) {
	field, ok := reflect.TypeOf(FullConfigType{}).FieldByName("AIPrompts")
	if !ok {
		t.Fatal("FullConfigType.AIPrompts is missing")
	}
	if tag := field.Tag.Get("json"); tag != "aiprompts" {
		t.Fatalf("AIPrompts json tag = %q, want aiprompts", tag)
	}

	var cfg AIPromptConfigType
	raw := []byte(`{"systemPrompt":"base","extraInstructions":"zh","aiMode":"custom@x","maxNoteChars":200,"maxTags":3,"maxTitleChars":50,"enabled":false}`)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cfg.SystemPrompt != "base" || cfg.ExtraInstructions != "zh" || cfg.AIMode != "custom@x" {
		t.Fatalf("string fields = %+v", cfg)
	}
	if cfg.MaxNoteChars != 200 || cfg.MaxTags != 3 || cfg.MaxTitleChars != 50 {
		t.Fatalf("numeric fields = %+v", cfg)
	}
	if cfg.Enabled == nil || *cfg.Enabled {
		t.Fatalf("enabled = %v, want explicit false", cfg.Enabled)
	}
}

func TestAIPromptsEnabledUnsetIsNil(t *testing.T) {
	var cfg AIPromptConfigType
	if err := json.Unmarshal([]byte(`{}`), &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cfg.Enabled != nil {
		t.Fatal("unset enabled must stay nil so callers default to enabled")
	}
}

// The retired "status" property type must be rewritten to "select" in
// settings.json agent:propertyschema at startup, preserving every other field,
// and must be a no-op (byte-identical settings) when no status def exists.
func TestMigrateAgentPropertySchemaStatus(t *testing.T) {
	oldHome := wavebase.ConfigHome_VarCache
	dir := t.TempDir()
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = oldHome
	})

	settingsPath := filepath.Join(dir, "settings.json")
	seed := `{"agent:propertyschema":[` +
		`{"key":"status","name":"状态","type":" Status ","options":["进行中","已完成"],"order":1,"aiManaged":true,"scope":"agent:pi"},` +
		`{"key":"owner","name":"Owner","type":"text","order":2}` +
		`]}`
	if err := os.WriteFile(settingsPath, []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}

	MigrateAgentPropertySchemaStatus()

	after, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Schema []AgentPropertyDefType `json:"agent:propertyschema"`
	}
	if err := json.Unmarshal(after, &parsed); err != nil {
		t.Fatalf("migrated settings are not valid JSON: %v", err)
	}
	if len(parsed.Schema) != 2 {
		t.Fatalf("expected 2 definitions, got %d: %+v", len(parsed.Schema), parsed.Schema)
	}
	status := parsed.Schema[0]
	if status.Type != "select" {
		t.Fatalf("status type not migrated: %+v", status)
	}
	if status.Name != "状态" || status.Order != 1 || !status.AIManaged || status.Scope != "agent:pi" ||
		!reflect.DeepEqual(status.Options, []string{"进行中", "已完成"}) {
		t.Fatalf("migration must preserve every other field, got %+v", status)
	}
	if parsed.Schema[1].Type != "text" || parsed.Schema[1].Name != "Owner" {
		t.Fatalf("unrelated definition changed: %+v", parsed.Schema[1])
	}

	// Idempotent: a second run leaves the file byte-identical.
	MigrateAgentPropertySchemaStatus()
	again, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != string(after) {
		t.Fatalf("second migration changed settings:\n%s\n---\n%s", after, again)
	}
}

// No status definitions -> the migration must not touch settings.json at all.
func TestMigrateAgentPropertySchemaStatusNoopWithoutStatus(t *testing.T) {
	oldHome := wavebase.ConfigHome_VarCache
	dir := t.TempDir()
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = oldHome
	})

	settingsPath := filepath.Join(dir, "settings.json")
	seed := `{"agent:propertyschema":[{"key":"owner","type":"text","order":1}]}`
	if err := os.WriteFile(settingsPath, []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatal(err)
	}

	MigrateAgentPropertySchemaStatus()

	after, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("no-status settings must stay byte-identical:\n%s\n---\n%s", before, after)
	}
}
