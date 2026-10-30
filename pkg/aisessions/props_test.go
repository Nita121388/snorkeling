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

func TestMetaStoreSetProps(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenMeta(filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	key := "codex:meta-props:/tmp/meta-props.jsonl"

	if err := store.SetProps(ctx, key, map[string]PropertyCell{
		"a": {Value: "one", Type: "text"},
		"b": {Value: "two", Type: "text"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetProps(ctx, key, map[string]PropertyCell{
		"b": {Value: nil},
		"c": {Value: true, Type: "checkbox"},
	}); err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{Key: key}
	store.Apply(&summary)
	if summary.Props["a"].Value != "one" {
		t.Fatalf("expected a to survive, got %#v", summary.Props)
	}
	if _, ok := summary.Props["b"]; ok {
		t.Fatalf("expected b to be deleted, got %#v", summary.Props)
	}
	if summary.Props["c"].Value != true {
		t.Fatalf("expected c to be set, got %#v", summary.Props)
	}
}
