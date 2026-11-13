// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package persona

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 11, 13, 4, 0, 0, 0, time.UTC)

func TestJournalAppendFormatAndGuards(t *testing.T) {
	root := makePersonaRoot(t, "alpha")
	result, err := AppendJournal(root, "alpha", JournalEntry{
		State:   "done",
		Summary: "完成备份归档",
		Source:  "agent:pi（会话 s1）",
		Now:     func() time.Time { return testNow },
	})
	if err != nil {
		t.Fatalf("AppendJournal: %v", err)
	}
	want := "- 2026-11-13T04:00:00Z [done] agent:pi（会话 s1） — 完成备份归档\n"
	if result.Line != want {
		t.Fatalf("line = %q, want %q", result.Line, want)
	}
	body := readFileString(t, result.Path)
	if !strings.Contains(body, want) {
		t.Fatalf("journal missing appended line:\n%s", body)
	}
	if _, err := os.Stat(filepath.Join(root, ".index", "PERSONAS.md")); err != nil {
		t.Fatalf("roster not refreshed: %v", err)
	}
	if _, err := AppendJournal(root, "alpha", JournalEntry{State: "bogus", Summary: "x"}); err == nil {
		t.Fatal("invalid state accepted")
	}
	if _, err := AppendJournal(root, "alpha", JournalEntry{Summary: "   "}); err == nil {
		t.Fatal("blank summary accepted")
	}
	if _, err := AppendJournal(root, "ghost", JournalEntry{Summary: "x"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing persona error = %v, want ErrNotFound", err)
	}
	// Default state is done, and a second append never rewrites the first line.
	res2, err := AppendJournal(root, "alpha", JournalEntry{Summary: "第二条", Now: func() time.Time { return testNow }})
	if err != nil || !strings.Contains(res2.Line, "[done]") {
		t.Fatalf("second append = %+v, %v", res2, err)
	}
	body = readFileString(t, result.Path)
	if strings.Count(body, want) != 1 || !strings.Contains(body, "第二条") {
		t.Fatalf("journal is not append-only:\n%s", body)
	}
}

func seedInbox(t *testing.T, root, id, section, text string) {
	t.Helper()
	_, err := AddMemory(root, id, section, text, &Provenance{Kind: "agent", Name: "pi", SessionID: "s1"}, false)
	if err == nil {
		t.Fatalf("AddMemory(%s) should refuse direct write", section)
	}
}

func TestInboxParseApproveIsIdempotentAndAudited(t *testing.T) {
	root := makePersonaRoot(t, "alpha")
	seedInbox(t, root, "alpha", MemorySectionFacts, "备份盘在 E:/backup")
	items, err := ListInbox(root, "alpha")
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("inbox count = %d, want 1", len(items))
	}
	item := items[0]
	if item.Status != InboxStatusPending || item.Section != "facts" || item.Target != "MEMORY/facts.md" {
		t.Fatalf("parsed item = %+v", item)
	}
	if !strings.Contains(item.Content, "备份盘") || !strings.Contains(item.Source, "pi") {
		t.Fatalf("content/source lost: %+v", item)
	}

	action, err := ApproveInbox(root, "alpha", item.Stamp, func() time.Time { return testNow })
	if err != nil {
		t.Fatalf("ApproveInbox: %v", err)
	}
	if !action.Changed || action.Status != InboxStatusApproved || action.Target != "MEMORY/facts.md" {
		t.Fatalf("action = %+v", action)
	}
	facts := readFileString(t, personaMemoryPath(root, "alpha", "facts.md"))
	if !strings.Contains(facts, "备份盘在 E:/backup") {
		t.Fatalf("approved content not appended:\n%s", facts)
	}
	inbox := readFileString(t, action.Path)
	if !strings.Contains(inbox, "- 状态: approved") {
		t.Fatalf("inbox status not marked:\n%s", inbox)
	}
	journal := readFileString(t, personaMemoryPath(root, "alpha", "journal.md"))
	if !strings.Contains(journal, "批准 facts 提议") {
		t.Fatalf("approval not audited in journal:\n%s", journal)
	}
	// Idempotency: a second approval must not duplicate the fact.
	again, err := ApproveInbox(root, "alpha", item.Stamp, nil)
	if err != nil {
		t.Fatalf("second approve: %v", err)
	}
	if again.Changed || again.Status != InboxStatusApproved {
		t.Fatalf("second approve changed state: %+v", again)
	}
	if strings.Count(readFileString(t, personaMemoryPath(root, "alpha", "facts.md")), "备份盘在 E:/backup") != 1 {
		t.Fatal("approved content duplicated")
	}
	// A dismissed/approved item can never be dismissed afterwards.
	if _, err := DismissInbox(root, "alpha", item.Stamp); !errors.Is(err, ErrInboxNotPending) {
		t.Fatalf("dismiss approved error = %v, want ErrInboxNotPending", err)
	}
	if _, err := ApproveInbox(root, "alpha", "does-not-exist", nil); !errors.Is(err, ErrInboxNotFound) {
		t.Fatalf("unknown stamp error = %v, want ErrInboxNotFound", err)
	}
}

func TestInboxDismissKeepsProposalAndNeverWritesMemory(t *testing.T) {
	root := makePersonaRoot(t, "alpha")
	seedInbox(t, root, "alpha", MemorySectionLessons, "不要用 rm -rf 删据点")
	items, err := ListInbox(root, "alpha")
	if err != nil || len(items) != 1 {
		t.Fatalf("ListInbox = %+v, %v", items, err)
	}
	lessonsBefore := readFileString(t, personaMemoryPath(root, "alpha", "lessons.md"))
	action, err := DismissInbox(root, "alpha", items[0].Stamp)
	if err != nil {
		t.Fatalf("DismissInbox: %v", err)
	}
	if !action.Changed || action.Status != InboxStatusDismissed {
		t.Fatalf("action = %+v", action)
	}
	if readFileString(t, personaMemoryPath(root, "alpha", "lessons.md")) != lessonsBefore {
		t.Fatal("dismissing a proposal wrote long-term memory")
	}
	inbox := readFileString(t, action.Path)
	if !strings.Contains(inbox, "不要用 rm -rf 删据点") || !strings.Contains(inbox, "- 状态: dismissed") {
		t.Fatalf("dismissed proposal not preserved:\n%s", inbox)
	}
	if _, err := ApproveInbox(root, "alpha", items[0].Stamp, nil); !errors.Is(err, ErrInboxNotPending) {
		t.Fatalf("approve dismissed error = %v, want ErrInboxNotPending", err)
	}
	// Second dismiss is a no-op.
	again, err := DismissInbox(root, "alpha", items[0].Stamp)
	if err != nil || again.Changed {
		t.Fatalf("second dismiss = %+v, %v", again, err)
	}
}

func TestInboxLegacyBlockWithoutStatusIsPending(t *testing.T) {
	root := makePersonaRoot(t, "alpha")
	legacy := "## 2026-11-13T00:00:00Z facts propose\n\n- 来源: human:nita\n- 目标: MEMORY/facts.md\n- 内容: 旧格式提议\n\n"
	if err := os.WriteFile(inboxPath(root, "alpha"), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	items, err := ListInbox(root, "alpha")
	if err != nil || len(items) != 1 || items[0].Status != InboxStatusPending {
		t.Fatalf("legacy parse = %+v, %v", items, err)
	}
	if _, err := ApproveInbox(root, "alpha", items[0].Stamp, func() time.Time { return testNow }); err != nil {
		t.Fatalf("approving legacy proposal: %v", err)
	}
	if !strings.Contains(readFileString(t, personaMemoryPath(root, "alpha", "facts.md")), "旧格式提议") {
		t.Fatal("legacy content not approved")
	}
	if !strings.Contains(readFileString(t, inboxPath(root, "alpha")), "旧格式提议") {
		t.Fatal("legacy proposal body lost during status rewrite")
	}
	if strings.Count(readFileString(t, inboxPath(root, "alpha")), "## ") != 1 {
		t.Fatal("status rewrite duplicated/dropped proposal blocks")
	}
}

func TestInboxTargetWhitelistRejectsEscape(t *testing.T) {
	root := makePersonaRoot(t, "alpha")
	evil := "## 2026-11-13T00:00:00Z facts propose\n\n- 来源: agent:x\n- 目标: ../../../etc/passwd\n- 内容: pwn\n\n"
	if err := os.WriteFile(inboxPath(root, "alpha"), []byte(evil), 0o644); err != nil {
		t.Fatal(err)
	}
	items, err := ListInbox(root, "alpha")
	if err != nil || len(items) != 1 {
		t.Fatalf("parse = %+v, %v", items, err)
	}
	if _, err := ApproveInbox(root, "alpha", items[0].Stamp, nil); err == nil {
		t.Fatal("path-escape target accepted")
	}
}
