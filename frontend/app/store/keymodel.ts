// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { openCommonTextSearch } from "@/app/commontext/commontext-events";
import { openWidgetQuickLaunch } from "@/app/workspace/widget-quick-launch";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import { FocusManager } from "@/app/store/focusManager";
import {
    atoms,
    confirmCurrentTabClose,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getFocusedBlockId,
    getSettingsKeyAtom,
    globalStore,
    recordTEvent,
    refocusNode,
    replaceBlock,
    WOS,
} from "@/app/store/global";
import { getActiveTabModel } from "@/app/store/tab-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import * as keyutil from "@/util/keyutil";
import { isMacOS, isWindows } from "@/util/platformutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";
import { resolvePreviewSaveTarget } from "./save-preview-draft";
import { isBuilderWindow, isTabWindow } from "./windowtype";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

const simpleControlShiftAtom = jotai.atom(false);
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();
const globalChordMap = new Map<string, Map<string, KeyHandler>>();
let globalKeybindingsDisabled = false;

// track current chord state and timeout (for resetting)
let activeChord: string | null = null;
let chordTimeout: NodeJS.Timeout = null;

function resetChord() {
    activeChord = null;
    if (chordTimeout) {
        clearTimeout(chordTimeout);
        chordTimeout = null;
    }
}

function setActiveChord(activeChordArg: string) {
    getApi().setKeyboardChordMode();
    if (chordTimeout) {
        clearTimeout(chordTimeout);
    }
    activeChord = activeChordArg;
    chordTimeout = setTimeout(() => resetChord(), CHORD_TIMEOUT);
}

export function keyboardMouseDownHandler(e: MouseEvent) {
    if (!e.ctrlKey || !e.shiftKey) {
        unsetControlShift();
    }
}

function getFocusedBlockInStaticTab(): string {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    return getLayoutDataActiveBlockId(focusedNode?.data);
}

// Global Cmd/Ctrl+S: flush the focused preview block's staged draft to disk.
// Preview (rendered markdown) mode has no editor-local keydown handler once the
// inline-edit textarea / Monaco editor is closed, so previously Ctrl+S silently
// no-op'd while the header Save button stayed lit (draft dirty, disk untouched).
// Monaco keeps its own editor.onKeyDown handler (fires first + stops propagation),
// and the inline textarea handler also stopPropagation's now, so this global path
// only fires when no editor is consuming the keystroke. Returns false for non-
// preview blocks so other modules (e.g. waveconfig Cmd:s) keep their own keys.
function saveFocusedPreviewDraft(): boolean {
    if (!isTabWindow()) {
        return false;
    }
    const target = resolvePreviewSaveTarget(getFocusedBlockInStaticTab(), (blockId) => {
        const bcm = getBlockComponentModel(blockId);
        return bcm == null ? undefined : { viewModel: bcm.viewModel };
    });
    if (target == null || target.handleFileSave == null) {
        return false;
    }
    fireAndForget(target.handleFileSave.bind(target));
    return true;
}

function getSimpleControlShiftAtom() {
    return simpleControlShiftAtom;
}

function setControlShift() {
    globalStore.set(simpleControlShiftAtom, true);
    const disableDisplay = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftdisplay"));
    if (!disableDisplay) {
        setTimeout(() => {
            const simpleState = globalStore.get(simpleControlShiftAtom);
            if (simpleState) {
                globalStore.set(atoms.controlShiftDelayAtom, true);
            }
        }, 400);
    }
}

function unsetControlShift() {
    globalStore.set(simpleControlShiftAtom, false);
    globalStore.set(atoms.controlShiftDelayAtom, false);
}

function disableGlobalKeybindings() {
    globalKeybindingsDisabled = true;
}

function enableGlobalKeybindings() {
    globalKeybindingsDisabled = false;
}

function shouldDispatchToBlock(e: WaveKeyboardEvent): boolean {
    if (globalStore.get(atoms.modalOpen)) {
        return false;
    }
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem instanceof HTMLElement) {
        if (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA" || activeElem.contentEditable == "true") {
            if (activeElem.classList.contains("dummy-focus") || activeElem.classList.contains("dummy")) {
                return true;
            }
            if (keyutil.isInputEvent(e)) {
                return false;
            }
            return true;
        }
    }
    return true;
}

function getStaticTabBlockCount(): number {
    const tabId = globalStore.get(atoms.staticTabId);
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    return tabData?.blockids?.length ?? 0;
}

async function confirmBlockClose(blockId: string): Promise<boolean> {
    const viewModel = getBlockComponentModel(blockId)?.viewModel;
    if (viewModel?.viewType !== "preview" || viewModel.confirmClose == null) {
        return true;
    }
    return await viewModel.confirmClose();
}

async function simpleCloseStaticTab() {
    if (!(await confirmCurrentTabClose())) {
        return;
    }
    const workspaceId = globalStore.get(atoms.workspaceId);
    const tabId = globalStore.get(atoms.staticTabId);
    const confirmClose = globalStore.get(getSettingsKeyAtom("tab:confirmclose")) ?? false;
    getApi()
        .closeTab(workspaceId, tabId, confirmClose)
        .then((didClose) => {
            if (didClose) {
                deleteLayoutModelForTab(tabId);
            }
        })
        .catch((e) => {
            console.log("error closing tab", e);
        });
}

async function uxCloseBlock(blockId: string) {
    if (!(await confirmBlockClose(blockId))) {
        return;
    }
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
        const aiModel = WaveAIModel.getInstance();
        const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
        if (shouldSwitchToAI) {
            replaceBlock(blockId, { meta: { view: "launcher" } }, false);
            setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
            return;
        }
    }

    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    const isAIFileDiff = blockData?.meta?.view === "aifilediff";

    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel.getNodeByBlockId(blockId);
    if (node) {
        await layoutModel.closeBlock(blockId);

        if (isAIFileDiff && isAIPanelOpen) {
            setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
        }
    }
}

async function genericClose() {
    const focusType = FocusManager.getInstance().getFocusType();
    if (focusType === "waveai") {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
        return;
    }

    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
        const aiModel = WaveAIModel.getInstance();
        const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
        if (shouldSwitchToAI) {
            const layoutModel = getLayoutModelForStaticTab();
            const focusedNode = globalStore.get(layoutModel.focusedNode);
            if (focusedNode) {
                const focusedBlockId = getLayoutDataActiveBlockId(focusedNode.data);
                if (focusedBlockId != null && !(await confirmBlockClose(focusedBlockId))) {
                    return;
                }
                replaceBlock(focusedBlockId, { meta: { view: "launcher" } }, false);
                setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
                return;
            }
        }
    }
    const blockCount = getStaticTabBlockCount();
    if (blockCount === 0) {
        await simpleCloseStaticTab();
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
    if (blockId != null && !(await confirmBlockClose(blockId))) {
        return;
    }
    const blockAtom = blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)) : null;
    const blockData = blockAtom ? globalStore.get(blockAtom) : null;
    const isAIFileDiff = blockData?.meta?.view === "aifilediff";

    await layoutModel.closeFocusedNode();

    if (isAIFileDiff && isAIPanelOpen) {
        setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
    }
}

function switchBlockByBlockNum(index: number) {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }
    layoutModel.switchNodeFocusByBlockNum(index);
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function switchBlockInDirection(direction: NavigateDirection) {
    const layoutModel = getLayoutModelForStaticTab();
    const focusType = FocusManager.getInstance().getFocusType();

    if (direction === NavigateDirection.Left) {
        const numBlocks = globalStore.get(layoutModel.numLeafs);
        if (focusType === "waveai") {
            return;
        }
        if (numBlocks === 1) {
            FocusManager.getInstance().requestWaveAIFocus();
            setTimeout(() => {
                FocusManager.getInstance().refocusNode();
            }, 10);
            return;
        }
    }

    if (direction === NavigateDirection.Right && focusType === "waveai") {
        FocusManager.getInstance().requestNodeFocus();
        return;
    }

    const inWaveAI = focusType === "waveai";
    const navResult = layoutModel.switchNodeFocusInDirection(direction, inWaveAI);
    if (navResult.atLeft) {
        FocusManager.getInstance().requestWaveAIFocus();
        setTimeout(() => {
            FocusManager.getInstance().refocusNode();
        }, 10);
        return;
    }
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function getAllTabs(ws: Workspace): string[] {
    return ws.tabids ?? [];
}

function switchTabAbs(index: number) {
    console.log("switchTabAbs", index);
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    const tabids = getAllTabs(ws);
    if (newTabIdx < 0 || newTabIdx >= tabids.length) {
        return;
    }
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    console.log("switchTab", offset);
    const ws = globalStore.get(atoms.workspace);
    const curTabId = globalStore.get(atoms.staticTabId);
    let tabIdx = -1;
    const tabids = getAllTabs(ws);
    for (let i = 0; i < tabids.length; i++) {
        if (tabids[i] == curTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + tabids.length) % tabids.length;
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function handleCmdI() {
    globalRefocus();
}

function globalRefocusWithTimeout(timeoutVal: number) {
    setTimeout(() => {
        globalRefocus();
    }, timeoutVal);
}

function globalRefocus() {
    if (isBuilderWindow()) {
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        // focus a node
        layoutModel.focusFirstNode();
        return;
    }
    const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
    if (blockId == null) {
        return;
    }
    refocusNode(blockId);
}

function getDefaultNewBlockDef(): BlockDef {
    const adnbAtom = getSettingsKeyAtom("app:defaultnewblock");
    const adnb = globalStore.get(adnbAtom) ?? "term";
    if (adnb == "launcher") {
        return {
            meta: {
                view: "launcher",
            },
        };
    }
    // "term", blank, anything else, fall back to terminal
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(
            WOS.makeORef("block", getLayoutDataActiveBlockId(focusedNode.data))
        );
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view == "term") {
            if (blockData?.meta?.["cmd:cwd"] != null) {
                termBlockDef.meta["cmd:cwd"] = blockData.meta["cmd:cwd"];
            }
        }
        if (blockData?.meta?.connection != null) {
            termBlockDef.meta.connection = blockData.meta.connection;
        }
    }
    return termBlockDef;
}

async function handleCmdN() {
    const blockDef = getDefaultNewBlockDef();
    await createBlock(blockDef);
}

async function handleSplitHorizontal(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitHorizontally(blockDef, getLayoutDataActiveBlockId(focusedNode.data), position);
}

async function handleSplitVertical(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitVertically(blockDef, getLayoutDataActiveBlockId(focusedNode.data), position);
}

let lastHandledEvent: KeyboardEvent | null = null;

// returns [keymatch, T]
function checkKeyMap<T>(waveEvent: WaveKeyboardEvent, keyMap: Map<string, T>): [string, T] {
    for (const key of keyMap.keys()) {
        if (keyutil.checkKeyPressed(waveEvent, key)) {
            const val = keyMap.get(key);
            return [key, val];
        }
    }
    return [null, null];
}

function appHandleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
    if (globalKeybindingsDisabled) {
        return false;
    }
    const nativeEvent = (waveEvent as any).nativeEvent;
    if (lastHandledEvent != null && nativeEvent != null && lastHandledEvent === nativeEvent) {
        return false;
    }
    lastHandledEvent = nativeEvent;
    const activeElem = document.activeElement;
    if (
        keyutil.isComposingEvent(waveEvent) &&
        activeElem instanceof HTMLElement &&
        (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA" || activeElem.contentEditable == "true")
    ) {
        return false;
    }
    if (activeChord) {
        console.log("handle activeChord", activeChord);
        // If we're in chord mode, look for the second key.
        const chordBindings = globalChordMap.get(activeChord);
        const [, handler] = checkKeyMap(waveEvent, chordBindings);
        if (handler) {
            resetChord();
            return handler(waveEvent);
        } else {
            // invalid chord; reset state and consume key
            resetChord();
            return true;
        }
    }
    const [chordKeyMatch] = checkKeyMap(waveEvent, globalChordMap);
    if (chordKeyMatch) {
        setActiveChord(chordKeyMatch);
        return true;
    }

    const [, globalHandler] = checkKeyMap(waveEvent, globalKeyMap);
    if (globalHandler) {
        const handled = globalHandler(waveEvent);
        if (handled) {
            return true;
        }
    }
    if (isTabWindow()) {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
        if (blockId != null && shouldDispatchToBlock(waveEvent)) {
            const bcm = getBlockComponentModel(blockId);
            const viewModel = bcm?.viewModel;
            if (viewModel?.keyDownHandler) {
                const handledByBlock = viewModel.keyDownHandler(waveEvent);
                if (handledByBlock) {
                    return true;
                }
            }
        }
    }
    return false;
}

function registerControlShiftStateUpdateHandler() {
    getApi().onControlShiftStateUpdate((state: boolean) => {
        if (state) {
            setControlShift();
        } else {
            unsetControlShift();
        }
    });
}

function registerElectronReinjectKeyHandler() {
    getApi().onReinjectKey((event: WaveKeyboardEvent) => {
        appHandleKeyDown(event);
    });
}

function tryReinjectKey(event: WaveKeyboardEvent): boolean {
    return appHandleKeyDown(event);
}

function countTermBlocks(): number {
    const allBCMs = getAllBlockComponentModels();
    let count = 0;
    const gsGetBound = globalStore.get.bind(globalStore);
    for (const bcm of allBCMs) {
        const viewModel = bcm.viewModel;
        if (viewModel.viewType == "term" && viewModel.isBasicTerm?.(gsGetBound)) {
            count++;
        }
    }
    return count;
}

function registerGlobalKeys() {
    globalKeyMap.set("Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Cmd:n", () => {
        handleCmdN();
        return true;
    });
    globalKeyMap.set("Cmd:d", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalKeyMap.set("Shift:Cmd:d", () => {
        handleSplitVertical("after");
        return true;
    });
    globalKeyMap.set("Cmd:i", () => {
        handleCmdI();
        return true;
    });
    globalKeyMap.set("Cmd:t", () => {
        createTab();
        return true;
    });
    globalKeyMap.set("Cmd:w", () => {
        fireAndForget(genericClose);
        return true;
    });
    globalKeyMap.set("Cmd:Shift:w", () => {
        fireAndForget(simpleCloseStaticTab);
        return true;
    });
    globalKeyMap.set("Cmd:m", () => {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        if (focusedNode != null) {
            layoutModel.magnifyNodeToggle(focusedNode.id);
        }
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowUp", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowDown", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowLeft", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowRight", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Right);
        return true;
    });
    // Vim-style aliases for block focus navigation.
    globalKeyMap.set("Ctrl:Shift:h", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:j", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:k", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:l", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Right);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:x", () => {
        const blockId = getFocusedBlockId();
        if (blockId == null) {
            return true;
        }
        replaceBlock(
            blockId,
            {
                meta: {
                    view: "launcher",
                },
            },
            true
        );
        return true;
    });
    globalKeyMap.set("F2", () => {
        const tabModel = getActiveTabModel();
        if (tabModel?.startRenameCallback != null) {
            tabModel.startRenameCallback();
            return true;
        }
        return false;
    });
    globalKeyMap.set("Cmd:g", () => {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.openSwitchConnection != null) {
            recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
            bcm.openSwitchConnection();
            return true;
        }
    });
    globalKeyMap.set("Ctrl:Shift:i", () => {
        const tabModel = getActiveTabModel();
        if (tabModel == null) {
            return true;
        }
        const curMI = globalStore.get(tabModel.isTermMultiInput);
        if (!curMI && countTermBlocks() <= 1) {
            // don't turn on multi-input unless there are 2 or more basic term blocks
            return true;
        }
        globalStore.set(tabModel.isTermMultiInput, !curMI);
        return true;
    });
    for (let idx = 1; idx <= 9; idx++) {
        globalKeyMap.set(`Cmd:${idx}`, () => {
            switchTabAbs(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Digit${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Numpad${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
    }
    if (isWindows()) {
        globalKeyMap.set("Alt:c{Digit0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
        globalKeyMap.set("Alt:c{Numpad0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
    } else {
        globalKeyMap.set("Ctrl:Shift:c{Digit0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
        globalKeyMap.set("Ctrl:Shift:c{Numpad0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
    }
    function activateSearch(event: WaveKeyboardEvent): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        // Ctrl+f is reserved in most shells
        if (event.control && bcm.viewModel.viewType == "term") {
            return false;
        }
        if (bcm.viewModel.searchAtoms) {
            if (globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
                // Already open — increment the focusInput counter so this block's
                // SearchComponent focuses its own input (avoids a global DOM query
                // that could target the wrong block when multiple searches are open).
                const cur = globalStore.get(bcm.viewModel.searchAtoms.focusInput) as number;
                globalStore.set(bcm.viewModel.searchAtoms.focusInput, cur + 1);
            } else {
                globalStore.set(bcm.viewModel.searchAtoms.isOpen, true);
            }
            return true;
        }
        return false;
    }
    function deactivateSearch(): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.viewModel.searchAtoms && globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, false);
            return true;
        }
        return false;
    }
    globalKeyMap.set("Cmd:s", () => saveFocusedPreviewDraft());
    globalKeyMap.set("Ctrl:s", () => saveFocusedPreviewDraft());
    globalKeyMap.set("Cmd:f", activateSearch);
    globalKeyMap.set("Escape", () => {
        if (modalsModel.cancelTopModal()) return true;
        if (deactivateSearch()) {
            return true;
        }
        return false;
    });
    globalKeyMap.set("Cmd:Shift:a", () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
        return true;
    });
    globalKeyMap.set("Cmd:Shift:o", () => {
        void SessionOverviewModel.getInstance().open();
        return true;
    });
    if (isMacOS()) {
        globalKeyMap.set("Cmd:Shift:p", () => {
            openWidgetQuickLaunch();
            return true;
        });
    } else {
        globalKeyMap.set("Ctrl:Shift:p", () => {
            openWidgetQuickLaunch();
            return true;
        });
    }
    // macOS: Ctrl+Shift+Space 被系统 IME 抢占 → 用 Cmd 系(Cmd=Meta),系统不抢。
    // win/linux: Ctrl+Shift+Space 在 Windows 中文 IME(微软拼音切候选/翻页)和 Linux
    //            桌面输入法(Fcitx/IBus)下也常被抢占 → 按键根本到不了 React keydown。
    // 统一放弃 Space(IME 高危键),改用 Slash 物理键;三个平台"概念键一致",只 Ctrl/Cmd 区分。
    // 用 c{Slash} 按 KeyboardEvent.code 匹配物理键,避免 Shift+/ 在美式键盘上报成 "?"(event.key="?"),
    // 跟注册名 "/" 不匹配而导致不命中(参见 keyutil.checkKeyPressed,符号键不做大小写归一)。
    if (isMacOS()) {
        globalKeyMap.set("Cmd:Shift:c{Slash}", () => {
            openCommonTextSearch();
            return true;
        });
    } else {
        globalKeyMap.set("Ctrl:Shift:c{Slash}", () => {
            openCommonTextSearch();
            return true;
        });
    }
    const allKeys = Array.from(globalKeyMap.keys());
    // special case keys, handled by web view
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft", "Cmd:o");
    getApi().registerGlobalWebviewKeys(allKeys);

    const splitBlockKeys = new Map<string, KeyHandler>();
    splitBlockKeys.set("ArrowUp", () => {
        handleSplitVertical("before");
        return true;
    });
    splitBlockKeys.set("ArrowDown", () => {
        handleSplitVertical("after");
        return true;
    });
    splitBlockKeys.set("ArrowLeft", () => {
        handleSplitHorizontal("before");
        return true;
    });
    splitBlockKeys.set("ArrowRight", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalChordMap.set("Ctrl:Shift:s", splitBlockKeys);
}

function registerBuilderGlobalKeys() {
    globalKeyMap.set("Cmd:w", () => {
        getApi().closeBuilderWindow();
        return true;
    });
    const allKeys = Array.from(globalKeyMap.keys());
    getApi().registerGlobalWebviewKeys(allKeys);
}

function getAllGlobalKeyBindings(): string[] {
    const allKeys = Array.from(globalKeyMap.keys());
    return allKeys;
}

export {
    appHandleKeyDown,
    disableGlobalKeybindings,
    enableGlobalKeybindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    registerBuilderGlobalKeys,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    tryReinjectKey,
    unsetControlShift,
    uxCloseBlock,
};
