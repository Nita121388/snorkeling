// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestManagerScanFlowWithoutIndexStore(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	t.Setenv("WAVETERM_AI_SESSIONS_DELETED_DIR", filepath.Join(t.TempDir(), "deleted"))

	sessionPath := filepath.Join(dir, "session.jsonl")
	err := os.WriteFile(sessionPath, []byte(
		`{"timestamp":"2026-03-06T21:50:12Z","type":"session_meta","payload":{"id":"test-id","cwd":"/tmp/project"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"message","role":"user","content":"How do I deploy Snorkling?"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":[\"ls\"]}","call_id":"call_1"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:13Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"release.yml"}}`+"\n"+
			`{"timestamp":"2026-03-06T21:50:14Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"Use the release pipeline."}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewCodexProvider(dir)})

	results, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "test-id" {
		t.Fatalf("unexpected list results: %#v", results)
	}
	if results[0].MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in list, got %d (%#v)", results[0].MessageCount, results[0])
	}

	marked, err := manager.Mark(context.Background(), "test-id", true)
	if err != nil {
		t.Fatal(err)
	}
	if !marked.Marked {
		t.Fatalf("expected marked session: %#v", marked)
	}

	note, err := manager.Note(context.Background(), "test-id", "important")
	if err != nil {
		t.Fatal(err)
	}
	if note.Note != "important" {
		t.Fatalf("unexpected note session: %#v", note)
	}

	detail, err := manager.Load(context.Background(), "test-id", LoadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Summary.Note != "important" || !detail.Summary.Marked {
		t.Fatalf("unexpected detail summary: %#v", detail.Summary)
	}
	if detail.Summary.MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in detail summary, got %d", detail.Summary.MessageCount)
	}
	if len(detail.Messages) != 4 {
		t.Fatalf("expected full detail to retain 4 parsed messages, got %d", len(detail.Messages))
	}
	if detail.ToolCalls != nil {
		t.Fatalf("expected default detail load to omit tool calls, got %#v", detail.ToolCalls)
	}

	path, err := manager.Path(context.Background(), "test-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if path != sessionPath {
		t.Fatalf("unexpected path: %q", path)
	}

	markedOnly, err := manager.List(context.Background(), ListOptions{Marked: "starred", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(markedOnly) != 1 || !markedOnly[0].Marked || markedOnly[0].Note != "important" {
		t.Fatalf("unexpected marked-only results: %#v", markedOnly)
	}

	deleted, err := manager.Delete(context.Background(), "test-id")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(sessionPath); !os.IsNotExist(err) {
		t.Fatalf("expected original session to be moved, stat err=%v", err)
	}
	if _, err := os.Stat(deleted.FilePath); err != nil {
		t.Fatalf("expected deleted session file at %q: %v", deleted.FilePath, err)
	}
	afterDelete, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(afterDelete) != 0 {
		t.Fatalf("expected no sessions after delete, got %#v", afterDelete)
	}
	if _, err := manager.Load(context.Background(), "test-id", LoadOptions{}); err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("expected deleted session not to load from sqlite cache, got err=%v", err)
	}
}

func TestManagerReadableMessageCountForClaude(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))

	sessionPath := filepath.Join(dir, "session-claude.jsonl")
	err := os.WriteFile(sessionPath, []byte(
		`{"type":"user","sessionId":"claude-id","timestamp":"2026-03-06T10:00:00Z","cwd":"/tmp/project","message":{"role":"user","content":"Write the file"}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:01Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"a.txt"}}]}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:02Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"File written"}]}}`+"\n"+
			`{"timestamp":"2026-03-06T10:00:03Z","message":{"role":"assistant","content":"Done."}}`+"\n",
	), 0600)
	if err != nil {
		t.Fatal(err)
	}

	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{NewClaudeProvider([]string{dir})})

	results, err := manager.List(context.Background(), ListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != "claude-id" {
		t.Fatalf("unexpected list results: %#v", results)
	}
	if results[0].MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in list, got %d (%#v)", results[0].MessageCount, results[0])
	}

	detail, err := manager.Load(context.Background(), "claude-id", LoadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if detail.Summary.MessageCount != 2 {
		t.Fatalf("expected 2 readable messages in detail summary, got %d", detail.Summary.MessageCount)
	}
	if len(detail.Messages) != 4 {
		t.Fatalf("expected full detail to retain 4 parsed messages, got %d", len(detail.Messages))
	}
	if detail.ToolCalls != nil {
		t.Fatalf("expected default detail load to omit tool calls, got %#v", detail.ToolCalls)
	}

	detailWithTools, err := manager.Load(context.Background(), "claude-id", LoadOptions{IncludeTools: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(detailWithTools.ToolCalls) != 1 || detailWithTools.ToolCalls[0].Name != "Write" {
		t.Fatalf("expected one loaded tool call, got %#v", detailWithTools.ToolCalls)
	}
}

type countingProvider struct {
	source          string
	summaries       []SessionSummary
	loadMessagesHit int
}

func (p *countingProvider) Source() string {
	return p.source
}

func (p *countingProvider) List(ctx context.Context) ([]SessionSummary, error) {
	return p.summaries, ctx.Err()
}

func (p *countingProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	p.loadMessagesHit++
	return nil, fmt.Errorf("LoadMessages should not be called")
}

func TestManagerSummaryDoesNotLoadMessages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	provider := &countingProvider{
		source: SourceCodex,
		summaries: []SessionSummary{
			{
				Key:      "codex:test-id:/tmp/session.jsonl",
				ID:       "test-id",
				Source:   SourceCodex,
				Title:    "Test session",
				FilePath: "/tmp/session.jsonl",
			},
		},
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})
	if _, err := manager.Note(context.Background(), "test-id", "important"); err != nil {
		t.Fatal(err)
	}

	summary, err := manager.Summary(context.Background(), "test-id", false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Note != "important" {
		t.Fatalf("expected note from meta, got %#v", summary)
	}
	if provider.loadMessagesHit != 0 {
		t.Fatalf("Summary loaded messages %d times", provider.loadMessagesHit)
	}
}

type cacheProvider struct {
	source          string
	summaries       []SessionSummary
	listHit         int
	messages        []Message
	loadMessagesHit int
}

type blockingRefreshProvider struct {
	source       string
	summaries    []SessionSummary
	listCalls    int32
	blockStarted chan struct{}
	release      chan struct{}
}

func (p *cacheProvider) Source() string {
	return p.source
}

func (p *cacheProvider) List(ctx context.Context) ([]SessionSummary, error) {
	p.listHit++
	return p.summaries, ctx.Err()
}

func (p *cacheProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	p.loadMessagesHit++
	return append([]Message(nil), p.messages...), ctx.Err()
}

func (p *blockingRefreshProvider) Source() string {
	return p.source
}

func (p *blockingRefreshProvider) List(ctx context.Context) ([]SessionSummary, error) {
	atomic.AddInt32(&p.listCalls, 1)
	select {
	case p.blockStarted <- struct{}{}:
	default:
	}
	select {
	case <-p.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return p.summaries, ctx.Err()
}

func (p *blockingRefreshProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	return nil, fmt.Errorf("LoadMessages should not be called")
}

func TestManagerSummaryRefreshReturnsCachedSummaryAndRefreshesInBackground(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	summary := SessionSummary{
		Key:      "codex:cached-refresh:/tmp/cached-refresh.jsonl",
		ID:       "cached-refresh",
		Source:   SourceCodex,
		Title:    "Cached refresh",
		FilePath: "/tmp/cached-refresh.jsonl",
		MTime:    1,
		Size:     100,
	}
	otherSummary := SessionSummary{
		Key:      "codex:cached-refresh-other:/tmp/cached-refresh-other.jsonl",
		ID:       "cached-refresh-other",
		Source:   SourceCodex,
		Title:    "Cached refresh other",
		FilePath: "/tmp/cached-refresh-other.jsonl",
		MTime:    1,
		Size:     100,
	}
	provider := &blockingRefreshProvider{
		source:       SourceCodex,
		summaries:    []SessionSummary{summary, otherSummary},
		blockStarted: make(chan struct{}, 2),
		release:      make(chan struct{}),
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})
	idx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	if err := idx.SaveSummary(context.Background(), summary); err != nil {
		t.Fatal(err)
	}
	if err := idx.SaveSummary(context.Background(), otherSummary); err != nil {
		t.Fatal(err)
	}
	idx.Close()

	start := time.Now()
	cached, err := manager.Summary(context.Background(), "cached-refresh", true)
	if err != nil {
		t.Fatal(err)
	}
	if cached.ID != "cached-refresh" {
		t.Fatalf("unexpected cached summary: %#v", cached)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("refresh summary waited for background scan: %s", elapsed)
	}

	select {
	case <-provider.blockStarted:
	case <-time.After(time.Second):
		t.Fatal("background refresh did not start")
	}
	if _, err := manager.Summary(context.Background(), "cached-refresh-other", true); err != nil {
		t.Fatal(err)
	}
	if calls := atomic.LoadInt32(&provider.listCalls); calls != 1 {
		t.Fatalf("expected duplicate refresh to reuse in-flight scan, got %d list calls", calls)
	}
	close(provider.release)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		refreshKey := manager.SQLitePath + "\x00" + manager.MetaPath + "\x00" + manager.IndexPath
		if !summaryRefreshes.start(refreshKey) {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		summaryRefreshes.done(refreshKey)
		return
	}
	t.Fatal("background refresh did not finish")
}

func TestManagerUserLinesPagesLatestUserMessages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	summary := SessionSummary{
		Key:      "codex:paged:/tmp/paged.jsonl",
		ID:       "paged",
		Source:   SourceCodex,
		Title:    "Paged session",
		FilePath: "/tmp/paged.jsonl",
		MTime:    1,
		Size:     100,
	}
	var messages []Message
	for idx := 1; idx <= 18; idx++ {
		messages = append(messages, Message{
			Seq:  idx,
			Role: RoleUser,
			Text: fmt.Sprintf("user %02d", idx),
		})
	}
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages:  messages,
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})

	first, err := manager.UserLines(context.Background(), "paged", UserLinesOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if first.UserMessageCount != 18 || len(first.Messages) != 8 || !first.HasMore {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Messages[0].Seq != 11 || first.Messages[7].Seq != 18 || first.NextBeforeSeq != 11 {
		t.Fatalf("unexpected first page messages: %#v", first.Messages)
	}

	second, err := manager.UserLines(context.Background(), "paged", UserLinesOptions{BeforeSeq: first.NextBeforeSeq})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Messages) != 8 || !second.HasMore {
		t.Fatalf("unexpected second page: %#v", second)
	}
	if second.Messages[0].Seq != 3 || second.Messages[7].Seq != 10 || second.NextBeforeSeq != 3 {
		t.Fatalf("unexpected second page messages: %#v", second.Messages)
	}

	third, err := manager.UserLines(context.Background(), "paged", UserLinesOptions{BeforeSeq: second.NextBeforeSeq})
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Messages) != 2 || third.HasMore || third.Messages[0].Seq != 1 || third.Messages[1].Seq != 2 {
		t.Fatalf("unexpected third page: %#v", third)
	}
}

func TestManagerLoadAndUserLinesReuseMessageCache(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	sessionPath := filepath.Join(dir, "cache-test.jsonl")
	if err := os.WriteFile(sessionPath, []byte("session"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	summary := SessionSummary{
		ID:       "cache-test",
		Source:   SourceCodex,
		Title:    "Cache test",
		FilePath: sessionPath,
		MTime:    info.ModTime().UnixMilli(),
		Size:     info.Size(),
	}
	summary.Key = StableKey(summary.Source, summary.ID, summary.FilePath)
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages: []Message{
			{Seq: 1, Role: RoleUser, Text: "first"},
			{Seq: 2, Role: RoleAssistant, Text: "answer"},
			{Seq: 3, Role: RoleUser, Text: "second"},
		},
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})

	if _, err := manager.Load(context.Background(), "cache-test", LoadOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.UserLines(context.Background(), "cache-test", UserLinesOptions{}); err != nil {
		t.Fatal(err)
	}
	if provider.loadMessagesHit != 1 {
		t.Fatalf("expected one source message load, got %d", provider.loadMessagesHit)
	}
	if provider.listHit != 1 {
		t.Fatalf("expected second call to resolve from sqlite without provider list, got %d list calls", provider.listHit)
	}

	if err := os.WriteFile(sessionPath, []byte("session changed"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err = os.Stat(sessionPath)
	if err != nil {
		t.Fatal(err)
	}
	provider.summaries[0].MTime = info.ModTime().UnixMilli()
	provider.summaries[0].Size = info.Size()
	if _, err := manager.UserLines(context.Background(), "cache-test", UserLinesOptions{}); err != nil {
		t.Fatal(err)
	}
	if provider.loadMessagesHit != 2 {
		t.Fatalf("expected cache invalidation after size change, got %d loads", provider.loadMessagesHit)
	}
}

func TestManagerLoadSkipsOversizedMessageIndex(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE", "0")
	originalLimit := maxMessageIndexBytesForLoad
	maxMessageIndexBytesForLoad = 32
	t.Cleanup(func() {
		maxMessageIndexBytesForLoad = originalLimit
	})

	summary := SessionSummary{
		Key:      "codex:oversized-index:/tmp/oversized-index.jsonl",
		ID:       "oversized-index",
		Source:   SourceCodex,
		FilePath: "/tmp/oversized-index.jsonl",
		MTime:    1,
		Size:     100,
	}
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages: []Message{
			{Seq: 1, Role: RoleUser, Text: "fresh"},
		},
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})
	idx, err := OpenIndex(manager.IndexPath)
	if err != nil {
		t.Fatal(err)
	}
	idx.saveMessages(summary, []Message{{Seq: 1, Role: RoleUser, Text: strings.Repeat("cached ", 20)}})
	if err := idx.save(); err != nil {
		t.Fatal(err)
	}
	if err := idx.Close(); err != nil {
		t.Fatal(err)
	}

	detail, err := manager.Load(context.Background(), "oversized-index", LoadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if provider.loadMessagesHit != 1 {
		t.Fatalf("expected provider load after oversized index skip, got %d", provider.loadMessagesHit)
	}
	if len(detail.Messages) != 1 || detail.Messages[0].Text != "fresh" {
		t.Fatalf("expected fresh provider messages, got %#v", detail.Messages)
	}

	info, err := os.Stat(manager.IndexPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() <= maxMessageIndexBytesForLoad {
		t.Fatalf("test index unexpectedly below oversized threshold: %d", info.Size())
	}
}

func TestManagerUserLinesQueryUsesCachedMessages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVETERM_AI_SESSIONS_META", filepath.Join(dir, "meta.json"))
	t.Setenv("WAVETERM_AI_SESSIONS_SQLITE_INDEX", filepath.Join(dir, "index-v2.sqlite"))
	summary := SessionSummary{
		Key:      "codex:query-test:/tmp/query-test.jsonl",
		ID:       "query-test",
		Source:   SourceCodex,
		FilePath: "/tmp/query-test.jsonl",
		MTime:    1,
		Size:     100,
	}
	provider := &cacheProvider{
		source:    SourceCodex,
		summaries: []SessionSummary{summary},
		messages: []Message{
			{Seq: 1, Role: RoleUser, Text: "alpha one"},
			{Seq: 2, Role: RoleUser, Text: "beta two"},
			{Seq: 3, Role: RoleUser, Text: "alpha three"},
		},
	}
	manager := NewManager(filepath.Join(dir, "index.json"), []Provider{provider})

	result, err := manager.UserLines(context.Background(), "query-test", UserLinesOptions{Query: "alpha", Limit: 8})
	if err != nil {
		t.Fatal(err)
	}
	var texts []string
	for _, message := range result.Messages {
		texts = append(texts, message.Text)
	}
	if result.UserMessageCount != 2 || strings.Join(texts, ",") != "alpha one,alpha three" {
		t.Fatalf("unexpected query result: %#v", result)
	}
}
