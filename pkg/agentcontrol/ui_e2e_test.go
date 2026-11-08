// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcontrol

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var uiStoreOnce sync.Once

// setupUIStore points the process-global wstore at a temp dir exactly once.
func setupUIStore(t *testing.T) {
	t.Helper()
	uiStoreOnce.Do(func() {
		dir, err := os.MkdirTemp("", "agentcontrol-ui-test")
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

// uidSeed creates window+workspace+tab+blocks for assertions.
type uidSeed struct {
	windowId, wsId, tabId string
	blocks                map[string]string // blockid -> view
}

// stubFocused installs a fake frontend focused-block source so tests don't
// need a live WshRouter.
func stubFocused(t *testing.T, fn func(string) (*wshrpc.FocusedBlockData, error)) {
	t.Helper()
	old := focusedBlockDataFn
	focusedBlockDataFn = fn
	t.Cleanup(func() { focusedBlockDataFn = old })
}

func stubScrollback(t *testing.T, fn func(string, wshrpc.CommandTermGetScrollbackLinesData) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error)) {
	t.Helper()
	old := termScrollbackFn
	termScrollbackFn = fn
	t.Cleanup(func() { termScrollbackFn = old })
}

func uidSeedData(t *testing.T, prefix string) uidSeed {
	t.Helper()
	ctx := context.Background()
	s := uidSeed{
		windowId: prefix + "-win",
		wsId:     prefix + "-ws",
		tabId:    prefix + "-tab",
		blocks:   map[string]string{prefix + "-b1": "term", prefix + "-b2": "preview"},
	}
	cleanup := func() {
		for id := range s.blocks {
			_ = wstore.DBDelete(ctx, waveobj.OType_Block, id)
		}
		_ = wstore.DBDelete(ctx, waveobj.OType_Tab, s.tabId)
		_ = wstore.DBDelete(ctx, waveobj.OType_Workspace, s.wsId)
		_ = wstore.DBDelete(ctx, waveobj.OType_Window, s.windowId)
	}
	cleanup()
	t.Cleanup(cleanup)

	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(wstore.DBInsert(ctx, &waveobj.Window{OID: s.windowId, WorkspaceId: s.wsId}))
	must(wstore.DBInsert(ctx, &waveobj.Workspace{
		OID:         s.wsId,
		Name:        "ui-test",
		TabIds:      []string{s.tabId},
		ActiveTabId: s.tabId,
	}))
	must(wstore.DBInsert(ctx, &waveobj.Tab{
		OID:      s.tabId,
		Name:     "ui-tab",
		BlockIds: []string{prefix + "-b1", prefix + "-b2"},
	}))
	for id, view := range s.blocks {
		meta := waveobj.MetaMapType{waveobj.MetaKey_View: view}
		if view == "preview" {
			meta[waveobj.MetaKey_File] = "/repo/README.md"
		}
		if view == "term" {
			// a credential-looking meta value must never survive redaction
			meta["cmd:env"] = "AI_API_KEY=sk-secret"
			meta[waveobj.MetaKey_FrameTitle] = "shell"
		}
		must(wstore.DBInsert(ctx, &waveobj.Block{OID: id, Meta: meta}))
	}
	return s
}

func TestBuildUIStateEnumeratesBlocks(t *testing.T) {
	setupUIStore(t)
	s := uidSeedData(t, "uistate")
	snap, err := BuildUIState(context.Background(), wshrpc.UIStateRequest{WorkspaceId: s.wsId})
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(snap.Blocks))
	}
	byId := map[string]wshrpc.UIBlockState{}
	for _, b := range snap.Blocks {
		byId[b.BlockId] = b
	}
	term := byId["uistate-b1"]
	if term.View != "term" {
		t.Fatalf("expected term view, got %q", term.View)
	}
	// credential meta must never leak
	if _, leaked := term.Meta["cmd:env"]; leaked {
		t.Fatal("cmd:env leaked into UI state meta")
	}
	// tab list marks active
	found := false
	for _, tab := range snap.Tabs {
		if tab.TabId == s.tabId && tab.Active {
			found = true
		}
	}
	if !found {
		t.Fatal("active tab not marked")
	}
	if snap.Sources["backend"] != "ok" {
		t.Fatalf("expected backend source ok, got %#v", snap.Sources)
	}
}

func TestBuildUIActiveSelfDistinct(t *testing.T) {
	setupUIStore(t)
	s := uidSeedData(t, "uiactive")
	stubFocused(t, func(tabId string) (*wshrpc.FocusedBlockData, error) {
		return &wshrpc.FocusedBlockData{
			BlockId:  "focused-blk",
			ViewType: "term",
			BlockMeta: waveobj.MetaMapType{waveobj.MetaKey_FrameTitle: "claude"},
		}, nil
	})
	// seed the client pointer at our window
	ctx := context.Background()
	_ = wstore.DBDelete(ctx, waveobj.OType_Client, "whatever")
	_ = wstore.DBDelete(ctx, waveobj.OType_Client, "ui-client")
	t.Cleanup(func() { _ = wstore.DBDelete(ctx, waveobj.OType_Client, "ui-client") })
	if err := wstore.DBInsert(ctx, &waveobj.Client{OID: "ui-client", WindowIds: []string{s.windowId}}); err != nil {
		t.Fatal(err)
	}

	snap, err := BuildUIActive(ctx, wshrpc.UIActiveRequest{
		TabId:   "some-other-tab",
		BlockId: "some-other-block",
	})
	if err != nil {
		t.Fatal(err)
	}
	if snap.Self.TabId != "some-other-tab" || snap.Self.BlockId != "some-other-block" {
		t.Fatalf("self wrong: %#v", snap.Self)
	}
	if snap.Active == nil {
		t.Fatal("expected active to resolve")
	}
	if snap.Active.WindowId != s.windowId || snap.Active.WorkspaceId != s.wsId || snap.Active.TabId != s.tabId {
		t.Fatalf("active wrong: %#v", snap.Active)
	}
	// self vs active must be separable (different tab/block)
	if snap.Self.TabId == snap.Active.TabId {
		t.Fatal("self and active should be distinct in this fixture")
	}
	if snap.Active.BlockId != "focused-blk" || snap.Active.View != "term" || snap.Active.Title != "claude" {
		t.Fatalf("focused block not carried: %#v", snap.Active)
	}
}

func TestBuildUIActiveFocusedUnavailableDegrades(t *testing.T) {
	setupUIStore(t)
	s := uidSeedData(t, "uiactivenf")
	stubFocused(t, func(tabId string) (*wshrpc.FocusedBlockData, error) {
		return nil, nil // FE not running
	})
	ctx := context.Background()
	_ = wstore.DBDelete(ctx, waveobj.OType_Client, "ui-client-2")
	t.Cleanup(func() { _ = wstore.DBDelete(ctx, waveobj.OType_Client, "ui-client-2") })
	if err := wstore.DBInsert(ctx, &waveobj.Client{OID: "ui-client-2", WindowIds: []string{s.windowId}}); err != nil {
		t.Fatal(err)
	}
	snap, err := BuildUIActive(ctx, wshrpc.UIActiveRequest{})
	if err != nil {
		t.Fatal(err)
	}
	// active still resolves (window/workspace/tab), only the focused block is null
	if snap.Active == nil || snap.Active.TabId != s.tabId {
		t.Fatalf("expected partial active, got %#v", snap.Active)
	}
	if snap.Active.BlockId != "" {
		t.Fatalf("expected empty focused block, got %q", snap.Active.BlockId)
	}
}

func TestReadTermBlockViaStub(t *testing.T) {
	setupUIStore(t)
	ctx := context.Background()
	blkId := "uiread-term-blk"
	tabId := "uiread-term-tab"
	_ = wstore.DBDelete(ctx, waveobj.OType_Block, blkId)
	_ = wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
	t.Cleanup(func() {
		_ = wstore.DBDelete(ctx, waveobj.OType_Block, blkId)
		_ = wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
	})
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabId, Name: "t", BlockIds: []string{blkId}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{
		OID:  blkId,
		Meta: waveobj.MetaMapType{waveobj.MetaKey_View: "term"},
	}); err != nil {
		t.Fatal(err)
	}
	stubScrollback(t, func(tabId string, data wshrpc.CommandTermGetScrollbackLinesData) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
		return &wshrpc.CommandTermGetScrollbackLinesRtnData{
			TotalLines: 5,
			LineStart:  0,
			Lines:      []string{"l1", "l2", "l3", "l4", "l5"},
		}, nil
	})

	rtn, err := ReadBlock(ctx, wshrpc.BlockReadRequest{BlockId: blkId, Tail: 2})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Payload["lines"] != "l4\nl5" {
		t.Fatalf("expected last 2 lines, got %#v", rtn.Payload["lines"])
	}
	if rtn.Payload["totallines"] != 5 {
		t.Fatalf("expected totallines 5, got %#v", rtn.Payload["totallines"])
	}
}

func TestReadBlockUnknownView(t *testing.T) {
	setupUIStore(t)
	ctx := context.Background()
	blkId := "uiread-unknown-blk"
	_ = wstore.DBDelete(ctx, waveobj.OType_Block, blkId)
	t.Cleanup(func() { _ = wstore.DBDelete(ctx, waveobj.OType_Block, blkId) })
	if err := wstore.DBInsert(ctx, &waveobj.Block{
		OID:  blkId,
		Meta: waveobj.MetaMapType{waveobj.MetaKey_View: "weird-view"},
	}); err != nil {
		t.Fatal(err)
	}

	rtn, err := ReadBlock(ctx, wshrpc.BlockReadRequest{BlockId: blkId})
	if err != nil {
		t.Fatal(err)
	}
	// structured error, not process failure
	if rtn.Payload["error"] != "unsupported view" {
		t.Fatalf("expected unsupported view, got %#v", rtn.Payload["error"])
	}
	if rtn.View != "weird-view" {
		t.Fatalf("expected view echoed, got %q", rtn.View)
	}
}

func TestReadBlockMissingBlock(t *testing.T) {
	setupUIStore(t)
	_, err := ReadBlock(context.Background(), wshrpc.BlockReadRequest{BlockId: "no-such-block"})
	if err == nil {
		t.Fatal("expected error for missing block")
	}
}
