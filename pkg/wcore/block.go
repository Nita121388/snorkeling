// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// removeBlockIdFromTab removes blockId from tab.BlockIds. Unlike utilfn.RemoveElemFromSlice,
// it keeps an empty (non-nil) slice when the last element is removed, so JSON serializes as
// "blockids": [] instead of "blockids": null. The frontend treats null blockids as a missing
// value, which breaks the empty-tab UI state (see tabcontent.tsx).
func removeBlockIdFromTab(tab *waveobj.Tab, blockId string) {
	tab.BlockIds = utilfn.RemoveElemFromSlice(tab.BlockIds, blockId)
	if tab.BlockIds == nil {
		tab.BlockIds = []string{}
	}
}

func CreateSubBlock(ctx context.Context, blockId string, blockDef *waveobj.BlockDef) (*waveobj.Block, error) {
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := createSubBlockObj(ctx, blockId, blockDef)
	if err != nil {
		return nil, fmt.Errorf("error creating sub block: %w", err)
	}
	return blockData, nil
}

func createSubBlockObj(ctx context.Context, parentBlockId string, blockDef *waveobj.BlockDef) (*waveobj.Block, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*waveobj.Block, error) {
		parentBlock, _ := wstore.DBGet[*waveobj.Block](tx.Context(), parentBlockId)
		if parentBlock == nil {
			return nil, fmt.Errorf("parent block not found: %q", parentBlockId)
		}
		blockId := uuid.NewString()
		blockData := &waveobj.Block{
			OID:         blockId,
			ParentORef:  waveobj.MakeORef(waveobj.OType_Block, parentBlockId).String(),
			RuntimeOpts: nil,
			Meta:        blockDef.Meta,
		}
		wstore.DBInsert(tx.Context(), blockData)
		parentBlock.SubBlockIds = append(parentBlock.SubBlockIds, blockId)
		wstore.DBUpdate(tx.Context(), parentBlock)
		return blockData, nil
	})
}

func CreateBlock(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (rtnBlock *waveobj.Block, rtnErr error) {
	return CreateBlockWithTelemetry(ctx, tabId, blockDef, rtOpts, true)
}

func CreateBlockInTab(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts, focused bool, magnified bool) (*waveobj.Block, error) {
	blockData, err := CreateBlock(ctx, tabId, blockDef, rtOpts)
	if err != nil {
		return nil, err
	}
	err = QueueLayoutActionForTab(ctx, tabId, waveobj.LayoutActionData{
		ActionType: LayoutActionDataType_Insert,
		BlockId:    blockData.OID,
		Focused:    focused,
		Magnified:  magnified,
	})
	if err != nil {
		_, _ = deleteBlockObj(ctx, blockData.OID)
		_ = filestore.WFS.DeleteZone(ctx, blockData.OID)
		return nil, fmt.Errorf("error queuing target layout action: %w", err)
	}
	return blockData, nil
}

func CreateBlockWithTelemetry(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts, recordTelemetry bool) (rtnBlock *waveobj.Block, rtnErr error) {
	var blockCreated bool
	var newBlockOID string
	defer func() {
		if rtnErr == nil {
			return
		}
		// if there was an error, and we created the block, clean it up since the function failed
		if blockCreated && newBlockOID != "" {
			deleteBlockObj(ctx, newBlockOID)
			filestore.WFS.DeleteZone(ctx, newBlockOID)
		}
	}()
	if blockDef == nil {
		return nil, fmt.Errorf("blockDef is nil")
	}
	if blockDef.Meta == nil || blockDef.Meta.GetString(waveobj.MetaKey_View, "") == "" {
		return nil, fmt.Errorf("no view provided for new block")
	}
	blockData, err := createBlockObj(ctx, tabId, blockDef, rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	blockCreated = true
	newBlockOID = blockData.OID
	// upload the files if present
	if len(blockDef.Files) > 0 {
		for fileName, fileDef := range blockDef.Files {
			err := filestore.WFS.MakeFile(ctx, newBlockOID, fileName, fileDef.Meta, wshrpc.FileOpts{})
			if err != nil {
				return nil, fmt.Errorf("error making blockfile %q: %w", fileName, err)
			}
			err = filestore.WFS.WriteFile(ctx, newBlockOID, fileName, []byte(fileDef.Content))
			if err != nil {
				return nil, fmt.Errorf("error writing blockfile %q: %w", fileName, err)
			}
		}
	}
	if recordTelemetry {
		blockView := blockDef.Meta.GetString(waveobj.MetaKey_View, "")
		blockController := blockDef.Meta.GetString(waveobj.MetaKey_Controller, "")
		go recordBlockCreationTelemetry(blockView, blockController)
	}
	return blockData, nil
}

func recordBlockCreationTelemetry(blockView string, blockController string) {
	defer func() {
		panichandler.PanicHandler("CreateBlock:telemetry", recover())
	}()
	if blockView == "" {
		return
	}
	tctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	telemetry.UpdateActivity(tctx, wshrpc.ActivityUpdate{
		Renderers: map[string]int{blockView: 1},
	})
	telemetry.RecordTEvent(tctx, &telemetrydata.TEvent{
		Event: "action:createblock",
		Props: telemetrydata.TEventProps{
			BlockView:       blockView,
			BlockController: blockController,
		},
	})
}

func createBlockObj(ctx context.Context, tabId string, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (*waveobj.Block, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*waveobj.Block, error) {
		tab, _ := wstore.DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return nil, fmt.Errorf("tab not found: %q", tabId)
		}
		blockId := uuid.NewString()
		blockData := &waveobj.Block{
			OID:         blockId,
			ParentORef:  waveobj.MakeORef(waveobj.OType_Tab, tabId).String(),
			RuntimeOpts: rtOpts,
			Meta:        blockDef.Meta,
		}
		wstore.DBInsert(tx.Context(), blockData)
		tab.BlockIds = append(tab.BlockIds, blockId)
		wstore.DBUpdate(tx.Context(), tab)
		return blockData, nil
	})
}

func MoveBlockToTab(ctx context.Context, blockId string, targetTabId string, focusMovedBlock bool) (string, error) {
	if blockId == "" {
		return "", fmt.Errorf("blockId cannot be empty")
	}
	if targetTabId == "" {
		return "", fmt.Errorf("targetTabId cannot be empty")
	}

	sourceTabId, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (string, error) {
		block, err := wstore.DBGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return "", fmt.Errorf("error getting block: %w", err)
		}
		if block == nil {
			return "", fmt.Errorf("block not found: %q", blockId)
		}
		parentORef, err := waveobj.ParseORef(block.ParentORef)
		if err != nil {
			return "", fmt.Errorf("bad block parent oref: %w", err)
		}
		if parentORef.OType != waveobj.OType_Tab {
			return "", fmt.Errorf("cannot move subblock %q with parent %q", blockId, block.ParentORef)
		}
		sourceTabId := parentORef.OID
		if sourceTabId == targetTabId {
			return sourceTabId, nil
		}

		sourceWorkspaceId, err := wstore.DBFindWorkspaceForTabId(tx.Context(), sourceTabId)
		if err != nil {
			return "", fmt.Errorf("error finding source workspace: %w", err)
		}
		targetWorkspaceId, err := wstore.DBFindWorkspaceForTabId(tx.Context(), targetTabId)
		if err != nil {
			return "", fmt.Errorf("error finding target workspace: %w", err)
		}
		if sourceWorkspaceId == "" {
			return "", fmt.Errorf("source tab %q has no workspace", sourceTabId)
		}
		if targetWorkspaceId == "" {
			return "", fmt.Errorf("target tab %q has no workspace", targetTabId)
		}
		if sourceWorkspaceId != targetWorkspaceId {
			return "", fmt.Errorf("cannot move block across workspaces")
		}

		sourceTab, err := wstore.DBGet[*waveobj.Tab](tx.Context(), sourceTabId)
		if err != nil {
			return "", fmt.Errorf("error getting source tab: %w", err)
		}
		targetTab, err := wstore.DBGet[*waveobj.Tab](tx.Context(), targetTabId)
		if err != nil {
			return "", fmt.Errorf("error getting target tab: %w", err)
		}
		if sourceTab == nil {
			return "", fmt.Errorf("source tab not found: %q", sourceTabId)
		}
		if targetTab == nil {
			return "", fmt.Errorf("target tab not found: %q", targetTabId)
		}
		if utilfn.FindStringInSlice(sourceTab.BlockIds, blockId) == -1 {
			return "", fmt.Errorf("source tab %q does not contain block %q", sourceTabId, blockId)
		}

		removeBlockIdFromTab(sourceTab, blockId)
		if utilfn.FindStringInSlice(targetTab.BlockIds, blockId) == -1 {
			targetTab.BlockIds = append(targetTab.BlockIds, blockId)
		}
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Tab, targetTabId).String()

		if err := wstore.DBUpdate(tx.Context(), sourceTab); err != nil {
			return "", fmt.Errorf("error updating source tab: %w", err)
		}
		if err := wstore.DBUpdate(tx.Context(), targetTab); err != nil {
			return "", fmt.Errorf("error updating target tab: %w", err)
		}
		if err := wstore.DBUpdate(tx.Context(), block); err != nil {
			return "", fmt.Errorf("error updating block parent: %w", err)
		}
		err = QueueLayoutActionForTab(tx.Context(), sourceTabId, waveobj.LayoutActionData{
			ActionType: LayoutActionDataType_RemoveFromLayout,
			BlockId:    blockId,
		})
		if err != nil {
			return "", fmt.Errorf("error queuing source layout action: %w", err)
		}
		err = QueueLayoutActionForTab(tx.Context(), targetTabId, waveobj.LayoutActionData{
			ActionType: LayoutActionDataType_Insert,
			BlockId:    blockId,
			Focused:    focusMovedBlock,
		})
		if err != nil {
			return "", fmt.Errorf("error queuing target layout action: %w", err)
		}
		return sourceTabId, nil
	})
	if err != nil {
		return "", err
	}
	if sourceTabId == targetTabId {
		return sourceTabId, nil
	}
	return sourceTabId, nil
}

type copyBlockToTabRtn struct {
	NewBlockId  string
	SourceTabId string
}

func CopyBlockToTab(ctx context.Context, blockId string, targetTabId string, focusCopiedBlock bool) (string, string, error) {
	if blockId == "" {
		return "", "", fmt.Errorf("blockId cannot be empty")
	}
	if targetTabId == "" {
		return "", "", fmt.Errorf("targetTabId cannot be empty")
	}

	rtn, err := wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (copyBlockToTabRtn, error) {
		block, err := wstore.DBGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error getting block: %w", err)
		}
		if block == nil {
			return copyBlockToTabRtn{}, fmt.Errorf("block not found: %q", blockId)
		}
		parentORef, err := waveobj.ParseORef(block.ParentORef)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("bad block parent oref: %w", err)
		}
		if parentORef.OType != waveobj.OType_Tab {
			return copyBlockToTabRtn{}, fmt.Errorf("cannot copy subblock %q with parent %q", blockId, block.ParentORef)
		}
		sourceTabId := parentORef.OID

		sourceWorkspaceId, err := wstore.DBFindWorkspaceForTabId(tx.Context(), sourceTabId)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error finding source workspace: %w", err)
		}
		targetWorkspaceId, err := wstore.DBFindWorkspaceForTabId(tx.Context(), targetTabId)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error finding target workspace: %w", err)
		}
		if sourceWorkspaceId == "" {
			return copyBlockToTabRtn{}, fmt.Errorf("source tab %q has no workspace", sourceTabId)
		}
		if targetWorkspaceId == "" {
			return copyBlockToTabRtn{}, fmt.Errorf("target tab %q has no workspace", targetTabId)
		}
		if sourceWorkspaceId != targetWorkspaceId {
			return copyBlockToTabRtn{}, fmt.Errorf("cannot copy block across workspaces")
		}

		sourceTab, err := wstore.DBGet[*waveobj.Tab](tx.Context(), sourceTabId)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error getting source tab: %w", err)
		}
		targetTab, err := wstore.DBGet[*waveobj.Tab](tx.Context(), targetTabId)
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error getting target tab: %w", err)
		}
		if sourceTab == nil {
			return copyBlockToTabRtn{}, fmt.Errorf("source tab not found: %q", sourceTabId)
		}
		if targetTab == nil {
			return copyBlockToTabRtn{}, fmt.Errorf("target tab not found: %q", targetTabId)
		}
		if utilfn.FindStringInSlice(sourceTab.BlockIds, blockId) == -1 {
			return copyBlockToTabRtn{}, fmt.Errorf("source tab %q does not contain block %q", sourceTabId, blockId)
		}

		newBlockId := uuid.NewString()
		newBlock := &waveobj.Block{
			OID:        newBlockId,
			ParentORef: waveobj.MakeORef(waveobj.OType_Tab, targetTabId).String(),
			Meta:       copyBlockMetaForDuplicate(block.Meta),
		}
		if len(block.Stickers) > 0 {
			newBlock.Stickers = copyBlockStickersForDuplicate(block.Stickers)
		}
		if err := wstore.DBInsert(tx.Context(), newBlock); err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error inserting copied block: %w", err)
		}
		targetTab.BlockIds = append(targetTab.BlockIds, newBlockId)
		if err := wstore.DBUpdate(tx.Context(), targetTab); err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error updating target tab: %w", err)
		}
		err = QueueLayoutActionForTab(tx.Context(), targetTabId, waveobj.LayoutActionData{
			ActionType: LayoutActionDataType_Insert,
			BlockId:    newBlockId,
			Focused:    focusCopiedBlock,
		})
		if err != nil {
			return copyBlockToTabRtn{}, fmt.Errorf("error queuing target layout action: %w", err)
		}
		return copyBlockToTabRtn{NewBlockId: newBlockId, SourceTabId: sourceTabId}, nil
	})
	if err != nil {
		return "", "", err
	}
	return rtn.NewBlockId, rtn.SourceTabId, nil
}

func copyBlockMetaForDuplicate(meta waveobj.MetaMapType) waveobj.MetaMapType {
	if meta == nil {
		return nil
	}
	var rtn waveobj.MetaMapType
	if data, err := json.Marshal(meta); err == nil {
		if err := json.Unmarshal(data, &rtn); err == nil {
			deleteCopiedBlockTransientMeta(rtn)
			return rtn
		}
	}
	rtn = make(waveobj.MetaMapType, len(meta))
	for k, v := range meta {
		rtn[k] = v
	}
	deleteCopiedBlockTransientMeta(rtn)
	return rtn
}

func deleteCopiedBlockTransientMeta(meta waveobj.MetaMapType) {
	delete(meta, "agent:sessionid")
	delete(meta, waveobj.MetaKey_TermVDomSubBlockId)
	delete(meta, waveobj.MetaKey_TermVDomToolbarBlockId)
}

func copyBlockStickersForDuplicate(stickers []*waveobj.StickerType) []*waveobj.StickerType {
	if stickers == nil {
		return nil
	}
	data, err := json.Marshal(stickers)
	if err != nil {
		return nil
	}
	var rtn []*waveobj.StickerType
	if err := json.Unmarshal(data, &rtn); err != nil {
		return nil
	}
	return rtn
}

// Deletes a block and its subblocks. Deleting the last block in a tab leaves an
// empty tab behind. Tabs are only removed by explicit tab/window/workspace close
// paths.
func DeleteBlock(ctx context.Context, blockId string, recursive bool) error {
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if block == nil {
		return nil
	}
	if len(block.SubBlockIds) > 0 {
		for _, subBlockId := range block.SubBlockIds {
			err := DeleteBlock(ctx, subBlockId, recursive)
			if err != nil {
				return fmt.Errorf("error deleting subblock %s: %w", subBlockId, err)
			}
		}
	}
	parentBlockCount, err := deleteBlockObj(ctx, blockId)
	if err != nil {
		return fmt.Errorf("error deleting block: %w", err)
	}
	log.Printf("DeleteBlock: parentBlockCount: %d", parentBlockCount)
	sendBlockCloseEvent(blockId)
	return nil
}

// returns the updated block count for the parent object
func deleteBlockObj(ctx context.Context, blockId string) (int, error) {
	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (int, error) {
		block, err := wstore.DBGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return -1, fmt.Errorf("error getting block: %w", err)
		}
		if block == nil {
			return -1, fmt.Errorf("block not found: %q", blockId)
		}
		if len(block.SubBlockIds) > 0 {
			return -1, fmt.Errorf("block has subblocks, must delete subblocks first")
		}
		parentORef := waveobj.ParseORefNoErr(block.ParentORef)
		parentBlockCount := -1
		if parentORef != nil {
			if parentORef.OType == waveobj.OType_Tab {
				tab, _ := wstore.DBGet[*waveobj.Tab](tx.Context(), parentORef.OID)
				if tab != nil {
					removeBlockIdFromTab(tab, blockId)
					wstore.DBUpdate(tx.Context(), tab)
					parentBlockCount = len(tab.BlockIds)
				}
			} else if parentORef.OType == waveobj.OType_Block {
				parentBlock, _ := wstore.DBGet[*waveobj.Block](tx.Context(), parentORef.OID)
				if parentBlock != nil {
					parentBlock.SubBlockIds = utilfn.RemoveElemFromSlice(parentBlock.SubBlockIds, blockId)
					wstore.DBUpdate(tx.Context(), parentBlock)
					parentBlockCount = len(parentBlock.SubBlockIds)
				}
			}
		}
		wstore.DBDelete(tx.Context(), waveobj.OType_Block, blockId)

		// Clean up block runtime info
		blockORef := waveobj.MakeORef(waveobj.OType_Block, blockId)
		wstore.DeleteRTInfo(blockORef)

		return parentBlockCount, nil
	})
}

func sendBlockCloseEvent(blockId string) {
	waveEvent := wps.WaveEvent{
		Event: wps.Event_BlockClose,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: blockId,
	}
	wps.Broker.Publish(waveEvent)
}
