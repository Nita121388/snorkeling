// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 左批注时间线 rail。
//
// 设计约束（design.md §2，2026-10-26 视觉重构）：
//  - 只画有批注的节点；无批注节点不占位。
//  - 节点是**竖向圆点**（accepted 实心 / draft 空心环 / orphan 警告色），
//    不再复用 session-outline-rail 的横向药丸语言。
//  - 2px 竖轴贯穿全高；少节点按 seq 等比铺满，多节点固定 28px 槽 + 内部滚动。
//  - rail → 消息流单向（点击跳转）；不做滚动反向高亮。

import { cn } from "@/util/util";
import * as React from "react";
import { AnnotationCard } from "./annotation-card";
import {
    AnnotationRailCollapsedWidth,
    AnnotationRailExpandedWidth,
    RailAxisWidth,
    RailDotActiveSize,
    RailDotGap,
    RailDotRestingSize,
    buildRailItems,
    buildSeqRanks,
    clusterRailItems,
    type AnnotationLike,
} from "./annotation-model";

const CollapsedStorageKey = "aisessions.annotationRailCollapsed";
const HoverDelayMs = 150;

function readCollapsedPreference(): boolean {
    try {
        return window.localStorage.getItem(CollapsedStorageKey) === "1";
    } catch {
        return false;
    }
}

function writeCollapsedPreference(collapsed: boolean): void {
    try {
        window.localStorage.setItem(CollapsedStorageKey, collapsed ? "1" : "0");
    } catch {
        // ignore
    }
}

export function AnnotationRail({
    annotations,
    onJump,
    activeSeq = null,
    previewBySeq,
    onGenerateTimeline,
    generating = false,
    onAccept,
    onDiscard,
    onAcceptAllDrafts,
    onDiscardAllDrafts,
}: {
    annotations: AnnotationLike[];
    onJump: (seq: number) => void;
    activeSeq?: number | null;
    /** seq → 节点原文摘要（截断），用于悬浮卡。 */
    previewBySeq?: Map<number, string>;
    /** 「✨ 生成时间线」；不传时不渲染按钮。 */
    onGenerateTimeline?: () => void;
    generating?: boolean;
    onAccept?: (id: number) => void;
    onDiscard?: (id: number) => void;
    onAcceptAllDrafts?: () => void;
    onDiscardAllDrafts?: () => void;
}) {
    const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsedPreference);
    const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
    const [openIndex, setOpenIndex] = React.useState<number | null>(null);
    // 点击刻度后"钉住"卡片：悬浮卡会因为鼠标移动瞬间消失，导致 Accept 点不到。
    const [pinnedIndex, setPinnedIndex] = React.useState<number | null>(null);
    const hoverTimer = React.useRef<number | null>(null);
    const closeTimer = React.useRef<number | null>(null);
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const [bodyHeight, setBodyHeight] = React.useState(0);

    const items = React.useMemo(() => buildRailItems(annotations), [annotations]);
    const clusters = React.useMemo(() => clusterRailItems(items), [items]);
    const draftCount = React.useMemo(
        () => annotations.filter((annotation) => annotation.status === "draft").length,
        [annotations]
    );
    const width = collapsed ? AnnotationRailCollapsedWidth : AnnotationRailExpandedWidth;

    const clearTimers = React.useCallback(() => {
        if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
        if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
        hoverTimer.current = null;
        closeTimer.current = null;
    }, []);
    React.useEffect(() => () => clearTimers(), [clearTimers]);

    // 量 rail 内容区高度，决定「少节点等比铺满 / 多节点固定槽 + 滚动」分支。
    React.useLayoutEffect(() => {
        const el = bodyRef.current;
        if (el == null) return;
        const update = () => setBodyHeight(el.clientHeight);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [collapsed, items.length]);

    const toggleCollapsed = React.useCallback(() => {
        setCollapsed((current) => {
            writeCollapsedPreference(!current);
            return !current;
        });
    }, []);

    // 折叠态：只画一条竖轴细线，不画圆点（design §2.4）。
    if (collapsed) {
        return (
            <div
                className="relative flex shrink-0 cursor-pointer flex-col items-center border-r border-border"
                style={{ width }}
                onClick={toggleCollapsed}
                title="Expand annotation timeline"
                aria-label="Expand annotation timeline"
            >
                <div className="h-full bg-border" style={{ width: RailAxisWidth }} />
            </div>
        );
    }

    // 空态：展开时必须给出 ✨ 生成入口——否则没有任何批注的用户找不到怎么开始。
    if (items.length === 0) {
        return (
            <div
                className="relative flex shrink-0 flex-col items-center border-r border-border"
                style={{ width }}
            >
                <div className="flex w-full flex-col items-center gap-2 py-1.5">
                    <div
                        className="w-full cursor-pointer text-center text-[9px] text-secondary hover:text-primary"
                        onClick={toggleCollapsed}
                        title="Collapse annotation timeline"
                    >
                        Notes
                    </div>
                    {onGenerateTimeline != null ? (
                        <button
                            type="button"
                            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-accent bg-panel text-accent transition-colors hover:bg-hover disabled:opacity-60"
                            disabled={generating}
                            title={generating ? "Generating…" : "Generate annotation timeline with AI"}
                            aria-label="Generate annotation timeline with AI"
                            onClick={(event) => {
                                event.stopPropagation();
                                onGenerateTimeline();
                            }}
                        >
                            <i
                                className={cn(
                                    "fa-sharp fa-solid text-[10px]",
                                    generating ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles"
                                )}
                            />
                        </button>
                    ) : null}
                    {!generating ? (
                        <span className="text-[9px] leading-3 text-secondary [writing-mode:vertical-rl]">
                            No annotations
                        </span>
                    ) : (
                        <span className="text-[9px] leading-3 text-accent [writing-mode:vertical-rl]">
                            Generating
                        </span>
                    )}
                </div>
            </div>
        );
    }

    const cardIndex = pinnedIndex ?? openIndex;
    const hoveredCluster = cardIndex != null ? clusters[cardIndex] : null;

    const count = clusters.length;
    const ranks = buildSeqRanks(clusters);
    // 少节点：节点间距 >= RailDotGap 就铺满全高；否则固定槽 + 内部滚动。
    const canSpread = count > 0 && bodyHeight > 0 && (count === 1 || bodyHeight - RailDotActiveSize >= (count - 1) * RailDotGap);
    const contentHeight = canSpread ? bodyHeight : count * RailDotGap;

    const topFor = (index: number): number => {
        if (canSpread) {
            const { rank, maxRank } = ranks[index];
            if (maxRank === 0) return bodyHeight / 2;
            const usable = Math.max(0, bodyHeight - RailDotActiveSize);
            return RailDotActiveSize / 2 + (rank / maxRank) * usable;
        }
        return index * RailDotGap + RailDotGap / 2;
    };

    return (
        <div
            className="relative flex shrink-0 flex-col items-start border-r border-border"
            style={{ width }}
        >
            {!collapsed ? (
                <div className="flex w-full flex-col items-start gap-0.5 px-1 py-1">
                    <div
                        className="w-full cursor-pointer text-[9px] text-secondary hover:text-primary"
                        onClick={toggleCollapsed}
                        title="Collapse annotation timeline"
                    >
                        Notes
                    </div>
                    {onGenerateTimeline != null ? (
                        <button
                            type="button"
                            className="flex h-5 w-full cursor-pointer items-center justify-center gap-1 rounded border border-accent bg-panel text-[9px] text-accent hover:bg-hover disabled:opacity-60"
                            disabled={generating}
                            title="Generate annotation timeline with AI"
                            onClick={(event) => {
                                event.stopPropagation();
                                onGenerateTimeline();
                            }}
                        >
                            <i
                                className={cn(
                                    "fa-sharp fa-solid",
                                    generating ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles"
                                )}
                            />
                            <span>AI</span>
                        </button>
                    ) : null}
                    {draftCount > 0 ? (
                        <div className="flex w-full items-center justify-between gap-1 rounded border border-accent bg-panel px-1 py-0.5 text-[9px] text-accent">
                            <span>{draftCount} drafts</span>
                            <span className="flex items-center gap-1">
                                {onDiscardAllDrafts != null ? (
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded px-1 hover:bg-hover"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDiscardAllDrafts();
                                        }}
                                    >
                                        Discard
                                    </button>
                                ) : null}
                                {onAcceptAllDrafts != null ? (
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded px-1 font-medium hover:bg-hover"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onAcceptAllDrafts();
                                        }}
                                    >
                                        Accept
                                    </button>
                                ) : null}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div
                ref={bodyRef}
                className="relative min-h-0 w-full flex-1"
                style={{ overflowY: canSpread ? "visible" : "auto", overflowX: "visible" }}
            >
                <div className="relative w-full" style={{ height: contentHeight }}>
                    {/* 2px 竖轴贯穿全高；居中于圆点列。 */}
                    <div
                        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 bg-border"
                        style={{ width: RailAxisWidth, height: contentHeight }}
                    />
                    {clusters.map((cluster, index) => {
                        const isActive =
                            activeSeq != null && cluster.items.some((item) => item.seq === activeSeq);
                        const isHovered = hoverIndex === index;
                        const size = isActive
                            ? RailDotActiveSize
                            : isHovered
                              ? Math.round(RailDotRestingSize * 1.4)
                              : RailDotRestingSize;
                        const isCardOpen = cardIndex === index;
                        const isPinned = pinnedIndex === index;
                        const dotClass = cluster.hasOrphan
                            ? "rounded-full bg-warning"
                            : cluster.hasAccepted
                              ? "rounded-full bg-primary"
                              : "rounded-full border-2 border-accent bg-transparent";
                        return (
                            <div
                                key={cluster.key}
                                className="absolute left-0 w-full"
                                style={{ top: topFor(index), transform: "translateY(-50%)" }}
                                onMouseEnter={() => {
                                    clearTimers();
                                    setHoverIndex(index);
                                    hoverTimer.current = window.setTimeout(() => {
                                        setOpenIndex(index);
                                    }, HoverDelayMs);
                                }}
                                onMouseLeave={() => {
                                    clearTimers();
                                    setHoverIndex(null);
                                }}
                            >
                                <button
                                    type="button"
                                    aria-label={`Jump to annotation at #${cluster.seq}`}
                                    className="mx-auto flex h-6 w-6 cursor-pointer items-center justify-center"
                                    onClick={() => {
                                        // 钉住卡片，避免鼠标一移开就消失导致点不到 Accept。
                                        // 已钉住时再次点击则完全收起。
                                        setPinnedIndex((current) => {
                                            if (current === index) {
                                                clearTimers();
                                                setOpenIndex(null);
                                                setHoverIndex(null);
                                                return null;
                                            }
                                            return index;
                                        });
                                        onJump(cluster.seq);
                                    }}
                                >
                                    <span
                                        className={cn(
                                            "transition-all duration-150 ease-out",
                                            dotClass,
                                            isActive && "ring-2 ring-accent"
                                        )}
                                        style={{ width: size, height: size }}
                                    />
                                </button>
                                {isCardOpen && hoveredCluster?.key === cluster.key ? (
                                    <div
                                        // pl-2 而不是 ml-2：留出"鼠标桥"，从圆点移到卡片时
                                        // 指针不会落到空隙里，卡片不会提前关闭。
                                        className="absolute left-full top-0 z-50 pl-2"
                                        onMouseEnter={() => {
                                            clearTimers();
                                            setOpenIndex(index);
                                        }}
                                        onMouseLeave={() => {
                                            clearTimers();
                                            if (isPinned) return; // 钉住的卡片只能点刻度或 Close 关闭
                                            closeTimer.current = window.setTimeout(() => {
                                                setOpenIndex(null);
                                                setHoverIndex(null);
                                            }, 320);
                                        }}
                                    >
                                        <AnnotationCard
                                            cluster={cluster}
                                            onPin={() => setPinnedIndex(index)}
                                            onClose={isPinned ? () => setPinnedIndex(null) : undefined}
                                            nodePreview={
                                                previewBySeq?.get(cluster.items[0]?.seq ?? -1) ??
                                                cluster.items[0]?.annotations[0]?.anchorPreview
                                            }
                                            onJump={onJump}
                                            onAccept={onAccept}
                                            onDiscard={onDiscard}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
