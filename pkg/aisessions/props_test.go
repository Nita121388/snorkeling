// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSQLiteIndexSetPropsRoundTrips(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:props:/tmp/props.jsonl"

	props := map[string]PropertyCell{
		"tech_stack": {Value: []any{"Go", "React"}, Type: "multi_select", Source: PropertySourceAI},
		"score":      {Value: float64(7), Type: "number", Source: PropertySourceUser},
		"done":       {Value: true, Type: "checkbox", Source: PropertySourceUser},
		"when":       {Value: map[string]any{"start": float64(1770000000000)}, Type: "date", Source: PropertySourceUser},
		"note_like":  {Value: "hello", Type: "text", Source: PropertySourceUser},
	}
	if err := idx.SetProps(ctx, key, props); err != nil {
		t.Fatal(err)
	}

	got, err := idx.PropsForSession(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(props) {
		t.Fatalf("expected %d props, got %d (%#v)", len(props), len(got), got)
	}
	if !reflect.DeepEqual(got["tech_stack"].Value, []any{"Go", "React"}) {
		t.Fatalf("unexpected multi_select value: %#v", got["tech_stack"].Value)
	}
	if got["tech_stack"].Source != PropertySourceAI || got["tech_stack"].Type != "multi_select" {
		t.Fatalf("metadata not preserved: %#v", got["tech_stack"])
	}
	if got["score"].Value != float64(7) {
		t.Fatalf("unexpected number value: %#v", got["score"].Value)
	}
	if got["done"].Value != true {
		t.Fatalf("unexpected checkbox value: %#v", got["done"].Value)
	}
}

func TestSQLiteIndexSetPropsMergesAndDeletes(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:props-merge:/tmp/props.jsonl"

	if err := idx.SetProps(ctx, key, map[string]PropertyCell{
		"a": {Value: "one", Type: "text"},
		"b": {Value: "two", Type: "text"},
	}); err != nil {
		t.Fatal(err)
	}
	// update a, delete b, leave a's metadata untouched otherwise
	if err := idx.SetProps(ctx, key, map[string]PropertyCell{
		"a": {Value: "one-updated", Type: "text"},
		"b": {Value: nil},
	}); err != nil {
		t.Fatal(err)
	}
	got, err := idx.PropsForSession(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("expected only a to remain, got %#v", got)
	}
	if got["a"].Value != "one-updated" {
		t.Fatalf("expected a to be updated, got %#v", got["a"].Value)
	}
	// source defaults to user when omitted
	if got["a"].Source != PropertySourceUser {
		t.Fatalf("expected default source user, got %q", got["a"].Source)
	}
}

func TestSQLiteIndexApplyMetaLoadsProps(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:props-apply:/tmp/props.jsonl"

	if err := idx.SetProps(ctx, key, map[string]PropertyCell{
		"owner": {Value: "nita", Type: "text", Source: PropertySourceUser},
	}); err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{Key: key}
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Props["owner"].Value != "nita" {
		t.Fatalf("expected owner prop to be applied, got %#v", summary.Props)
	}
}

// 数据安全：自定义属性写入绝不能碰 note / tags / title 这些既有字段。
func TestSetPropsDoesNotTouchNoteAndTags(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:props-safety:/tmp/props.jsonl"

	if err := idx.SetNoteAndTags(ctx, key, "important note #work", []string{"work", "urgent"}); err != nil {
		t.Fatal(err)
	}
	if err := idx.SetProps(ctx, key, map[string]PropertyCell{
		"owner": {Value: "nita", Type: "text"},
	}); err != nil {
		t.Fatal(err)
	}

	summary := SessionSummary{Key: key}
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "important note #work" {
		t.Fatalf("note was modified by SetProps: %q", summary.Note)
	}
	if !reflect.DeepEqual(summary.Tags, []string{"urgent", "work"}) && !reflect.DeepEqual(summary.Tags, []string{"work", "urgent"}) {
		t.Fatalf("tags were modified by SetProps: %#v", summary.Tags)
	}
	if summary.Props["owner"].Value != "nita" {
		t.Fatalf("props missing: %#v", summary.Props)
	}
}

// 数据安全：读路径在没有 props 时不得把旧的虚拟映射值改写成别的。
func TestApplyMetaLeavesLegacyFieldsWhenNoProps(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()
	key := "codex:props-legacy:/tmp/legacy.jsonl"

	providerTags := []string{"legacy-tag"}
	summary := SessionSummary{Key: key, Tags: providerTags, Note: "provider note"}
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Note != "provider note" {
		t.Fatalf("provider note overwritten when no meta row: %q", summary.Note)
	}
	if !reflect.DeepEqual(summary.Tags, providerTags) {
		t.Fatalf("provider tags overwritten when no meta row: %#v", summary.Tags)
	}
	if summary.Props != nil {
		t.Fatalf("props should stay nil when none stored: %#v", summary.Props)
	}
}
