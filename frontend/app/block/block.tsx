// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    BlockComponentModel2,
    BlockProps,
    FullBlockProps,
    FullSubBlockProps,
    SubBlockProps,
} from "@/app/block/blocktypes";
import { Tooltip } from "@/app/element/tooltip";
import { uxCloseBlock } from "@/app/store/keymodel";
import { BlockLockMetaKey, buildInlineTabContextMenu } from "@/app/block/inlinetab-contextmenu";
import { useTabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getAgentLogoByProvider } from "@/app/view/term/agent-logo";
import { isAgentTerminalMeta, normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import {
    agentStatusPresentation,
    isInferredAgentStatus,
} from "@/app/agent-status/agent-status-derive";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread } from "@/app/agent-status/agent-status-unread";
import { agentDoneElapsedMs, formatDoneElapsed, isAgentDoneUnread } from "@/app/agent-status/agent-status-done-unread";
import { agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import type { LayoutNode } from "@/layout/index";
import { getLayoutModelForTabById, TileItemType, useDebouncedNodeInnerRect } from "@/layout/index";
import {
    getLayoutDataActiveBlockId,
    getLayoutDataBlockIds,
    InlineTabDragItem,
    InlineTabDragItemType,
    InlineTabDropResult,
} from "@/layout/lib/inlineTabs";
import { counterInc } from "@/store/counters";
import { getBlockComponentModel, registerBlockComponentModel, unregisterBlockComponentModel } from "@/store/global";
import { makeORef } from "@/store/wos";
import { focusedBlockId, getElemAsStr } from "@/util/focusutil";
import { isBlank, makeIconClass, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import type { Atom } from "jotai";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import {
    getInlineTabRuntimeOpts,
    getRemainingInlineTabBlockIds,
    isConfirmedMissingInlineTabBlock,
    shouldWarmupInlineTabController,
} from "./block-recovery";
import "./block.scss";
import { BlockEnv } from "./blockenv";
import { BlockFrame } from "./blockframe";
import { makeViewModel } from "./blockregistry";
import { blockViewToIcon, blockViewToName } from "./blockutil";

/**
 * 读取 InlineTabLabel 所属 agent block 的 canonical agent status.
 *
 * 旧实现直接复用 TermViewModel.agentStatusAtom, 但 InlineTabBlock 只渲染 active 子 block,
 * 切走的 tab 的 ViewModel 被 dispose, atom 消失 → 非激活 tab 状态点不显示.
 * 现改用全局 AgentStatusStore: 它对每个 blockId 自带一份 GetAgentStatus + agentstatus 事件订阅,
 * 生命周期与 ViewModel 解耦. 通过 acquire/release 引用计数管理订阅, 关闭的 block 释放订阅.
 *
 * 仍复用已有 TermViewModel 那条订阅的 active 块: 它本身行为不变 (term-model.ts 自带一份 atom),
 * 这里仅用于补齐非激活 tab 的状态来源.
 */
function useInlineTabAgentStatus(blockId: string): AgentStatus | null {
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = useState<Atom<AgentStatus | null> | Atom<Promise<AgentStatus | null>> | null>(null);
    useEffect(() => {
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => {
            store.release(blockId);
        };
    }, [store, blockId]);
    return useAtomValueSafe(statusAtom);
}

function getViewElem(
    blockId: string,
    blockRef: React.RefObject<HTMLDivElement>,
    contentRef: React.RefObject<HTMLDivElement>,
    blockView: string,
    viewModel: ViewModel
): React.ReactElement {
    if (isBlank(blockView)) {
        return <CenteredDiv>No View</CenteredDiv>;
    }
    if (viewModel.viewComponent == null) {
        return <CenteredDiv>No View Component</CenteredDiv>;
    }
    const VC = viewModel.viewComponent;
    return <VC key={blockId} blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={viewModel} />;
}

function basename(path: string): string {
    if (isBlank(path)) {
        return "";
    }
    // 兼容 Windows 反斜杠路径,统一按 POSIX 风格切分
    const posixPath = path.replace(/\\/g, "/");
    const normalized = posixPath.endsWith("/") && posixPath.length > 1 ? posixPath.slice(0, -1) : posixPath;
    return normalized.split("/").pop() || normalized;
}

function getElementDimensions(element: HTMLElement): Dimensions | undefined {
    if (!element) {
        return;
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

type InlineTabLabelProps = {
    nodeId: string;
    blockId: string;
    allBlockIds: string[];
    layoutData: TabLayoutData;
    isActive: boolean;
    duplicateIndex?: number;
    index: number;
    onActivate: () => void;
    onClose: () => void;
    onCloseOthers: () => void;
    onCloseOthersExceptLocked: () => void;
    onCloseAll: () => void;
    onCloseAllExceptLocked: () => void;
    lockedBlockIds: Set<string>;
    onRename: (title: string) => void;
    onReorder: (dragBlockId: string, hoverIndex: number) => void;
    onDragEnd: () => void;
    sourceStripRef: React.RefObject<HTMLDivElement>;
};

const InlineTabLabel = memo(
    ({
        nodeId,
        blockId,
        allBlockIds,
        layoutData,
        isActive,
        duplicateIndex,
        index,
        onActivate,
        onClose,
        onCloseOthers,
        onCloseOthersExceptLocked,
        onCloseAll,
        onCloseAllExceptLocked,
        lockedBlockIds,
        onRename,
        onReorder,
        onDragEnd,
        sourceStripRef,
    }: InlineTabLabelProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const blockData = useAtomValue(waveEnv.wos.getWaveObjectAtom<Block>(makeORef("block", blockId)));
        const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "view")) ?? "";
        const frameTitle = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "frame:title"));
        const filePath = typeof blockData?.meta?.["file"] === "string" ? blockData.meta["file"] : "";
        const connection = useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "connection"));
        const customTitle = layoutData.blockTabTitles?.[blockId];
        const [isEditing, setIsEditing] = useState(false);
        const [draftTitle, setDraftTitle] = useState(customTitle ?? "");
        const inputRef = useRef<HTMLInputElement>(null);
        const tabRef = useRef<HTMLDivElement>(null);
        const isLocked = ((blockData?.meta ?? {}) as Record<string, unknown>)[BlockLockMetaKey] === true;
        const toggleLock = useCallback(() => {
            void RpcApi.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", blockId),
                meta: { [BlockLockMetaKey]: isLocked ? null : true } as unknown as MetaType,
            }).catch((e) => console.warn("failed to toggle block lock", e));
        }, [blockId, isLocked]);

        const defaultTitle = useMemo(() => {
            if (!isBlank(frameTitle)) {
                return frameTitle;
            }
            // agent 类 Block: 显示项目文件夹最后一段名(本地); 远端拼 connection
            const agentMeta = isAgentTerminalMeta(blockData?.meta) ? blockData?.meta : null;
            if (agentMeta != null) {
                const cwd = typeof agentMeta?.["cmd:cwd"] === "string" ? agentMeta["cmd:cwd"] : "";
                const folderName = basename(cwd);
                if (!isBlank(folderName)) {
                    return isBlank(connection) ? folderName : `${folderName} · ${connection}`;
                }
            }
            if (blockView === "preview" && !isBlank(filePath)) {
                return basename(filePath);
            }
            if (blockView === "term" && !isBlank(connection)) {
                return connection;
            }
            return blockViewToName(blockView) || blockId.slice(0, 8);
        }, [blockId, blockView, connection, filePath, frameTitle, blockData?.meta]);
        // 完整路径(供 hover tooltip 用): 仅 preview 读 meta.file, agent/term 读 cmd:cwd, 远端附 connection
        const fullPath = useMemo(() => {
            const agentMeta = isAgentTerminalMeta(blockData?.meta) ? blockData?.meta : null;
            if (agentMeta != null) {
                const cwd = typeof agentMeta?.["cmd:cwd"] === "string" ? agentMeta["cmd:cwd"] : "";
                return isBlank(cwd) ? "" : isBlank(connection) ? cwd : `${cwd} · ${connection}`;
            }
            if (blockView === "preview" && !isBlank(filePath)) {
                return isBlank(connection) ? filePath : `${filePath} · ${connection}`;
            }
            return "";
        }, [blockId, blockView, connection, filePath, blockData?.meta]);
        const title = customTitle || defaultTitle;
        // hover tooltip: 优先展示完整路径(包含远程 connection 后缀); 用户已重命名时附 defaultTitle 表明归属
        const tooltip = useMemo(() => {
            if (!isBlank(fullPath)) {
                return customTitle ? `${customTitle} (${fullPath})` : fullPath;
            }
            return customTitle ? `${customTitle} (${defaultTitle})` : defaultTitle;
        }, [customTitle, defaultTitle, fullPath]);
        const displayTitle =
            duplicateIndex != null && duplicateIndex > 1 && !customTitle ? `${title} ${duplicateIndex}` : title;
        const iconClass = makeIconClass(blockViewToIcon(blockView), true);
        // agent 类 Block: Tab 标签上显示对应 agent 的品牌 logo 而不是通用 terminal 图标
        const agentLogo = useMemo(() => {
            const meta = blockData?.meta;
            if (!isAgentTerminalMeta(meta)) return null;
            const provider = normalizeAgentProvider(meta?.["agent:provider"]);
            if (provider === "agent") return null;
            return getAgentLogoByProvider(provider);
        }, [blockData?.meta]);

        // 读取该 agent block 的 canonical status (复用 TermViewModel 已经订阅好的 atom),
        // 用于在 Tab 标签右侧渲染状态点. R 类 (working/blocked) 显眼状态点亮; 22 号方案新增
        // D 类 (非 idle → idle 跳变后未阅) 同样点亮, 用绿色呼吸表达"刚跑完可来看结果".
        // idle/unknown 默认不点亮, 但 D 触发后会以 is-done-unread 视觉盖过 is-idle 的灰蓝.
        const agentStatus = useInlineTabAgentStatus(blockId);
        // 与 Session Overview chip / term header pill 共享同一份 fingerprint atom
        // (SessionOverviewModel 单例上的 agentStatusAckedFpAtom), 任一 surface 点击
        // markAgentStatusAcked 时所有 surface 同帧 re-derive, 三处已读状态天然联动.
        // idle/unknown 不算 unread (isAgentStatusUnread 已处理).
        const overviewModel = SessionOverviewModel.getInstance();
        const ackedFpMap = useAtomValueSafe(overviewModel.agentStatusAckedFpAtom) ?? {};
        // D 类 done ack 走 agent-status 自有通道 (决策 6B), 与 R ack map 平行, 仅由 A 头部点击写入
        // (决策 2A) — 这里只读不写, B 处点击只 ack R (19 号方案既有行为), D 必须切回 block 点 A.
        const doneAckedAtMap = useAtomValueSafe(agentStatusDoneAckStore.doneAckedAtAtom) ?? {};
        const statusDot = useMemo(() => {
            if (agentStatus == null) return null;
            const state = agentStatus.state;
            const ackedFp = ackedFpMap[blockId] ?? null;
            const unread = isAgentStatusUnread(agentStatus, ackedFp);
            const doneAckedAt = doneAckedAtMap[blockId] ?? 0;
            const doneUnread = isAgentDoneUnread(agentStatus, doneAckedAt);
            // 22 号方案明确: idle/unknown 默认不渲染 R 状态点减噪; 但 D 触发后即便 state=idle,
            // 因 doneUnread=true 也要点亮. 否则进入"开局即 idle 不亮"分支会把 D 也误吞.
            if ((state === "idle" || state === "unknown") && !doneUnread) return null;
            const presentation = agentStatusPresentation(agentStatus);
            const inferred = isInferredAgentStatus(agentStatus);
            const doneElapsedMs = doneUnread ? agentDoneElapsedMs(agentStatus, Date.now()) : 0;
            const doneElapsedText = doneUnread ? formatDoneElapsed(doneElapsedMs) : "";
            return {
                state,
                inferred,
                unread,
                doneUnread,
                doneElapsedText,
                title: `${presentation.label}${inferred ? " (inferred)" : ""}${
                    unread ? " — click to mark as read" : doneUnread ? ` — done ${doneElapsedText} ago, switch to block to dismiss` : " — up to date"
                }`,
            };
        }, [agentStatus, ackedFpMap, doneAckedAtMap, blockId]);

        useEffect(() => {
            if (isEditing) {
                setDraftTitle(customTitle ?? "");
                inputRef.current?.select();
            }
        }, [customTitle, isEditing]);

        const commitRename = useCallback(() => {
            setIsEditing(false);
            onRename(draftTitle);
        }, [draftTitle, onRename]);

        const [{ isDragging }, dragInlineTab] = useDrag<
            InlineTabDragItem,
            InlineTabDropResult,
            { isDragging: boolean }
        >(
            () => ({
                type: InlineTabDragItemType,
                item: () => ({
                    sourceNodeId: nodeId,
                    blockId,
                    sourceIndex: index,
                    origin: "tab-label",
                    sourceRect: getElementDimensions(sourceStripRef.current),
                }),
                collect: (monitor) => ({
                    isDragging: monitor.isDragging(),
                }),
                end: onDragEnd,
            }),
            [blockId, index, nodeId, onDragEnd, sourceStripRef]
        );

        const [{ isOver }, dropInlineTab] = useDrop<InlineTabDragItem, InlineTabDropResult, { isOver: boolean }>(
            () => ({
                accept: InlineTabDragItemType,
                canDrop: (dragItem) => dragItem.sourceNodeId === nodeId && dragItem.origin === "tab-label",
                drop: (dragItem) => {
                    onReorder(dragItem.blockId, index);
                    return { action: "reorder" };
                },
                collect: (monitor) => ({
                    isOver: monitor.isOver() && monitor.canDrop(),
                }),
            }),
            [index, nodeId, onReorder]
        );

        dragInlineTab(dropInlineTab(tabRef));

        if (isEditing) {
            return (
                <input
                    ref={inputRef}
                    className="inline-tab-block-tab-input"
                    value={draftTitle}
                    placeholder={defaultTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            commitRename();
                        } else if (e.key === "Escape") {
                            setIsEditing(false);
                            setDraftTitle(customTitle ?? "");
                        }
                    }}
                />
            );
        }

        const handleContextMenu = useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = buildInlineTabContextMenu(
                    blockId,
                    allBlockIds,
                    lockedBlockIds,
                    onClose,
                    onCloseOthers,
                    onCloseOthersExceptLocked,
                    onCloseAll,
                    onCloseAllExceptLocked,
                    toggleLock,
                    waveEnv,
                );
                waveEnv.showContextMenu(menu, e);
            },
            [
                blockId,
                allBlockIds,
                lockedBlockIds,
                onClose,
                onCloseOthers,
                onCloseOthersExceptLocked,
                onCloseAll,
                onCloseAllExceptLocked,
                toggleLock,
                waveEnv,
            ],
        );

        return (
            <div
                ref={tabRef}
                onContextMenu={handleContextMenu}
                className={clsx("inline-tab-block-tab", {
                    active: isActive,
                    dragging: isDragging,
                    "drop-target": isOver,
                })}
            >
                <div className="inline-tab-block-tab-main-wrapper">
                    <Tooltip
                        content={
                            <div className="max-w-[420px] whitespace-pre-wrap break-words text-[11px] leading-4 text-secondary">
                                {tooltip}
                            </div>
                        }
                        placement="top"
                        openDelay={300}
                        disable={isBlank(tooltip)}
                        divClassName="inline-tab-block-tab-main"
                    >
                        <button
                            type="button"
                            className="inline-tab-block-tab-button"
                            onClick={onActivate}
                            onDoubleClick={() => setIsEditing(true)}
                            role="tab"
                            aria-selected={isActive}
                            aria-label={`Tab ${displayTitle}${isActive ? ", active" : ""}`}
                            tabIndex={isActive ? 0 : -1}
                        >
                            {agentLogo != null ? (
                                <span
                                    className="agent-brand-icon inline-tab-block-tab-agentlogo"
                                    style={agentLogo.iconColor != null ? { color: agentLogo.iconColor } : undefined}
                                >
                                    {agentLogo.icon}
                                </span>
                            ) : (
                                <i className={iconClass} />
                            )}
                            <span>{displayTitle}</span>
                            {isLocked ? (
                                <i
                                    className={makeIconClass("lock", true) + " inline-tab-block-tab-lockicon"}
                                    title="已锁定"
                                />
                            ) : null}
                            {statusDot != null ? (
                                <span
                                    className={clsx("inline-tab-block-tab-statusdot", `is-${statusDot.state}`, {
                                        "is-inferred": statusDot.inferred,
                                        "is-acked": !statusDot.unread && !statusDot.doneUnread,
                                        "is-done-unread": statusDot.doneUnread,
                                    })}
                                    data-elapsed={statusDot.doneUnread ? statusDot.doneElapsedText : undefined}
                                    // [DIAG] D 复活排查: 把 blockId 标进 dataset, 让 inspect 可以直接
                                    // 通过 DOM 读出 D 圆点对应哪个 block, 不再需要猜对应. 排查完后删除.
                                    data-blockid={statusDot.doneUnread ? blockId : undefined}
                                    title={statusDot.title}
                                    onClick={
                                        statusDot.unread || statusDot.doneUnread
                                            ? (e) => {
                                                  e.stopPropagation();
                                                  if (statusDot.unread) {
                                                      // Pass current status so R fingerprint is stored;
                                                      // otherwise read sites would still see unread.
                                                      overviewModel.markAgentStatusAcked(blockId, Date.now(), agentStatus);
                                                  }
                                                  if (statusDot.doneUnread) {
                                                      agentStatusDoneAckStore.markDoneAcked(blockId, Date.now(), "block-header");
                                                  }
                                              }
                                            : undefined
                                    }
                                >
                                    {statusDot.state === "done" ? <i className="fa-solid fa-check" /> : null}
                                </span>
                            ) : null}
                        </button>
                    </Tooltip>
                </div>
                <button
                    type="button"
                    className="inline-tab-block-tab-close"
                    title="Close Block"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose();
                    }}
                >
                    <i className={makeIconClass("xmark", true)} />
                </button>
            </div>
        );
    }
);
InlineTabLabel.displayName = "InlineTabLabel";

const InlineTabBlockMissingGuard = memo(
    ({ blockId, onMissingBlock }: { blockId: string; onMissingBlock: (blockId: string) => void }) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const blockRef = makeORef("block", blockId);
        const blockIsLoading = useAtomValue(waveEnv.wos.getWaveObjectLoadingAtom(blockRef));
        const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(blockRef));

        useEffect(() => {
            if (isConfirmedMissingInlineTabBlock(blockIsLoading, blockIsNull)) {
                onMissingBlock(blockId);
            }
        }, [blockId, blockIsLoading, blockIsNull, onMissingBlock]);

        return null;
    }
);
InlineTabBlockMissingGuard.displayName = "InlineTabBlockMissingGuard";

const InlineTabBlockControllerWarmup = memo(
    ({ active, blockId, preview, tabId }: { active: boolean; blockId: string; preview: boolean; tabId: string }) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const [blockData, blockIsLoading] = waveEnv.wos.useWaveObjectValue<Block>(makeORef("block", blockId));
        const blockExists = blockData != null;
        const blockView = blockData?.meta?.view ?? "";
        const controller = blockData?.meta?.controller ?? "";
        const connection = blockData?.meta?.connection ?? "";
        const connStatus = useAtomValue(waveEnv.getConnStatusAtom(connection));
        const connStatusType = connStatus?.status;
        const termRows = blockData?.runtimeopts?.termsize?.rows;
        const termCols = blockData?.runtimeopts?.termsize?.cols;

        useEffect(() => {
            if (
                !shouldWarmupInlineTabController({
                    active,
                    preview,
                    blockIsLoading,
                    blockExists,
                    blockView,
                    controller,
                })
            ) {
                return;
            }
            const rtOpts = getInlineTabRuntimeOpts(termRows, termCols);
            void RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: tabId,
                blockid: blockId,
                rtopts: rtOpts,
            }).catch((error) => console.log("error warming inline-tab controller", blockId, error));
        }, [
            active,
            blockExists,
            blockId,
            blockIsLoading,
            blockView,
            connection,
            connStatusType,
            controller,
            preview,
            tabId,
            termCols,
            termRows,
        ]);

        return null;
    }
);
InlineTabBlockControllerWarmup.displayName = "InlineTabBlockControllerWarmup";

function getDuplicateIndexes(blockIds: string[], titles: Record<string, string>): Map<string, number> {
    const counts = new Map<string, number>();
    const indexes = new Map<string, number>();
    for (const blockId of blockIds) {
        const title = titles[blockId] ?? blockId;
        const nextCount = (counts.get(title) ?? 0) + 1;
        counts.set(title, nextCount);
        indexes.set(blockId, nextCount);
    }
    return indexes;
}

const InlineTabBlock = memo(({ nodeModel, preview, layoutData }: BlockProps & { layoutData: TabLayoutData }) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const tabModel = useTabModel();
    const layoutModel = getLayoutModelForTabById(tabModel.tabId);
    const blockIds = getLayoutDataBlockIds(layoutData);
    const blockIdsKey = blockIds.join("\n");
    const activeBlockId = getLayoutDataActiveBlockId(layoutData) ?? blockIds[0];
    const fallbackTabStripRef = useRef<HTMLDivElement>(null);
    const tabStripRef = nodeModel.dragHandleRef ?? fallbackTabStripRef;
    const activeBlockDragHandleRef = useRef<HTMLDivElement>(null);
    const activeLayoutDataAtom = useMemo(() => atom<TabLayoutData>(layoutData), [layoutData]);
    const activeNodeModel = useMemo(
        () => ({
            ...nodeModel,
            blockId: activeBlockId,
            layoutData: activeLayoutDataAtom,
            dragHandleRef: blockIds.length > 1 ? activeBlockDragHandleRef : nodeModel.dragHandleRef,
        }),
        [activeBlockId, activeLayoutDataAtom, blockIds.length, nodeModel]
    );
    const titleMap = useMemo(() => {
        return Object.fromEntries(
            blockIds.map((blockId) => [blockId, layoutData.blockTabTitles?.[blockId] ?? blockId])
        );
    }, [blockIds, layoutData.blockTabTitles]);
    const duplicateIndexes = useMemo(() => getDuplicateIndexes(blockIds, titleMap), [blockIds, titleMap]);
    // 组内各 block 的锁定标记集合 (block:lock meta). 锁定不拦截正常关闭,
    // 仅用于「关闭其他/全部(锁定除外)」时保留对应标签。
    const lockedBlockIds = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    const locked = new Set<string>();
                    for (const id of blockIds) {
                        const data = get(waveEnv.wos.getWaveObjectAtom<Block>(makeORef("block", id)));
                        if ((data?.meta as Record<string, unknown> | undefined)?.[BlockLockMetaKey] === true) {
                            locked.add(id);
                        }
                    }
                    return locked;
                }),
            [blockIdsKey, waveEnv]
        )
    );
    const isEphemeral = useAtomValue(nodeModel.isEphemeral);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const isHidden = useAtomValue(nodeModel.isHidden);

    const handleTabStripKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const target = e.target as HTMLElement;
            const tabStrip = tabStripRef.current;
            if (!tabStrip) return;
            if (!target.classList.contains("inline-tab-block-tab-button")) return;
            if (blockIds.length <= 1) return;
            const buttons = Array.from(tabStrip.querySelectorAll<HTMLElement>(".inline-tab-block-tab-button"));
            const currentIndex = buttons.indexOf(target);
            if (currentIndex === -1) return;
            let targetIndex = currentIndex;
            if (e.key === "ArrowLeft") {
                targetIndex = (currentIndex - 1 + blockIds.length) % blockIds.length;
            } else if (e.key === "ArrowRight") {
                targetIndex = (currentIndex + 1) % blockIds.length;
            } else if (e.key === "Home") {
                targetIndex = 0;
            } else if (e.key === "End") {
                targetIndex = blockIds.length - 1;
            } else {
                return;
            }
            e.preventDefault();
            const targetBlockId = blockIds[targetIndex];
            layoutModel?.setActiveInlineTabBlock(nodeModel.nodeId, targetBlockId);
            buttons[targetIndex]?.focus({
                preventScroll: true,
            });
        },
        [blockIds, layoutModel, nodeModel.nodeId, tabStripRef]
    );

    const cleanupMissingBlock = useCallback(
        (missingBlockId: string) => {
            if (!layoutModel) {
                return;
            }
            const validBlockIds = getRemainingInlineTabBlockIds(blockIds, missingBlockId);
            layoutModel.cleanupInlineTabBlockIds(nodeModel.nodeId, validBlockIds);
        },
        [blockIdsKey, layoutModel, nodeModel.nodeId]
    );
    const [, dragActiveInlineTabBlock] = useDrag<InlineTabDragItem, InlineTabDropResult>(
        () => ({
            type: InlineTabDragItemType,
            canDrag: () => blockIds.length > 1 && !(isEphemeral || isMagnified || isHidden),
            item: () => ({
                sourceNodeId: nodeModel.nodeId,
                blockId: activeBlockId,
                sourceIndex: blockIds.indexOf(activeBlockId),
                origin: "block-header",
                sourceRect: getElementDimensions(tabStripRef.current),
            }),
            end: () => layoutModel?.clearPendingInlineTabDrop(),
        }),
        [activeBlockId, blockIdsKey, isEphemeral, isHidden, isMagnified, layoutModel, nodeModel.nodeId]
    );
    const [, dropInlineTabBlock] = useDrop<LayoutNode | InlineTabDragItem, unknown>(
        () => ({
            accept: [TileItemType, InlineTabDragItemType],
            canDrop: (dragItem, monitor) => {
                if (monitor.getItemType() === InlineTabDragItemType) {
                    return (dragItem as InlineTabDragItem).sourceNodeId === nodeModel.nodeId;
                }
                return (dragItem as LayoutNode).id !== nodeModel.nodeId;
            },
            hover: (dragItem, monitor) => {
                if (monitor.getItemType() !== TileItemType) {
                    return;
                }
                layoutModel?.setPendingInlineTabMerge(nodeModel.nodeId, (dragItem as LayoutNode).id);
            },
            drop: (dragItem, monitor) => {
                if (monitor.didDrop()) {
                    return;
                }
                if (monitor.getItemType() === InlineTabDragItemType) {
                    return { action: "reorder" } satisfies InlineTabDropResult;
                }
                if (layoutModel?.setPendingInlineTabMerge(nodeModel.nodeId, (dragItem as LayoutNode).id)) {
                    layoutModel.onDrop();
                }
            },
        }),
        [layoutModel, nodeModel.nodeId]
    );

    dragActiveInlineTabBlock(activeBlockDragHandleRef);
    dropInlineTabBlock(tabStripRef);

    if (blockIds.length <= 1 || !activeBlockId) {
        return <Block key={activeBlockId} nodeModel={activeNodeModel} preview={preview} />;
    }

    return (
        <div className="inline-tab-block">
            {blockIds.map((blockId) => (
                <InlineTabBlockMissingGuard
                    key={`missing-guard-${blockId}`}
                    blockId={blockId}
                    onMissingBlock={cleanupMissingBlock}
                />
            ))}
            {blockIds.map((blockId) => (
                <InlineTabBlockControllerWarmup
                    key={`controller-warmup-${blockId}`}
                    active={blockId == activeBlockId}
                    blockId={blockId}
                    preview={preview}
                    tabId={tabModel.tabId}
                />
            ))}
            {!preview && (
                <div
                    ref={tabStripRef}
                    className="inline-tab-block-tabs"
                    role="tablist"
                    aria-orientation="horizontal"
                    onKeyDown={handleTabStripKeyDown}
                >
                    <button
                        type="button"
                        className="inline-tab-block-group-handle"
                        title="Move Tab Group"
                        aria-label="Move Tab Group"
                    >
                        <i className={makeIconClass("grip-lines", true)} />
                    </button>
                    {blockIds.map((blockId, index) => (
                        <InlineTabLabel
                            key={blockId}
                            nodeId={nodeModel.nodeId}
                            blockId={blockId}
                            allBlockIds={blockIds}
                            layoutData={layoutData}
                            isActive={blockId === activeBlockId}
                            duplicateIndex={duplicateIndexes.get(blockId)}
                            lockedBlockIds={lockedBlockIds}
                            onActivate={() => layoutModel?.setActiveInlineTabBlock(nodeModel.nodeId, blockId)}
                            onClose={() => uxCloseBlock(blockId)}
                            onCloseOthers={() => layoutModel?.closeOtherInlineTabBlocks(nodeModel.nodeId, blockId)}
                            onCloseOthersExceptLocked={() =>
                                layoutModel?.closeOtherInlineTabBlocks(nodeModel.nodeId, blockId, lockedBlockIds)
                            }
                            onCloseAll={() => layoutModel?.closeAllInlineTabBlocks(nodeModel.nodeId)}
                            onCloseAllExceptLocked={() =>
                                layoutModel?.closeAllInlineTabBlocksExceptLocked(nodeModel.nodeId, lockedBlockIds)
                            }
                            index={index}
                            onReorder={(dragBlockId, hoverIndex) =>
                                layoutModel?.reorderInlineTabBlock(nodeModel.nodeId, dragBlockId, hoverIndex)
                            }
                            onDragEnd={() => layoutModel?.clearPendingInlineTabDrop()}
                            sourceStripRef={tabStripRef}
                            onRename={(title) => layoutModel?.setInlineTabTitle(nodeModel.nodeId, blockId, title)}
                        />
                    ))}
                </div>
            )}
            <div className="inline-tab-block-active">
                <SingleBlock
                    key={activeBlockId}
                    nodeModel={activeNodeModel}
                    preview={preview}
                    activeBlockId={activeBlockId}
                    layoutDataOverride={layoutData}
                />
            </div>
        </div>
    );
});
InlineTabBlock.displayName = "InlineTabBlock";

const BlockPreview = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    if (blockIsNull) {
        return null;
    }
    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockSubBlock = memo(({ nodeModel, viewModel }: FullSubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const blockIsNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", nodeModel.blockId)));
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );
    const noPadding = useAtomValueSafe(viewModel.noPadding);
    if (blockIsNull) {
        return null;
    }
    return (
        <div key="content" className={clsx("block-content", { "block-no-padding": noPadding })} ref={contentRef}>
            <ErrorBoundary>
                <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
            </ErrorBoundary>
        </div>
    );
});

const BlockFull = memo(({ nodeModel, viewModel }: FullBlockProps) => {
    counterInc("render-BlockFull");
    const waveEnv = useWaveEnv<BlockEnv>();
    const focusElemRef = useRef<HTMLInputElement>(null);
    const blockRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const pendingFocusRafRef = useRef<number | null>(null);
    const [blockClicked, setBlockClicked] = useState(false);
    const blockView = useAtomValue(waveEnv.getBlockMetaKeyAtom(nodeModel.blockId, "view")) ?? "";
    const isFocused = useAtomValue(nodeModel.isFocused);
    const disablePointerEvents = useAtomValue(nodeModel.disablePointerEvents);
    const isResizing = useAtomValue(nodeModel.isResizing);
    const isMagnified = useAtomValue(nodeModel.isMagnified);
    const anyMagnified = useAtomValue(nodeModel.anyMagnified);
    const modalOpen = useAtomValue(waveEnv.atoms.modalOpen);
    const focusFollowsCursorMode = useAtomValue(waveEnv.getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const innerRect = useDebouncedNodeInnerRect(nodeModel);
    const noPadding = useAtomValueSafe(viewModel.noPadding);

    useEffect(() => {
        return () => {
            if (pendingFocusRafRef.current != null) {
                cancelAnimationFrame(pendingFocusRafRef.current);
            }
        };
    }, []);

    useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = focusedBlockId() == nodeModel.blockId;
        if (!focusWithin) {
            setFocusTarget();
        }
        if (!isFocused) {
            nodeModel.focusNode();
        }
    }, [blockClicked, isFocused]);

    const setBlockClickedTrue = useCallback(() => {
        setBlockClicked(true);
    }, []);

    const [blockContentOffset, setBlockContentOffset] = useState<Dimensions>();

    useEffect(() => {
        if (blockRef.current && contentRef.current) {
            const blockRect = blockRef.current.getBoundingClientRect();
            const contentRect = contentRef.current.getBoundingClientRect();
            setBlockContentOffset({
                top: 0,
                left: 0,
                width: blockRect.width - contentRect.width,
                height: blockRect.height - contentRect.height,
            });
        }
    }, [blockRef, contentRef]);

    const blockContentStyle = useMemo<React.CSSProperties>(() => {
        const retVal: React.CSSProperties = {
            pointerEvents: disablePointerEvents ? "none" : undefined,
        };
        if (innerRect?.width && innerRect.height && blockContentOffset) {
            retVal.width = `calc(${innerRect?.width} - ${blockContentOffset.width}px)`;
            retVal.height = `calc(${innerRect?.height} - ${blockContentOffset.height}px)`;
        }
        return retVal;
    }, [innerRect, disablePointerEvents, blockContentOffset]);

    const viewElem = useMemo(
        () => getViewElem(nodeModel.blockId, blockRef, contentRef, blockView, viewModel),
        [nodeModel.blockId, blockView, viewModel]
    );

    const handleChildFocus = useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            console.log("setFocusedChild", nodeModel.blockId, getElemAsStr(event.target));
            if (!isFocused) {
                console.log("focusedChild focus", nodeModel.blockId);
                nodeModel.focusNode();
            }
        },
        [isFocused]
    );

    const setFocusTarget = useCallback(() => {
        if (pendingFocusRafRef.current != null) {
            cancelAnimationFrame(pendingFocusRafRef.current);
            pendingFocusRafRef.current = null;
        }
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
        pendingFocusRafRef.current = requestAnimationFrame(() => {
            pendingFocusRafRef.current = null;
            if (blockRef.current?.contains(document.activeElement)) {
                viewModel?.giveFocus?.();
            }
        });
    }, [viewModel]);

    const focusFromPointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const focusFollowsCursorEnabled =
                focusFollowsCursorMode === "on" || (focusFollowsCursorMode === "term" && blockView === "term");
            if (!focusFollowsCursorEnabled || event.pointerType === "touch" || event.buttons > 0) {
                return;
            }
            if (modalOpen || disablePointerEvents || isResizing || (anyMagnified && !isMagnified)) {
                return;
            }
            if (isFocused && focusedBlockId() === nodeModel.blockId) {
                return;
            }
            setFocusTarget();
            if (!isFocused) {
                nodeModel.focusNode();
            }
        },
        [
            focusFollowsCursorMode,
            blockView,
            modalOpen,
            disablePointerEvents,
            isResizing,
            isMagnified,
            anyMagnified,
            isFocused,
            nodeModel,
            setFocusTarget,
        ]
    );

    const blockModel = useMemo<BlockComponentModel2>(
        () => ({
            onClick: setBlockClickedTrue,
            onPointerEnter: focusFromPointerEnter,
            onFocusCapture: handleChildFocus,
            blockRef: blockRef,
        }),
        [setBlockClickedTrue, focusFromPointerEnter, handleChildFocus, blockRef]
    );

    return (
        <BlockFrame
            key={nodeModel.blockId}
            nodeModel={nodeModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${nodeModel.blockId}-dummy-focus`} // don't change this name (used in refocusNode)
                    className="dummy-focus"
                    onChange={() => {}}
                />
            </div>
            <div
                key="content"
                className={clsx("block-content", { "block-no-padding": noPadding })}
                ref={contentRef}
                style={blockContentStyle}
            >
                <ErrorBoundary>
                    <Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const BlockInner = memo((props: BlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel?.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        console.log("[block-remount-debug] mount", {
            blockId: props.nodeModel.blockId,
            nodeId: props.nodeModel.nodeId,
            viewType: props.viewType,
        });
        return () => {
            console.log("[block-remount-debug] unmount", {
                blockId: props.nodeModel.blockId,
                nodeId: props.nodeModel.nodeId,
                viewType: props.viewType,
            });
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    if (props.preview) {
        return <BlockPreview {...props} viewModel={viewModel} />;
    }
    return <BlockFull {...props} viewModel={viewModel} />;
});
BlockInner.displayName = "BlockInner";

const SingleBlock = memo((props: BlockProps & { activeBlockId: string; layoutDataOverride?: TabLayoutData }) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const { activeBlockId, layoutDataOverride } = props;
    const activeLayoutDataAtom = useMemo(
        () => atom<TabLayoutData>(layoutDataOverride ?? { blockId: activeBlockId }),
        [activeBlockId, layoutDataOverride]
    );
    const activeNodeModel = useMemo(
        () => ({
            ...props.nodeModel,
            blockId: activeBlockId,
            layoutData: activeLayoutDataAtom,
        }),
        [activeBlockId, activeLayoutDataAtom, props.nodeModel]
    );
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", activeBlockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(activeBlockId, "view")) ?? "";
    if (isNull || isBlank(activeBlockId)) {
        return null;
    }
    return (
        <BlockInner key={activeBlockId + ":" + viewType} {...props} nodeModel={activeNodeModel} viewType={viewType} />
    );
});
SingleBlock.displayName = "SingleBlock";

const Block = memo((props: BlockProps) => {
    const layoutData = useAtomValue(props.nodeModel.layoutData);
    const blockIds = getLayoutDataBlockIds(layoutData);
    if (blockIds.length > 1) {
        return <InlineTabBlock {...props} layoutData={layoutData} />;
    }
    const activeBlockId = getLayoutDataActiveBlockId(layoutData) ?? props.nodeModel.blockId;
    return <SingleBlock {...props} activeBlockId={activeBlockId} />;
});

const SubBlockInner = memo((props: SubBlockProps & { viewType: string }) => {
    counterInc("render-Block");
    counterInc("render-Block-" + props.nodeModel.blockId?.substring(0, 8));
    const tabModel = useTabModel();
    const waveEnv = useWaveEnv();
    const bcm = getBlockComponentModel(props.nodeModel.blockId);
    let viewModel = bcm?.viewModel;
    if (viewModel == null) {
        // viewModel gets the full waveEnv
        viewModel = makeViewModel(props.nodeModel.blockId, props.viewType, props.nodeModel, tabModel, waveEnv);
        registerBlockComponentModel(props.nodeModel.blockId, { viewModel });
    }
    useEffect(() => {
        return () => {
            unregisterBlockComponentModel(props.nodeModel.blockId);
            viewModel?.dispose?.();
        };
    }, []);
    return <BlockSubBlock {...props} viewModel={viewModel} />;
});
SubBlockInner.displayName = "SubBlockInner";

const SubBlock = memo((props: SubBlockProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const isNull = useAtomValue(waveEnv.wos.isWaveObjectNullAtom(makeORef("block", props.nodeModel.blockId)));
    const viewType = useAtomValue(waveEnv.getBlockMetaKeyAtom(props.nodeModel.blockId, "view")) ?? "";
    if (isNull || isBlank(props.nodeModel.blockId)) {
        return null;
    }
    return <SubBlockInner key={props.nodeModel.blockId + ":" + viewType} {...props} viewType={viewType} />;
});

export { Block, SubBlock };
