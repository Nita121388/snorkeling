// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestNormalizePropertyKey(t *testing.T) {
	cases := map[string]string{
		"Tech Stack":   "tech_stack",
		"  owner name": "owner_name",
		"due-date":     "due_date",
		"a..b":         "a_b",
		"中文":           "",
		"***":          "",
	}
	for in, want := range cases {
		if got := NormalizePropertyKey(in); got != want {
			t.Fatalf("NormalizePropertyKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidatePropertyValue(t *testing.T) {
	if v, ok := ValidatePropertyValue("text", "  hi  "); !ok || v != "hi" {
		t.Fatalf("text trim failed: %#v %v", v, ok)
	}
	if _, ok := ValidatePropertyValue("text", 5); ok {
		t.Fatal("text accepted a number")
	}
	if v, ok := ValidatePropertyValue("number", json.Number("7")); !ok || v != float64(7) {
		t.Fatalf("number coerce failed: %#v %v", v, ok)
	}
	if v, ok := ValidatePropertyValue("checkbox", true); !ok || v != true {
		t.Fatalf("checkbox failed: %#v %v", v, ok)
	}
	if v, ok := ValidatePropertyValue("multi_select", []any{"Go", "Go", " react "}); !ok {
		t.Fatal("multi_select rejected")
	} else if arr := v.([]string); len(arr) != 2 || arr[0] != "Go" || arr[1] != "react" {
		t.Fatalf("multi_select dedupe/trim failed: %#v", arr)
	}
	if _, ok := ValidatePropertyValue("multi_select", []any{}); ok {
		t.Fatal("empty multi_select accepted")
	}
}

func TestParsePropertySuggestionsRejectsReservedAndUserOwned(t *testing.T) {
	reply := `{"properties":[
		{"key":"note","type":"text","value":"evil"},
		{"key":"tags","type":"multi_select","value":["x"]},
		{"key":"tech_stack","type":"multi_select","value":["go","react"]},
		{"key":"owner","type":"text","value":"ai-guess"},
		{"key":"status","type":"select","value":"in progress"},
		{"key":"bad","type":"formula","value":"x"},
		{"key":"broken","type":"number","value":"not-a-number"}
	]}`
	existing := map[string]PropertyCell{
		"owner": {Value: "nita", Type: "text", Source: PropertySourceUser},
	}
	got, err := parsePropertySuggestions(reply, existing, 8)
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]PropertySuggestion{}
	for _, s := range got {
		byKey[s.Key] = s
	}
	if _, ok := byKey["note"]; ok {
		t.Fatal("reserved key note was accepted")
	}
	if _, ok := byKey["tags"]; ok {
		t.Fatal("reserved key tags was accepted")
	}
	if _, ok := byKey["owner"]; ok {
		t.Fatal("user-owned property was accepted")
	}
	if _, ok := byKey["bad"]; !ok {
		t.Fatal("non-whitelisted type should fall back to inference (text)")
	} else if byKey["bad"].Type != "text" {
		t.Fatalf("expected inferred text, got %q", byKey["bad"].Type)
	}
	if _, ok := byKey["broken"]; ok {
		t.Fatal("invalid number value was accepted")
	}
	if _, ok := byKey["tech_stack"]; !ok {
		t.Fatal("valid multi_select property was dropped")
	}
	if _, ok := byKey["status"]; !ok {
		t.Fatal("valid select property was dropped")
	}
}

func TestParsePropertySuggestionsCapsAndStripsFences(t *testing.T) {
	reply := "```json\n{\"properties\":[" +
		`{"key":"a","type":"text","value":"1"},` +
		`{"key":"b","type":"text","value":"2"},` +
		`{"key":"c","type":"text","value":"3"}` +
		"]}\n```"
	got, err := parsePropertySuggestions(reply, nil, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected cap 2, got %d", len(got))
	}
}

func TestParsePropertySuggestionsBareArray(t *testing.T) {
	reply := `[{"key":"lang","type":"text","value":"go"}]`
	got, err := parsePropertySuggestions(reply, nil, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Key != "lang" {
		t.Fatalf("bare array parse failed: %#v", got)
	}
}

// Manager 级安全闸门：AI 属性写入不得覆盖用户值、不得碰 note/tags，
// 且 Force 只影响 source=user 的属性，不影响内置字段。
func TestManagerApplyAIPropertiesSafety(t *testing.T) {
	dir := t.TempDir()
	key := "codex:ai-props:/tmp/ai-props.jsonl"
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{{Key: key, ID: "ai-props", Source: SourceCodex, FilePath: filepath.Join(dir, "ai-props.jsonl"), MTime: 1, Size: 10}},
		messages:  []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()
	if _, err := manager.ScanList(ctx, ListOptions{}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.NoteAndTags(ctx, key, "keep note", []string{"keep-tag"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SetProps(ctx, key, map[string]PropertyCell{
		"owner": {Value: "nita", Type: "text", Source: PropertySourceUser},
	}); err != nil {
		t.Fatal(err)
	}

	suggestions := []PropertySuggestion{
		{Key: "note", Type: "text", Value: "evil"},
		{Key: "tags", Type: "multi_select", Value: []any{"evil"}},
		{Key: "owner", Type: "text", Value: "ai-guess"},
		{Key: "tech_stack", Type: "multi_select", Value: []any{"go", "react"}},
	}
	summary, skipped, err := manager.ApplyAIProperties(ctx, key, suggestions, false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "keep note" {
		t.Fatalf("AI pass modified note: %q", summary.Note)
	}
	if len(summary.Tags) != 1 || summary.Tags[0] != "keep-tag" {
		t.Fatalf("AI pass modified tags: %#v", summary.Tags)
	}
	if summary.Props["owner"].Value != "nita" {
		t.Fatalf("AI pass overwrote user prop: %#v", summary.Props["owner"])
	}
	if got := summary.Props["tech_stack"]; got.Source != PropertySourceAI {
		t.Fatalf("AI prop not written with source=ai: %#v", got)
	}
	if len(skipped) != 3 {
		t.Fatalf("expected 3 skipped (note/tags/owner), got %#v", skipped)
	}

	// Force 覆盖 owner，但 note/tags 依旧不能动。
	forced, _, err := manager.ApplyAIProperties(ctx, key, []PropertySuggestion{{Key: "owner", Type: "text", Value: "ai-forced"}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if forced.Props["owner"].Value != "ai-forced" {
		t.Fatalf("force did not overwrite: %#v", forced.Props["owner"])
	}
	if forced.Note != "keep note" || len(forced.Tags) != 1 {
		t.Fatalf("force touched note/tags: note=%q tags=%#v", forced.Note, forced.Tags)
	}
}
