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

type slowCountingProvider struct {
	source    string
	summary   SessionSummary
	messages  []Message
	listDelay time.Duration
	listCalls atomic.Int32
	loadCalls atomic.Int32
}

func (p *slowCountingProvider) Source() string { return p.source }

func (p *slowCountingProvider) List(ctx context.Context) ([]SessionSummary, error) {
	p.listCalls.Add(1)
	if p.listDelay > 0 {
		select {
		case <-time.After(p.listDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return []SessionSummary{p.summary}, nil
}

func (p *slowCountingProvider) LoadMessages(ctx context.Context, filePath string) ([]Message, error) {
	p.loadCalls.Add(1)
	return append([]Message(nil), p.messages...), ctx.Err()
}

func TestSummaryMissRespectsShortBudgetWhileSharedScanContinues(t *testing.T) {
	tmpDir := t.TempDir()
	provider := &slowCountingProvider{
		source:    "pi",
		summary:   SessionSummary{Key: "pi:slow:1", ID: "slow-1", Source: "pi", FilePath: filepath.Join(tmpDir, "s.jsonl")},
		listDelay: 2500 * time.Millisecond,
	}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(tmpDir, "index.json"),
		MetaPath:   filepath.Join(tmpDir, "meta.json"),
		SQLitePath: filepath.Join(tmpDir, "index.sqlite"),
	})

	// Start a shared scan flight in the background (simulating List's 60s background scan).
	flightDone := make(chan bool, 1)
	go func() {
		summaries, _, partial := manager.ScanAllSummaries(context.Background(), ScanOptions{Budget: 5 * time.Second})
		flightDone <- (!partial && len(summaries) == 1)
	}()
	time.Sleep(60 * time.Millisecond)

	start := time.Now()
	_, _ = manager.Summary(context.Background(), "missing-session-id", false)
	elapsed := time.Since(start)

	if elapsed > 2100*time.Millisecond {
		t.Fatalf("Summary(false) miss waited %s on shared scan flight (expected bounded wait <= 1.5s)", elapsed)
	}

	// Shared background scan must NOT be aborted by Summary's short budget.
	select {
	case ok := <-flightDone:
		if !ok {
			t.Fatalf("shared background scan did not complete cleanly")
		}
	case <-time.After(4 * time.Second):
		t.Fatalf("timed out waiting for shared background scan to finish")
	}
}

func TestLoadAllContinuationPreservesFreshnessAndZeroExtraLoads(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "transcript.jsonl")
	if err := os.WriteFile(filePath, []byte(strings.Repeat("x", 4096)), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatal(err)
	}
	realMTime, realSize := info.ModTime().UnixMilli(), info.Size()

	messages := make([]Message, 0, 12)
	for i := 0; i < 12; i++ {
		role := RoleUser
		if i%2 == 1 {
			role = RoleAssistant
		}
		text := fmt.Sprintf("msg-%02d ", i) + strings.Repeat("a", 160*1024)
		messages = append(messages, Message{
			Seq: i, Role: role, Text: text, Timestamp: 1700000000000 + int64(i), CharCount: len(text),
		})
	}
	summary := SessionSummary{
		Key: "pi:loadall:" + filePath, ID: "loadall-1", Source: "pi",
		Title: "loadall test", FilePath: filePath, ProjectPath: tmpDir,
		CreatedAt: realMTime, UpdatedAt: realMTime, MTime: realMTime, Size: realSize,
		MessageCount: len(messages),
	}
	provider := &slowCountingProvider{source: "pi", summary: summary, messages: messages}
	manager := NewManagerWithOptions(ManagerOptions{
		Providers:  []Provider{provider},
		IndexPath:  filepath.Join(tmpDir, "index.json"),
		MetaPath:   filepath.Join(tmpDir, "meta.json"),
		SQLitePath: filepath.Join(tmpDir, "index.sqlite"),
	})

	ctx := context.Background()
	detail, err := manager.Load(ctx, summary.Key, LoadOptions{LoadAll: true})
	if err != nil {
		t.Fatalf("initial Load failed: %v", err)
	}
	if !detail.HasMore {
		t.Fatalf("expected multi-frame LoadAll session")
	}

	offset := detail.NextMessageOffset
	for frame := 1; frame <= 10; frame++ {
		// Simulate DetailDelta caller that omits MTime/Size on continuation summary.
		cont := detail.Summary
		cont.MTime = 0
		cont.Size = 0
		delta, err := manager.LoadDelta(ctx, summary.Key, LoadDeltaOptions{
			Summary:       cont,
			LoadAll:       true,
			MessageOffset: offset,
			MaxBytes:      512 * 1024,
			BaseCount:     detail.Summary.MessageCount,
		})
		if err != nil {
			t.Fatalf("LoadDelta frame %d failed: %v", frame, err)
		}
		offset = delta.NextMessageOffset
		if !delta.HasMore {
			break
		}
	}

	if got := provider.loadCalls.Load(); got != 1 {
		t.Fatalf("expected 0 redundant provider.LoadMessages calls after frame 0 (total=1), got %d", got)
	}

	idx, err := OpenSQLiteIndex(manager.SQLitePath, manager.MetaPath)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	var sessMTime, sessSize, fileMTime, fileSize int64
	if err := idx.db.QueryRowContext(ctx, `SELECT s.mtime, s.size, f.mtime, f.size FROM ai_sessions s JOIN ai_files f ON f.file_path = s.file_path WHERE s.key = ?`, summary.Key).
		Scan(&sessMTime, &sessSize, &fileMTime, &fileSize); err != nil {
		t.Fatal(err)
	}
	if sessMTime != realMTime || sessSize != realSize || fileMTime != realMTime || fileSize != realSize {
		t.Fatalf("DB freshness corrupted: session=(%d,%d) file=(%d,%d) want=(%d,%d)", sessMTime, sessSize, fileMTime, fileSize, realMTime, realSize)
	}
}

func TestSaveSummaryDoesNotZeroFreshness(t *testing.T) {
	tmpDir := t.TempDir()
	idx, err := OpenSQLiteIndex(filepath.Join(tmpDir, "index.sqlite"), filepath.Join(tmpDir, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()

	ctx := context.Background()
	realSummary := SessionSummary{
		Key: "pi:fresh:1", ID: "fresh-1", Source: "pi",
		FilePath: filepath.Join(tmpDir, "a.jsonl"),
		MTime:    1700000123456, Size: 8192, MessageCount: 1,
	}
	msgs := []Message{{Seq: 0, Role: RoleUser, Text: "hello", CharCount: 5}}
	if err := idx.SaveMessages(ctx, realSummary, msgs); err != nil {
		t.Fatal(err)
	}

	zeroSummary := realSummary
	zeroSummary.MTime = 0
	zeroSummary.Size = 0
	if err := idx.SaveMessages(ctx, zeroSummary, msgs); err != nil {
		t.Fatal(err)
	}

	var sessMTime, sessSize, fileMTime, fileSize int64
	if err := idx.db.QueryRowContext(ctx, `SELECT s.mtime, s.size, f.mtime, f.size FROM ai_sessions s JOIN ai_files f ON f.file_path = s.file_path WHERE s.key = ?`, realSummary.Key).
		Scan(&sessMTime, &sessSize, &fileMTime, &fileSize); err != nil {
		t.Fatal(err)
	}
	if sessMTime != realSummary.MTime || sessSize != realSummary.Size || fileMTime != realSummary.MTime || fileSize != realSummary.Size {
		t.Fatalf("saveSummaryTx overwrote real freshness with zero: session=(%d,%d) file=(%d,%d)", sessMTime, sessSize, fileMTime, fileSize)
	}
}
