// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessionsservice

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aisessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// setupSessionReadService points every aisessions path at a temp dir and gives
// the test a private CODEX_HOME to write fixtures into.
func setupSessionReadService(t *testing.T) (codexHome string) {
	t.Helper()
	home := t.TempDir()
	dataDir := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("WAVETERM_AI_SESSIONS_INDEX", filepath.Join(dataDir, "index.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dataDir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dataDir, "index.sqlite"))
	previous := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = dataDir
	t.Cleanup(func() {
		wavebase.DataHome_VarCache = previous
	})
	codexHome = t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	return codexHome
}

// writeCodexSessionTurns writes a codex transcript with turnCount turns. Each
// turn is: user message(s) -> tool output -> assistant answer.
func writeCodexSessionTurns(t *testing.T, codexHome string, sessionID string, turnCount int, userPrefix string) string {
	t.Helper()
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "14")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sessionDir, "rollout-2026-05-14T00-00-00-"+sessionID+".jsonl")
	var lines []string
	lines = append(lines, fmt.Sprintf(`{"timestamp":"2026-05-14T00:00:00Z","type":"session_meta","payload":{"id":%q,"cwd":"/tmp/project"}}`, sessionID))
	second := 1
	for turn := 1; turn <= turnCount; turn++ {
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:%02d:%02dZ","type":"response_item","payload":{"type":"message","role":"user","content":%q}}`,
			second/60, second%60,
			fmt.Sprintf("%s user message %d", userPrefix, turn),
		))
		second++
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:%02d:%02dZ","type":"response_item","payload":{"type":"function_call_output","output":%q}}`,
			second/60, second%60,
			fmt.Sprintf("tool output %d", turn),
		))
		second++
		lines = append(lines, fmt.Sprintf(
			`{"timestamp":"2026-05-14T00:%02d:%02dZ","type":"response_item","payload":{"type":"message","role":"assistant","content":%q}}`,
			second/60, second%60,
			fmt.Sprintf("assistant answer %d", turn),
		))
		second++
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// AC1：info 给出分档 + 计数 + 体积，且不返回正文。
func TestSessionInfoReportsVerdictAndCounts(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "info-small", 10, "probe")
	info, err := (&AISessionsService{}).SessionInfo(context.Background(), &AISessionsSessionInfoRequest{ID: "info-small", Refresh: true})
	if err != nil {
		t.Fatal(err)
	}
	if info.Verdict != aisessions.SessionVerdictSmall {
		t.Fatalf("expected small verdict, got %#v", info)
	}
	if info.Stale {
		t.Fatalf("fresh session reported stale: %#v", info)
	}
	if info.UserMessageCount != 10 {
		t.Fatalf("userMessageCount = %d, want 10", info.UserMessageCount)
	}
	if info.MessageCount < 30 || info.Bytes <= 0 || info.LastMessageAt == 0 {
		t.Fatalf("unexpected info counters: %#v", info)
	}
	// 一行元信息，不含正文
	payload := fmt.Sprintf("%+v", *info)
	if strings.Contains(payload, "user message 1") || strings.Contains(payload, "assistant answer") {
		t.Fatalf("info leaked message content: %s", payload)
	}
}

// AC1（stale 口径）：文件在索引后变了，info 必须报 stale 而不是静默给出旧计数。
func TestSessionInfoReportsStaleAfterFileChange(t *testing.T) {
	codexHome := setupSessionReadService(t)
	path := writeCodexSessionTurns(t, codexHome, "info-stale", 3, "stale")
	service := &AISessionsService{}
	first, err := service.SessionInfo(context.Background(), &AISessionsSessionInfoRequest{ID: "info-stale", Refresh: true})
	if err != nil {
		t.Fatal(err)
	}
	if first.Stale {
		t.Fatalf("unexpected stale on first read: %#v", first)
	}
	// 追加一条新消息但不动消息索引：summary 会被扫描追上，消息索引不会。
	appendLine := `
{"timestamp":"2026-05-14T00:10:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"late question"}}
`
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(appendLine); err != nil {
		t.Fatal(err)
	}
	file.Close()
	// 不带 --refresh：消息索引没追上，必须如实报 stale
	second, err := service.SessionInfo(context.Background(), &AISessionsSessionInfoRequest{ID: "info-stale"})
	if err != nil {
		t.Fatal(err)
	}
	if !second.Stale {
		t.Fatalf("expected stale=true after appending a message: %#v", second)
	}
}

// AC2：users 一页 20 条、翻到底不重不漏，条数与 userMessageCount 一致。
func TestSessionUsersPagesToTheEnd(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "users-page", 25, "paged")
	service := &AISessionsService{}
	info, err := service.SessionInfo(context.Background(), &AISessionsSessionInfoRequest{ID: "users-page", Refresh: true})
	if err != nil {
		t.Fatal(err)
	}
	var seen []int
	beforeSeq := 0
	firstPage := true
	for {
		page, err := service.SessionUsers(context.Background(), &AISessionsSessionUsersRequest{
			ID:        "users-page",
			Limit:     20,
			BeforeSeq: beforeSeq,
			Refresh:   firstPage,
		})
		firstPage = false
		if err != nil {
			t.Fatal(err)
		}
		if page.Stale {
			t.Fatalf("unexpected stale page: %#v", page)
		}
		for _, row := range page.Rows {
			seen = append(seen, row.Seq)
			if !strings.Contains(row.Text, "paged user message") {
				t.Fatalf("non-user row leaked into users page: %#v", row)
			}
		}
		if !page.HasMore {
			break
		}
		beforeSeq = page.NextBeforeSeq
	}
	if len(seen) != info.UserMessageCount {
		t.Fatalf("paged %d rows but info reports %d user messages", len(seen), info.UserMessageCount)
	}
	seenSet := map[int]bool{}
	for _, seq := range seen {
		if seenSet[seq] {
			t.Fatalf("duplicate seq %d while paging", seq)
		}
		seenSet[seq] = true
	}
}

// AC3：turns 的轮边界与 user 消息切分一致（首/中/末轮），并在无 limit 时报错。
func TestSessionTurnsMatchesUserSegmentsAndGates(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "turns-page", 6, "turn")
	service := &AISessionsService{}
	page, err := service.SessionTurns(context.Background(), &AISessionsSessionTurnsRequest{ID: "turns-page", Limit: 3, Refresh: true})
	if err != nil {
		t.Fatal(err)
	}
	if page.Stale {
		t.Fatalf("unexpected stale page: %#v", page)
	}
	if len(page.Rows) != 3 || !page.HasMore || page.NextBeforeTurn != 4 {
		t.Fatalf("unexpected last page: %#v", page)
	}
	for _, row := range page.Rows {
		if !strings.Contains(row.Text, "turn user message") {
			t.Fatalf("turn head must be the user message: %#v", row)
		}
		if row.ToolCount != 1 {
			t.Fatalf("turn %d tool count = %d, want 1", row.Turn, row.ToolCount)
		}
		if row.Chars == 0 || row.Ms <= 0 {
			t.Fatalf("turn %d aggregate missing: %#v", row.Turn, row)
		}
	}
	if page.Rows[0].Turn != 4 || page.Rows[1].Turn != 5 || page.Rows[2].Turn != 6 {
		t.Fatalf("expected turns 4,5,6 (newest page), got %#v", page.Rows)
	}
	first, err := service.SessionTurns(context.Background(), &AISessionsSessionTurnsRequest{ID: "turns-page", Limit: 3, BeforeTurn: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Rows) != 3 || first.Rows[0].Turn != 1 || first.HasMore {
		t.Fatalf("unexpected first page: %#v", first)
	}
	// 门禁：limit 缺失 / 超限
	for _, limit := range []int{0, 11} {
		_, err := service.SessionTurns(context.Background(), &AISessionsSessionTurnsRequest{ID: "turns-page", Limit: limit})
		if err == nil || !strings.Contains(err.Error(), "session info") {
			t.Fatalf("limit=%d must be rejected with a 'session info' hint, got %v", limit, err)
		}
	}
}

// AC4：turn 原文超 8KB 截断并标记；chars 门禁。
func TestSessionTurnTruncatesAndGates(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "turn-messages", 2, "chunky")
	service := &AISessionsService{}
	full, err := service.SessionTurn(context.Background(), &AISessionsSessionTurnRequest{ID: "turn-messages", Turn: 1, Chars: 8000, Refresh: true})
	if err != nil {
		t.Fatal(err)
	}
	if full.Truncated {
		t.Fatalf("small turn must not be truncated: %#v", full)
	}
	if len(full.Rows) != 3 || full.Rows[0].Role != aisessions.RoleUser {
		t.Fatalf("unexpected turn rows: %#v", full.Rows)
	}
	if full.TotalChars == 0 {
		t.Fatalf("totalChars missing: %#v", full)
	}
	cut, err := service.SessionTurn(context.Background(), &AISessionsSessionTurnRequest{ID: "turn-messages", Turn: 1, Chars: 10})
	if err != nil {
		t.Fatal(err)
	}
	if !cut.Truncated {
		t.Fatalf("expected truncated=true under a 10-char budget: %#v", cut)
	}
	used := 0
	for _, row := range cut.Rows {
		used += len([]rune(row.Text))
	}
	if used > 10 {
		t.Fatalf("chars budget exceeded: %d runes", used)
	}
	for _, chars := range []int{0, 8001} {
		_, err := service.SessionTurn(context.Background(), &AISessionsSessionTurnRequest{ID: "turn-messages", Turn: 1, Chars: chars})
		if err == nil || !strings.Contains(err.Error(), "session info") {
			t.Fatalf("chars=%d must be rejected with a 'session info' hint, got %v", chars, err)
		}
	}
	if _, err := service.SessionTurn(context.Background(), &AISessionsSessionTurnRequest{ID: "turn-messages", Turn: 99, Chars: 2000}); err == nil {
		t.Fatal("out-of-range turn must fail")
	}
}

// AC6：UserOutline 改 SQL 后与旧实现逐字节一致（含 UserMessageCount 与 limit 边界）。
func TestUserOutlineSQLMatchesLegacy(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "outline-equal", 30, "legacy")
	service := &AISessionsService{}
	detail, err := service.Detail(context.Background(), &AISessionsDetailRequest{ID: "outline-equal"})
	if err != nil {
		t.Fatal(err)
	}
	for _, limit := range []int{0, 1, 5, 20, 200, 500} {
		legacyMessages, legacyCount := aisessions.LatestUserOutlineMessages(detail.Messages, limit)
		outline, err := service.UserOutline(context.Background(), &AISessionsUserOutlineRequest{ID: "outline-equal", Limit: limit})
		if err != nil {
			t.Fatalf("limit=%d: %v", limit, err)
		}
		if outline.UserMessageCount != legacyCount {
			t.Fatalf("limit=%d: userMessageCount %d != legacy %d", limit, outline.UserMessageCount, legacyCount)
		}
		if !reflect.DeepEqual(outline.Messages, legacyMessages) {
			t.Fatalf("limit=%d: messages drifted from legacy implementation\n got %#v\nwant %#v", limit, outline.Messages, legacyMessages)
		}
		if outline.Summary.Key != detail.Summary.Key || outline.Summary.MessageCount != detail.Summary.MessageCount {
			t.Fatalf("limit=%d: summary drifted: %#v vs %#v", limit, outline.Summary, detail.Summary)
		}
	}
}

// AC6：索引新鲜时 UserOutline 不得再走全量加载路径（Load / provider）。
func TestUserOutlineSkipsFullLoadWhenIndexIsCurrent(t *testing.T) {
	codexHome := setupSessionReadService(t)
	writeCodexSessionTurns(t, codexHome, "outline-nofull", 5, "nostale")
	service := &AISessionsService{}
	if _, err := service.Detail(context.Background(), &AISessionsDetailRequest{ID: "outline-nofull"}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("WAVETERM_AI_SESSIONS_DEBUG", "1")
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	if _, err := service.UserOutline(context.Background(), &AISessionsUserOutlineRequest{ID: "outline-nofull", Limit: 20}); err != nil {
		t.Fatal(err)
	}
	logs := buf.String()
	if !strings.Contains(logs, "UserOutlineRows sql hit") {
		t.Fatalf("expected the SQL path to serve UserOutline, logs:\n%s", logs)
	}
	if strings.Contains(logs, "Manager.Load start") || strings.Contains(logs, "provider start") {
		t.Fatalf("UserOutline must not trigger a full load on a current index, logs:\n%s", logs)
	}
}

// AC6（新鲜度语义）：索引 stale 时按旧语义回退到 Load，输出仍然正确。
func TestUserOutlineStaleIndexFallsBackToLoad(t *testing.T) {
	codexHome := setupSessionReadService(t)
	path := writeCodexSessionTurns(t, codexHome, "outline-stale", 2, "before")
	service := &AISessionsService{}
	if _, err := service.Detail(context.Background(), &AISessionsDetailRequest{ID: "outline-stale"}); err != nil {
		t.Fatal(err)
	}
	appendLine := `
{"timestamp":"2026-05-14T00:20:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"appended user message"}}
`
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(appendLine); err != nil {
		t.Fatal(err)
	}
	file.Close()

	t.Setenv("WAVETERM_AI_SESSIONS_DEBUG", "1")
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	outline, err := service.UserOutline(context.Background(), &AISessionsUserOutlineRequest{ID: "outline-stale", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if outline.UserMessageCount != 3 {
		t.Fatalf("expected the appended user message to be visible, got %d", outline.UserMessageCount)
	}
	last := outline.Messages[len(outline.Messages)-1]
	if last.Text != "appended user message" {
		t.Fatalf("expected the appended message last, got %#v", last)
	}
	if strings.Contains(buf.String(), "UserOutlineRows sql hit") {
		t.Fatalf("stale index must not be served by the SQL path, logs:\n%s", buf.String())
	}
}

// MCP/CLI 共用同一 service 方法：4 个新方法与 CLI 参数一一对应，返回体不变形。
func TestSessionReadMethodsRequireID(t *testing.T) {
	_, err := (&AISessionsService{}).SessionInfo(context.Background(), &AISessionsSessionInfoRequest{})
	if err == nil || !strings.Contains(err.Error(), "session id is required") {
		t.Fatalf("expected id validation, got %v", err)
	}
	_, err = (&AISessionsService{}).SessionUsers(context.Background(), &AISessionsSessionUsersRequest{})
	if err == nil {
		t.Fatal("expected id validation for users")
	}
	_, err = (&AISessionsService{}).SessionTurns(context.Background(), &AISessionsSessionTurnsRequest{})
	if err == nil {
		t.Fatal("expected id validation for turns")
	}
	_, err = (&AISessionsService{}).SessionTurn(context.Background(), &AISessionsSessionTurnRequest{})
	if err == nil {
		t.Fatal("expected id validation for turn")
	}
}
