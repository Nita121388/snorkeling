// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    blockViewToIcon,
    blockViewToName,
    getViewIconElem,
    OptMagnifyButton,
    renderHeaderElements,
} from "@/app/block/blockutil";
import { BlockInfoCard } from "@/app/block/block-info-card";
import { ConnectionButton } from "@/app/block/connectionbutton";
import { DurableSessionFlyover } from "@/app/block/durable-session-flyover";
import {
    claimInfoCard,
    InfoCardPinProvider,
    isInAttachedInfoCardLayer,
    isInfoCardClaimedBy,
    releaseInfoCard,
    subscribeInfoCard,
    useInfoCardDismiss,
} from "@/app/element/info-card";
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
import { NewTabRowKey, TabRowAction, TabTargetModal } from "@/app/tab/tab-target-modal";
import { canOpenAgentFolder, openAgentFolderInCurrentTab } from "@/app/view/term/agent-folder";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import { isAgentCardMeta } from "@/app/block/block-info-card-meta";
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
import { useHeaderHoverLatch } from "./use-header-hover-latch";
import { planHeaderIcons, type HeaderIconScene } from "./header-icon-plan";

export type MoveBlockMenuContext = {
    currentTabId: string;
    sourceTabName: string;
    workspace: Workspace;
    /** 打开统一的「Move to Tab…」弹窗（选择已有 + 新建，动作在弹窗内选）。 */
    onOpenMoveModal: () => void;
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
    // 一条入口。历史上有 4 条（Move/Copy × New/Existing）：两条「新建」立刻执行、tab 名字不可见，
    // 两条「选择」才开弹窗而弹窗自己不能新建。收敛后由弹窗同时承担「选已有」与「建新的」，
    // 动作（Move / Copy）也在弹窗内按行选 —— 菜单层不再分叉。
    // blockEnv 保留在签名里是为了不动所有调用点（覆盖各 view 右键 / header ⋯ / 框右键）。
    void blockId;
    void blockEnv;
    return [{ label: "Move to Tab…", click: () => moveContext.onOpenMoveModal() }];
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

type HeaderIconGroup = "start" | "reveal" | "pinned";

/** 一条 header icon 记录：`key` 给 plan 用，`node` 是已构造好的元素。 */
type HeaderIconItem = {
    key: string;
    group: HeaderIconGroup;
    node: React.ReactElement;
    priority: number;
    neverOverflow: boolean;
};

function iconItem(
    key: string,
    decl: IconButtonDecl | null,
    group: HeaderIconGroup,
    node: React.ReactElement,
    neverOverflow = false
): HeaderIconItem {
    return {
        key,
        group,
        node,
        priority: decl?.priority ?? 0,
        neverOverflow: neverOverflow || decl?.neverOverflow === true,
    };
}

type HeaderEndIconsProps = {
    viewModel: ViewModel;
    nodeModel: NodeModel;
    blockId: string;
    moveContext?: MoveBlockMenuContext;
    isHovered: boolean;
    /** 当前锁存方向；null = 两侧都不展开。 */
    latchedZone?: "left" | "right" | null;
    /** header 当前宽度（px），由父级 ResizeObserver 维护。 */
    headerWidth?: number;
};

const HeaderEndIcons = React.memo(
    ({
        viewModel,
        nodeModel,
        blockId,
        moveContext,
        isHovered,
        latchedZone,
        headerWidth = 0,
    }: HeaderEndIconsProps) => {
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

    // 三组 item：start（左组）/ reveal（右组）/ pinned（常驻）。
    // 「放在哪个容器」由 group 决定；「是否可见」由 plan() + data-latched 决定。
    const startElems: HeaderIconItem[] = [];
    const revealElems: HeaderIconItem[] = [];
    const pinnedElems: HeaderIconItem[] = [];

    const startIconButtons = util.useAtomValueSafe(viewModel?.startIconButtons);
    if (startIconButtons && startIconButtons.length > 0) {
        startIconButtons.forEach((button, idx) => {
            startElems.push(
                iconItem("start-" + idx, button, "start", <IconButton decl={button} className="hdr-icon" />)
            );
        });
    }
    if (endIconButtons && endIconButtons.length > 0) {
        endIconButtons.forEach((button, idx) => {
            const group: HeaderIconGroup =
                button.zone === "pinned" ? "pinned" : button.zone === "start" ? "start" : "reveal";
            const item = iconItem(
                "end-" + idx,
                button,
                group,
                <IconButton decl={button} className={resolveZoneClass(button)} />
            );
            (group === "pinned" ? pinnedElems : group === "start" ? startElems : revealElems).push(item);
        });
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
        revealElems.push(iconItem("split-horizontal", splitHorizontalDecl, "reveal", <IconButton decl={splitHorizontalDecl} className="end-icon-reveal" />));
        revealElems.push(iconItem("split-vertical", splitVerticalDecl, "reveal", <IconButton decl={splitVerticalDecl} className="end-icon-reveal" />));
    }
    // 「…」是窄块下唯一的逃生通道：标 neverOverflow，任何宽度都留在 header。
    // 它自己就是溢出容器，不允许再被收进溢出（否则整条通道消失）。
    // click 在渲染层被覆盖：有隐藏项时先弹隐藏项，否则回落块右键菜单。
    const moreDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "ellipsis",
        title: "More",
        zone: "reveal",
        neverOverflow: true,
        click: (e) => showBlockContextMenu(e, blockId, viewModel, nodeModel, blockEnv, tabModel.tabId, moveContext),
    };
    revealElems.push(iconItem("more", moreDecl, "reveal", <IconButton decl={moreDecl} className="block-frame-settings end-icon-reveal" />, true));
    if (isNoteBlock && (minimizedPreview || ephemeral)) {
        revealElems.push(
            iconItem("collapse-note-preview", null, "reveal",
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
            )
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
        revealElems.push(iconItem("restore-minimized", restoreDecl, "reveal", <IconButton decl={restoreDecl} className="end-icon-reveal" />));
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
        revealElems.push(iconItem("add-to-layout", addToLayoutDecl, "reveal", <IconButton decl={addToLayoutDecl} className="end-icon-reveal" />));
    } else {
        revealElems.push(
            iconItem("unmagnify", null, "reveal",
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
            )
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
        revealElems.push(iconItem("inline-tab-minimize", inlineMinimizeDecl, "reveal", <IconButton decl={inlineMinimizeDecl} className="end-icon-reveal" />));
    }

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: minimizedPreview ? "Close Preview" : "Close",
        zone: "pinned",
        click: () =>
            minimizedPreview ? nodeModel.onClose() : util.fireAndForget(() => uxCloseBlock(nodeModel.blockId)),
    };
    pinnedElems.push(iconItem("close", closeDecl, "pinned", <IconButton decl={closeDecl} className="block-frame-default-close end-icon-pinned" />, true));

    // ── 按 plan 决定「哪些留在 header」────────────────────────────
    // 宽度取 header 根节点的实际宽度（由 ResizeObserver 维持）。plan 是纯函数，
    // 保证 shown + hidden === total，所以任何宽度下都不会出现「被 overflow:hidden 硬切」。
    const scene: HeaderIconScene = {
        entries: [
            ...startElems.map((i) => ({
                key: i.key,
                group: "left" as const,
                priority: i.priority,
                neverOverflow: i.neverOverflow,
            })),
            ...revealElems.map((i) => ({
                key: i.key,
                group: "right" as const,
                priority: i.priority,
                neverOverflow: i.neverOverflow,
            })),
            ...pinnedElems.map((i) => ({
                key: i.key,
                group: "pinned" as const,
                priority: i.priority,
                neverOverflow: i.neverOverflow,
            })),
        ],
    };
    const plan = planHeaderIcons(headerWidth, latchedZone ?? null, scene);
    const shownSet = new Set(plan.shown);
    const total = scene.entries.length;

    // 未锁存时两侧都不展开（保持旧观感：仅 pinned 常驻 + 悬浮时 reveal 按 .is-hovered 显）。
    const idle = latchedZone == null;

    const renderGroup = (items: HeaderIconItem[], cls: string, overrideFor?: (key: string) => React.ReactElement | null) => {
        const visible = idle ? items : items.filter((i) => shownSet.has(i.key));
        if (visible.length === 0) return null;
        return (
            <div className={cn("hdr-icon-group", cls, idle && "is-idle")}>
                {visible.map((i) => (
                    <React.Fragment key={i.key}>{overrideFor?.(i.key) ?? i.node}</React.Fragment>
                ))}
            </div>
        );
    };

    // 「…」的双重职责：有隐藏项时弹“隐藏项列表”，否则回落块右键菜单。
    // 这样不需要新增第二个溢出按钮（复用一个入口，避免两个 … 并排）。
    const overflowCount = idle ? 0 : plan.hidden.length;
    const buildOverflowNode = (): React.ReactElement | null => {
        if (overflowCount === 0) return null;
        const hiddenSet = new Set(plan.hidden);
        const menu: ContextMenuItem[] = [];
        let realItems = 0;
        const pushFor = (items: HeaderIconItem[], label: string) => {
            const hit = items.filter((i) => hiddenSet.has(i.key));
            if (hit.length === 0) return;
            if (realItems > 0) menu.push({ type: "separator" });
            for (const i of hit) {
                const decl = (i.node as React.ReactElement<{ decl?: IconButtonDecl }>).props?.decl;
                if (decl == null) continue; // OptMagnifyButton 等非 decl 节点不进菜单
                menu.push({
                    label: `${label} · ${decl.title ?? i.key}`,
                    click: () => decl.click?.(undefined as unknown as React.MouseEvent<any>),
                    enabled: decl.disabled !== true,
                });
                realItems += 1;
            }
        };
        pushFor(startElems, "L");
        pushFor(revealElems, "R");
        pushFor(pinnedElems, "P");
        const overflowDecl: IconButtonDecl = {
            ...moreDecl,
            title: realItems > 0 ? `More (${realItems} hidden)` : "More",
            click: (e) => {
                if (realItems === 0) {
                    // 没有可弹的隐藏项（或全是非 decl 节点）：回落块右键菜单。
                    showBlockContextMenu(e, blockId, viewModel, nodeModel, blockEnv, tabModel.tabId, moveContext);
                    return;
                }
                blockEnv.showContextMenu(menu, e);
            },
        };
        return <IconButton key="more" decl={overflowDecl} className="block-frame-settings end-icon-reveal" />;
    };

    return (
        <div
            className={cn("block-frame-end-icons", isHovered && "is-hovered")}
            data-header-total={total}
            data-header-tier={plan.tier}
            data-header-yield={plan.yieldLeft ? "1" : "0"}
        >
            {renderGroup(startElems, "hdr-group-start")}
            {renderGroup(revealElems, "hdr-group-reveal", (key) => (key === "more" ? buildOverflowNode() : null))}
            {renderGroup(pinnedElems, "hdr-group-pinned")}
        </div>
    );
});
HeaderEndIcons.displayName = "HeaderEndIcons";

type MoveBlockToTabModalProps = {
    blockId: string;
    currentTabId: string;
    workspace: Workspace;
    sourceTabName: string;
    onClose: () => void;
    onMoved: (targetTabId: string) => void;
    onCopied: (targetTabId: string, blockId: string) => void;
};

/**
 * 「把 block 送到某个 tab」的唯一弹窗。
 *
 * 没有 Move / Copy 模式状态 —— 每行两个图标（→ Move / ⧉ Copy），点哪个就是哪个动作；
 * 点行体 = Move（快路径）。New tab 行置顶且永远可用，动作走同一个图标对
 * （后端 `MoveBlockToNewTab` / `CopyBlockToNewTab`）。
 */
const MoveBlockToTabModal = React.memo(
    ({ blockId, currentTabId, workspace, sourceTabName, onClose, onMoved, onCopied }: MoveBlockToTabModalProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();

        const runMove = React.useCallback(
            async (targetTabId: string) => {
                if (targetTabId === NewTabRowKey) {
                    const createdTabId = await waveEnv.services.object.MoveBlockToNewTab(blockId, sourceTabName);
                    onMoved(createdTabId);
                    return;
                }
                await waveEnv.services.object.MoveBlockToTab(blockId, targetTabId, false);
                onMoved(targetTabId);
            },
            [waveEnv, blockId, sourceTabName, onMoved]
        );

        const runCopy = React.useCallback(
            async (targetTabId: string) => {
                if (targetTabId === NewTabRowKey) {
                    const result = await waveEnv.services.object.CopyBlockToNewTab(blockId, sourceTabName);
                    onCopied(result.tabid, result.blockid);
                    return;
                }
                const newBlockId = await waveEnv.services.object.CopyBlockToTab(blockId, targetTabId, false);
                onCopied(targetTabId, newBlockId);
            },
            [waveEnv, blockId, sourceTabName, onCopied]
        );

        const rowActions = React.useMemo<TabRowAction[]>(
            () => [
                {
                    key: "move",
                    label: `Move block to «${sourceTabName}» target tab`,
                    icon: <i className={makeIconClass("arrow-right", true)} />,
                    primary: true,
                    run: ({ targetTabId }) => runMove(targetTabId),
                },
                {
                    key: "copy",
                    label: `Copy block to «${sourceTabName}» target tab`,
                    icon: <i className={makeIconClass("clone", true)} />,
                    run: ({ targetTabId }) => runCopy(targetTabId),
                },
            ],
            [sourceTabName, runMove, runCopy]
        );

        return (
            <TabTargetModal
                workspace={workspace}
                currentTabId={currentTabId}
                title="Move Block"
                subtitle={`↳ from «${sourceTabName}»`}
                actionLabel="Move"
                workingLabel="Moving..."
                onClose={onClose}
                onSelect={async () => {}}
                onCreate={async () => {
                    await runMove(NewTabRowKey);
                }}
                createHint={`Named after «${sourceTabName}»`}
                rowActions={rowActions}
            />
        );
    }
);
MoveBlockToTabModal.displayName = "MoveBlockToTabModal";

export function useBlockMoveMenu(nodeModel: NodeModel, viewModel: ViewModel, preview: boolean): BlockMoveMenuState {
    const waveEnv = useWaveEnv<BlockEnv>();
    const tabModel = useTabModel();
    const workspace = jotai.useAtomValue(waveEnv.atoms.workspace);
    const [moveModalOpen, setMoveModalOpen] = React.useState(false);
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
                      onOpenMoveModal: () => setMoveModalOpen(true),
                      onMoved: handleMoved,
                      onCopied: handleCopied,
                  }
                : null,
        [preview, workspace, tabModel.tabId, sourceTabName, handleMoved, handleCopied]
    );

    const moveTabModal =
        moveModalOpen && moveContext ? (
            <MoveBlockToTabModal
                blockId={nodeModel.blockId}
                currentTabId={moveContext.currentTabId}
                workspace={moveContext.workspace}
                sourceTabName={moveContext.sourceTabName}
                onClose={() => setMoveModalOpen(false)}
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
    // 会话类 block（term agent / 会话详情 / GUI Chat）都需要悬浮卡；
    // 判定收紧后的行为等价：不命中分派器时 BlockInfoCard 返回 null，不制造空卡片。
    const isAgentBlock = isAgentCardMeta(blockData?.meta as Record<string, unknown> | undefined);
    viewName = metaFrameTitle ?? viewName;
    viewIconUnion = metaFrameIcon ?? viewIconUnion;
    const [isHovered, setIsHovered] = React.useState(false);
    // 卡片可见性独立于 header hover 高亮：header 高亮有 2000ms 延迟（给图标看），
    // 卡片不能跟着挂 2 秒 —— 指针离开 header 后卡片应在 300ms 内收起。
    const [isCardOpen, setIsCardOpen] = React.useState(false);
    // 本 header 在全局独占悬浮卡管理器中的唯一 token。
    const claimTokenRef = React.useRef<symbol>(Symbol("blockframe-header-card"));
    const hideHoverTimerRef = React.useRef<number | null>(null);
    const hideCardTimerRef = React.useRef<number | null>(null);
    const cardFocusRef = React.useRef(false);
    /** 附属浮层（属性值下拉等 portal 到 body 的浮层）的 pin 计数：> 0 时不因 hover/失焦收卡。 */
    const cardPinCountRef = React.useRef(0);
    // 卡片容器（用于「点击外侧」包含判定；header 元素由它 closest 得到）。
    const cardElRef = React.useRef<HTMLDivElement | null>(null);
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
    const scheduleHideCard = React.useCallback(() => {
        cancelPendingHideCard();
        hideCardTimerRef.current = window.setTimeout(() => {
            hideCardTimerRef.current = null;
            // 定时器挂起期间可能已被钉住（浮层刚打开 / 焦点进卡片），到期时再确认一次。
            if (cardFocusRef.current || cardPinCountRef.current > 0) {
                return;
            }
            cardFocusRef.current = false;
            setIsCardOpen(false);
        }, 300);
    }, [cancelPendingHideCard]);
    const closeCardNow = React.useCallback(() => {
        cancelPendingHideCard();
        cardFocusRef.current = false;
        cardPinCountRef.current = 0;
        setIsCardOpen(false);
    }, [cancelPendingHideCard]);

    // 附属浮层（portal 到 body 的属性值浮层）保活：打开即 pin，关闭即 release。
    const pinCard = React.useCallback(() => {
        cardPinCountRef.current += 1;
        cancelPendingHideCard();
        claimInfoCard(claimTokenRef.current);
        setIsCardOpen(true);
    }, [cancelPendingHideCard]);
    const releaseCardPin = React.useCallback(() => {
        cardPinCountRef.current = Math.max(0, cardPinCountRef.current - 1);
        if (cardPinCountRef.current > 0) {
            return;
        }
        // 浮层关掉了：焦点不在卡内、指针也不在卡上时，按常规延迟收起。
        if (cardFocusRef.current || cardElRef.current?.matches(":hover")) {
            return;
        }
        scheduleHideCard();
    }, [scheduleHideCard]);
    // 点击外侧关闭：卡片容器是 header 的直接子节点，两者任一包含点击目标都算「内部」；
    // 附属浮层（portal 到 body 的属性值浮层）也算内部，否则在浮层里点选项会把卡片关掉。
    const isInsideCardOrHeader = React.useCallback((target: Node) => {
        if (isInAttachedInfoCardLayer(target)) {
            return true;
        }
        const cardEl = cardElRef.current;
        if (cardEl == null) {
            return false;
        }
        if (cardEl.contains(target)) {
            return true;
        }
        return cardEl.closest(".block-frame-default-header")?.contains(target) ?? false;
    }, []);
    useInfoCardDismiss({
        isOpen: isAgentBlock && isCardOpen,
        isInside: isInsideCardOrHeader,
        onDismiss: closeCardNow,
    });

    React.useEffect(() => () => {
        cancelPendingHideHover();
        cancelPendingHideCard();
    }, [cancelPendingHideHover, cancelPendingHideCard]);

    // 被全局独占管理器顶掉时, 立即关闭本 header 的卡片与高亮(跳过隐藏延迟)。
    React.useEffect(() => {
        const unsubscribe = subscribeInfoCard(() => {
            if (!isInfoCardClaimedBy(claimTokenRef.current)) {
                closeCardNow();
                setIsHovered(false);
            }
        });
        return () => {
            unsubscribe();
            releaseInfoCard(claimTokenRef.current);
        };
    }, [closeCardNow]);

    React.useEffect(() => {
        if (magnified && !preview && !prevMagifiedState.current) {
            waveEnv.rpc.ActivityCommand(TabRpcClient, { nummagnify: 1 });
            recordTEvent("action:magnify", { "block:view": viewName });
        }
        prevMagifiedState.current = magnified;
    }, [magnified]);

    const viewIconElem = getViewIconElem(viewIconUnion, iconColor);

    // 悬停分区锁存。与 isHovered 完全独立（后者管 reveal 显隐 + 悬浮卡，一行不改）。
    // 溢出菜单 / 浮层是 portal，挂载晚于 hook 初始化，所以用 ref + getter 延迟求值。
    const attachedLayerRef = React.useRef<HTMLDivElement | null>(null);
    const getAttachedEls = React.useCallback(() => [attachedLayerRef.current], []);
    const hoverLatchEnabled = jotai.useAtomValue(waveEnv.getSettingsKeyAtom("block:headersplitreveal")) ?? true;
    const hoverGraceRaw = jotai.useAtomValue(waveEnv.getSettingsKeyAtom("block:headerhovergrace"));
    const hoverLatch = useHeaderHoverLatch(hoverLatchEnabled, hoverGraceRaw, getAttachedEls);

    // header 实际宽度：plan() 的唯一输入。用 ResizeObserver 而非每次 render 读 DOM，
    // 避免布局抖动与强制同步布局。
    const headerElRef = React.useRef<HTMLDivElement | null>(null);
    const [headerWidth, setHeaderWidth] = React.useState(0);
    React.useEffect(() => {
        const el = headerElRef.current;
        if (el == null || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width;
            if (typeof w === "number") setHeaderWidth(w);
        });
        ro.observe(el);
        setHeaderWidth(el.getBoundingClientRect().width);
        return () => ro.disconnect();
    }, []);

    // dragHandleRef 是外部传入的 RefObject（拖拽用），不能直接覆盖；
    // 用回调 ref 同时写两边：自己的宽度测量 + 外部拖拽句柄。
    const setHeaderRef = React.useCallback(
        (el: HTMLDivElement | null) => {
            headerElRef.current = el;
            if (dragHandleRef != null) {
                (dragHandleRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }
        },
        [dragHandleRef]
    );

    return (
        <div
            className={cn("block-frame-default-header", useTermHeader && "!pl-[2px]")}
            data-role="block-header"
            data-latched={hoverLatch.latch.zone ?? ""}
            ref={setHeaderRef}
            onPointerEnter={(e) => {
                cancelPendingHideHover();
                cancelPendingHideCard();
                claimInfoCard(claimTokenRef.current);
                setIsHovered(true);
                setIsCardOpen(true);
                hoverLatch.onPointerEnter(e);
            }}
            onPointerLeave={(e) => {
                cancelPendingHideHover();
                hideHoverTimerRef.current = window.setTimeout(() => {
                    hideHoverTimerRef.current = null;
                    setIsHovered(false);
                }, 2000);
                // 卡片不跟 header 高亮一起等 2s：指针离开 header 后 300ms 收起。
                // 指针进了卡片时，卡片自己的 mouseenter 会 cancel 掉这个定时器；
                // 卡片内有焦点（正在写 note）或附属浮层开着时保持打开，交给失焦/点击外侧关闭。
                if (!cardFocusRef.current && cardPinCountRef.current === 0) {
                    scheduleHideCard();
                }
                hoverLatch.onPointerLeave(e);
            }}
            onContextMenu={(e) =>
                showBlockContextMenu(e, nodeModel.blockId, viewModel, nodeModel, waveEnv, tabModel.tabId, moveContext)
            }
        >
            {/* 左区：右锁时整体收起让位（chevron + 路径），类型图标保留。
                useTermHeader 分支不进左区（term 有自己的排布，不改）。 */}
            <div className="block-frame-header-left-zone">
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
            </div>
            <HeaderEndIcons
                viewModel={viewModel}
                nodeModel={nodeModel}
                blockId={nodeModel.blockId}
                moveContext={moveContext}
                isHovered={isHovered}
                latchedZone={hoverLatch.latch.zone}
                headerWidth={headerWidth}
            />
            {/* Agent/Note hover card - 经 BlockInfoCard 分派（GUI 模式；TUI 用 TermAgentSessionRail） */}
            {isAgentBlock && isCardOpen && (
                <div
                    ref={cardElRef}
                    className="info-card-portal"
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 100,
                        marginTop: 2,
                    }}
                    onMouseEnter={() => {
                        cancelPendingHideCard();
                        claimInfoCard(claimTokenRef.current);
                        setIsCardOpen(true);
                    }}
                    onFocusCapture={() => {
                        // 卡片内有焦点 = 钉住：鼠标移开也不关（note 编辑不被打断）。
                        cardFocusRef.current = true;
                        cancelPendingHideCard();
                        claimInfoCard(claimTokenRef.current);
                        setIsCardOpen(true);
                    }}
                    onBlurCapture={(event) => {
                        if (event.relatedTarget instanceof Node) {
                            // 附属浮层也是“卡内”：焦点从卡片走进浮层，不算离开。
                            if (
                                event.currentTarget.contains(event.relatedTarget) ||
                                isInAttachedInfoCardLayer(event.relatedTarget)
                            ) {
                                return;
                            }
                        }
                        cardFocusRef.current = false;
                        // 指针还在卡片上就先不关，等 mouseleave；否则焦点走了就该收卡。
                        if (cardElRef.current?.matches(":hover")) {
                            return;
                        }
                        scheduleHideCard();
                    }}
                    onMouseLeave={() => {
                        cancelPendingHideCard();
                        // 钉住期间（焦点在卡片内 / 附属浮层开着）不因鼠标移开而关闭；
                        // 由「点击外侧」或失焦负责关闭。
                        if (cardFocusRef.current || cardPinCountRef.current > 0) {
                            return;
                        }
                        scheduleHideCard();
                    }}
                >
                    <InfoCardPinProvider pin={pinCard} release={releaseCardPin}>
                        {BlockInfoCard({ blockId: nodeModel.blockId, blockData: blockData ?? null, mode: "gui" })}
                    </InfoCardPinProvider>
                </div>
            )}
        </div>
    );
};

export { BlockFrame_Header };
