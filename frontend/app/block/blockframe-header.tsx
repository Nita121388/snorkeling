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
import { TabTargetModal } from "@/app/tab/tab-target-modal";
import { canOpenAgentFolder, openAgentFolderInCurrentTab } from "@/app/view/term/agent-folder";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import { isAgentTerminalMeta } from "@/app/view/term/agent-meta";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import {
    insertBlockAtFixedLeftOrder,
    SnorkelingBlockKindMetaKey,
    SnorkelingBlockKindNote,
} from "@/app/workspace/toggle-block";
import { IconButton } from "@/element/iconbutton";
import { getLayoutModelForTabById, NodeModel } from "@/layout/index";
import { getLayoutDataBlockIds } from "@/layout/lib/inlineTabs";
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
    onCopyToExistingTab: () => void;
    onMoved: (targetTabId: string) => void;
    onCopied: (targetTabId: string, blockId: string) => void;
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
    currentTabId: string,
    moveContext?: MoveBlockMenuContext
) {
    e.preventDefault();
    e.stopPropagation();
    const magnified = globalStore.get(nodeModel.isMagnified);
    const ephemeral = globalStore.get(nodeModel.isEphemeral);
    const minimizedPreview = globalStore.get(nodeModel.isMinimizedPreview);
    const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
    const blockMeta = (blockData?.meta ?? {}) as Record<string, unknown>;
    const isNoteBlock = blockMeta[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote;
    const agentSessionId = resolveAgentSessionIdFromMeta(blockMeta).trim();
    const hasAgentMeta =
        blockMeta.view === "agent" ||
        blockMeta["agent:autoresume"] === true ||
        (typeof blockMeta["agent:provider"] === "string" && blockMeta["agent:provider"].trim() !== "") ||
        agentSessionId !== "";
    const showMinimizedPreviewInTab = () => {
        const restored = restoreMinimizedBlockToLayout(currentTabId, blockId);
        if (restored) {
            setTimeout(() => refocusNode(blockId), 50);
        }
    };
    const menu: ContextMenuItem[] = [
        minimizedPreview
            ? {
                  label: isNoteBlock ? "Collapse to Tab" : "Show in Tab",
                  click: showMinimizedPreviewInTab,
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
    if (hasAgentMeta && canOpenAgentFolder(blockData ?? null, agentSessionId)) {
        menu.push({
            label: "Open Agent Folder",
            click: () => {
                util.fireAndForget(() =>
                    openAgentFolderInCurrentTab({
                        blockId,
                        block: blockData ?? null,
                        sessionId: agentSessionId,
                    })
                );
            },
        });
    }
    if (moveContext && !ephemeral) {
        menu.push({
            label: "Minimize to BlockBar",
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
            click: () => (minimizedPreview ? nodeModel.onClose() : util.fireAndForget(() => uxCloseBlock(blockId))),
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
        {
            label: "Copy to New Tab",
            click: () => {
                util.fireAndForget(async () => {
                    const result = await blockEnv.services.object.CopyBlockToNewTab(blockId, moveContext.sourceTabName);
                    moveContext.onCopied(result.tabid, result.blockid);
                });
            },
        },
        {
            label: "Copy to Existing Tab...",
            enabled: moveContext.canMoveToExistingTab,
            click: () => moveContext.onCopyToExistingTab(),
        },
    ];
}

type HeaderTextElemsProps = {
    viewModel: ViewModel;
    blockId: string;
    preview: boolean;
    error?: Error;
    isHovered: boolean;
};

const HeaderTextElems = React.memo(({ viewModel, blockId, preview, error, isHovered }: HeaderTextElemsProps) => {
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

    return <div className={cn("block-frame-textelems-wrapper", isHovered && "is-hovered")}>{headerTextElems}</div>;
});
HeaderTextElems.displayName = "HeaderTextElems";

function resolveZoneClass(decl: IconButtonDecl): string {
    return decl.zone === "pinned" ? "end-icon-pinned" : "end-icon-reveal";
}

type HeaderEndIconsProps = {
    viewModel: ViewModel;
    nodeModel: NodeModel;
    blockId: string;
    moveContext?: MoveBlockMenuContext;
    isHovered: boolean;
};

const HeaderEndIcons = React.memo(({ viewModel, nodeModel, blockId, moveContext, isHovered }: HeaderEndIconsProps) => {
    const blockEnv = useWaveEnv<BlockEnv>();
    const tabModel = useTabModel();
    const layoutModel = getLayoutModelForTabById(tabModel.tabId);
    const layoutData = jotai.useAtomValue(nodeModel.layoutData);
    jotai.useAtomValue(nodeModel.additionalProps);
    const inlineBlockIds = getLayoutDataBlockIds(layoutData);
    const isInlineTabGroup = inlineBlockIds.length > 1;
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const ephemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const minimizedPreview = jotai.useAtomValue(nodeModel.isMinimizedPreview);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;
    const showSplitButtons = jotai.useAtomValue(blockEnv.getSettingsKeyAtom("term:showsplitbuttons"));
    const blockData = jotai.useAtomValue(blockEnv.wos.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
    const isNoteBlock = blockData?.meta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote;

    const endIconsElem: React.ReactElement[] = [];

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => (
            <IconButton key={idx} decl={button} className={resolveZoneClass(button)} />
        )));
    }
    if (showSplitButtons && viewModel?.viewType === "term") {
        const splitHorizontalDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "columns",
            title: "Split Horizontally",
            zone: "reveal",
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
            zone: "reveal",
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
        endIconsElem.push(<IconButton key="split-horizontal" decl={splitHorizontalDecl} className="end-icon-reveal" />);
        endIconsElem.push(<IconButton key="split-vertical" decl={splitVerticalDecl} className="end-icon-reveal" />);
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        zone: "reveal",
        click: (e) => showBlockContextMenu(e, blockId, viewModel, nodeModel, blockEnv, tabModel.tabId, moveContext),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings end-icon-reveal" />);
    if (isNoteBlock && (minimizedPreview || ephemeral)) {
        endIconsElem.push(
            <OptMagnifyButton
                key="collapse-note-preview"
                magnified={true}
                title="Collapse to Tab"
                disabled={false}
                className="end-icon-reveal"
                toggleMagnify={() => {
                    if (minimizedPreview) {
                        const restored = restoreMinimizedBlockToLayout(tabModel.tabId, blockId);
                        if (restored) {
                            setTimeout(() => refocusNode(blockId), 50);
                        }
                        return;
                    }
                    layoutModel?.closeEphemeralNodeForBlock(blockId);
                    insertBlockAtFixedLeftOrder(SnorkelingBlockKindNote, blockId, false);
                }}
            />
        );
    } else if (minimizedPreview) {
        const restoreDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "arrow-up-right-from-square",
            title: "Show in Tab",
            zone: "reveal",
            click: () => {
                const restored = restoreMinimizedBlockToLayout(tabModel.tabId, blockId);
                if (restored) {
                    setTimeout(() => refocusNode(blockId), 50);
                }
            },
        };
        endIconsElem.push(<IconButton key="restore-minimized" decl={restoreDecl} className="end-icon-reveal" />);
    } else if (ephemeral) {
        const addToLayoutDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "circle-plus",
            title: "Add to Layout",
            zone: "reveal",
            click: () => {
                nodeModel.addEphemeralNodeToLayout();
            },
        };
        endIconsElem.push(<IconButton key="add-to-layout" decl={addToLayoutDecl} className="end-icon-reveal" />);
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
                className="end-icon-reveal"
            />
        );
        const inlineMinimizeDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: isInlineTabGroup ? "box-open" : "box",
            title: isInlineTabGroup ? "Restore as Block" : "Merge into Previous Block",
            disabled: isInlineTabGroup ? false : !layoutModel?.canInlineMinimizeBlock(blockId),
            zone: "reveal",
            click: () => {
                if (isInlineTabGroup) {
                    layoutModel?.restoreInlineTabBlock(blockId);
                } else {
                    layoutModel?.inlineMinimizeBlock(blockId);
                }
            },
        };
        endIconsElem.push(<IconButton key="inline-tab-minimize" decl={inlineMinimizeDecl} className="end-icon-reveal" />);
    }

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: minimizedPreview ? "Close Preview" : "Close",
        zone: "pinned",
        click: () =>
            minimizedPreview ? nodeModel.onClose() : util.fireAndForget(() => uxCloseBlock(nodeModel.blockId)),
    };
    endIconsElem.push(<IconButton key="close" decl={closeDecl} className="block-frame-default-close end-icon-pinned" />);

    return <div className={cn("block-frame-end-icons", isHovered && "is-hovered")}>{endIconsElem}</div>;
});
HeaderEndIcons.displayName = "HeaderEndIcons";

type BlockTabActionMode = "move" | "copy";

type MoveBlockToTabModalProps = {
    mode: BlockTabActionMode;
    blockId: string;
    currentTabId: string;
    workspace: Workspace;
    sourceTabName: string;
    onClose: () => void;
    onMoved: (targetTabId: string) => void;
    onCopied: (targetTabId: string, blockId: string) => void;
};

const MoveBlockToTabModal = React.memo(
    ({
        mode,
        blockId,
        currentTabId,
        workspace,
        sourceTabName,
        onClose,
        onMoved,
        onCopied,
    }: MoveBlockToTabModalProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const title = mode === "move" ? "Move Block" : "Copy Block";
        const actionLabel = mode === "move" ? "Move" : "Copy";
        const workingLabel = mode === "move" ? "Moving..." : "Copying...";

        const runTabAction = React.useCallback(
            async (targetTabId: string) => {
                if (mode === "move") {
                    await waveEnv.services.object.MoveBlockToTab(blockId, targetTabId, false);
                    onMoved(targetTabId);
                    return;
                }
                const newBlockId = await waveEnv.services.object.CopyBlockToTab(blockId, targetTabId, false);
                onCopied(targetTabId, newBlockId);
            },
            [waveEnv, mode, blockId, onMoved, onCopied]
        );

        return (
            <TabTargetModal
                workspace={workspace}
                currentTabId={currentTabId}
                title={title}
                subtitle={sourceTabName}
                actionLabel={actionLabel}
                workingLabel={workingLabel}
                onClose={onClose}
                onSelect={runTabAction}
            />
        );
    }
);
MoveBlockToTabModal.displayName = "MoveBlockToTabModal";

export function useBlockMoveMenu(nodeModel: NodeModel, viewModel: ViewModel, preview: boolean): BlockMoveMenuState {
    const waveEnv = useWaveEnv<BlockEnv>();
    const tabModel = useTabModel();
    const workspace = jotai.useAtomValue(waveEnv.atoms.workspace);
    const [tabActionModalMode, setTabActionModalMode] = React.useState<BlockTabActionMode>(null);
    const canMoveToExistingTab = (workspace?.tabids ?? []).some((tabId) => tabId !== tabModel.tabId);
    const handleMoved = React.useCallback(
        (targetTabId: string) => {
            waveEnv.electron.setActiveTab(targetTabId);
            setTimeout(() => refocusNode(nodeModel.blockId), 150);
        },
        [waveEnv, nodeModel.blockId]
    );
    const handleCopied = React.useCallback(
        (targetTabId: string, blockId: string) => {
            waveEnv.electron.setActiveTab(targetTabId);
            setTimeout(() => refocusNode(blockId), 150);
        },
        [waveEnv]
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
                      onMoveToExistingTab: () => setTabActionModalMode("move"),
                      onCopyToExistingTab: () => setTabActionModalMode("copy"),
                      onMoved: handleMoved,
                      onCopied: handleCopied,
                  }
                : null,
        [preview, workspace, tabModel.tabId, sourceTabName, canMoveToExistingTab, handleMoved, handleCopied]
    );

    const moveTabModal =
        tabActionModalMode && moveContext ? (
            <MoveBlockToTabModal
                mode={tabActionModalMode}
                blockId={nodeModel.blockId}
                currentTabId={moveContext.currentTabId}
                workspace={moveContext.workspace}
                sourceTabName={moveContext.sourceTabName}
                onClose={() => setTabActionModalMode(null)}
                onMoved={handleMoved}
                onCopied={handleCopied}
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
    const tabModel = useTabModel();
    const metaView = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view"));
    const metaFrameTitle = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "frame:title"));
    const metaFrameIcon = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "frame:icon"));
    const metaFrameText = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "frame:text"));
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
    const blockData = jotai.useAtomValue(
        waveEnv.wos.getWaveObjectAtom<Block>(WOS.makeORef("block", nodeModel.blockId))
    );
    const isAgentBlock = isTerminalBlock && isAgentTerminalMeta(blockData?.meta);
    viewName = metaFrameTitle ?? viewName;
    viewIconUnion = metaFrameIcon ?? viewIconUnion;
    const [isHovered, setIsHovered] = React.useState(false);
    const [isCardHovered, setIsCardHovered] = React.useState(false);
    const hideHoverTimerRef = React.useRef<number | null>(null);
    const hideCardTimerRef = React.useRef<number | null>(null);
    const cancelPendingHideHover = React.useCallback(() => {
        if (hideHoverTimerRef.current != null) {
            window.clearTimeout(hideHoverTimerRef.current);
            hideHoverTimerRef.current = null;
        }
    }, []);
    const cancelPendingHideCard = React.useCallback(() => {
        if (hideCardTimerRef.current != null) {
            window.clearTimeout(hideCardTimerRef.current);
            hideCardTimerRef.current = null;
        }
    }, []);

    React.useEffect(() => () => {
        cancelPendingHideHover();
        cancelPendingHideCard();
    }, [cancelPendingHideHover, cancelPendingHideCard]);

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
            onPointerEnter={() => {
                cancelPendingHideHover();
                setIsHovered(true);
            }}
            onPointerLeave={() => {
                cancelPendingHideHover();
                hideHoverTimerRef.current = window.setTimeout(() => {
                    hideHoverTimerRef.current = null;
                    setIsHovered(false);
                }, 2000);
            }}
            onContextMenu={(e) =>
                showBlockContextMenu(e, nodeModel.blockId, viewModel, nodeModel, waveEnv, tabModel.tabId, moveContext)
            }
        >
            {!useTermHeader && (
                <>
                    {preIconButton && <IconButton decl={preIconButton} className="block-frame-preicon-button" />}
                    <div className="block-frame-default-header-iconview">
                        {viewIconElem}
                        {metaFrameText && !hideViewName && <div className="block-frame-view-type"><span>{metaFrameText}</span></div>}
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
            <HeaderTextElems viewModel={viewModel} blockId={nodeModel.blockId} preview={preview} error={error} isHovered={isHovered} />
            <HeaderEndIcons
                viewModel={viewModel}
                nodeModel={nodeModel}
                blockId={nodeModel.blockId}
                moveContext={moveContext}
                isHovered={isHovered}
            />
            {/* Agent hover card - only show for agent blocks in GUI mode (TUI uses TermSessionTopBar) */}
            {isAgentBlock && (isHovered || isCardHovered) && (
                <div
                    className="agent-hover-card-wrapper"
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 100,
                        marginTop: 2,
                    }}
                    onMouseEnter={() => {
                        cancelPendingHideCard();
                        setIsCardHovered(true);
                    }}
                    onMouseLeave={() => {
                        cancelPendingHideCard();
                        hideCardTimerRef.current = window.setTimeout(() => {
                            hideCardTimerRef.current = null;
                            setIsCardHovered(false);
                            setIsHovered(false);
                        }, 300);
                    }}
                >
                    <AgentHoverCard
                        blockId={nodeModel.blockId}
                        blockData={blockData ?? null}
                        mode="gui"
                    />
                </div>
            )}
        </div>
    );
};

export { BlockFrame_Header };
