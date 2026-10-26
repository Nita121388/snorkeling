// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 左批注时间线 rail。
//
// 设计约束：
//  - 只画有批注的节点；无批注节点不占位。
//  - rail → 消息流单向（点击跳转）；不做滚动反向高亮。
//  - dock 放大复用 session-outline-rail 的 tickMagnification，不复制实现。

import { tickMagnification } from "@/app/view/session-outline-rail";
import { cn } from "@/util/util";
import * as React from "react";
import { AnnotationCard } from "./annotation-card";
import {
    AnnotationRailCollapsedWidth,
    AnnotationRailExpandedWidth,
    AnnotationRailSlotHeight,
    buildRailItems,
    clusterRailItems,
    type AnnotationLike,
} from "./annotation-model";

const CollapsedStorageKey = "aisessions.annotationRailCollapsed";
const HoverDelayMs = 150;
const MagnifyRadius = 3;
const RestingPillWidth = 10;
const ActivePillWidth = 18;
const MagnifiedPillWidth = 26;
const RestingPillHeight = 2;
const MagnifiedPillHeight = 3;

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

    const toggleCollapsed = React.useCallback(() => {
        setCollapsed((current) => {
            writeCollapsedPreference(!current);
            return !current;
        });
    }, []);

    // 空态：折叠时只是一条竖线；展开时必须给出 ✨ 生成入口——
    // 否则"没有任何批注"的用户永远找不到怎么开始（PRD 验收第一条）。
    if (items.length === 0) {
        return (
            <div className="relative flex shrink-0 flex-col items-center border-r border-border/40" style={{ width }}>
                {collapsed ? (
                    <div
                        className="flex h-full w-full cursor-pointer items-center justify-center"
                        onClick={toggleCollapsed}
                        title="Expand annotation timeline"
                    >
                        <div className="h-full w-px bg-border/40" />
                    </div>
                ) : (
                    <div className="flex w-full flex-col items-center gap-2 py-1.5">
                        <div
                            className="w-full cursor-pointer text-center text-[9px] text-secondary/70 hover:text-primary"
                            onClick={toggleCollapsed}
                            title="Collapse annotation timeline"
                        >
                            Notes
                        </div>
                        {onGenerateTimeline != null ? (
                            <button
                                type="button"
                                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-accent/40 bg-accent/10 text-accent transition-colors hover:bg-accent/20 disabled:opacity-60"
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
                )}
            </div>
        );
    }

    const cardIndex = pinnedIndex ?? openIndex;
    const hoveredCluster = cardIndex != null ? clusters[cardIndex] : null;

    return (
        <div
            className="relative flex shrink-0 flex-col items-start overflow-visible border-r border-border/40"
            style={{ width }}
        >
            <div className="flex w-full flex-col items-start gap-0.5 px-1 py-1">
                <div
                    className="w-full cursor-pointer text-[9px] text-secondary/70 hover:text-primary"
                    onClick={toggleCollapsed}
                    title={collapsed ? "Expand annotation timeline" : "Collapse annotation timeline"}
                >
                    {collapsed ? "" : "Notes"}
                </div>
                {!collapsed && onGenerateTimeline != null ? (
                    <button
                        type="button"
                        className="flex h-5 w-full cursor-pointer items-center justify-center gap-1 rounded border border-accent/40 bg-accent/10 text-[9px] text-accent hover:bg-accent/20 disabled:opacity-60"
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
                {!collapsed && draftCount > 0 ? (
                    <div className="flex w-full items-center justify-between gap-1 rounded border border-accent/30 bg-accent/5 px-1 py-0.5 text-[9px] text-accent">
                        <span>{draftCount} drafts</span>
                        <span className="flex items-center gap-1">
                            {onDiscardAllDrafts != null ? (
                                <button
                                    type="button"
                                    className="cursor-pointer rounded px-1 hover:bg-accent/10"
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
                                    className="cursor-pointer rounded px-1 font-medium hover:bg-accent/10"
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
            <div className="w-full">
                {clusters.map((cluster, index) => {
                    const magnification = hoverIndex == null ? 0 : tickMagnification(index - hoverIndex);
                    const isActive = activeSeq != null && cluster.items.some((item) => item.seq === activeSeq);
                    const restingWidth = isActive ? ActivePillWidth : RestingPillWidth;
                    const pillWidth = restingWidth + magnification * (MagnifiedPillWidth - restingWidth);
                    const pillHeight = RestingPillHeight + magnification * (MagnifiedPillHeight - RestingPillHeight);
                    const isCardOpen = cardIndex === index;
                    const isPinned = pinnedIndex === index;
                    return (
                        <div
                            key={cluster.key}
                            className="relative"
                            style={{ height: AnnotationRailSlotHeight }}
                            onMouseEnter={() => {
                                clearTimers();
                                setHoverIndex(index);
                                hoverTimer.current = window.setTimeout(() => {
                                    setOpenIndex(index);
                                }, HoverDelayMs);
                            }}
                        >
                            <button
                                type="button"
                                aria-label={`Jump to annotation at #${cluster.seq}`}
                                className="flex h-full w-full cursor-pointer items-center pl-1"
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
                                        "rounded-full transition-[width,height,background-color] duration-150 ease-out",
                                        cluster.hasOrphan
                                            ? "bg-warning"
                                            : isActive
                                              ? "bg-primary/70"
                                              : cluster.hasAccepted
                                                ? "bg-primary/55"
                                                : "bg-accent/50"
                                    )}
                                    style={{ width: pillWidth, height: pillHeight }}
                                />
                            </button>
                            {isCardOpen && hoveredCluster?.key === cluster.key ? (
                                <div
                                    // pl-2 而不是 ml-2：留出"鼠标桥"，从刻度移到卡片时
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
    );
}
