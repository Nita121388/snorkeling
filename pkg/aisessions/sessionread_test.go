// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// setupReadSession indexes one synthetic session through a cacheProvider and
// returns a manager whose message cache is current (ai_files fresh).
func setupReadSession(t *testing.T, messages []Message) (*Manager, *cacheProvider, SessionSummary) {
	t.Helper()
	dir := t.TempDir()
	sessionPath := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return setupReadSessionAt(t, dir, sessionPath, messages)
}

func setupReadSessionAt(t *testing.T, dir string, sessionPath string, messages []Message) (*Manager, *cacheProvider, SessionSummary) {
	t.Helper()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	stat, err := os.Stat(sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{
		Key:      "codex:read-test:" + sessionPath,
		ID:       "read-test",
		Source:   SourceCodex,
		FilePath: sessionPath,
		MTime:    stat.ModTime().UnixMilli(),
		Size:     stat.Size(),
	}
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages:  messages,
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
	// Load once so the SQLite message cache is populated and marked current.
	if _, err := manager.Load(context.Background(), "read-test", LoadOptions{}); err != nil {
		t.Fatal(err)
	}
	return manager, provider, summary
}

func readMessage(role string, seq int, text string, ts int64, chars int) Message {
	return Message{Seq: seq, Role: role, Text: text, Timestamp: ts, CharCount: chars}
}

// AC1（分档）：small/medium/large 三种规模的会话 info 判档正确，stale=false。
func TestReadInfoVerdicts(t *testing.T) {
	makeMessages := func(count int) []Message {
		var messages []Message
		for i := 0; i < count; i++ {
			role := RoleUser
			if i%2 == 1 {
				role = RoleAssistant
			}
			messages = append(messages, readMessage(role, i+1, fmt.Sprintf("m-%d", i+1), int64(1000+i), 6))
		}
		return messages
	}
	for _, tc := range []struct {
		name        string
		messageCt   int
		bytes       int64
		wantVerdict string
	}{
		{"small", 40, 4096, SessionVerdictSmall},
		{"medium-消息超标", 200, 4096, SessionVerdictMedium},
		{"large-消息超标", 1300, 4096, SessionVerdictLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := VerdictOf(tc.messageCt, tc.bytes); got != tc.wantVerdict {
				t.Fatalf("VerdictOf(%d,%d) = %q, want %q", tc.messageCt, tc.bytes, got, tc.wantVerdict)
			}
		})
	}
	// large 靠文件大小判定
	if got := VerdictOf(100, 21*1024*1024); got != SessionVerdictLarge {
		t.Fatalf("expected large by bytes, got %q", got)
	}
	manager, _, summary := setupReadSession(t, makeMessages(40))
	info, err := manager.ReadInfo(context.Background(), "read-test", true)
	if err != nil {
		t.Fatal(err)
	}
	if info.Verdict != SessionVerdictSmall || info.Stale {
		t.Fatalf("unexpected info: %#v", info)
	}
	if info.MessageCount != 40 || info.UserMessageCount != 20 {
		t.Fatalf("counts drifted: %#v", info)
	}
	if info.SessionKey != summary.Key || info.Bytes != summary.Size {
		t.Fatalf("identity drifted: %#v vs %#v", info, summary)
	}
}

// AC2（users 翻页）：20 条一页翻到底不重不漏；空文本 user 被跳过；120 字截断有标记。
func TestReadUsersPagination(t *testing.T) {
	var messages []Message
	messages = append(messages, readMessage(RoleAssistant, 1, "preface", 100, 7))
	seq := 2
	var wantSeqs []int
	for i := 0; i < 25; i++ {
		messages = append(messages, readMessage(RoleUser, seq, fmt.Sprintf("user-%02d", i), int64(200+i), 8))
		wantSeqs = append(wantSeqs, seq)
		seq++
		if i%5 == 0 {
			// 空白文本 user 消息必须被跳过（与旧 UserOutline 口径一致）
			messages = append(messages, readMessage(RoleUser, seq, "   ", int64(300), 3))
			seq++
		}
		messages = append(messages, readMessage(RoleAssistant, seq, "reply", int64(400), 5))
		seq++
	}
	// 一条超长 user 消息验证截断标记
	longText := strings.Repeat("长", 200)
	messages = append(messages, readMessage(RoleUser, seq, longText, 900, 200))
	wantSeqs = append(wantSeqs, seq)
	seq++
	manager, _, _ := setupReadSession(t, messages)

	var gotSeqs []int
	beforeSeq := 0
	pages := 0
	var pageRows [][]SessionUserRow
	for {
		page, err := manager.ReadUsers(context.Background(), "read-test", beforeSeq, 20, false)
		if err != nil {
			t.Fatal(err)
		}
		if page.Stale {
			t.Fatal("expected a current index, got stale")
		}
		pageRows = append(pageRows, page.Rows)
		pages++
		if len(page.Rows) > 20 {
			t.Fatalf("page over limit: %d rows", len(page.Rows))
		}
		if !page.HasMore {
			if len(page.Rows) != 6 {
				t.Fatalf("last page should hold 6 rows, got %d", len(page.Rows))
			}
			break
		}
		if page.NextBeforeSeq == 0 {
			t.Fatal("hasMore without a cursor")
		}
		beforeSeq = page.NextBeforeSeq
	}
	if pages != 2 {
		t.Fatalf("expected 2 pages, got %d", pages)
	}
	// 页从新到旧，页内从旧到新：整体拼起来必须不重不漏。
	for i := len(pageRows) - 1; i >= 0; i-- {
		for _, row := range pageRows[i] {
			gotSeqs = append(gotSeqs, row.Seq)
		}
	}
	if fmt.Sprint(gotSeqs) != fmt.Sprint(wantSeqs) {
		t.Fatalf("paging drifted:\n got %v\nwant %v", gotSeqs, wantSeqs)
	}
	// 最后一页包含超长消息，验证截断标记
	last, err := manager.ReadUsers(context.Background(), "read-test", 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	var longRow *SessionUserRow
	for i := range last.Rows {
		if last.Rows[i].Seq == seq-1 {
			longRow = &last.Rows[i]
		}
	}
	if longRow == nil {
		t.Fatal("long user row missing from page")
	}
	if !longRow.Truncated || runeCount(longRow.Text) != 120 {
		t.Fatalf("expected 120-rune truncation flag, got truncated=%v runes=%d", longRow.Truncated, runeCount(longRow.Text))
	}
}

// AC2（尾部截断的 SQL/Go 一致性）：120 rune 以内不标记，超出即标记。
func TestReadUsersTruncationBoundary(t *testing.T) {
	manager, _, _ := setupReadSession(t, []Message{
		readMessage(RoleUser, 1, strings.Repeat("a", 120), 1, 120),
		readMessage(RoleUser, 2, strings.Repeat("b", 121), 2, 121),
	})
	page, err := manager.ReadUsers(context.Background(), "read-test", 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %#v", page.Rows)
	}
	if page.Rows[0].Truncated || runeCount(page.Rows[0].Text) != 120 {
		t.Fatalf("120-rune text must not be truncated: %#v", page.Rows[0])
	}
	if !page.Rows[1].Truncated || runeCount(page.Rows[1].Text) != 120 {
		t.Fatalf("121-rune text must be truncated to 120: %#v", page.Rows[1])
	}
}

// AC3（轮边界）：SQL 轮起点与 ComputeTurns 纯函数一致（引导段不占轮号）。
func TestSQLTurnStartsMatchComputeTurns(t *testing.T) {
	var messages []Message
	messages = append(messages,
		readMessage(RoleAssistant, 1, "preface-1", 100, 9),
		readMessage(RoleTool, 2, "preface-2", 110, 9),
		readMessage(RoleUser, 3, "q1", 200, 2),
		readMessage(RoleUser, 4, "q1-followup", 210, 11),
		readMessage(RoleTool, 5, "t1", 300, 2),
		readMessage(RoleAssistant, 6, "a1", 400, 2),
		readMessage(RoleUser, 7, "q2", 500, 2),
		readMessage(RoleAssistant, 8, "a2", 600, 2),
		readMessage(RoleUser, 9, "q3", 700, 2),
		readMessage(RoleUser, 10, "q3-followup", 710, 12),
	)
	manager, _, _ := setupReadSession(t, messages)
	sqliteIdx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	defer sqliteIdx.Close()

	// resolve summary key properly
	scope, err := manager.resolveReadScope(context.Background(), "read-test", false)
	if err != nil {
		t.Fatal(err)
	}
	starts, err := sqliteIdx.TurnStarts(context.Background(), scope.summary.Key)
	if err != nil {
		t.Fatal(err)
	}
	var pureStarts []int
	for i := range messages {
		if isTurnStart(messages, i) {
			pureStarts = append(pureStarts, messages[i].Seq)
		}
	}
	if fmt.Sprint(starts) != fmt.Sprint(pureStarts) {
		t.Fatalf("SQL turn starts %v != ComputeTurns starts %v", starts, pureStarts)
	}
	if fmt.Sprint(starts) != "[3 7 9]" {
		t.Fatalf("unexpected turn starts: %v", starts)
	}
}

// AC3（turns 页字段）：turn/seq/toolCount/chars/ms 与 ComputeTurns 逐项一致。
func TestReadTurnsCrossMatchesComputeTurns(t *testing.T) {
	var messages []Message
	messages = append(messages,
		readMessage(RoleAssistant, 1, "preface", 100, 7),
		readMessage(RoleUser, 2, "question one", 200, 12),
		readMessage(RoleUser, 3, "补充文件", 210, 5),
		readMessage(RoleTool, 4, "tool-a", 300, 7),
		readMessage(RoleTool, 5, "tool-b", 320, 7),
		readMessage(RoleAssistant, 6, "answer one", 400, 10),
		readMessage(RoleUser, 7, "question two", 500, 12),
		readMessage(RoleAssistant, 8, "answer two", 700, 10),
		readMessage(RoleTool, 9, "tool-c", 800, 7),
	)
	manager, _, _ := setupReadSession(t, messages)
	page, err := manager.ReadTurns(context.Background(), "read-test", 0, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	if page.Stale {
		t.Fatal("expected fresh index")
	}
	if len(page.Rows) != 2 {
		t.Fatalf("expected 2 turns (preface excluded), got %#v", page.Rows)
	}
	turns := ComputeTurns(messages)
	var numbered []Turn
	for _, turn := range turns {
		if !turn.Preface {
			numbered = append(numbered, turn)
		}
	}
	if len(numbered) != 2 {
		t.Fatalf("pure function disagrees: %#v", turns)
	}
	for idx, row := range page.Rows {
		want := numbered[idx]
		if row.Turn != idx+1 || row.Seq != want.Rows[0].Seq {
			t.Fatalf("turn %d identity drifted: %#v", idx+1, row)
		}
		wantTools, wantChars := 0, 0
		for _, m := range want.Rows {
			if m.Role == RoleTool {
				wantTools++
			}
			wantChars += m.CharCount
		}
		wantMs := want.Rows[len(want.Rows)-1].Timestamp - want.Rows[0].Timestamp
		if row.ToolCount != wantTools || row.Chars != wantChars || row.Ms != wantMs {
			t.Fatalf("turn %d aggregate drifted: got %#v want tools=%d chars=%d ms=%d", idx+1, row, wantTools, wantChars, wantMs)
		}
		if row.Text != want.Rows[0].Text {
			t.Fatalf("turn %d head text drifted: %q vs %q", idx+1, row.Text, want.Rows[0].Text)
		}
	}
	if page.HasMore || page.NextBeforeTurn != 1 {
		t.Fatalf("single page must cover all turns: %#v", page)
	}
}

// AC5（门禁，改写口径）：turns 不传 limit / limit>10 报明确错误。
func TestReadTurnsLimitGate(t *testing.T) {
	manager, _, _ := setupReadSession(t, []Message{readMessage(RoleUser, 1, "hi", 1, 2)})
	for _, limit := range []int{0, -1, 11, 100} {
		_, err := manager.ReadTurns(context.Background(), "read-test", 0, limit, false)
		if err == nil {
			t.Fatalf("limit=%d must be rejected", limit)
		}
		if !strings.Contains(err.Error(), "session info") {
			t.Fatalf("error must point at 'session info', got: %v", err)
		}
	}
	if _, err := manager.ReadTurns(context.Background(), "read-test", 0, 1, false); err != nil {
		t.Fatalf("limit=1 must pass: %v", err)
	}
	if _, err := manager.ReadTurns(context.Background(), "read-test", 0, 10, false); err != nil {
		t.Fatalf("limit=10 must pass: %v", err)
	}
}

// turns 翻页：beforeTurn 游标连续翻到底，不重不漏。
func TestReadTurnsPaging(t *testing.T) {
	var messages []Message
	seq := 1
	for turn := 0; turn < 7; turn++ {
		messages = append(messages, readMessage(RoleUser, seq, fmt.Sprintf("q%d", turn), int64(100*seq), 3))
		seq++
		messages = append(messages, readMessage(RoleAssistant, seq, fmt.Sprintf("a%d", turn), int64(100*seq), 3))
		seq++
	}
	manager, _, _ := setupReadSession(t, messages)
	var pageTurns [][]int
	beforeTurn := 0
	pages := 0
	for {
		page, err := manager.ReadTurns(context.Background(), "read-test", beforeTurn, 3, false)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		var pageSeen []int
		for _, row := range page.Rows {
			pageSeen = append(pageSeen, row.Turn)
		}
		pageTurns = append(pageTurns, pageSeen)
		if !page.HasMore {
			if len(page.Rows) != 1 {
				t.Fatalf("last page should hold 1 turn, got %d", len(page.Rows))
			}
			break
		}
		if page.NextBeforeTurn <= 0 {
			t.Fatal("hasMore without cursor")
		}
		beforeTurn = page.NextBeforeTurn
	}
	if pages != 3 {
		t.Fatalf("expected 3 pages, got %d", pages)
	}
	var seen []int
	for i := len(pageTurns) - 1; i >= 0; i-- {
		seen = append(seen, pageTurns[i]...)
	}
	if fmt.Sprint(seen) != "[1 2 3 4 5 6 7]" {
		t.Fatalf("unexpected paging: seen=%v", seen)
	}
}

// AC4（8KB 截断）：turn 原文超预算时截断并标记。
func TestReadTurnTruncatesOverBudget(t *testing.T) {
	turnMsgs := []Message{
		readMessage(RoleUser, 1, strings.Repeat("甲", 600), 100, 600),
		readMessage(RoleAssistant, 2, strings.Repeat("乙", 600), 200, 600),
		readMessage(RoleAssistant, 3, strings.Repeat("丙", 600), 300, 600),
	}
	manager, _, _ := setupReadSession(t, turnMsgs)
	result, err := manager.ReadTurn(context.Background(), "read-test", 1, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Truncated {
		t.Fatal("expected truncated=true")
	}
	if result.TotalChars != 1800 {
		t.Fatalf("totalChars = %d, want 1800", result.TotalChars)
	}
	totalRunes := 0
	for _, row := range result.Rows {
		totalRunes += runeCount(row.Text)
	}
	if totalRunes > 1000 {
		t.Fatalf("budget exceeded: %d runes", totalRunes)
	}
	if len(result.Rows) == 0 {
		t.Fatal("expected at least one row")
	}
	if !result.Rows[len(result.Rows)-1].Truncated {
		t.Fatalf("expected the last included row to be cut: %#v", result.Rows[len(result.Rows)-1])
	}
	// 完整预算下不截断
	full, err := manager.ReadTurn(context.Background(), "read-test", 1, 8000, false)
	if err != nil {
		t.Fatal(err)
	}
	if full.Truncated || len(full.Rows) != 3 || full.TotalChars != 1800 {
		t.Fatalf("unexpected full turn: %#v", full)
	}
}

// AC5（门禁，turn 侧）：chars 不传/越界报错；turn 越界报 E_NOT_FOUND。
func TestReadTurnGates(t *testing.T) {
	manager, _, _ := setupReadSession(t, []Message{
		readMessage(RoleUser, 1, "q", 100, 1),
		readMessage(RoleAssistant, 2, "a", 200, 1),
	})
	for _, chars := range []int{0, -5, 8001} {
		_, err := manager.ReadTurn(context.Background(), "read-test", 1, chars, false)
		if err == nil || !strings.Contains(err.Error(), "session info") {
			t.Fatalf("chars=%d must be rejected with a 'session info' hint, got: %v", chars, err)
		}
	}
	if _, err := manager.ReadTurn(context.Background(), "read-test", 0, 2000, false); err == nil {
		t.Fatal("turn 0 must be rejected")
	}
	_, err := manager.ReadTurn(context.Background(), "read-test", 5, 2000, false)
	if err == nil || !strings.Contains(err.Error(), "E_NOT_FOUND") {
		t.Fatalf("out-of-range turn must report E_NOT_FOUND, got %v", err)
	}
}

// stale 语义：文件在索引之后变化时，users/turns/turn 如实报 stale，不静默。
func TestReadLayersReportStale(t *testing.T) {
	dir := t.TempDir()
	sessionPath := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	messages := []Message{
		readMessage(RoleUser, 1, "q1", 100, 2),
		readMessage(RoleAssistant, 2, "a1", 200, 2),
	}
	manager, provider, _ := setupReadSessionAt(t, dir, sessionPath, messages)
	if err := os.WriteFile(sessionPath, []byte("{}\nmore\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	stat, err := os.Stat(sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	// provider 报新的 mtime/size（模拟扫描已追上文件），但消息索引仍是旧的。
	provider.summaries[0].MTime = stat.ModTime().UnixMilli()
	provider.summaries[0].Size = stat.Size()
	info, err := manager.ReadInfo(context.Background(), "read-test", false)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Stale {
		t.Fatalf("expected stale=true after file change, got %#v", info)
	}
	users, err := manager.ReadUsers(context.Background(), "read-test", 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if !users.Stale || len(users.Rows) != 0 {
		t.Fatalf("stale users page must be empty and flagged, got %#v", users)
	}
	turns, err := manager.ReadTurns(context.Background(), "read-test", 0, 5, false)
	if err != nil {
		t.Fatal(err)
	}
	if !turns.Stale || len(turns.Rows) != 0 {
		t.Fatalf("stale turns page must be empty and flagged, got %#v", turns)
	}
}

// 性能红线：turns 单页只走「轮首 seq 定位 + 窗口聚合」，不得把整会话消息读进内存。
// 用 20000 条消息（约 4MB 正文）的会话量测单页分配的 Go 内存。
func TestReadTurnsTailWindowIsBounded(t *testing.T) {
	dir := t.TempDir()
	sessionPath := filepath.Join(dir, "big.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	const turnCount = 10000
	body := strings.Repeat("x", 200)
	var messages []Message
	seq := 1
	for turn := 1; turn <= turnCount; turn++ {
		messages = append(messages, Message{Seq: seq, Role: RoleUser, Text: fmt.Sprintf("q%d-%s", turn, body), Timestamp: int64(turn * 1000), CharCount: 205})
		seq++
		messages = append(messages, Message{Seq: seq, Role: RoleAssistant, Text: body, Timestamp: int64(turn*1000 + 500), CharCount: 200})
		seq++
	}
	manager, _, _ := setupReadSessionAt(t, dir, sessionPath, messages)

	// 直接写入 sqlite（跳过 provider 全量解析），确保索引新鲜。
	sqliteIdx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := manager.resolveReadScope(context.Background(), "read-test", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.loadMessages(context.Background(), scope.summary, true); err != nil {
		sqliteIdx.Close()
		t.Fatal(err)
	}
	sqliteIdx.Close()

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	page, err := manager.ReadTurns(context.Background(), "read-test", 0, 5, false)
	if err != nil {
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc

	if len(page.Rows) != 5 || page.Rows[4].Turn != turnCount {
		t.Fatalf("expected the newest 5 turns, got %#v", page.Rows)
	}
	if !page.HasMore || page.NextBeforeTurn != turnCount-4 {
		t.Fatalf("unexpected cursor: %#v", page)
	}
	if page.Rows[0].Chars != 405 || page.Rows[0].ToolCount != 0 {
		t.Fatalf("unexpected aggregates: %#v", page.Rows[0])
	}
	// 会话正文约 4MB：整段 LoadMessages 至少分配正文大小。单页只允许远低于
	// 正文一半的分配（实测 ~1.2MB，其中大头是与会话规模无关的 sqlite 调用开销；
	// 随轮数增长的部分只是轮首 seq 列表，~40B/轮）。
	corpusBytes := 0
	for _, message := range messages {
		corpusBytes += len(message.Text)
	}
	allocBudget := uint64(corpusBytes / 2)
	if allocated > allocBudget {
		t.Fatalf("turns page allocated %d bytes (> %d, corpus %d) — tail window is not bounded", allocated, allocBudget, corpusBytes)
	}
	// 与大会话规模脱钩的硬上限：实测约 176KB（几乎全是 sqlite 调用开销）。
	if allocated > 512*1024 {
		t.Fatalf("turns page allocated %d bytes, expected < 512KB regardless of session size", allocated)
	}
	t.Logf("turns page over %d messages (%d turns): sql rows<=6, rows=%d allocated=%d bytes (corpus=%d)",
		len(messages), turnCount, len(page.Rows), allocated, corpusBytes)
}

// AC2/AC6（SQL/Go 过滤口径一致）：空白 user 消息的判定必须与旧实现的
// strings.TrimSpace 完全同集，含 Unicode 空白（U+3000 全角空格、U+2028 行分隔、
// U+00A0 NBSP 等），否则 SQL 路径与 stale 回退路径会给出不同的页与计数。
func TestUserRowsSQLFilterMatchesTrimSpace(t *testing.T) {
	blankTexts := []string{"", " ", "\t", "\u3000", "\u2028", "\u00a0", "\u2003"}
	var messages []Message
	seq := 1
	wantUserCount := 0
	for _, blank := range blankTexts {
		messages = append(messages, readMessage(RoleUser, seq, blank, int64(seq*100), len(blank)))
		seq++
	}
	for i := 0; i < 3; i++ {
		messages = append(messages, readMessage(RoleUser, seq, fmt.Sprintf("real-%d", i), int64(seq*100), 6))
		wantUserCount++
		seq++
		messages = append(messages, readMessage(RoleAssistant, seq, "answer", int64(seq*100), 6))
		seq++
	}
	manager, _, _ := setupReadSession(t, messages)
	page, err := manager.ReadUsers(context.Background(), "read-test", 0, 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != wantUserCount {
		t.Fatalf("SQL path returned %d rows, want %d non-blank: %#v", len(page.Rows), wantUserCount, page.Rows)
	}
	info, err := manager.ReadInfo(context.Background(), "read-test", false)
	if err != nil {
		t.Fatal(err)
	}
	_, legacyCount := LatestUserOutlineMessages(messages, 0)
	if info.UserMessageCount != legacyCount {
		t.Fatalf("UserMessageCount via SQL = %d, legacy TrimSpace count = %d", info.UserMessageCount, legacyCount)
	}
}

// 步骤 1 判据：新索引随建表块一起创建（只加索引，不改表结构）。
func TestSessionMessagesUserIndexExists(t *testing.T) {
	dir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(dir, "idx.sqlite"), filepath.Join(dir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	var names []string
	if err := idx.db.SelectContext(context.Background(), &names, `SELECT name FROM pragma_index_list('ai_session_messages')`); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, name := range names {
		found[name] = true
	}
	for _, want := range []string{"idx_ai_session_messages_session", "idx_ai_session_messages_user"} {
		if !found[want] {
			t.Fatalf("index %q missing, have %v", want, names)
		}
	}
	// 索引列顺序必须是 (session_key, role, seq)：角色过滤在前、游标在后。
	var columns []struct {
		SeqNo int    `db:"seqno"`
		Name  string `db:"name"`
	}
	if err := idx.db.SelectContext(context.Background(), &columns, `SELECT seqno, name FROM pragma_index_info('idx_ai_session_messages_user') ORDER BY seqno`); err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, column := range columns {
		got = append(got, column.Name)
	}
	if fmt.Sprint(got) != "[session_key role seq]" {
		t.Fatalf("index columns = %v, want [session_key role seq]", got)
	}
}
