// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

// TestSQLiteIndexEmojiPropsSurfacedInList verifies P1 read path: the batch list
// pipeline attaches backend emoji props (prop_key='emoji', value string) to each
// summary's Props, so the frontend can resolve L2 session emojis from the backend
// without one RPC per session (design.md §3.3).
func TestSQLiteIndexEmojiPropsSurfacedInList(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	summaries := []SessionSummary{
		{Key: "s1", ID: "s1", Source: "pi", Title: "with emoji", ProjectPath: "/work/x", CreatedAt: 100, UpdatedAt: 100, FilePath: filepath.Join(dir, "s1.jsonl")},
		{Key: "s2", ID: "s2", Source: "pi", Title: "plain", ProjectPath: "/work/x", CreatedAt: 200, UpdatedAt: 200, FilePath: filepath.Join(dir, "s2.jsonl")},
	}
	if _, errs := idx.SaveScannedSummaries(ctx, summaries, true); len(errs) != 0 {
		t.Fatalf("save errors: %v", errs)
	}
	// Backend emoji prop with an explicit source (design: UI writes source=user).
	if err := idx.SetProps(ctx, "s1", map[string]PropertyCell{
		"emoji": {Value: "🦊", Type: "text", Source: PropertySourceUser},
	}); err != nil {
		t.Fatal(err)
	}

	out, _, truncated, err := idx.ListWithDistributionAndQuery(ctx, ListOptions{Limit: 200}, "")
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("unexpected truncation")
	}
	byKey := make(map[string]SessionSummary, len(out))
	for _, s := range out {
		byKey[s.Key] = s
	}
	cell, ok := byKey["s1"].Props["emoji"]
	if !ok {
		t.Fatalf("s1 summary Props missing emoji: %#v", byKey["s1"].Props)
	}
	if cell.Value != "🦊" || cell.Source != PropertySourceUser || cell.Type != "text" {
		t.Fatalf("emoji cell = %#v, want {value:🦊 source:user type:text}", cell)
	}
	// Sessions without an emoji prop must not get a synthetic Props map entry.
	if _, ok := byKey["s2"].Props["emoji"]; ok {
		t.Fatalf("s2 must not carry an emoji prop: %#v", byKey["s2"].Props)
	}
}

// TestSQLiteIndexEmojiPropsApplyMetaSingle verifies the single-summary path
// (ApplyMeta) also surfaces the emoji prop, matching the batch path.
func TestSQLiteIndexEmojiPropsApplyMetaSingle(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	ctx := context.Background()

	summary := SessionSummary{Key: "s1", ID: "s1", Source: "pi", Title: "t", CreatedAt: 100, UpdatedAt: 100, FilePath: filepath.Join(dir, "s1.jsonl")}
	if _, errs := idx.SaveScannedSummaries(ctx, []SessionSummary{summary}, true); len(errs) != 0 {
		t.Fatalf("save errors: %v", errs)
	}
	if err := idx.SetProps(ctx, "s1", map[string]PropertyCell{"emoji": {Value: "🐙", Source: PropertySourceAI}}); err != nil {
		t.Fatal(err)
	}
	if err := idx.ApplyMeta(ctx, &summary); err != nil {
		t.Fatal(err)
	}
	if cell, ok := summary.Props["emoji"]; !ok || cell.Value != "🐙" || cell.Source != PropertySourceAI {
		t.Fatalf("single-summary Props = %#v, want emoji 🐙 source=ai", summary.Props)
	}
}