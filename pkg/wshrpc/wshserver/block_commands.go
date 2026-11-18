// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// BlockOpenCommand is an orchestration layer, not a second create path: it
// resolves --tab, validates meta, optionally dedupes, then hands off to the
// existing CreateBlockCommand (so the FE sees the same events as
// `wsh createblock`). It never writes user data.
func (ws *WshServer) BlockOpenCommand(ctx context.Context, data wshrpc.BlockOpenRequest) (*wshrpc.BlockOpenResult, error) {
	view := strings.TrimSpace(data.View)
	if view == "" {
		return nil, fmt.Errorf("E_USAGE: --view is required")
	}
	if data.Split != "" && data.Replace != "" {
		return nil, fmt.Errorf("E_USAGE: --split and --replace are mutually exclusive")
	}

	// 1. Resolve target tab.
	tabId, err := resolveTabTarget(ctx, data.Tab, data.WorkspaceId)
	if err != nil {
		return nil, err
	}

	// 2. Build meta (view is mandatory; only whitelisted keys pass through).
	meta := waveobj.MetaMapType{}
	for k, v := range data.Meta {
		key := strings.TrimSpace(k)
		if key == "" || strings.HasPrefix(key, "cmd:") || strings.HasPrefix(key, "agent:") {
			return nil, fmt.Errorf("E_FORBIDDEN: meta key %q is not allowed", key)
		}
		meta[key] = v
	}
	meta[waveobj.MetaKey_View] = view

	// 3. Dedupe: same view + same signature meta already open in this tab.
	if data.Dedupe {
		if existing, found := findDedupeBlock(ctx, tabId, meta); found {
			return &wshrpc.BlockOpenResult{
				Version:   wshrpc.AgentControlVersion,
				Ok:        true,
				TabId:     tabId,
				BlockId:   existing,
				View:      view,
				Deduped:   true,
				SyncState: BlockSyncStateLayoutApplied,
			}, nil
		}
	}

	// 4. Delegate to the existing create path. Split needs a target block:
	// use the last block in the tab so `--split right` places the new block
	// after the current end of the tab (mirrors "split current pane").
	targetBlockId, targetAction, err := splitTargetAction(data.Split, data.Replace)
	if err != nil {
		return nil, err
	}
	if targetAction != "" && targetAction != "replace" && targetBlockId == "" {
		targetBlockId = lastBlockInTab(ctx, tabId)
	}

	oref, err := ws.CreateBlockCommand(ctx, wshrpc.CommandCreateBlockData{
		TabId:         tabId,
		BlockDef:      &waveobj.BlockDef{Meta: meta},
		Magnified:     data.Magnified,
		Focused:       !data.NoFocus,
		TargetBlockId: targetBlockId,
		TargetAction:  targetAction,
	})
	if err != nil {
		return nil, fmt.Errorf("create block: %w", err)
	}

	rtn := &wshrpc.BlockOpenResult{
		Version:   wshrpc.AgentControlVersion,
		Ok:        true,
		TabId:     tabId,
		BlockId:   oref.OID,
		View:      view,
		SyncState: BlockSyncStateDbOnly,
	}

	// 5. --wait: poll until the frontend has actually consumed the layout
	// action. BlockIds membership is not enough (the row exists as soon as the
	// backend writes it); we also need the queue drained and the leaf order to
	// contain the block, otherwise `layout-applied` would be a lie.
	if data.Wait {
		rtn.SyncState, rtn.WaitedMs, rtn.Warnings = waitForLayoutApplied(ctx, tabId, oref.OID, data.WaitMs, rtn.Warnings)
	}
	return rtn, nil
}

// Sync states reported by block open. `layout-queued` exists because a block
// can be written to the tab while the frontend has not consumed the layout
// action yet — reporting that as "layout-applied" would make agents believe a
// block is on screen when it is not.
const (
	BlockSyncStateDbOnly        = "db-only"
	BlockSyncStateLayoutQueued  = "layout-queued"
	BlockSyncStateLayoutApplied = "layout-applied"
)

// splitTargetAction maps CLI --split/--replace to wshrpc TargetAction.
// The split target block is left empty (CreateBlockCommand appends to the
// tab), so split maps to a no-target insert with the direction recorded in
// the layout action by CreateBlockCommand itself.
func splitTargetAction(split, replace string) (targetBlockId, targetAction string, err error) {
	if split != "" && replace != "" {
		return "", "", fmt.Errorf("E_USAGE: --split and --replace are mutually exclusive")
	}
	if replace != "" {
		return replace, "replace", nil
	}
	switch split {
	case "", "right":
		return "", "splitright", nil
	case "left":
		return "", "splitleft", nil
	case "down":
		return "", "splitdown", nil
	case "up":
		return "", "splitup", nil
	default:
		return "", "", fmt.Errorf("E_USAGE: invalid --split %q (right|down|left|up)", split)
	}
}

func findDedupeBlock(ctx context.Context, tabId string, meta waveobj.MetaMapType) (string, bool) {
	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return "", false
	}
	for _, blkId := range tabObj.BlockIds {
		blk, err := wstore.DBMustGet[*waveobj.Block](ctx, blkId)
		if err != nil {
			continue
		}
		if blk.Meta.GetString(waveobj.MetaKey_View, "") != meta.GetString(waveobj.MetaKey_View, "") {
			continue
		}
		if signatureMatches(blk.Meta, meta) {
			return blkId, true
		}
	}
	return "", false
}

// signatureMatches compares the signature meta keys (file/url/connection).
func signatureMatches(existing, want waveobj.MetaMapType) bool {
	for _, key := range []string{waveobj.MetaKey_File, waveobj.MetaKey_Url, waveobj.MetaKey_Connection} {
		if want.GetString(key, "") != "" && existing.GetString(key, "") != want.GetString(key, "") {
			return false
		}
	}
	return true
}

// lastBlockInTab returns the last block id in the tab, or "" when empty.
func lastBlockInTab(ctx context.Context, tabId string) string {
	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil || len(tabObj.BlockIds) == 0 {
		return ""
	}
	return tabObj.BlockIds[len(tabObj.BlockIds)-1]
}
