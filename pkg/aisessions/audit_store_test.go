// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aisessions

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func newAuditTestIndex(t *testing.T) *SQLiteIndex {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audit.db")
	idx, err := openSQLiteIndex(path, filepath.Join(t.TempDir(), "meta.db"))
	if err != nil {
		t.Fatalf("open index: %v", err)
	}
	t.Cleanup(func() { _ = idx.db.Close() })
	return idx
}

func seedAuditRow(t *testing.T, idx *SQLiteIndex, in AuditInput, createdAt int64) int64 {
	t.Helper()
	id, err := idx.AuditBegin(context.Background(), in)
	if err != nil {
		t.Fatalf("audit begin: %v", err)
	}
	if _, err := idx.db.Exec(`UPDATE ai_audit_log SET created_at = ? WHERE id = ?`, createdAt, id); err != nil {
		t.Fatalf("backdate audit row: %v", err)
	}
	return id
}

func TestBuildAuditHourBucketsIsFixed24Slots(t *testing.T) {
	now := time.Date(2026, 3, 4, 12, 30, 0, 0, time.UTC).UnixMilli()
	buckets := buildAuditHourBuckets(nil, now)
	if len(buckets) != 24 {
		t.Fatalf("expected 24 buckets, got %d", len(buckets))
	}
	last := buckets[len(buckets)-1]
	if last.Hour != time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC).UnixMilli() {
		t.Fatalf("unexpected last bucket hour: %d", last.Hour)
	}
	rows := []auditBucketRow{
		{createdAt: now, failed: true},
		{createdAt: now, failed: false},
		{createdAt: now - 3*60*60*1000, failed: false},
	}
	buckets = buildAuditHourBuckets(rows, now)
	if buckets[23].Count != 2 || buckets[23].Failed != 1 {
		t.Fatalf("unexpected last bucket: %+v", buckets[23])
	}
	if buckets[20].Count != 1 {
		t.Fatalf("expected count in bucket 20, got %+v", buckets[20])
	}
}

func TestAuditSearchMatchesUpperCaseQuery(t *testing.T) {
	idx := newAuditTestIndex(t)
	seedAuditRow(t, idx, AuditInput{
		Feature:      AuditFeatureTitle,
		SessionKey:   "sess-1",
		SessionTitle: "Refactor Timeline",
	}, time.Now().UnixMilli())

	filter := AuditFilter{Query: "TIMELINE", Limit: 10}
	rows, total, err := idx.listAuditLogs(context.Background(), filter)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 || len(rows) != 1 {
		t.Fatalf("expected 1 match for uppercase query, got total=%d rows=%d", total, len(rows))
	}

	// Session key is part of the search surface too.
	_, keyTotal, err := idx.listAuditLogs(context.Background(), AuditFilter{Query: "SESS-1", Limit: 10})
	if err != nil {
		t.Fatalf("list by key: %v", err)
	}
	if keyTotal != 1 {
		t.Fatalf("expected session key match, got %d", keyTotal)
	}
}

func TestAuditStatsIgnoresUnfinishedDurations(t *testing.T) {
	idx := newAuditTestIndex(t)
	now := time.Now().UnixMilli()

	doneID := seedAuditRow(t, idx, AuditInput{Feature: AuditFeatureTitle, SessionKey: "a"}, now)
	if err := idx.AuditFinish(context.Background(), doneID, AuditResult{State: AuditStateDone, DurationMs: 8000}); err != nil {
		t.Fatalf("finish: %v", err)
	}
	seedAuditRow(t, idx, AuditInput{Feature: AuditFeatureTitle, SessionKey: "b"}, now)

	stats, err := idx.AuditStats(context.Background())
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.Total24h != 2 || stats.Done24h != 1 {
		t.Fatalf("unexpected counts: %+v", stats)
	}
	if stats.AvgDurationMs != 8000 {
		t.Fatalf("queued rows must not drag the average, got %d", stats.AvgDurationMs)
	}
	if len(stats.Hourly) != 24 {
		t.Fatalf("expected 24 hourly buckets, got %d", len(stats.Hourly))
	}
}

func TestAuditStaleSweepReclaimsQueuedRows(t *testing.T) {
	idx := newAuditTestIndex(t)
	auditLastSweep.Store(0)
	t.Cleanup(func() { auditLastSweep.Store(0) })

	old := time.Now().Add(-2 * time.Hour).UnixMilli()
	oldID := seedAuditRow(t, idx, AuditInput{Feature: AuditFeatureTitle, SessionKey: "old"}, old)
	freshID := seedAuditRow(t, idx, AuditInput{Feature: AuditFeatureTitle, SessionKey: "fresh"}, time.Now().UnixMilli())

	swept, err := idx.sweepStaleAuditLogs(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if swept != 1 {
		t.Fatalf("expected 1 swept row, got %d", swept)
	}

	oldRow, err := idx.getAuditLog(context.Background(), oldID)
	if err != nil {
		t.Fatalf("get old: %v", err)
	}
	if oldRow.State != AuditStateFailed || oldRow.Error != auditOrphanError {
		t.Fatalf("expected reclaimed row, got state=%q error=%q", oldRow.State, oldRow.Error)
	}
	freshRow, err := idx.getAuditLog(context.Background(), freshID)
	if err != nil {
		t.Fatalf("get fresh: %v", err)
	}
	if freshRow.State != AuditStateQueued {
		t.Fatalf("fresh row must stay queued, got %q", freshRow.State)
	}
}
