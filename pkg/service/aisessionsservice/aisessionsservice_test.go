// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
)

func TestStatKnownCodexSessionFile(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-test-id.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	stat, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: sessionPath})
	if err != nil {
		t.Fatal(err)
	}
	if stat.FilePath != sessionPath || stat.Size == 0 || stat.MTime == 0 || stat.Missing {
		t.Fatalf("unexpected stat response: %#v", stat)
	}
}

func TestStatRejectsPathOutsideSessionRoots(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	outsidePath := filepath.Join(t.TempDir(), "not-a-session.jsonl")
	if err := os.WriteFile(outsidePath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := (&AISessionsService{}).Stat(context.Background(), &AISessionsStatRequest{FilePath: outsidePath})
	if err == nil {
		t.Fatalf("expected outside path to be rejected")
	}
}

func TestUserOutlineFindsUserMessagesOutsideRecentTail(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(t.TempDir(), "meta.json"))
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-outline-test.jsonl")
	var lines []string
	lines = append(lines,
		`{"timestamp":"2026-05-14T00:00:00Z","type":"session_meta","payload":{"id":"outline-test","cwd":"/tmp/project"}}`,
		`{"timestamp":"2026-05-14T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":"Initial user request"}}`,
	)
	for idx := 0; idx < 120; idx++ {
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Assistant message %d"}}`,
			idx,
		))
	}
	if err := os.WriteFile(sessionPath, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	detail, err := (&AISessionsService{}).Detail(context.Background(), &AISessionsDetailRequest{
		ID:   "outline-test",
		Tail: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range detail.Messages {
		if message.Role == "user" {
			t.Fatalf("expected tailed detail to omit early user message, got %#v", message)
		}
	}

	outline, err := (&AISessionsService{}).UserOutline(context.Background(), &AISessionsUserOutlineRequest{
		ID:    "outline-test",
		Limit: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if outline.UserMessageCount != 1 {
		t.Fatalf("expected one user message, got %d", outline.UserMessageCount)
	}
	if len(outline.Messages) != 1 || outline.Messages[0].Text != "Initial user request" {
		t.Fatalf("unexpected outline messages: %#v", outline.Messages)
	}
}

func TestLatestUserOutlineMessagesLimitsLatestMessages(t *testing.T) {
	messages := []aisessions.Message{
		{Seq: 1, Role: aisessions.RoleUser, Text: "one"},
		{Seq: 2, Role: aisessions.RoleAssistant, Text: "assistant"},
		{Seq: 3, Role: aisessions.RoleUser, Text: "two"},
		{Seq: 4, Role: aisessions.RoleUser, Text: "three"},
	}
	latest, count := latestUserOutlineMessages(messages, 2)
	if count != 3 {
		t.Fatalf("expected total count 3, got %d", count)
	}
	if len(latest) != 2 || latest[0].Seq != 3 || latest[1].Seq != 4 {
		t.Fatalf("expected latest two user messages, got %#v", latest)
	}
}

func TestUserLinesDefaultsToEightAndPagesOlderMessages(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(t.TempDir(), "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(t.TempDir(), "index.json"))
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-user-lines-test.jsonl")
	var lines []string
	lines = append(lines, `{"timestamp":"2026-05-14T00:00:00Z","type":"session_meta","payload":{"id":"user-lines-test","cwd":"/tmp/project"}}`)
	for idx := 1; idx <= 12; idx++ {
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:00:%02dZ","type":"response_item","payload":{"type":"message","role":"user","content":"User line %02d"}}`,
			idx,
			idx,
		))
	}
	if err := os.WriteFile(sessionPath, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	first, err := (&AISessionsService{}).UserLines(context.Background(), &AISessionsUserLinesRequest{
		ID: "user-lines-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.UserMessageCount != 12 || len(first.Messages) != 8 || !first.HasMore {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Messages[0].Seq != 5 || first.Messages[7].Seq != 12 || first.NextBeforeSeq != 5 {
		t.Fatalf("unexpected first page messages: %#v", first.Messages)
	}

	second, err := (&AISessionsService{}).UserLines(context.Background(), &AISessionsUserLinesRequest{
		ID:        "user-lines-test",
		BeforeSeq: first.NextBeforeSeq,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Messages) != 4 || second.HasMore || second.Messages[0].Seq != 1 || second.Messages[3].Seq != 4 {
		t.Fatalf("unexpected second page: %#v", second)
	}

	outline, err := (&AISessionsService{}).UserOutline(context.Background(), &AISessionsUserOutlineRequest{
		ID: "user-lines-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if outline.UserMessageCount != 12 || len(outline.Messages) != 12 {
		t.Fatalf("expected UserOutline default to keep existing 20 item behavior, got %#v", outline)
	}
}
