// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// scanFileProvider is a SummaryFileProvider that records how often it is asked
// to list or parse, so tests can assert that scans are shared and truncated.
type scanFileProvider struct {
	source     string
	files      []SessionFile
	parseDelay time.Duration

	listCalls       int32
	listFilesCalls  int32
	parseCalls      int32
	loadMsgsCalls   int32
	parsedFileOrder []string
	orderMu         sync.Mutex

	messages []Message
}

func (p *scanFileProvider) Source() string { return p.source }

func (p *scanFileProvider) List(ctx context.Context) ([]SessionSummary, error) {
	atomic.AddInt32(&p.listCalls, 1)
	var summaries []SessionSummary
	for _, file := range p.files {
		if summary, ok := p.ParseSummary(ctx, file); ok {
			summaries = append(summaries, summary)
		}
	}
	return summaries, nil
}

func (p *scanFileProvider) ListFiles(ctx context.Context) ([]SessionFile, error) {
	atomic.AddInt32(&p.listFilesCalls, 1)
	return append([]SessionFile(nil), p.files...), nil
}

func (p *scanFileProvider) ParseSummary(ctx context.Context, file SessionFile) (SessionSummary, bool) {
	atomic.AddInt32(&p.parseCalls, 1)
	p.orderMu.Lock()
	p.parsedFileOrder = append(p.parsedFileOrder, file.Path)
	p.orderMu.Unlock()
	if p.parseDelay > 0 {
		time.Sleep(p.parseDelay)
	}
	if ctx.Err() != nil {
		return SessionSummary{}, false
	}
	return SessionSummary{
		Key:       StableKey(p.source, filepath.Base(file.Path), file.Path),
		ID:        filepath.Base(file.Path),
		Source:    p.source,
		FilePath:  file.Path,
		MTime:     file.MTime,
		Size:      file.Size,
		UpdatedAt: file.MTime,
	}, true
}

func (p *scanFileProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	atomic.AddInt32(&p.loadMsgsCalls, 1)
	return p.messages, nil
}

func resetScanState() {
	scanFlights.mu.Lock()
	scanFlights.m = map[string]*scanFlight{}
	scanFlights.mu.Unlock()

	scanProgressState.mu.Lock()
	scanProgressState.m = map[string]ScanProgress{}
	scanProgressState.mu.Unlock()

	summaryRefreshes.lock.Lock()
	summaryRefreshes.inflight = nil
	summaryRefreshes.lock.Unlock()

	backgroundScans.lock.Lock()
	backgroundScans.inflight = nil
	backgroundScans.lock.Unlock()
}

func newScanManager(t *testing.T, provider *scanFileProvider) *Manager {
	t.Helper()
	resetScanState()
	dir := t.TempDir()
	return NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})
}

func makeFiles(n int) []SessionFile {
	files := make([]SessionFile, 0, n)
	for i := 0; i < n; i++ {
		files = append(files, SessionFile{
			Source: "fake",
			Path:   filepath.Join("/sessions", "s"+string(rune('a'+i))+".jsonl"),
			MTime:  int64(1000 + i),
			Size:   10,
		})
	}
	return files
}

func TestScanAllSummariesSingleflight(t *testing.T) {
	provider := &scanFileProvider{source: "fake", files: makeFiles(5), parseDelay: 10 * time.Millisecond}
	manager := newScanManager(t, provider)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			summaries, errs, partial := manager.ScanAllSummaries(context.Background(), ScanOptions{Budget: 5 * time.Second})
			if len(errs) != 0 || partial {
				t.Errorf("unexpected scan result: errs=%v partial=%v", errs, partial)
			}
			if len(summaries) != 5 {
				t.Errorf("expected 5 summaries, got %d", len(summaries))
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&provider.listFilesCalls); got != 1 {
		t.Fatalf("expected exactly one shared scan, listFiles called %d times", got)
	}
	if got := atomic.LoadInt32(&provider.parseCalls); got != 5 {
		t.Fatalf("expected 5 parses (one per file), got %d", got)
	}
	if got := atomic.LoadInt32(&provider.listCalls); got != 0 {
		t.Fatalf("expected the file-level path to be used, provider.List called %d times", got)
	}
}

func TestScanAllSummariesBudgetPartial(t *testing.T) {
	provider := &scanFileProvider{source: "fake", files: makeFiles(20), parseDelay: 10 * time.Millisecond}
	manager := newScanManager(t, provider)

	summaries, errs, partial := manager.ScanAllSummaries(context.Background(), ScanOptions{Budget: 30 * time.Millisecond})
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if !partial {
		t.Fatalf("expected a partial scan when the budget expires")
	}
	if len(summaries) >= 20 {
		t.Fatalf("expected fewer than 20 summaries from a truncated scan, got %d", len(summaries))
	}
	_, total, scanning := scanProgressSnapshot(manager.scanKey())
	if total != 20 {
		t.Fatalf("expected total=20 in progress snapshot, got %d", total)
	}
	if !scanning {
		t.Fatalf("expected a partial scan to still report scanning")
	}
}

func TestCollectScanUnitsNewestFirst(t *testing.T) {
	files := []SessionFile{
		{Path: "/sessions/old.jsonl", MTime: 100, Size: 1},
		{Path: "/sessions/new.jsonl", MTime: 300, Size: 1},
		{Path: "/sessions/mid.jsonl", MTime: 200, Size: 1},
	}
	provider := &scanFileProvider{source: "fake", files: files}
	manager := newScanManager(t, provider)

	units, errs := manager.collectScanUnits(context.Background())
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	got := []string{}
	for _, unit := range units {
		got = append(got, filepath.Base(unit.file.Path))
	}
	want := []string{"new.jsonl", "mid.jsonl", "old.jsonl"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected newest-first order %v, got %v", want, got)
		}
	}
}

func TestManagerSummaryStaleCacheFastPath(t *testing.T) {
	provider := &scanFileProvider{source: "fake", files: makeFiles(3)}
	manager := newScanManager(t, provider)

	// A real file whose mtime will not match the cached row.
	dir := t.TempDir()
	sessionPath := filepath.Join(dir, "live.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cached := SessionSummary{
		Key:          StableKey("fake", "live", sessionPath),
		ID:           "live",
		Source:       "fake",
		Title:        "cached title",
		FilePath:     sessionPath,
		MTime:        1,
		Size:         2,
		MessageCount: 42,
	}
	idx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{cached}, true); len(errs) != 0 {
		t.Fatalf("unexpected save errors: %v", errs)
	}
	_ = idx.Close()

	summary, err := manager.Summary(context.Background(), "live", false)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Title != "cached title" || summary.MessageCount != 42 {
		t.Fatalf("expected the cached row, got %#v", summary)
	}
	if got := atomic.LoadInt32(&provider.listFilesCalls) + atomic.LoadInt32(&provider.listCalls); got != 0 {
		t.Fatalf("stale polling reads must not scan, provider scans=%d", got)
	}
}

func TestManagerDetailRejectsStaleCache(t *testing.T) {
	provider := &scanFileProvider{source: "fake", files: makeFiles(3)}
	manager := newScanManager(t, provider)

	dir := t.TempDir()
	sessionPath := filepath.Join(dir, "detail.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cached := SessionSummary{
		Key:      StableKey("fake", "detail", sessionPath),
		ID:       "detail",
		Source:   "fake",
		FilePath: sessionPath,
		MTime:    1,
		Size:     2,
	}
	idx, err := manager.openSQLiteIndex()
	if err != nil {
		t.Fatal(err)
	}
	if _, errs := idx.SaveScannedSummaries(context.Background(), []SessionSummary{cached}, true); len(errs) != 0 {
		t.Fatalf("unexpected save errors: %v", errs)
	}
	_ = idx.Close()

	// Detail loads need the current file state, so they may rescan, but that
	// rescan must stay single-flighted and budgeted.
	if _, err := manager.Load(context.Background(), "detail", LoadOptions{}); err == nil {
		t.Fatalf("expected the provider scan to miss the synthetic id")
	}
	if got := atomic.LoadInt32(&provider.listFilesCalls); got != 1 {
		t.Fatalf("expected exactly one budgeted scan for a stale detail read, got %d", got)
	}
}

func TestPopulateMessageCountsBudget(t *testing.T) {
	t.Setenv("SNORKELING_AISESSIONS_MSG_BUDGET_BYTES", "10")
	resetScanState()
	provider := &scanFileProvider{
		source:   "fake",
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "0123456789"}},
	}
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})

	summaries := []SessionSummary{
		{Key: "k1", ID: "1", Source: "fake", FilePath: "/sessions/1.jsonl", MessageCount: 0},
		{Key: "k2", ID: "2", Source: "fake", FilePath: "/sessions/2.jsonl", MessageCount: 0},
		{Key: "k3", ID: "3", Source: "fake", FilePath: "/sessions/3.jsonl", MessageCount: 0},
	}
	manager.populateMessageCounts(context.Background(), summaries, true)

	if got := atomic.LoadInt32(&provider.loadMsgsCalls); got != 1 {
		t.Fatalf("expected the parse budget to stop after one session, provider loads=%d", got)
	}
	if summaries[0].MessageCount != 1 {
		t.Fatalf("expected the first session to be counted, got %d", summaries[0].MessageCount)
	}
	if summaries[1].MessageCount != 0 || summaries[2].MessageCount != 0 {
		t.Fatalf("expected budget-skipped sessions to keep their stored counts, got %d and %d", summaries[1].MessageCount, summaries[2].MessageCount)
	}
}

// A stored count is authoritative; a list render must never re-parse a session
// just to print "N msgs" (that is what pushed the List RPC past the service
// timeout and surfaced as net::ERR_EMPTY_RESPONSE).
func TestPopulateMessageCountsTrustsStoredCount(t *testing.T) {
	resetScanState()
	provider := &scanFileProvider{
		source:   "fake",
		messages: []Message{{Seq: 1, Role: RoleUser, Text: "hello"}},
	}
	dir := t.TempDir()
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(dir, "index.json"),
		MetaPath:   filepath.Join(dir, "meta.json"),
		SQLitePath: filepath.Join(dir, "index-v2.sqlite"),
	})

	summaries := []SessionSummary{
		{Key: "k1", ID: "1", Source: "fake", FilePath: "/sessions/1.jsonl", MessageCount: 7},
		{Key: "k2", ID: "2", Source: "fake", FilePath: "/sessions/2.jsonl", MessageCount: 9},
	}
	manager.populateMessageCounts(context.Background(), summaries, false)

	if got := atomic.LoadInt32(&provider.loadMsgsCalls); got != 0 {
		t.Fatalf("expected no message parsing when counts are stored, provider loads=%d", got)
	}
	if summaries[0].MessageCount != 7 || summaries[1].MessageCount != 9 {
		t.Fatalf("expected stored counts to be preserved, got %d and %d", summaries[0].MessageCount, summaries[1].MessageCount)
	}
}

func TestPiSummaryGateSkipsTitleScanForOversizedFiles(t *testing.T) {
	t.Setenv("SNORKELING_AISESSIONS_SCAN_MAX_FILE_BYTES", "64")
	dir := t.TempDir()
	path := filepath.Join(dir, "big.jsonl")
	line := `{"id":"big-id","type":"session","timestamp":"2026-05-01T00:00:00Z","cwd":"/tmp/big-project"}` + "\n"
	// Pad past the gate so the title scan is skipped.
	pad := `{"id":"pad","type":"message","timestamp":"2026-05-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"PADPADDING"}]}}` + "\n"
	for i := 0; i < 3; i++ {
		line += pad
	}
	if err := os.WriteFile(path, []byte(line), 0600); err != nil {
		t.Fatal(err)
	}

	provider := NewPiProvider(dir)
	summaries, err := provider.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected one summary, got %d", len(summaries))
	}
	if summaries[0].Title != "" {
		t.Fatalf("expected no title for an oversized transcript, got %q", summaries[0].Title)
	}
	if summaries[0].ProjectPath != "/tmp/big-project" {
		t.Fatalf("expected project path from the header, got %q", summaries[0].ProjectPath)
	}
}
