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
    clusterRailItems,
    type AnnotationLike,
} from "./annotation-model";
import {
    buildTimePositions,
    createRafCoalescer,
    nearestAnnotatedSeq,
    relaxTimelinePositions,
    timeRangeOf,
} from "./timeline-virtual";

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
    scrollSeq = null,
    seqToTimestamp,
    previewBySeq,
    onGenerateTimeline,
    generating = false,
    onAccept,
    onDiscard,
    onAcceptAllDrafts,
    onDiscardAllDrafts,
    onNodeTextSave,
    bottomInset = 0,
}: {
    annotations: AnnotationLike[];
    onJump: (seq: number, anchorKey?: string) => void;
    activeSeq?: number | null;
    /** 滚动跟随的当前消息 seq（不是批注 seq）；用于把 rail 高亮到最近批注节点。 */
    scrollSeq?: number | null;
    /** 消息 seq → 时间戳（ms）；用于按时间分布节点。缺失时回落均分。 */
    seqToTimestamp?: Map<number, number>;
    /** seq → 节点原文摘要（截断），用于悬浮卡。 */
    previewBySeq?: Map<number, string>;
    /** 「✨ 生成时间线」；不传时不渲染按钮。 */
    onGenerateTimeline?: () => void;
    generating?: boolean;
    onAccept?: (id: number) => void;
    onDiscard?: (id: number) => void;
    onAcceptAllDrafts?: () => void;
    onDiscardAllDrafts?: () => void;
    /** 卡片 NODE 区就地编辑：保存用户手改的节点原文副本。 */
    onNodeTextSave?: (annotation: AnnotationLike, nodeText: string) => void;
    /** 底部让位（composer 高度）：竖轴与圆点不得压到底部输入框上。 */
    bottomInset?: number;
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
    // 悬浮卡定位需要的 rail 内部滚动量：拖动密集分支时一帧最多提交一次。
    const railScrollCoalescer = React.useMemo(
        () =>
            createRafCoalescer(() => {
                setBodyScrollTop(bodyRef.current?.scrollTop ?? 0);
            }),
        []
    );
    React.useEffect(() => () => railScrollCoalescer.cancel(), [railScrollCoalescer]);
    // 悬浮卡被上提到 rail 根节点渲染（脱离滚动容器与 dot 包裹层的 transform），
    // 需要 dot 在 rail 根坐标系里的位置，故跟踪滚动量与体/根偏移。
    const [bodyScrollTop, setBodyScrollTop] = React.useState(0);
    const [bodyOffsetTop, setBodyOffsetTop] = React.useState(0);

    const items = React.useMemo(() => buildRailItems(annotations), [annotations]);
    const clusters = React.useMemo(() => clusterRailItems(items), [items]);
    const draftCount = React.useMemo(
        () => annotations.filter((annotation) => annotation.status === "draft").length,
        [annotations]
    );
    const width = collapsed ? AnnotationRailCollapsedWidth : AnnotationRailExpandedWidth;
    // rail 与「聊天列（滚动区 + composer）」是同级的 stretch 子项：
    // 用 marginBottom 吃掉 composer 的高度，rail 的 border-r 与竖轴就停在输入框上沿。
    const inset = Math.max(0, Math.round(bottomInset));
    const railBoxStyle: React.CSSProperties = { width, marginBottom: inset };

    const clearTimers = React.useCallback(() => {
        if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
        if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
        hoverTimer.current = null;
        closeTimer.current = null;
    }, []);
    React.useEffect(() => () => clearTimers(), [clearTimers]);

    // 量 rail 内容区高度，决定「少节点等比铺满 / 多节点固定槽 + 滚动」分支。
    // 同时记录 bodyRef 相对 rail 根节点的偏移，供悬浮卡定位。
    React.useLayoutEffect(() => {
        const el = bodyRef.current;
        if (el == null) return;
        const update = () => {
            setBodyHeight(el.clientHeight);
            setBodyOffsetTop(el.offsetTop);
        };
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

    const count = clusters.length;
    // 节点按真实时间戳分布；时间不可用时 buildTimePositions 回落为均分。
    const positions = React.useMemo(
        () =>
            buildTimePositions(
                clusters.map((cluster) => ({ seq: cluster.seq, ts: seqToTimestamp?.get(cluster.seq) }))
            ),
        [clusters, seqToTimestamp]
    );
    const timeRange = React.useMemo(
        () => timeRangeOf(clusters.map((cluster) => ({ seq: cluster.seq, ts: seqToTimestamp?.get(cluster.seq) }))),
        [clusters, seqToTimestamp]
    );
    const clusterSeqs = React.useMemo(() => clusters.map((cluster) => cluster.seq), [clusters]);
    // 滚动点（任意消息 seq）→ 最近一个已批注节点。
    const liveSeq = React.useMemo(() => nearestAnnotatedSeq(scrollSeq, clusterSeqs), [scrollSeq, clusterSeqs]);
    // 少节点：节点间距 >= RailDotGap 就铺满全高；否则固定槽 + 内部滚动。
    const canSpread =
        count > 0 && bodyHeight > 0 && (count === 1 || bodyHeight - RailDotActiveSize >= (count - 1) * RailDotGap);
    const contentHeight = canSpread ? bodyHeight : count * RailDotGap;

    // 时间分布 + 最小间距松弛：挤在一起的批注不重叠，有空间时保留时间比例。
    const spreadTops = React.useMemo(() => {
        if (!canSpread || bodyHeight <= 0) return null;
        const usable = Math.max(0, bodyHeight - RailDotActiveSize);
        const ideal = positions.map((position) => RailDotActiveSize / 2 + position * usable);
        return relaxTimelinePositions(ideal, RailDotGap, RailDotActiveSize / 2, bodyHeight - RailDotActiveSize / 2);
    }, [canSpread, bodyHeight, positions]);

    const topFor = (index: number): number => {
        if (canSpread) {
            return spreadTops?.[index] ?? bodyHeight / 2;
        }
        return index * RailDotGap + RailDotGap / 2;
    };

    // 当前滚动位置在时间轴上的落点：当前消息 timestamp 归一化到批注时间跨度。
    const playheadTop = React.useMemo(() => {
        if (!canSpread || timeRange == null || scrollSeq == null || seqToTimestamp == null) return null;
        const ts = seqToTimestamp.get(scrollSeq);
        if (ts == null) return null;
        const fraction = (ts - timeRange.min) / (timeRange.max - timeRange.min);
        const usable = Math.max(0, bodyHeight - RailDotActiveSize);
        return RailDotActiveSize / 2 + Math.max(0, Math.min(1, fraction)) * usable;
    }, [canSpread, timeRange, scrollSeq, seqToTimestamp, bodyHeight]);

    // 折叠态：只画一条竖轴细线，不画圆点（design §2.4）。
    if (collapsed) {
        return (
            <div
                className="relative z-10 flex shrink-0 cursor-pointer flex-col items-center border-r border-border"
                style={railBoxStyle}
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
                className="relative z-10 flex shrink-0 flex-col items-center border-r border-border"
                style={railBoxStyle}
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
                        <span className="text-[9px] leading-3 text-accent [writing-mode:vertical-rl]">Generating</span>
                    )}
                </div>
            </div>
        );
    }

    const cardIndex = pinnedIndex ?? openIndex;
    const hoveredCluster = cardIndex != null ? clusters[cardIndex] : null;


    const railContentHeight = bodyOffsetTop + bodyHeight;
    // 悬浮卡上提到 rail 根节点渲染。dotTop = 圆点中心在 rail 根坐标系里的纵向位置
    // （减去 body 的滚动量，保证滚动后卡片仍贴着对应圆点）。
    const cardTop = cardIndex != null ? bodyOffsetTop + topFor(cardIndex) - bodyScrollTop : 0;
    // 圆点在 rail 上半部 → 卡片向下长；在下半部 → 向上翻转，避免长出 rail 底部。
    const cardPlaceBelow = cardTop < railContentHeight / 2;

    return (
        // z-10：rail 自成一个 stacking level，悬浮卡（z-50）绘制在右侧聊天列（z-auto）之上。
        // 约束：本节点禁止 overflow:hidden / transform，否则悬浮卡会再次被裁切或困在局部层叠上下文。
        <div className="relative z-10 flex shrink-0 flex-col items-start border-r border-border" style={railBoxStyle}>
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
                    {/* 草稿条：rail 展开仅 44px，横排的 "2 drafts Discard Accept" 会溢出 rail
                        并被右侧聊天列盖住（overflow 部分不可点击）。这里改竖排紧凑版：
                        第一行计数、第二行两个等宽图标按钮，宽度锁在 rail 内容区内。 */}
                    {draftCount > 0 ? (
                        <div
                            className="flex w-full flex-col items-stretch gap-0.5 overflow-hidden rounded border border-accent bg-panel px-0.5 py-0.5 text-[9px] text-accent"
                            title={`${draftCount} draft annotation${draftCount === 1 ? "" : "s"}`}
                        >
                            <span className="flex items-center justify-center gap-0.5 leading-3">
                                <i className="fa-sharp fa-solid fa-pen-to-square text-[7px]" />
                                <span>{draftCount}</span>
                            </span>
                            <span className="flex items-center justify-center gap-0.5">
                                {onDiscardAllDrafts != null ? (
                                    <button
                                        type="button"
                                        className="flex h-3.5 min-w-0 flex-1 cursor-pointer items-center justify-center rounded hover:bg-hover"
                                        title="Discard all drafts"
                                        aria-label="Discard all drafts"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDiscardAllDrafts();
                                        }}
                                    >
                                        <i className="fa-sharp fa-solid fa-xmark text-[9px]" />
                                    </button>
                                ) : null}
                                {onAcceptAllDrafts != null ? (
                                    <button
                                        type="button"
                                        className="flex h-3.5 min-w-0 flex-1 cursor-pointer items-center justify-center rounded font-medium hover:bg-hover"
                                        title="Accept all drafts"
                                        aria-label="Accept all drafts"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onAcceptAllDrafts();
                                        }}
                                    >
                                        <i className="fa-sharp fa-solid fa-check text-[9px]" />
                                    </button>
                                ) : null}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div
                ref={bodyRef}
                data-testid="annotation-rail-body"
                className="relative min-h-0 w-full flex-1"
                style={{ overflowY: canSpread ? "visible" : "auto", overflowX: "visible" }}
                onScroll={railScrollCoalescer.schedule}
            >
                <div className="relative w-full" style={{ height: contentHeight }}>
                    {/* 2px 竖轴贯穿全高；居中于圆点列。 */}
                    <div
                        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 bg-border"
                        style={{ width: RailAxisWidth, height: contentHeight }}
                    />
                    {/* 当前滚动位置的播放头：细线 + 轴上小点，跟随会话详情滚动更新。 */}
                    {playheadTop != null ? (
                        <div
                            className="pointer-events-none absolute left-0 w-full"
                            style={{ top: playheadTop, transform: "translateY(-50%)" }}
                            aria-hidden="true"
                        >
                            <div className="h-px w-full bg-accent/45" />
                            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-accent/25" />
                        </div>
                    ) : null}
                    {clusters.map((cluster, index) => {
                        const isActive =
                            (liveSeq != null && cluster.items.some((item) => item.seq === liveSeq)) ||
                            (activeSeq != null && cluster.items.some((item) => item.seq === activeSeq));
                        const isHovered = hoverIndex === index;
                        const size = isActive
                            ? RailDotActiveSize
                            : isHovered
                              ? Math.round(RailDotRestingSize * 1.4)
                              : RailDotRestingSize;
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
                                        onJump(cluster.seq, cluster.items[0]?.anchorKey);
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
                            </div>
                        );
                    })}
                </div>
            </div>
            {/* 悬浮卡：上提到 rail 根节点渲染，脱离 bodyRef 的 overflow 裁切与 dot 包裹层的
                transform 层叠上下文。定位按 dotTop 计算，下半区向上翻转。 */}
            {cardIndex != null && hoveredCluster != null && clusters[cardIndex]?.key === hoveredCluster.key ? (
                <div
                    className="absolute left-full z-50 pl-2"
                    style={
                        cardPlaceBelow
                            ? { top: cardTop }
                            : { top: "auto", bottom: Math.max(0, railContentHeight - cardTop) }
                    }
                    onMouseEnter={() => {
                        clearTimers();
                        setOpenIndex(cardIndex);
                    }}
                    onMouseLeave={() => {
                        clearTimers();
                        if (pinnedIndex === cardIndex) return; // 钉住的卡片只能点刻度或 Close 关闭
                        closeTimer.current = window.setTimeout(() => {
                            setOpenIndex(null);
                            setHoverIndex(null);
                        }, 320);
                    }}
                >
                    <AnnotationCard
                        cluster={hoveredCluster}
                        onPin={() => setPinnedIndex(cardIndex)}
                        onClose={
                            pinnedIndex === cardIndex
                                ? () => {
                                      clearTimers();
                                      setPinnedIndex(null);
                                      setOpenIndex(null);
                                      setHoverIndex(null);
                                  }
                                : undefined
                        }
                        nodePreview={
                            previewBySeq?.get(hoveredCluster.items[0]?.seq ?? -1) ??
                            hoveredCluster.items[0]?.annotations[0]?.anchorPreview
                        }
                        onJump={onJump}
                        onAccept={onAccept}
                        onDiscard={onDiscard}
                        onNodeTextSave={onNodeTextSave}
                    />
                </div>
            ) : null}
        </div>
    );
}
