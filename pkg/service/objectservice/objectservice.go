// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ObjectService struct{}

const DefaultTimeout = 2 * time.Second
const ConnContextTimeout = 60 * time.Second

func sendUpdateEvents(label string, updates waveobj.UpdatesRtnType) {
	go func() {
		defer func() {
			panichandler.PanicHandler(label+":SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
}

func parseORef(oref string) (*waveobj.ORef, error) {
	fields := strings.Split(oref, ":")
	if len(fields) != 2 {
		return nil, fmt.Errorf("invalid object reference: %q", oref)
	}
	return &waveobj.ORef{OType: fields[0], OID: fields[1]}, nil
}

func (svc *ObjectService) GetObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get wave object by oref",
		ArgNames: []string{"oref"},
	}
}

func (svc *ObjectService) GetObject(orefStr string) (waveobj.WaveObj, error) {
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, err
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	return obj, nil
}

func (svc *ObjectService) GetObjects_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"orefs"},
		ReturnDesc: "objects",
	}
}

func (svc *ObjectService) GetObjects(orefStrArr []string) ([]waveobj.WaveObj, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	var orefArr []waveobj.ORef
	for _, orefStr := range orefStrArr {
		orefObj, err := parseORef(orefStr)
		if err != nil {
			return nil, err
		}
		orefArr = append(orefArr, *orefObj)
	}
	return wstore.DBSelectORefs(ctx, orefArr)
}

func (svc *ObjectService) CreateBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"uiContext", "blockDef", "rtOpts"},
		ReturnDesc: "blockId",
	}
}

func (svc *ObjectService) CreateBlock(uiContext waveobj.UIContext, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (string, waveobj.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return "", nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)

	blockData, err := wcore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return "", nil, err
	}

	return blockData.OID, waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) DeleteBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) DeleteBlock(uiContext waveobj.UIContext, blockId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.DeleteBlock(ctx, blockId, true)
	if err != nil {
		return nil, fmt.Errorf("error deleting block: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) MoveBlockToTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "move an existing block to another tab",
		ArgNames: []string{"ctx", "blockId", "targetTabId", "activateTargetTab"},
	}
}

func (svc *ObjectService) MoveBlockToTab(ctx context.Context, blockId string, targetTabId string, activateTargetTab bool) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	sourceTabId, err := wcore.MoveBlockToTab(ctx, blockId, targetTabId, true)
	if err != nil {
		return nil, fmt.Errorf("error moving block: %w", err)
	}
	if activateTargetTab && sourceTabId != targetTabId {
		workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, targetTabId)
		if err != nil {
			return nil, fmt.Errorf("error finding target workspace: %w", err)
		}
		if err := wcore.SetActiveTab(ctx, workspaceId, targetTabId); err != nil {
			return nil, fmt.Errorf("error setting active tab: %w", err)
		}
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	sendUpdateEvents("ObjectService:MoveBlockToTab", updates)
	return updates, nil
}

func (svc *ObjectService) MoveBlockToNewTab_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "move an existing block to a newly created empty tab",
		ArgNames:   []string{"ctx", "blockId", "tabNameBase"},
		ReturnDesc: "tabId",
	}
}

func resolveMoveBlockToNewTabBaseName(sourceTabName string, fallbackBaseName string) string {
	sourceTabName = strings.TrimSpace(sourceTabName)
	if sourceTabName != "" {
		return sourceTabName
	}
	fallbackBaseName = strings.TrimSpace(fallbackBaseName)
	if fallbackBaseName != "" {
		return fallbackBaseName
	}
	return "Tab"
}

func (svc *ObjectService) MoveBlockToNewTab(ctx context.Context, blockId string, tabNameBase string) (string, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	sourceTabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		return "", nil, fmt.Errorf("error finding source tab: %w", err)
	}
	sourceTab, err := wstore.DBMustGet[*waveobj.Tab](ctx, sourceTabId)
	if err != nil {
		return "", nil, fmt.Errorf("error finding source tab object: %w", err)
	}
	sourceWorkspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, sourceTabId)
	if err != nil {
		return "", nil, fmt.Errorf("error finding source workspace: %w", err)
	}
	if sourceWorkspaceId == "" {
		return "", nil, fmt.Errorf("source tab %q has no workspace", sourceTabId)
	}
	tabNameBase = resolveMoveBlockToNewTabBaseName(sourceTab.Name, tabNameBase)
	tabName, err := wcore.MakeUniqueTabName(ctx, sourceWorkspaceId, tabNameBase)
	if err != nil {
		return "", nil, fmt.Errorf("error making unique tab name: %w", err)
	}
	targetTabId, err := wcore.CreateEmptyTab(ctx, sourceWorkspaceId, tabName, false)
	if err != nil {
		return "", nil, fmt.Errorf("error creating target tab: %w", err)
	}
	moveSucceeded := false
	defer func() {
		if !moveSucceeded {
			_, _ = wcore.DeleteTab(ctx, sourceWorkspaceId, targetTabId, false)
		}
	}()
	_, err = wcore.MoveBlockToTab(ctx, blockId, targetTabId, true)
	if err != nil {
		return "", nil, fmt.Errorf("error moving block to new tab: %w", err)
	}
	moveSucceeded = true
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	sendUpdateEvents("ObjectService:MoveBlockToNewTab", updates)
	return targetTabId, updates, nil
}

func (svc *ObjectService) UpdateObjectMeta_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "oref", "meta"},
	}
}

func (svc *ObjectService) UpdateObjectMeta(uiContext waveobj.UIContext, orefStr string, meta waveobj.MetaMapType) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, fmt.Errorf("error parsing object reference: %w", err)
	}
	err = wstore.UpdateObjectMeta(ctx, *oref, meta, false)
	if err != nil {
		return nil, fmt.Errorf("error updating %q meta: %w", orefStr, err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "waveObj", "returnUpdates"},
	}
}

func (svc *ObjectService) UpdateObject(uiContext waveobj.UIContext, waveObj waveobj.WaveObj, returnUpdates bool) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	if waveObj == nil {
		return nil, fmt.Errorf("update wavobj is nil")
	}
	oref := waveobj.ORefFromWaveObj(waveObj)
	found, err := wstore.DBExistsORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if !found {
		return nil, fmt.Errorf("object not found: %s", oref)
	}
	err = wstore.DBUpdate(ctx, waveObj)
	if err != nil {
		return nil, fmt.Errorf("error updating object: %w", err)
	}
	if (waveObj.GetOType() == waveobj.OType_Workspace) && (waveObj.(*waveobj.Workspace).Name != "") {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_WorkspaceUpdate})
	}
	if returnUpdates {
		return waveobj.ContextGetUpdatesRtn(ctx), nil
	}
	return nil, nil
}
