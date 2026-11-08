// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var wstoreTestOnce sync.Once

// Note: the wstore is process-global (globalDB). This fixture points it at a
// temp dir exactly once; later tests in this package share it.
func setupBlockScopeStore(t *testing.T) {
	t.Helper()
	wstoreTestOnce.Do(func() {
		dir, err := os.MkdirTemp("", "wcore-blockscope-test")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.RemoveAll(dir) })
		wavebase.DataHome_VarCache = filepath.Join(dir, "data")
		wavebase.ConfigHome_VarCache = filepath.Join(dir, "config")
		if err := os.MkdirAll(filepath.Join(wavebase.DataHome_VarCache, wavebase.WaveDBDir), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(wavebase.ConfigHome_VarCache, 0o700); err != nil {
			t.Fatal(err)
		}
		if !wstore.IsInitialized() {
			if err := wstore.InitWStore(); err != nil {
				t.Fatal(err)
			}
		}
	})
}

func TestListBlocksScopedEnumeratesWorkspaceBlocks(t *testing.T) {
	setupBlockScopeStore(t)
	ctx := context.Background()

	wsId := "wstest-ws-1"
	tabId := "wstest-tab-1"
	blkTerm := "wstest-blk-term"
	blkWeb := "wstest-blk-web"

	cleanup := func() {
		_ = wstore.DBDelete(ctx, waveobj.OType_Block, blkTerm)
		_ = wstore.DBDelete(ctx, waveobj.OType_Block, blkWeb)
		_ = wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
		_ = wstore.DBDelete(ctx, waveobj.OType_Workspace, wsId)
	}
	cleanup()
	t.Cleanup(cleanup)

	if err := wstore.DBInsert(ctx, &waveobj.Workspace{
		OID:         wsId,
		Name:        "test",
		TabIds:      []string{tabId},
		ActiveTabId: tabId,
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Tab{
		OID:      tabId,
		Name:     "tab1",
		BlockIds: []string{blkTerm, blkWeb},
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{
		OID:  blkTerm,
		Meta: waveobj.MetaMapType{waveobj.MetaKey_View: "term"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{
		OID:  blkWeb,
		Meta: waveobj.MetaMapType{waveobj.MetaKey_View: "web"},
	}); err != nil {
		t.Fatal(err)
	}

	entries, err := ListBlocksScoped(ctx, BlocksScope{WorkspaceId: wsId})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d: %#v", len(entries), entries)
	}
	byId := map[string]string{}
	for _, e := range entries {
		if e.WorkspaceId != wsId || e.TabId != tabId {
			t.Fatalf("entry %#v has wrong workspace/tab", e)
		}
		byId[e.BlockId] = e.Meta.GetString(waveobj.MetaKey_View, "")
	}
	if byId[blkTerm] != "term" || byId[blkWeb] != "web" {
		t.Fatalf("unexpected block views: %#v", byId)
	}
}

func TestListBlocksScopedUnknownWorkspaceErrors(t *testing.T) {
	setupBlockScopeStore(t)
	_, err := ListBlocksScoped(context.Background(), BlocksScope{WorkspaceId: "wstest-no-such-ws"})
	if err == nil {
		t.Fatal("expected error for unknown workspace")
	}
}

func TestLayoutAppliedToFrontend(t *testing.T) {
	setupBlockScopeStore(t)
	ctx := context.Background()
	tabId := "wstest-layout-tab"
	layoutId := "wstest-layout-1"
	blkId := "wstest-layout-blk"

	cleanup := func() {
		_ = wstore.DBDelete(ctx, waveobj.OType_LayoutState, layoutId)
		_ = wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
	}
	cleanup()
	t.Cleanup(cleanup)

	if err := wstore.DBInsert(ctx, &waveobj.Tab{
		OID:         tabId,
		Name:        "layout-tab",
		LayoutState: layoutId,
		BlockIds:    []string{blkId},
	}); err != nil {
		t.Fatal(err)
	}

	pending := []waveobj.LayoutActionData{{ActionType: "insert", BlockId: blkId}}
	leaves := []waveobj.LeafOrderEntry{{NodeId: "n1", BlockId: blkId}}

	// queue still has the action -> not applied, even though BlockIds has it
	if err := wstore.DBInsert(ctx, &waveobj.LayoutState{
		OID:                   layoutId,
		PendingBackendActions: &pending,
	}); err != nil {
		t.Fatal(err)
	}
	if LayoutAppliedToFrontend(ctx, tabId, blkId) {
		t.Fatal("pending queue must block layout-applied")
	}

	// queue drained but block not in leaf order -> still not applied
	otherLeaves := []waveobj.LeafOrderEntry{{NodeId: "n2", BlockId: "some-other-block"}}
	if err := wstore.DBUpdate(ctx, &waveobj.LayoutState{OID: layoutId, LeafOrder: &otherLeaves}); err != nil {
		t.Fatal(err)
	}
	if LayoutAppliedToFrontend(ctx, tabId, blkId) {
		t.Fatal("missing leaf order must block layout-applied")
	}

	// queue drained and block present -> applied
	empty := []waveobj.LayoutActionData{}
	if err := wstore.DBUpdate(ctx, &waveobj.LayoutState{
		OID:                   layoutId,
		LeafOrder:             &leaves,
		PendingBackendActions: &empty,
	}); err != nil {
		t.Fatal(err)
	}
	if !LayoutAppliedToFrontend(ctx, tabId, blkId) {
		t.Fatal("drained queue + leaf present must report applied")
	}
}
