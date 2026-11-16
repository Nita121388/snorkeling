// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
)

func openAnnotationTestIndex(t *testing.T) *SQLiteIndex {
	t.Helper()
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "index-v2.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = idx.Close() })
	return idx
}

func TestAnnotationCreateListDelete(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann:/tmp/ann.jsonl"

	created, err := idx.UpsertAnnotation(ctx, AnnotationRow{
		SessionKey: key,
		AnchorKey:  "e1:m0",
		Seq:        1,
		Kind:       "milestone",
		Title:      "First decision",
		Body:       "We picked SQLite.",
		Tags:       []string{"#Arch", "design", "design"},
		Status:     "accepted",
		Source:     "user",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 {
		t.Fatalf("expected an id, got %#v", created)
	}
	if len(decodeAnnotationTags(created.TagsJSON)) != 2 {
		t.Fatalf("tags must be normalized/deduped: %#v", created.TagsJSON)
	}

	rows, err := idx.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Title != "First decision" {
		t.Fatalf("unexpected list: %#v", rows)
	}

	if err := idx.DeleteAnnotation(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	rows, _ = idx.ListAnnotations(ctx, key)
	if len(rows) != 0 {
		t.Fatalf("delete failed: %#v", rows)
	}
	if err := idx.DeleteAnnotation(ctx, created.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("second delete should report ErrNoRows, got %v", err)
	}
}

func TestAnnotationUpdateAIMarksUserEdited(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann-ai:/tmp/ann-ai.jsonl"

	ai, err := idx.UpsertAnnotation(ctx, AnnotationRow{
		SessionKey: key,
		AnchorKey:  "e1:m0",
		Seq:        1,
		Title:      "AI title",
		Status:     "draft",
		Source:     "ai",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ai.UserEdited {
		t.Fatalf("new AI row must start unedited")
	}

	ai.Title = "Human fixed title"
	updated, err := idx.UpsertAnnotation(ctx, ai)
	if err != nil {
		t.Fatal(err)
	}
	if !updated.UserEdited {
		t.Fatalf("saving an AI row must set user_edited=1")
	}
	if CanReplace(updated) {
		t.Fatalf("edited AI row must be protected")
	}
}

func TestReplaceReplaceableAnnotationsProtectsUserData(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	key := "codex:ann-replace:/tmp/ann-replace.jsonl"

	manual, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Seq: 1, Title: "manual", Source: "user", Status: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	aiDraft, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e2:m0", Seq: 2, Title: "ai draft", Source: "ai", Status: "draft"})
	if err != nil {
		t.Fatal(err)
	}
	aiEdited, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e3:m0", Seq: 3, Title: "ai edited", Source: "ai", Status: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	aiEdited.Body = "human edit"
	aiEdited, err = idx.UpsertAnnotation(ctx, aiEdited)
	if err != nil {
		t.Fatal(err)
	}

	inserted, err := idx.ReplaceReplaceableAnnotations(ctx, key, []AnnotationRow{
		{AnchorKey: "e9:m0", Seq: 9, Title: "new draft", Body: "regenerated"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(inserted) != 1 || inserted[0].Status != AnnotationStatusDraft {
		t.Fatalf("new rows must be drafts: %#v", inserted)
	}

	rows, err := idx.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]bool{}
	for _, row := range rows {
		titles[row.Title] = true
	}
	if !titles["manual"] {
		t.Fatalf("manual annotation was deleted")
	}
	if !titles["ai edited"] {
		t.Fatalf("user-edited AI annotation was deleted")
	}
	if titles["ai draft"] {
		t.Fatalf("replaceable draft should be deleted")
	}
	if !titles["new draft"] {
		t.Fatalf("replacement was not inserted")
	}
	_ = aiDraft
	_ = manual
	_ = aiEdited
}

func TestListAnnotatedSessionsAggregatesAcceptedOnly(t *testing.T) {
	idx := openAnnotationTestIndex(t)
	ctx := context.Background()
	withAnnotations := SessionSummary{Key: "codex:s1:/tmp/s1.jsonl", ID: "s1", Source: "codex", Title: "Session One", ProjectPath: "/repo/one", FilePath: "/tmp/s1.jsonl", UpdatedAt: 100}
	draftOnly := SessionSummary{Key: "codex:s2:/tmp/s2.jsonl", ID: "s2", Source: "codex", Title: "Session Two", ProjectPath: "/repo/two", FilePath: "/tmp/s2.jsonl", UpdatedAt: 200}
	for _, summary := range []SessionSummary{withAnnotations, draftOnly} {
		if err := idx.SaveSummary(ctx, summary); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: withAnnotations.Key, AnchorKey: "e1:m0", Seq: 1, Title: "kept", Tags: []string{"k8s"}, Status: "accepted", Source: "user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := idx.UpsertAnnotation(ctx, AnnotationRow{SessionKey: draftOnly.Key, AnchorKey: "e1:m0", Seq: 1, Title: "draft", Status: "draft", Source: "ai"}); err != nil {
		t.Fatal(err)
	}

	sessions, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(sessions) != 1 || sessions[0].Key != withAnnotations.Key {
		t.Fatalf("draft-only session must not appear: total=%d %#v", total, sessions)
	}
	if sessions[0].AnnotationCount != 1 {
		t.Fatalf("expected 1 annotation, got %#v", sessions[0])
	}

	tagged, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{TagFilters: []string{"k8s"}})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(tagged) != 1 {
		t.Fatalf("tag filter failed: total=%d %#v", total, tagged)
	}
	none, total, err := idx.ListAnnotatedSessions(ctx, AnnotatedSessionFilter{TagFilters: []string{"missing-tag"}})
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 || len(none) != 0 {
		t.Fatalf("unexpected tag matches: total=%d %#v", total, none)
	}
}

func TestResolveAnnotationAnchorsFixesStaleSeqForSameKey(t *testing.T) {
	// 回归：AI 生成的批注只带 anchorKey 落库，seq 恒为 0。活锚点里同一个 key
	// 存在但位置不同时，必须把 seq/hash 补写回去，否则时间线圆点永远不跳转。
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()
	key := "codex:ann-stale:/tmp/ann-stale.jsonl"

	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{
		SessionKey: key, AnchorKey: "e1:t0", Seq: 0, Title: "ai draft", AnchorPreview: "bash ls", Source: "ai",
	}); err != nil {
		t.Fatal(err)
	}

	views, err := manager.ResolveAnnotationAnchors(ctx, key, []AnnotationAnchor{
		{AnchorKey: "e1:t0", Seq: 7, Role: "tool", Hash: AnchorHash("bash\nls")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 {
		t.Fatalf("expected 1 view, got %#v", views)
	}
	if views[0].Seq != 7 {
		t.Fatalf("stale seq must be rewritten to the live anchor seq, got %#v", views[0])
	}
	if views[0].Orphaned {
		t.Fatalf("same-key anchor must not be orphaned: %#v", views[0])
	}

	stored, err := manager.ListAnnotations(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 1 || stored[0].Seq != 7 {
		t.Fatalf("seq must be persisted, got %#v", stored)
	}
}

func TestResolveAnnotationAnchorsReanchorsAndOrphans(t *testing.T) {
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	ctx := context.Background()
	key := "codex:ann-anchor:/tmp/ann-anchor.jsonl"

	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e1:m0", Seq: 1, Title: "drifted", AnchorHash: AnchorHash("node one"), Source: "user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.SaveAnnotation(ctx, AnnotationRow{SessionKey: key, AnchorKey: "e9:m0", Seq: 9, Title: "orphan", AnchorHash: AnchorHash("unknown"), Source: "user"}); err != nil {
		t.Fatal(err)
	}

	views, err := manager.ResolveAnnotationAnchors(ctx, key, []AnnotationAnchor{
		{AnchorKey: "e2:m0", Seq: 2, Role: "user", Hash: AnchorHash("node one")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 2 {
		t.Fatalf("expected 2 views, got %#v", views)
	}
	byTitle := map[string]AnnotationView{}
	for _, view := range views {
		byTitle[view.Title] = view
	}
	if byTitle["drifted"].AnchorKey != "e2:m0" || byTitle["drifted"].Orphaned {
		t.Fatalf("drifted annotation should re-anchor: %#v", byTitle["drifted"])
	}
	if !byTitle["orphan"].Orphaned {
		t.Fatalf("unresolvable annotation should be orphaned: %#v", byTitle["orphan"])
	}

	// No anchors supplied = do not flag anything as orphaned.
	plain, err := manager.ResolveAnnotationAnchors(ctx, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range plain {
		if view.Orphaned {
			t.Fatalf("empty anchor list must not orphan: %#v", view)
		}
	}
}


func pagingTestViews(count int) []AnnotationView {
	views := make([]AnnotationView, 0, count)
	for seq := 1; seq <= count; seq++ {
		views = append(views, AnnotationView{
			ID:        int64(seq),
			Seq:       seq,
			AnchorKey: fmt.Sprintf("e1:m%d", seq),
			Title:     fmt.Sprintf("note %d", seq),
		})
	}
	return views
}

func pagingTitles(views []AnnotationView) []string {
	titles := make([]string, 0, len(views))
	for _, view := range views {
		titles = append(titles, view.Title)
	}
	return titles
}

func pagingTitleRange(views []AnnotationView) string {
	if len(views) == 0 {
		return "[]"
	}
	return fmt.Sprintf("[note %d..note %d]", views[0].Seq, views[len(views)-1].Seq)
}

// TestPageAnnotationViews 覆盖游标边界：首页 / 翻页 / 耗尽 / 零值 cursor /
// v1 全量兼容 / limit 夹取 / resolve 后乱序输入。注意 limit 下界 20，
// 所以用 30 条以上才能逼出真实翻页。
func TestPageAnnotationViews(t *testing.T) {
	views := pagingTestViews(30)

	// 首页：nil cursor = 最新页（最新端 20 条），升序。
	page, hasMore, next := PageAnnotationViews(views, nil, 20)
	if len(page) != 20 || !hasMore || next == nil {
		t.Fatalf("latest page mismatch: len=%d hasMore=%v next=%#v", len(page), hasMore, next)
	}
	if page[0].Seq != 11 || page[0].ID != 11 {
		t.Fatalf("latest page must start at note 11, got %#v", page[0])
	}
	if next.BeforeSeq != 11 || next.BeforeID != 11 {
		t.Fatalf("latest page cursor mismatch: %#v", next)
	}

	// 零值 cursor ≡ nil cursor（最新页）。
	zeroPage, zeroMore, zeroNext := PageAnnotationViews(views, &AnnotationCursor{}, 20)
	if !reflect.DeepEqual(zeroPage, page) || zeroMore != hasMore || !reflect.DeepEqual(zeroNext, next) {
		t.Fatalf("zero cursor must equal nil cursor")
	}

	// 翻页：cursor = 上一页最早条目，返回严格更早的一页。
	page2, hasMore2, next2 := PageAnnotationViews(views, next, 20)
	if len(page2) != 10 || hasMore2 || next2 != nil {
		t.Fatalf("second page mismatch: len=%d hasMore=%v next=%#v", len(page2), hasMore2, next2)
	}
	if page2[0].Seq != 1 || page2[9].Seq != 10 {
		t.Fatalf("second page content mismatch: %s", pagingTitleRange(page2))
	}

	// 耗尽：cursor 早于所有条目 → 空页。
	page3, hasMore3, next3 := PageAnnotationViews(views, &AnnotationCursor{BeforeSeq: 1, BeforeID: 1}, 20)
	if len(page3) != 0 || hasMore3 || next3 != nil {
		t.Fatalf("exhausted page mismatch: len=%d hasMore=%v next=%#v", len(page3), hasMore3, next3)
	}

	// v1 兼容：nil cursor + limit 0 → 全量返回，hasMore=false，nextCursor=nil。
	full, fullMore, fullNext := PageAnnotationViews(views, nil, 0)
	if len(full) != 30 || fullMore || fullNext != nil {
		t.Fatalf("v1 full-list mismatch: len=%d hasMore=%v next=%#v", len(full), fullMore, fullNext)
	}

	// limit 夹取下界：limit 5 → 20。
	minPage, minMore, _ := PageAnnotationViews(views, nil, 5)
	if len(minPage) != 20 || !minMore || minPage[0].Seq != 11 {
		t.Fatalf("limit must clamp up to min 20: len=%d hasMore=%v first=%d", len(minPage), minMore, minPage[0].Seq)
	}

	// limit 夹取上界：limit 1000 → 500。
	maxViews := pagingTestViews(600)
	maxPage, maxMore, _ := PageAnnotationViews(maxViews, nil, 1000)
	if len(maxPage) != 500 || !maxMore {
		t.Fatalf("limit must clamp to max 500: len=%d hasMore=%v", len(maxPage), maxMore)
	}

	// cursor 有、limit 缺省 → 默认 100：早于 (400,400) 的有 399 条，取最新 100。
	defPage, defMore, defNext := PageAnnotationViews(maxViews, &AnnotationCursor{BeforeSeq: 400, BeforeID: 400}, 0)
	if len(defPage) != 100 || !defMore || defNext == nil || defPage[0].Seq != 300 {
		t.Fatalf("default limit must be 100: len=%d hasMore=%v first=%d", len(defPage), defMore, defPage[0].Seq)
	}

	// resolve 之后的乱序输入（重锚定改写 seq）→ 按新 seq 升序重排。
	shuffled := []AnnotationView{{ID: 3, Seq: 7, Title: "note 7"}, {ID: 1, Seq: 1, Title: "note 1"}, {ID: 2, Seq: 3, Title: "note 3"}}
	sortedPage, _, _ := PageAnnotationViews(shuffled, nil, 20)
	if fmt.Sprint(pagingTitles(sortedPage)) != "[note 1 note 3 note 7]" {
		t.Fatalf("post-resolve ordering mismatch: %v", pagingTitles(sortedPage))
	}
}

// TestPageAnnotationViewsSameSeq：同一 seq 多条按 id 二级排序，翻页不漏不重。
func TestPageAnnotationViewsSameSeq(t *testing.T) {
	views := pagingTestViews(20)
	// seq 15 上再叠 5 条（id 21..25），共 25 条，页边界会把同 seq 簇拆开。
	for extra := 21; extra <= 25; extra++ {
		views = append(views, AnnotationView{ID: int64(extra), Seq: 15, AnchorKey: "e1:m15", Title: fmt.Sprintf("note 15-%d", extra)})
	}

	seen := map[string]bool{}
	var cursor *AnnotationCursor
	pages := 0
	for {
		page, hasMore, errNext := PageAnnotationViews(views, cursor, 20)
		pages++
		for _, view := range page {
			if seen[view.Title] {
				t.Fatalf("duplicate entry across pages: %s", view.Title)
			}
			seen[view.Title] = true
		}
		if !hasMore {
			if errNext != nil {
				t.Fatalf("final page must not carry a cursor: %#v", errNext)
			}
			break
		}
		cursor = errNext
		if pages > 10 {
			t.Fatalf("paging did not converge")
		}
	}
	if len(seen) != 25 || pages != 2 {
		t.Fatalf("same-seq paging leaked entries: seen=%d pages=%d", len(seen), pages)
	}

	// 游标落在同 seq 簇中间：严格早于 (15, 22) 的 = seq 1..14 + (15,15) + (15,21) = 16 条。
	midPage, _, _ := PageAnnotationViews(views, &AnnotationCursor{BeforeSeq: 15, BeforeID: 22}, 20)
	if len(midPage) != 16 || midPage[14].Title != "note 15" || midPage[15].Title != "note 15-21" {
		t.Fatalf("mid-seq cursor mismatch: len=%d last two=%v,%v", len(midPage), midPage[14].Title, midPage[15].Title)
	}
}
