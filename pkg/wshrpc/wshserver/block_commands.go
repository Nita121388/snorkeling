// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
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
	tabId, err := resolveOpenTabId(ctx, data)
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
				SyncState: "layout-applied",
			}, nil
		}
	}

	// 4. Delegate to the existing create path.
	var targetBlockId, targetAction string
	switch data.Split {
	case "", "right":
		targetAction = "splitright"
	case "left":
		targetAction = "splitleft"
	case "down":
		targetAction = "splitdown"
	case "up":
		targetAction = "splitup"
	default:
		return nil, fmt.Errorf("E_USAGE: invalid --split %q (right|down|left|up)", data.Split)
	}
	if data.Replace != "" {
		targetAction = "replace"
		targetBlockId = data.Replace
	} else {
		// split needs a target block; without one, append to the tab.
		targetBlockId = ""
	}
	if targetBlockId == "" && data.Replace == "" {
		// plain insert: no layout target, CreateBlockCommand appends.
		targetAction = ""
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
		SyncState: "db-only",
	}

	// 5. --wait: poll until the block is reflected in the tab's block list.
	if data.Wait {
		waitMs := data.WaitMs
		if waitMs <= 0 {
			waitMs = 5000
		}
		start := time.Now()
		deadline := start.Add(time.Duration(waitMs) * time.Millisecond)
		for time.Now().Before(deadline) {
			if blockInTab(ctx, tabId, oref.OID) {
				rtn.SyncState = "layout-applied"
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		rtn.WaitedMs = int(time.Since(start).Milliseconds())
		if rtn.SyncState != "layout-applied" {
			rtn.Warnings = append(rtn.Warnings, "wait-timeout")
		}
	}
	return rtn, nil
}

func resolveOpenTabId(ctx context.Context, data wshrpc.BlockOpenRequest) (string, error) {
	switch data.Tab {
	case "", "active":
		// Active tab of the current workspace (same resolution as `blocks list`).
		client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
		if err != nil {
			return "", fmt.Errorf("E_NO_ROUTE: no active window")
		}
		if len(client.WindowIds) == 0 {
			return "", fmt.Errorf("E_NO_ROUTE: no active window")
		}
		win, err := wcore.GetWindow(ctx, client.WindowIds[0])
		if err != nil {
			return "", err
		}
		wsObj, err := wcore.GetWorkspace(ctx, win.WorkspaceId)
		if err != nil {
			return "", err
		}
		if wsObj.ActiveTabId == "" {
			return "", fmt.Errorf("E_NO_ROUTE: no active tab")
		}
		return wsObj.ActiveTabId, nil
	case "new":
		wsId := data.WorkspaceId
		if wsId == "" {
			client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
			if err != nil || len(client.WindowIds) == 0 {
				return "", fmt.Errorf("E_NO_ROUTE: no active window for --tab new")
			}
			win, err := wcore.GetWindow(ctx, client.WindowIds[0])
			if err != nil {
				return "", err
			}
			wsId = win.WorkspaceId
		}
		newTabId, err := wcore.CreateTab(ctx, wsId, "", true, false)
		if err != nil {
			return "", err
		}
		return newTabId, nil
	default:
		// explicit tab id: verify it exists
		if _, err := wstore.DBMustGet[*waveobj.Tab](ctx, data.Tab); err != nil {
			return "", fmt.Errorf("E_NOT_FOUND: tab %q not found", data.Tab)
		}
		return data.Tab, nil
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

func blockInTab(ctx context.Context, tabId, blockId string) bool {
	tabObj, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return false
	}
	for _, id := range tabObj.BlockIds {
		if id == blockId {
			return true
		}
	}
	return false
}
