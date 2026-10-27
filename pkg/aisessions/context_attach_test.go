// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
)

func attachFixture(rows ...SessionSummary) []SessionSummary { return rows }

func summaryOfKey(rows []SessionSummary) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Key)
	}
	return out
}

func attachedReason(rows []SessionSummary, key string) string {
	for _, row := range rows {
		if row.Key == key {
			return row.Attached
		}
	}
	return "<missing>"
}

func TestAttachContextOffKeepsRows(t *testing.T) {
	hits := []SessionSummary{{Key: "c", ParentKey: "p", Kind: SessionKindSubagent}}
	all := append([]SessionSummary{}, hits...)
	all = append(all, SessionSummary{Key: "p", Kind: SessionKindSession})

	out := attachContext(context.Background(), hits, all, ListOptions{})
	if len(out) != 1 || out[0].Key != "c" || out[0].Attached != "" {
		t.Fatalf("off mode must not attach anything, got %#v", out)
	}
}

func TestAttachContextParentForMatchingChild(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	hit := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	other := SessionSummary{Key: "c2", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, hit, other}

	out := attachContext(context.Background(), []SessionSummary{hit}, all, ListOptions{AttachMode: AttachModeBoth})
	if len(out) != 2 {
		t.Fatalf("want hit + parent, got %v", summaryOfKey(out))
	}
	if got := attachedReason(out, "p"); got != AttachedReasonParent {
		t.Fatalf("parent reason = %q", got)
	}
	// 兄弟代理不应因为父亲被补带而一起冒出来。
	if got := attachedReason(out, "c2"); got != "<missing>" {
		t.Fatalf("sibling should not be attached, got %q", got)
	}
}

func TestAttachContextChildrenForMatchingParent(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	fork := SessionSummary{Key: "f", ParentKey: "p", Kind: SessionKindFork, ProjectPath: "/a"}
	sub := SessionSummary{Key: "s", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	grand := SessionSummary{Key: "g", ParentKey: "s", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, fork, sub, grand}

	out := attachContext(context.Background(), []SessionSummary{parent}, all, ListOptions{AttachMode: AttachModeBoth})
	if len(out) != 3 {
		t.Fatalf("want parent + 2 direct children, got %v", summaryOfKey(out))
	}
	if got := attachedReason(out, "s"); got != AttachedReasonChild {
		t.Fatalf("child reason = %q", got)
	}
	if got := attachedReason(out, "f"); got != AttachedReasonChild {
		t.Fatalf("fork reason = %q", got)
	}
	// 只补一层：子代理内部再派发的不带。
	if got := attachedReason(out, "g"); got != "<missing>" {
		t.Fatalf("grandchild should not be attached, got %q", got)
	}
}

func TestAttachContextChildrenOnlyMode(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	child := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, child}

	// 子命中时不回填父。
	out := attachContext(context.Background(), []SessionSummary{child}, all, ListOptions{AttachMode: AttachModeChildren})
	if len(out) != 1 || out[0].Key != "c" {
		t.Fatalf("children-only must not attach parents, got %v", summaryOfKey(out))
	}
	// 父命中时仍带出子。
	out = attachContext(context.Background(), []SessionSummary{parent}, all, ListOptions{AttachMode: AttachModeChildren})
	if len(out) != 2 || attachedReason(out, "c") != AttachedReasonChild {
		t.Fatalf("children-only should attach children, got %v", summaryOfKey(out))
	}
}

func TestAttachContextParentOnlyMode(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	child := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, child}

	out := attachContext(context.Background(), []SessionSummary{parent}, all, ListOptions{AttachMode: AttachModeParent})
	if len(out) != 1 {
		t.Fatalf("parent-only must not attach children, got %v", summaryOfKey(out))
	}
}

func TestAttachContextSkipsRowsAlreadyPresent(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	child := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, child}

	out := attachContext(context.Background(), []SessionSummary{parent, child}, all, ListOptions{AttachMode: AttachModeBoth})
	if len(out) != 2 {
		t.Fatalf("both hits must stay hits, got %v", summaryOfKey(out))
	}
	if out[0].Attached != "" || out[1].Attached != "" {
		t.Fatalf("hits must not be marked attached: %#v", out)
	}
}

func TestAttachContextHonorsExcludes(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	hidden := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a", Tags: []string{"secret"}}
	all := []SessionSummary{parent, hidden}

	out := attachContext(context.Background(), []SessionSummary{parent}, all, ListOptions{
		AttachMode:  AttachModeBoth,
		ExcludeTags: []string{"secret"},
	})
	if len(out) != 1 {
		t.Fatalf("excluded tag must not be attached, got %v", summaryOfKey(out))
	}

	out = attachContext(context.Background(), []SessionSummary{hidden}, all, ListOptions{
		AttachMode:      AttachModeBoth,
		ExcludeProjects: []string{"/a"},
	})
	if len(out) != 1 || out[0].Key != "c" {
		t.Fatalf("excluded parent must not be attached, got %v", summaryOfKey(out))
	}
}

func TestAttachContextLimitOnlyCutsHits(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	child := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, child}

	hits := limitSummaries([]SessionSummary{parent}, 1)
	out := attachContext(context.Background(), hits, all, ListOptions{AttachMode: AttachModeBoth})
	if len(out) != 2 {
		t.Fatalf("limit must not cut context rows, got %v", summaryOfKey(out))
	}
}

func TestAttachContextCapsChildrenPerParent(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	all := []SessionSummary{parent}
	for i := 0; i < attachMaxChildrenPerHit+20; i++ {
		all = append(all, SessionSummary{
			Key:         "c" + string(rune('a'+i%26)) + string(rune('a'+i/26)),
			ParentKey:   "p",
			Kind:        SessionKindSubagent,
			ProjectPath: "/a",
		})
	}

	out := attachContext(context.Background(), []SessionSummary{parent}, all, ListOptions{AttachMode: AttachModeBoth})
	if got := len(out) - 1; got != attachMaxChildrenPerHit {
		t.Fatalf("want %d children, got %d", attachMaxChildrenPerHit, got)
	}
}

func TestAttachContextTruncatesTotalContext(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a"}
	all := []SessionSummary{parent}
	for i := 0; i < 10; i++ {
		all = append(all, SessionSummary{
			Key:         "c" + string(rune('a'+i)),
			ParentKey:   "p",
			Kind:        SessionKindSubagent,
			ProjectPath: "/a",
		})
	}
	out, truncated := attachContextExcluding(context.Background(), []SessionSummary{parent}, all, ListOptions{
		AttachMode:    AttachModeBoth,
		AttachMaxRows: 3,
	}, nil)
	if !truncated {
		t.Fatal("expected truncation flag")
	}
	if len(out) != 4 {
		t.Fatalf("want 1 hit + 3 context, got %d", len(out))
	}
}

func TestAttachContextSkipsMissingAndOrphans(t *testing.T) {
	parent := SessionSummary{Key: "p", Kind: SessionKindSession, ProjectPath: "/a", Missing: true}
	handler := SessionSummary{Key: "c", ParentKey: "p", Kind: SessionKindSubagent, ProjectPath: "/a"}
	orphan := SessionSummary{Key: "o", ParentKey: "gone", Kind: SessionKindSubagent, ProjectPath: "/a"}
	all := []SessionSummary{parent, handler}

	out := attachContext(context.Background(), []SessionSummary{handler, orphan}, all, ListOptions{AttachMode: AttachModeBoth})
	if len(out) != 2 {
		t.Fatalf("missing parent or dangling parent must not add rows, got %v", summaryOfKey(out))
	}
}

func TestNormalizeAttachMode(t *testing.T) {
	cases := map[string]string{
		"":         AttachModeOff,
		"OFF":      AttachModeOff,
		"junk":     AttachModeOff,
		" Both ":   AttachModeBoth,
		"children": AttachModeChildren,
		"parent":   AttachModeParent,
	}
	for input, want := range cases {
		if got := normalizeAttachMode(input); got != want {
			t.Fatalf("%q -> %q, want %q", input, got, want)
		}
	}
}

func TestListWithDistributionAndQueryAttachesBothDirections(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	summaries := []SessionSummary{
		{Key: "p", ID: "p", Source: "pi", Title: "parent rollout", ProjectPath: "/work/x", CreatedAt: 100, UpdatedAt: 100, FilePath: filepath.Join(dir, "p.jsonl")},
		{Key: "c1", ID: "c1", Source: "pi", Title: "child alpha", ProjectPath: "/work/x", ParentKey: "p", Kind: SessionKindSubagent, CreatedAt: 200, UpdatedAt: 200, FilePath: filepath.Join(dir, "c1.jsonl")},
		{Key: "c2", ID: "c2", Source: "pi", Title: "child beta", ProjectPath: "/work/x", ParentKey: "p", Kind: SessionKindSubagent, CreatedAt: 300, UpdatedAt: 300, FilePath: filepath.Join(dir, "c2.jsonl")},
		{Key: "other", ID: "other", Source: "pi", Title: "unrelated", ProjectPath: "/work/x", CreatedAt: 400, UpdatedAt: 400, FilePath: filepath.Join(dir, "o.jsonl")},
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), summaries, true); len(errs) != 0 {
		t.Fatalf("save errors: %v", errs)
	}

	// 命中子代理 → 补带父。
	out, _, truncated, err := idx.ListWithDistributionAndQuery(context.Background(),
		ListOptions{AttachMode: AttachModeBoth, Limit: 200}, "child beta")
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("unexpected truncation")
	}
	byKey := map[string]SessionSummary{}
	for _, s := range out {
		byKey[s.Key] = s
	}
	if byKey["p"].Attached != AttachedReasonParent {
		t.Fatalf("parent not attached: %#v", byKey["p"])
	}
	if byKey["c2"].Attached != "" {
		t.Fatalf("hit must not be attached: %#v", byKey["c2"])
	}
	// 父的另一个子代理不是命中行，也不是补带目标（它不是命中父的子）。
	if _, ok := byKey["c1"]; ok {
		t.Fatal("sibling subagent should not be pulled in")
	}

	// 命中父 → 带出子代理。
	out, _, _, err = idx.ListWithDistributionAndQuery(context.Background(),
		ListOptions{AttachMode: AttachModeBoth, Limit: 200}, "parent rollout")
	if err != nil {
		t.Fatal(err)
	}
	byKey = map[string]SessionSummary{}
	for _, s := range out {
		byKey[s.Key] = s
	}
	if byKey["c1"].Attached != AttachedReasonChild || byKey["c2"].Attached != AttachedReasonChild {
		t.Fatalf("children should be attached as context: %#v", byKey)
	}

	// 精确模式：两个方向都不补。
	out, _, _, err = idx.ListWithDistributionAndQuery(context.Background(),
		ListOptions{AttachMode: AttachModeOff, Limit: 200}, "child beta")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Key != "c2" {
		t.Fatalf("off mode must return only the hit, got %v", summaryOfKey(out))
	}
}

func TestSummaryMatchesQueryBySessionIDAndKey(t *testing.T) {
	summary := SessionSummary{
		Key:         "pi:54d0ff7c-8067-46fa-9e8b-df57e9ef2c6b:/sessions/a.jsonl",
		ID:          "54d0ff7c-8067-46fa-9e8b-df57e9ef2c6b",
		Source:      "pi",
		Title:       "unrelated title",
		ProjectPath: "/work/x",
	}
	cases := []string{
		"54d0ff7c-8067-46fa-9e8b-df57e9ef2c6b",         // 裸 id
		"54d0ff7c",                                     // id 片段
		"SESSION:54d0ff7c-8067-46fa-9e8b-df57e9ef2c6b", // 带前缀（大小写不敏感）
		"id:54d0ff7c",                                  // 短前缀 + 片段
		"pi:54d0ff7c-8067-46fa-9e8b-df57e9ef2c6b",      // 整条 key 的前半段
	}
	for _, query := range cases {
		if !summaryMatchesQuery(summary, query) {
			t.Fatalf("query %q should match the session id/key", query)
		}
	}
	if summaryMatchesQuery(summary, "no-such-session") {
		t.Fatal("unrelated query must not match")
	}
}

func TestSortSummariesByCreatedBeforeLimit(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	// old-created but recently updated vs new-created but stale-updated.
	summaries := []SessionSummary{
		{Key: "old", ID: "old", Source: "pi", ProjectPath: "/work/x", CreatedAt: 100, UpdatedAt: 900, FilePath: filepath.Join(dir, "old.jsonl")},
		{Key: "new", ID: "new", Source: "pi", ProjectPath: "/work/x", CreatedAt: 900, UpdatedAt: 100, FilePath: filepath.Join(dir, "new.jsonl")},
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), summaries, true); len(errs) != 0 {
		t.Fatalf("save errors: %v", errs)
	}

	// Default ordering (updatedAt desc) + limit 1 keeps "old".
	out, _, _, err := idx.ListWithDistributionAndQuery(context.Background(), ListOptions{Limit: 1}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Key != "old" {
		t.Fatalf("default sort should keep the recently updated row, got %v", summaryOfKey(out))
	}

	// Created desc must pick the newest-created row even though it was updated long ago.
	out, _, _, err = idx.ListWithDistributionAndQuery(context.Background(),
		ListOptions{Limit: 1, SortField: SortFieldCreated, SortDesc: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Key != "new" {
		t.Fatalf("created desc should keep the newest-created row, got %v", summaryOfKey(out))
	}

	// Created asc picks the oldest.
	out, _, _, err = idx.ListWithDistributionAndQuery(context.Background(),
		ListOptions{Limit: 1, SortField: SortFieldCreated, SortDesc: false}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Key != "old" {
		t.Fatalf("created asc should keep the oldest-created row, got %v", summaryOfKey(out))
	}
}
