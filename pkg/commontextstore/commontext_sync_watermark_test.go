// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package commontextstore

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/syncproto"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// Watermark lifecycle: a saved item is pending until a sync confirms it, becomes pending again
// the moment it is edited. This is the single judgement the whole feature rests on, so it is
// pinned here rather than inferred from the UI.
func TestSyncWatermarkLifecycle(t *testing.T) {
	resetCommonTextTestState(t, nil)
	ctx := context.Background()

	if err := SaveAll(ctx, []commonTextItem{{Id: "ct-a", Title: "A", Text: "body", CreatedAt: 1000, UpdatedAt: 2000}}); err != nil {
		t.Fatalf("save: %v", err)
	}
	items, err := List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].SyncState != SyncStatePending {
		t.Fatalf("never-synced item must be pending, got %q", items[0].SyncState)
	}

	if err := MarkSynced(ctx, []syncproto.PushItemResult{{Id: "ct-a", Rev: 7, Status: syncproto.PushStatusApplied}}); err != nil {
		t.Fatalf("mark synced: %v", err)
	}
	items, err = List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("list after mark: %v", err)
	}
	if items[0].SyncState != SyncStateSynced {
		t.Fatalf("confirmed item must read synced, got %q", items[0].SyncState)
	}
	if items[0].SyncedRev != 7 {
		t.Fatalf("expected syncedrev 7, got %v", items[0].SyncedRev)
	}
	pending, err := PendingItems(ctx)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("a confirmed item must not be pending, got %d", len(pending))
	}

	// A local edit moves updatedat forward without touching rev — exactly the case the old
	// rev-only model could not detect.
	if err := SaveAll(ctx, []commonTextItem{{Id: "ct-a", Title: "A", Text: "body edited", CreatedAt: 1000, UpdatedAt: 3000}}); err != nil {
		t.Fatalf("save edit: %v", err)
	}
	pending, err = PendingItems(ctx)
	if err != nil {
		t.Fatalf("pending after edit: %v", err)
	}
	if len(pending) != 1 || pending[0].Id != "ct-a" {
		t.Fatalf("edited item must be pending again, got %+v", pending)
	}
}

// The reason watermarks live in their own table: commontext:items is written by a full-table
// overwrite from the renderer, whose copy predates the sync. If the watermark shared that row it
// would be reset to the stale value on every UI save.
func TestSyncWatermarkSurvivesFullTableSave(t *testing.T) {
	resetCommonTextTestState(t, nil)
	ctx := context.Background()

	items := []commonTextItem{{Id: "ct-b", Title: "B", Text: "body b", CreatedAt: 1000, UpdatedAt: 2000}}
	if err := SaveAll(ctx, items); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := MarkSynced(ctx, []syncproto.PushItemResult{{Id: "ct-b", Rev: 11, Status: syncproto.PushStatusApplied}}); err != nil {
		t.Fatalf("mark synced: %v", err)
	}

	// Simulate the renderer saving the whole array back (pin toggle / rename / usage bump).
	stale := []commonTextItem{{
		Id: "ct-b", Title: "B renamed", Text: "body b", Pinned: true,
		CreatedAt: 1000, UpdatedAt: 2000,
	}}
	if err := SaveAll(ctx, stale); err != nil {
		t.Fatalf("save stale copy: %v", err)
	}

	got, err := List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if got[0].SyncState != SyncStateSynced {
		t.Fatalf("full-table save must not wipe the watermark, got %q", got[0].SyncState)
	}
	if got[0].SyncedRev != 11 {
		t.Fatalf("expected watermark rev 11 to survive, got %v", got[0].SyncedRev)
	}
}

// A tombstone is a delete waiting to be uploaded: it must be visible to the sync path (still
// pending until confirmed) and invisible to the UI list.
func TestSyncWatermarkTombstoneIsPendingAndHidden(t *testing.T) {
	resetCommonTextTestState(t, nil)
	ctx := context.Background()

	if err := SaveAll(ctx, []commonTextItem{{
		Id: "ct-gone", Title: "Gone", Text: "body", CreatedAt: 1000, UpdatedAt: 4000, DeletedAt: 4000,
	}}); err != nil {
		t.Fatalf("save tombstone: %v", err)
	}

	visible, err := List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(visible) != 0 {
		t.Fatalf("tombstone must stay out of the default list, got %d", len(visible))
	}

	all, err := List(ctx, ListOptions{IncludeDeleted: true})
	if err != nil {
		t.Fatalf("list with deleted: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("expected the tombstone back, got %d", len(all))
	}
	if all[0].SyncState != SyncStatePending {
		t.Fatalf("unconfirmed tombstone must be pending, got %q", all[0].SyncState)
	}

	pending, err := PendingItems(ctx)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(pending) != 1 || pending[0].Id != "ct-gone" {
		t.Fatalf("tombstone must be pushed, got %+v", pending)
	}
}

// Remote state bookkeeping: MaxSyncedRev drives the "remote was reset" self-heal, and
// ResetSyncWatermarks must put every item back into the pending set.
func TestSyncWatermarkMaxRevAndReset(t *testing.T) {
	resetCommonTextTestState(t, nil)
	ctx := context.Background()

	if err := SaveAll(ctx, []commonTextItem{
		{Id: "ct-1", Title: "1", Text: "one", CreatedAt: 1000, UpdatedAt: 2000},
		{Id: "ct-2", Title: "2", Text: "two", CreatedAt: 1000, UpdatedAt: 2000},
	}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := MarkSynced(ctx, []syncproto.PushItemResult{
		{Id: "ct-1", Rev: 3, Status: syncproto.PushStatusApplied},
		{Id: "ct-2", Rev: 9, Status: syncproto.PushStatusUnchanged},
	}); err != nil {
		t.Fatalf("mark synced: %v", err)
	}
	maxRev, err := MaxSyncedRev(ctx)
	if err != nil {
		t.Fatalf("max synced rev: %v", err)
	}
	if maxRev != 9 {
		t.Fatalf("expected max synced rev 9, got %v", maxRev)
	}

	if err := ResetSyncWatermarks(ctx); err != nil {
		t.Fatalf("reset: %v", err)
	}
	pending, err := PendingItems(ctx)
	if err != nil {
		t.Fatalf("pending after reset: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("reset must make every item pending, got %d", len(pending))
	}
}

// Conflict results must NOT be recorded as synced: the remote kept a different version, so
// claiming "synced" would hide an unresolved divergence.
func TestSyncWatermarkIgnoresConflicts(t *testing.T) {
	resetCommonTextTestState(t, nil)
	ctx := context.Background()

	if err := SaveAll(ctx, []commonTextItem{{Id: "ct-c", Title: "C", Text: "body", CreatedAt: 1000, UpdatedAt: 2000}}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := MarkSynced(ctx, []syncproto.PushItemResult{{Id: "ct-c", Status: syncproto.PushStatusConflict}}); err != nil {
		t.Fatalf("mark synced: %v", err)
	}
	items, err := List(ctx, ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if items[0].SyncState != SyncStatePending {
		t.Fatalf("conflicted item must stay pending, got %q", items[0].SyncState)
	}
}

// The judgement function must be pure so every caller (engine, CLI, UI projection) agrees.
func TestSyncStateOfIsMonotonic(t *testing.T) {
	item := wconfig.CommonTextItemType{Id: "x", UpdatedAt: 5000}
	if got := SyncStateOf(item, nil); got != SyncStatePending {
		t.Fatalf("no watermark must be pending, got %q", got)
	}
	behind := &commonTextSyncRow{Id: "x", SyncedRev: 4, SyncedUpdatedAt: 4000}
	if got := SyncStateOf(item, behind); got != SyncStatePending {
		t.Fatalf("watermark behind updatedat must be pending, got %q", got)
	}
	caught := &commonTextSyncRow{Id: "x", SyncedRev: 5, SyncedUpdatedAt: 5000}
	if got := SyncStateOf(item, caught); got != SyncStateSynced {
		t.Fatalf("watermark at updatedat must be synced, got %q", got)
	}
	ahead := &commonTextSyncRow{Id: "x", SyncedRev: 6, SyncedUpdatedAt: 6000}
	if got := SyncStateOf(item, ahead); got != SyncStateSynced {
		t.Fatalf("watermark ahead of updatedat must be synced, got %q", got)
	}
}
