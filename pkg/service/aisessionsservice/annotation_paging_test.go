// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// setupAnnotationPagingTest points the local AI-session index at a temp dir so
// the paging tests never touch real user data.
func setupAnnotationPagingTest(t *testing.T) {
	t.Helper()
	dataDir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(dataDir, "index.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dataDir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dataDir, "index.sqlite"))
	previous := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = dataDir
	t.Cleanup(func() {
		wavebase.DataHome_VarCache = previous
	})
}

// TestAnnotationsCursorPaging walks the RPC cursor protocol end to end:
// latest page / older pages / exhaustion / v1 full-list compatibility /
// limit clamping (min 20) / same-seq entries across a page boundary.
func TestAnnotationsCursorPaging(t *testing.T) {
	setupAnnotationPagingTest(t)
	ctx := context.Background()
	svc := &AISessionsService{}
	key := "codex:annpage:/tmp/annpage.jsonl"

	seed := func(seq int, title string) {
		t.Helper()
		_, err := svc.AnnotationSave(ctx, &AISessionsAnnotationSaveRequest{
			SessionKey: key,
			AnchorKey:  fmt.Sprintf("e1:m%d", seq),
			Seq:        seq,
			Title:      title,
			Body:       "paging seed",
			Status:     "accepted",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	// 27 条：seq 1..25，外加 seq 13 上的两条同 seq 条目（页边界要按 id 拆开）。
	for seq := 1; seq <= 25; seq++ {
		seed(seq, fmt.Sprintf("note %d", seq))
	}
	seed(13, "note 13b")
	seed(13, "note 13c")

	// v1 兼容：不带 cursor/limit = 全量返回，hasMore=false，nextCursor=nil。
	full, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{SessionKey: key})
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Annotations) != 27 || full.HasMore || full.NextCursor != nil {
		t.Fatalf("v1 full-list mismatch: len=%d hasMore=%v next=%#v", len(full.Annotations), full.HasMore, full.NextCursor)
	}

	// 首页（最新端）：limit 20（下界夹取值），升序，游标指向页内最早条目。
	page1, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{SessionKey: key, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(page1.Annotations) != 20 || !page1.HasMore || page1.NextCursor == nil {
		t.Fatalf("first page mismatch: len=%d hasMore=%v next=%#v", len(page1.Annotations), page1.HasMore, page1.NextCursor)
	}
	if page1.Annotations[0].Seq != 8 || page1.Annotations[0].Title != "note 8" {
		t.Fatalf("first page must start 20 entries from the top, got %#v", page1.Annotations[0])
	}
	if page1.NextCursor.BeforeSeq != 8 || page1.NextCursor.BeforeID != page1.Annotations[0].ID {
		t.Fatalf("first-page cursor must point at the earliest returned entry: %#v", page1.NextCursor)
	}

	// 翻页直到耗尽；跨页不漏不重（同 seq 13 的三条可能被页边界拆开）。
	seen := map[string]bool{}
	cursor := page1.NextCursor
	for cursor != nil {
		pageN, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{SessionKey: key, Cursor: cursor, Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		for _, view := range pageN.Annotations {
			if seen[view.Title] {
				t.Fatalf("duplicate entry across pages: %s", view.Title)
			}
			seen[view.Title] = true
		}
		if len(pageN.Annotations) == 0 {
			t.Fatalf("non-final page must not be empty")
		}
		if !pageN.HasMore && pageN.NextCursor != nil {
			t.Fatalf("final page must not carry a cursor: %#v", pageN)
		}
		cursor = pageN.NextCursor
	}
	// 首页 20 条 + 翻页拿到的剩余条目 = 全量 27 条。
	for _, view := range page1.Annotations {
		seen[view.Title] = true
	}
	if len(seen) != 27 {
		t.Fatalf("paging leaked entries: seen=%d", len(seen))
	}

	// 耗尽：游标早于所有条目 → 空页、hasMore=false、nextCursor=nil。
	earliest := full.Annotations[0]
	done, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{
		SessionKey: key,
		Cursor:     &aisessions.AnnotationCursor{BeforeSeq: earliest.Seq, BeforeID: earliest.ID},
		Limit:      20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(done.Annotations) != 0 || done.HasMore || done.NextCursor != nil {
		t.Fatalf("exhausted page mismatch: %#v", done)
	}

	// limit 夹取下界：limit 4 → 夹到 20（与首页相同的一页）。
	clamped, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{SessionKey: key, Limit: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(clamped.Annotations) != 20 || clamped.Annotations[0].Seq != 8 || !clamped.HasMore {
		t.Fatalf("limit must clamp up to 20: len=%d first=%#v hasMore=%v", len(clamped.Annotations), clamped.Annotations[0], clamped.HasMore)
	}

	// cursor 给了、limit 缺省 → 默认 100（一页装下剩余全部，hasMore=false）。
	defaultLimit, err := svc.Annotations(ctx, &AISessionsAnnotationsRequest{
		SessionKey: key,
		Cursor:     &aisessions.AnnotationCursor{BeforeSeq: 7, BeforeID: 0},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(defaultLimit.Annotations) != 6 || defaultLimit.HasMore {
		t.Fatalf("default-limit page mismatch: len=%d hasMore=%v", len(defaultLimit.Annotations), defaultLimit.HasMore)
	}
}
