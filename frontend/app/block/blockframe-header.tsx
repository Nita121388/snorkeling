// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    blockViewToIcon,
    blockViewToName,
    getViewIconElem,
    OptMagnifyButton,
    renderHeaderElements,
} from "@/app/block/blockutil";
import { ConnectionButton } from "@/app/block/connectionbutton";
import { DurableSessionFlyover } from "@/app/block/durable-session-flyover";
import { Modal } from "@/app/modals/modal";
import { getBlockBadgeAtom } from "@/app/store/badge";
import {
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    recordTEvent,
    refocusNode,
    WOS,
} from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { uxCloseBlock } from "@/app/store/keymodel";
import { useTabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { Button } from "@/element/button";
import { IconButton } from "@/element/iconbutton";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { cn, makeIconClass } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { minimizeBlockToFloat, restoreMinimizedBlockToLayout } from "./block-minimize";
import { BlockEnv } from "./blockenv";
import { BlockFrameProps } from "./blocktypes";

export type MoveBlockMenuContext = {
    currentTabId: string;
    sourceTabName: string;
    workspace: Workspace;
    canMoveToExistingTab: boolean;
    onMoveToExistingTab: () => void;
    onMoved: (targetTabId: string) => void;
};

export type BlockMoveMenuState = {
    moveContext: MoveBlockMenuContext | null;
    moveTabModal: React.ReactElement | null;
};

export function showBlockContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockId: string,
    viewModel: ViewModel,
    nodeModel: NodeModel,
    blockEnv: BlockEnv,
    moveContext?: MoveBlockMenuContext
) {
    e.preventDefault();
    e.stopPropagation();
    const magnified = globalStore.get(nodeModel.isMagnified);
    const ephemeral = globalStore.get(nodeModel.isEphemeral);
    const minimizedPreview = globalStore.get(nodeModel.isMinimizedPreview);
    const menu: ContextMenuItem[] = [
        minimizedPreview
            ? {
                  label: "Show in Tab",
                  click: () => restoreMinimizedBlockToLayout(moveContext?.currentTabId, blockId),
              }
            : {
                  label: magnified ? "Un-Magnify Block" : "Magnify Block",
                  click: () => {
                      nodeModel.toggleMagnify();
                  },
              },
        { type: "separator" },
        {
            label: "Copy BlockId",
            click: () => {
                navigator.clipboard.writeText(blockId);
            },
        },
    ];
    if (moveContext && !ephemeral) {
        menu.push({
            label: "Minimize to Float",
            enabled: !minimizedPreview,
            click: () => minimizeBlockToFloat(moveContext.currentTabId, blockId),
        });
        menu.push({ type: "separator" }, ...makeBlockMoveMenuItems(blockId, blockEnv, moveContext));
    }
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems && extraItems.length > 0) menu.push({ type: "separator" }, ...extraItems);
    menu.push(
        { type: "separator" },
        {
            label: minimizedPreview ? "Close Preview" : "Close Block",
            click: () => (minimizedPreview ? nodeModel.onClose() : uxCloseBlock(blockId)),
        }
    );
    blockEnv.showContextMenu(menu, e);
}

export function makeBlockMoveMenuItems(
    blockId: string,
    blockEnv: BlockEnv,
    moveContext?: MoveBlockMenuContext
): ContextMenuItem[] {
    if (!moveContext) {
        return [];
    }
    return [
        {
            label: "Move to New Tab",
            click: () => {
                util.fireAndForget(async () => {
                    const targetTabId = await blockEnv.services.object.MoveBlockToNewTab(
                        blockId,
                        moveContext.sourceTabName
                    );
                    moveContext.onMoved(targetTabId);
                });
            },
        },
        {
            label: "Move to Existing Tab...",
            enabled: moveContext.canMoveToExistingTab,
            click: () => moveContext.onMoveToExistingTab(),
        },
    ];
}

type HeaderTextElemsProps = {
    viewModel: ViewModel;
    blockId: string;
    preview: boolean;
    error?: Error;
};

const HeaderTextElems = React.memo(({ viewModel, blockId, preview, error }: HeaderTextElemsProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const frameTextAtom = waveEnv.getBlockMetaKeyAtom(blockId, "frame:text");
    const frameText = jotai.useAtomValue(frameTextAtom);
    let headerTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    headerTextUnion = frameText ?? headerTextUnion;

    const headerTextElems: React.ReactElement[] = [];
    if (typeof headerTextUnion === "string") {
        if (!util.isBlank(headerTextUnion)) {
            headerTextElems.push(
                <div key="text" className="block-frame-text ellipsis">
                    &lrm;{headerTextUnion}
                </div>
            );
        }
    } else if (Array.isArray(headerTextUnion)) {
        headerTextElems.push(...renderHeaderElements(headerTextUnion, preview));
    }
    if (error != null) {
        const copyHeaderErr = () => {
            navigator.clipboard.writeText(error.message + "\n" + error.stack);
        };
        headerTextElems.push(
            <div className="iconbutton disabled" key="controller-status" onClick={copyHeaderErr}>
                <i
                    className="fa-sharp fa-solid fa-triangle-exclamation"
                    title={"Error Rendering View Header: " + error.message}
                />
            </div>
        );
    }

    return <div className="block-frame-textelems-wrapper">{headerTextElems}</div>;
});
HeaderTextElems.displayName = "HeaderTextElems";

type HeaderEndIconsProps = {
    viewModel: ViewModel;
    nodeModel: NodeModel;
    blockId: string;
    moveContext?: MoveBlockMenuContext;
};

const HeaderEndIcons = React.memo(({ viewModel, nodeModel, blockId, moveContext }: HeaderEndIconsProps) => {
    const blockEnv = useWaveEnv<BlockEnv>();
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const ephemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const minimizedPreview = jotai.useAtomValue(nodeModel.isMinimizedPreview);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;
    const showSplitButtons = jotai.useAtomValue(blockEnv.getSettingsKeyAtom("term:showsplitbuttons"));

    const endIconsElem: React.ReactElement[] = [];

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    if (showSplitButtons && viewModel?.viewType === "term") {
        const splitHorizontalDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "columns",
            title: "Split Horizontally",
            click: (e) => {
                e.stopPropagation();
                const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
                const blockData = globalStore.get(blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || { view: "term", controller: "shell" },
                };
                createBlockSplitHorizontally(blockDef, blockId, "after");
            },
        };
        const splitVerticalDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "grip-lines",
            title: "Split Vertically",
            click: (e) => {
                e.stopPropagation();
                const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
                const blockData = globalStore.get(blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || { view: "term", controller: "shell" },
                };
                createBlockSplitVertically(blockDef, blockId, "after");
            },
        };
        endIconsElem.push(<IconButton key="split-horizontal" decl={splitHorizontalDecl} />);
        endIconsElem.push(<IconButton key="split-vertical" decl={splitVerticalDecl} />);
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        click: (e) => showBlockContextMenu(e, blockId, viewModel, nodeModel, blockEnv, moveContext),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings" />);
    if (minimizedPreview) {
        const restoreDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "arrow-up-right-from-square",
            title: "Show in Tab",
            click: () => {
                restoreMinimizedBlockToLayout(moveContext?.currentTabId, blockId);
            },
        };
        endIconsElem.push(<IconButton key="restore-minimized" decl={restoreDecl} />);
    } else if (ephemeral) {
        const addToLayoutDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "circle-plus",
            title: "Add to Layout",
            click: () => {
                nodeModel.addEphemeralNodeToLayout();
            },
        };
        endIconsElem.push(<IconButton key="add-to-layout" decl={addToLayoutDecl} />);
    } else {
        endIconsElem.push(
            <OptMagnifyButton
                key="unmagnify"
                magnified={magnified}
                toggleMagnify={() => {
                    nodeModel.toggleMagnify();
                    setTimeout(() => refocusNode(blockId), 50);
                }}
                disabled={magnifyDisabled}
            />
        );
        if (moveContext) {
            const minimizeDecl: IconButtonDecl = {
                elemtype: "iconbutton",
                icon: "box",
                title: "Minimize to Float",
                click: () => minimizeBlockToFloat(moveContext.currentTabId, blockId),
            };
            endIconsElem.push(<IconButton key="minimize-to-float" decl={minimizeDecl} />);
        }
    }

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: minimizedPreview ? "Close Preview" : "Close",
        click: () => (minimizedPreview ? nodeModel.onClose() : uxCloseBlock(nodeModel.blockId)),
    };
    endIconsElem.push(<IconButton key="close" decl={closeDecl} className="block-frame-default-close" />);

    return <div className="block-frame-end-icons">{endIconsElem}</div>;
});
HeaderEndIcons.displayName = "HeaderEndIcons";

type MoveBlockToTabModalProps = {
    blockId: string;
    currentTabId: string;
    workspace: Workspace;
    sourceTabName: string;
    onClose: () => void;
    onMoved: (targetTabId: string) => void;
};

type MoveBlockToTabRowProps = {
    tabId: string;
    moving: boolean;
    disabled: boolean;
    onMove: (tabId: string) => void;
};

const MoveBlockToTabRow = React.memo(({ tabId, moving, disabled, onMove }: MoveBlockToTabRowProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const tabAtom = waveEnv.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = jotai.useAtomValue(tabAtom);
    const tabName = tab?.name || "Untitled Tab";

    return (
        <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hoverbg disabled:cursor-default disabled:opacity-60"
            disabled={disabled}
            onClick={() => onMove(tabId)}
        >
            <div className="min-w-0">
                <div className="truncate text-sm text-primary">{tabName}</div>
                <div className="truncate text-[11px] text-secondary">{tabId}</div>
            </div>
            <span className="shrink-0 text-xs text-secondary">{moving ? "Moving..." : "Move"}</span>
        </button>
    );
});
MoveBlockToTabRow.displayName = "MoveBlockToTabRow";

const MoveBlockToTabModal = React.memo(
    ({ blockId, currentTabId, workspace, sourceTabName, onClose, onMoved }: MoveBlockToTabModalProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const setModalOpen = jotai.useSetAtom(waveEnv.atoms.modalOpen);
        const [movingTabId, setMovingTabId] = React.useState<string>(null);
        const [error, setError] = React.useState<string>(null);
        const tabIds = React.useMemo(
            () => (workspace?.tabids ?? []).filter((tabId) => tabId !== currentTabId),
            [workspace?.tabids, currentTabId]
        );

        React.useEffect(() => {
            setModalOpen(true);
            return () => setModalOpen(false);
        }, [setModalOpen]);

        React.useEffect(() => {
            const handleKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    onClose();
                }
            };
            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [onClose]);

        const moveToTab = React.useCallback(
            (targetTabId: string) => {
                setMovingTabId(targetTabId);
                setError(null);
                util.fireAndForget(async () => {
                    try {
                        await waveEnv.services.object.MoveBlockToTab(blockId, targetTabId, false);
                        onMoved(targetTabId);
                        onClose();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                        setMovingTabId(null);
                    }
                });
            },
            [waveEnv, blockId, onMoved, onClose]
        );

        return (
            <Modal className="w-[420px] max-w-[calc(100vw-32px)] pt-8 pb-4" onClose={onClose} onClickBackdrop={onClose}>
                <div className="mb-3 pr-8">
                    <div className="truncate text-base font-semibold text-primary">Move Block</div>
                    <div className="mt-1 truncate text-xs text-secondary">{sourceTabName}</div>
                </div>
                <div className="max-h-[320px] w-full overflow-y-auto rounded-md border border-border/50 p-1">
                    {tabIds.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-secondary">No other tabs</div>
                    ) : (
                        tabIds.map((tabId) => (
                            <MoveBlockToTabRow
                                key={tabId}
                                tabId={tabId}
                                moving={movingTabId === tabId}
                                disabled={movingTabId != null}
                                onMove={moveToTab}
                            />
                        ))
                    )}
                </div>
                {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
                <div className="mt-4 flex w-full justify-end">
                    <Button className="grey ghost" onClick={onClose} disabled={movingTabId != null}>
                        Cancel
                    </Button>
                </div>
            </Modal>
        );
    }
);
MoveBlockToTabModal.displayName = "MoveBlockToTabModal";

export function useBlockMoveMenu(nodeModel: NodeModel, viewModel: ViewModel, preview: boolean): BlockMoveMenuState {
    const waveEnv = useWaveEnv<BlockEnv>();
    const tabModel = useTabModel();
    const workspace = jotai.useAtomValue(waveEnv.atoms.workspace);
    const [moveTabModalOpen, setMoveTabModalOpen] = React.useState(false);
    const canMoveToExistingTab = (workspace?.tabids ?? []).some((tabId) => tabId !== tabModel.tabId);
    const handleMoved = React.useCallback(
        (targetTabId: string) => {
            waveEnv.electron.setActiveTab(targetTabId);
            setTimeout(() => refocusNode(nodeModel.blockId), 150);
        },
        [waveEnv, nodeModel.blockId]
    );
    const sourceTabName = jotai.useAtomValue(
        waveEnv.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabModel.tabId))
    )?.name;
    const moveContext = React.useMemo<MoveBlockMenuContext>(
        () =>
            !preview && workspace && tabModel.tabId
                ? {
                      currentTabId: tabModel.tabId,
                      sourceTabName: sourceTabName || "Tab",
                      workspace,
                      canMoveToExistingTab,
                      onMoveToExistingTab: () => setMoveTabModalOpen(true),
                      onMoved: handleMoved,
                  }
                : null,
        [preview, workspace, tabModel.tabId, sourceTabName, canMoveToExistingTab, handleMoved]
    );

    const moveTabModal =
        moveTabModalOpen && moveContext ? (
            <MoveBlockToTabModal
                blockId={nodeModel.blockId}
                currentTabId={moveContext.currentTabId}
                workspace={moveContext.workspace}
                sourceTabName={moveContext.sourceTabName}
                onClose={() => setMoveTabModalOpen(false)}
                onMoved={handleMoved}
            />
        ) : null;

    return { moveContext, moveTabModal };
}

const BlockFrame_Header = ({
    nodeModel,
    viewModel,
    preview,
    connBtnRef,
    changeConnModalAtom,
    error,
    moveContext,
}: BlockFrameProps & {
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    error?: Error;
    moveContext?: MoveBlockMenuContext;
}) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const metaView = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view"));
    const metaFrameTitle = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "frame:title"));
    const metaFrameIcon = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "frame:icon"));
    const metaConnection = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "connection"));
    let viewName = util.useAtomValueSafe(viewModel?.viewName) ?? blockViewToName(metaView);
    let viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(metaView);
    const preIconButton = util.useAtomValueSafe(viewModel?.preIconButton);
    const useTermHeader = util.useAtomValueSafe(viewModel?.useTermHeader);
    const termConfigedDurable = util.useAtomValueSafe(viewModel?.termConfigedDurable);
    const hideViewName = util.useAtomValueSafe(viewModel?.hideViewName);
    const badge = jotai.useAtomValue(getBlockBadgeAtom(useTermHeader ? nodeModel.blockId : null));
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const prevMagifiedState = React.useRef(magnified);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const iconColor = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "icon:color"));
    const dragHandleRef = preview ? null : nodeModel.dragHandleRef;
    const isTerminalBlock = metaView === "term";
    viewName = metaFrameTitle ?? viewName;
    viewIconUnion = metaFrameIcon ?? viewIconUnion;

    React.useEffect(() => {
        if (magnified && !preview && !prevMagifiedState.current) {
            waveEnv.rpc.ActivityCommand(TabRpcClient, { nummagnify: 1 });
            recordTEvent("action:magnify", { "block:view": viewName });
        }
        prevMagifiedState.current = magnified;
    }, [magnified]);

    const viewIconElem = getViewIconElem(viewIconUnion, iconColor);

    return (
        <div
            className={cn("block-frame-default-header", useTermHeader && "!pl-[2px]")}
            data-role="block-header"
            ref={dragHandleRef}
            onContextMenu={(e) =>
                showBlockContextMenu(e, nodeModel.blockId, viewModel, nodeModel, waveEnv, moveContext)
            }
        >
            {!useTermHeader && (
                <>
                    {preIconButton && <IconButton decl={preIconButton} className="block-frame-preicon-button" />}
                    <div className="block-frame-default-header-iconview">
                        {viewIconElem}
                        {viewName && !hideViewName && <div className="block-frame-view-type">{viewName}</div>}
                    </div>
                </>
            )}
            {manageConnection && (
                <ConnectionButton
                    ref={connBtnRef}
                    key="connbutton"
                    connection={metaConnection}
                    changeConnModalAtom={changeConnModalAtom}
                    isTerminalBlock={isTerminalBlock}
                />
            )}
            {useTermHeader && termConfigedDurable != null && (
                <DurableSessionFlyover
                    key="durable-status"
                    blockId={nodeModel.blockId}
                    viewModel={viewModel}
                    placement="bottom"
                    divClassName="iconbutton disabled text-[13px] ml-[-4px]"
                />
            )}
            {useTermHeader && badge && (
                <div className="pointer-events-none flex items-center px-1" style={{ color: badge.color || "#fbbf24" }}>
                    <i className={makeIconClass(badge.icon, true, { defaultIcon: "circle-small" })} />
                </div>
            )}
            <HeaderTextElems viewModel={viewModel} blockId={nodeModel.blockId} preview={preview} error={error} />
            <HeaderEndIcons
                viewModel={viewModel}
                nodeModel={nodeModel}
                blockId={nodeModel.blockId}
                moveContext={moveContext}
            />
        </div>
    );
};

export { BlockFrame_Header };
