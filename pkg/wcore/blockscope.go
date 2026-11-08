// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// BlocksScope is the window/workspace filter for block listing. An empty
// scope means "current" (first workspace in the client focus list).
type BlocksScope struct {
	WindowId    string
	WorkspaceId string
}

// ListBlocksScoped returns every block visible in the requested scope
// (current workspace by default). It is the single source of truth for
// block enumeration: both the `wsh blocks list` handler and the Agent
// Control Surface (`ui state`) walk through this, so the two can never
// drift apart.
func ListBlocksScoped(ctx context.Context, scope BlocksScope) ([]wshrpc.BlocksListEntry, error) {
	var results []wshrpc.BlocksListEntry

	// Resolve the set of workspaces to inspect.
	var workspaceIDs []string
	if scope.WorkspaceId != "" {
		workspaceIDs = []string{scope.WorkspaceId}
	} else if scope.WindowId != "" {
		win, err := GetWindow(ctx, scope.WindowId)
		if err != nil {
			return nil, err
		}
		workspaceIDs = []string{win.WorkspaceId}
	} else {
		// "current" == first workspace in client focus list
		client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
		if err != nil {
			return nil, err
		}
		if len(client.WindowIds) == 0 {
			return nil, fmt.Errorf("no active window")
		}
		win, err := GetWindow(ctx, client.WindowIds[0])
		if err != nil {
			return nil, err
		}
		workspaceIDs = []string{win.WorkspaceId}
	}

	for _, wsID := range workspaceIDs {
		wsData, err := GetWorkspace(ctx, wsID)
		if err != nil {
			return nil, err
		}

		windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, wsID)
		if err != nil {
			log.Printf("error finding window for workspace %s: %v", wsID, err)
		}

		for _, tabID := range wsData.TabIds {
			tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabID)
			if err != nil {
				return nil, err
			}
			for _, blkID := range tab.BlockIds {
				blk, err := wstore.DBMustGet[*waveobj.Block](ctx, blkID)
				if err != nil {
					return nil, err
				}
				results = append(results, wshrpc.BlocksListEntry{
					WindowId:    windowId,
					WorkspaceId: wsID,
					TabId:       tabID,
					BlockId:     blkID,
					Meta:        blk.Meta,
				})
			}
		}
	}
	return results, nil
}

// GetLayoutStateForTab returns the layout object backing one tab. Callers use
// it to ask the two questions that decide whether a block is really applied:
// is the pending-action queue drained, and does the leaf order contain it?
func GetLayoutStateForTab(ctx context.Context, tabId string) (*waveobj.LayoutState, error) {
	layoutId, err := GetLayoutIdForTab(ctx, tabId)
	if err != nil {
		return nil, err
	}
	if layoutId == "" {
		return nil, fmt.Errorf("tab %q has no layout state", tabId)
	}
	return wstore.DBMustGet[*waveobj.LayoutState](ctx, layoutId)
}

// LayoutAppliedToFrontend reports whether the frontend has consumed every
// pending layout action for the tab AND the block appears in its leaf order.
// BlockIds membership alone is not enough: the block row exists as soon as the
// backend writes it, while the frontend may not have processed the action yet
// (measured 2026-11-08: BlockIds=4 while leaforder=1).
func LayoutAppliedToFrontend(ctx context.Context, tabId, blockId string) bool {
	layout, err := GetLayoutStateForTab(ctx, tabId)
	if err != nil || layout == nil {
		return false
	}
	if layout.PendingBackendActions != nil && len(*layout.PendingBackendActions) > 0 {
		return false
	}
	if layout.LeafOrder == nil {
		return false
	}
	for _, leaf := range *layout.LeafOrder {
		if leaf.BlockId == blockId {
			return true
		}
	}
	return false
}
