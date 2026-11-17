// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 左批注时间线 rail（v2 B1 行对齐 gutter 版，design/plans/aisessions-annotation-timeline-v2.md §4.2b）。
//
// 两种渲染路径：
//  - **gutter 路径**（传 `markers`，Step 7 由 session-detail 从 `virtualizer.getOffsetForIndex`
//    批量算好传入）：标记绝对定位 `top: y`（目标消息行的屏幕 y），rail 本体 `overflow: hidden`
//    永不滚动；视口外的标记不渲染；相邻标记按 MarkerMinGap 最小错开（`layoutGutterMarkers`）。
//  - **v1 降级路径**（不传 `markers`，Step 7 接线前的兜底）：圆点按时间分布 + 固定 28px 槽 +
//    rail 内部滚动，数据流与 2026-10-26 视觉重构版一致，保留旧 DOM 契约（dom 测试依赖）。
//
// rail 头是**绝对定位浮动工具条**（不占轴线高度）：Notes+计数、折叠、✨ 生成、类型过滤弹层
// （5 类含 node）、端帽 `↑N` / `…` / `!` 三态、草稿条、新批注 pill。
//
// 视觉规格全部在 `./annotation-rail.scss`（既定契约）：类型色经 `--ann-kind-color` 变量注入
// （值来自 `annotationKindMeta(kind).colorToken`），本文件不维护第二份 kind → 色映射。

import "./annotation-rail.scss";

import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AnnotationCard } from "./annotation-card";
import {
    AnnotationKindMetaTable,
    AnnotationRailCollapsedWidth,
    AnnotationRailExpandedWidth,
    RailAxisWidth,
    RailDotActiveSize,
    RailDotGap,
    RailDotRestingSize,
    annotationKindMeta,
    buildRailItems,
    clusterRailItems,
    layoutGutterMarkers,
    mergeRailItemsBySeq,
    type AnnotationKindMeta,
    type AnnotationLike,
    type AnnotationRailCluster,
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

/** gutter 标记输入：父级（Step 7）从 virtualizer 批量算好的「行 y + 该行批注」。 */
export type AnnotationGutterMarker = {
    /** 目标消息 seq（标记归属行的排序键）。 */
    seq: number;
    /** 标记在 rail body 坐标系里的纵向位置（px，父级经 rAF 合并算好）。 */
    y: number;
    /** 该行上的批注（父级视角的数据快照；rail 仍以 annotations prop 为渲染真相源）。 */
    items: AnnotationLike[];
};

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

/** 输入控件里的按键不归 rail 键盘模型管（卡片 textarea / 过滤弹层正在用时箭头键应正常输入）。 */
function isTypingTarget(target: EventTarget | null): boolean {
    if (target == null || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** 簇的主 kind：取簇内 (seq, id) 最小的那条批注的 kind（稳定、确定）。 */
function clusterKindMeta(cluster: AnnotationRailCluster): AnnotationKindMeta | null {
    const first = cluster.items[0]?.annotations[0];
    if (first == null) return null;
    return annotationKindMeta(first.kind);
}

/** 簇内是否含 agent 写入条目（rail 角标，§4.2；B1 阶段数据源通常没有 agent 条目，B2 接线后生效）。 */
function clusterHasAgentSource(cluster: AnnotationRailCluster): boolean {
    return cluster.items.some((item) => item.annotations.some((annotation) => annotation.source === "agent"));
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
    markers,
    scopeSeqs,
    onLoadOlder,
    loadingOlder = false,
    olderError = null,
    olderCount = 0,
    showLoadOlder = true,
    pendingNewCount = 0,
    onJumpToNew,
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
    // ── v2 B1 gutter（§4.2b）：传入即启用行对齐 gutter 渲染，缺省 = v1 降级路径。 ──
    /** 父级（Step 7）算好的行标记：marker y = 目标消息行的屏幕 y（rail body 坐标系）。 */
    markers?: AnnotationGutterMarker[];
    /** 当前页渲染作用域（§4.2c）：rail 标记 / 悬浮卡 / 过滤计数 / 草稿条 / 读数只算当前页。 */
    scopeSeqs?: Set<number>;
    /** 端帽「加载更早」：点击请求上一页（游标）数据；只在 all 模式出现（§4.2c）。 */
    onLoadOlder?: () => void;
    loadingOlder?: boolean;
    olderError?: string | null;
    /** 窗口外仍有的更早条目数（端帽 `↑N` 的 N）。 */
    olderCount?: number;
    /** 是否渲染端帽（默认 true；Step 7 按 pageMode 传，非 all 模式的加载语义由翻页条承担）。 */
    showLoadOlder?: boolean;
    /** 视口外新到批注数（§3.6「N 条新批注 ↓」pill，不自动跳转）。 */
    pendingNewCount?: number;
    onJumpToNew?: () => void;
}) {
    const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsedPreference);
    const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
    const [openIndex, setOpenIndex] = React.useState<number | null>(null);
    // 点击刻度后"钉住"卡片：悬浮卡会因为鼠标移动瞬间消失，导致 Accept 点不到。
    const [pinnedIndex, setPinnedIndex] = React.useState<number | null>(null);
    // 键盘 roving focus（§4.4）：rail 内同一时刻只有一个 marker 可 Tab 到达。
    const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
    const [filterOpen, setFilterOpen] = React.useState(false);
    // null = 不做 kind 过滤（全部显示）；非 null = 只显示集合内的 kind。
    const [kindFilter, setKindFilter] = React.useState<Set<string> | null>(null);
    // 卡片上下条导航的位置（§4.5 `‹ 1/5 ›`）；卡片切换目标时归零。
    const [cardNavIndex, setCardNavIndex] = React.useState(0);
    const { t } = useTranslation("aisessions");
    const hoverTimer = React.useRef<number | null>(null);
    const closeTimer = React.useRef<number | null>(null);
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const railRootRef = React.useRef<HTMLDivElement | null>(null);
    const markerRefs = React.useRef(new Map<number, HTMLButtonElement>());
    const [bodyHeight, setBodyHeight] = React.useState(0);
    // 悬浮卡定位需要的 rail 内部滚动量：拖动密集分支时一帧最多提交一次（v1 降级路径专用）。
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

    const gutter = markers != null;
    // 作用域收窄（§4.2c）：缺省 = 不过滤（整窗口）。
    const scopedAnnotations = React.useMemo(() => {
        if (scopeSeqs == null) return annotations;
        return annotations.filter((annotation) => scopeSeqs.has(annotation.seq));
    }, [annotations, scopeSeqs]);
    // kind 过滤只作用于标记与读数；草稿条按页内全部草稿计（采纳/丢弃不该被 kind 过滤收窄）。
    const visibleAnnotations = React.useMemo(() => {
        if (kindFilter == null) return scopedAnnotations;
        return scopedAnnotations.filter((annotation) => kindFilter.has(annotation.kind));
    }, [scopedAnnotations, kindFilter]);
    const items = React.useMemo(() => buildRailItems(visibleAnnotations), [visibleAnnotations]);
    // gutter：同一行多条合簇（mergeRailItemsBySeq，§4.2b）；v1 降级：按槽位压缩（clusterRailItems）。
    const clusters = React.useMemo(
        () => (gutter ? mergeRailItemsBySeq(items) : clusterRailItems(items)),
        [gutter, items]
    );
    const draftCount = React.useMemo(
        () => scopedAnnotations.filter((annotation) => annotation.status === "draft").length,
        [scopedAnnotations]
    );
    const kindCounts = React.useMemo(() => {
        const counts = new Map<string, number>();
        for (const annotation of scopedAnnotations) {
            counts.set(annotation.kind, (counts.get(annotation.kind) ?? 0) + 1);
        }
        return counts;
    }, [scopedAnnotations]);
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

    // 量 rail 内容区高度，决定「少节点等比铺满 / 多节点固定槽 + 滚动」分支（v1），
    // 以及 gutter 的视口裁剪（§4.2b：视口外标记不渲染）。
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

    // 过滤弹层的「点击外侧关闭」。
    React.useEffect(() => {
        if (!filterOpen) return;
        const onDocPointerDown = (event: Event) => {
            const rootEl = railRootRef.current;
            if (rootEl == null || !(event.target instanceof Node) || rootEl.contains(event.target)) return;
            setFilterOpen(false);
        };
        document.addEventListener("pointerdown", onDocPointerDown);
        return () => document.removeEventListener("pointerdown", onDocPointerDown);
    }, [filterOpen]);

    const toggleCollapsed = React.useCallback(() => {
        setCollapsed((current) => {
            writeCollapsedPreference(!current);
            return !current;
        });
    }, []);

    // 读数（§4.2c）：作用域 + kind 过滤后的条数，与画出来的标记一一对应。
    const count = visibleAnnotations.length;
    // 节点按真实时间戳分布；时间不可用时 buildTimePositions 回落为均分（v1 降级路径）。
    const positions = React.useMemo(
        () =>
            buildTimePositions(clusters.map((cluster) => ({ seq: cluster.seq, ts: seqToTimestamp?.get(cluster.seq) }))),
        [clusters, seqToTimestamp]
    );
    const timeRange = React.useMemo(
        () => timeRangeOf(clusters.map((cluster) => ({ seq: cluster.seq, ts: seqToTimestamp?.get(cluster.seq) }))),
        [clusters, seqToTimestamp]
    );
    const clusterSeqs = React.useMemo(() => clusters.map((cluster) => cluster.seq), [clusters]);
    // 滚动点（任意消息 seq）→ 最近一个已批注节点。
    const liveSeq = React.useMemo(() => nearestAnnotatedSeq(scrollSeq, clusterSeqs), [scrollSeq, clusterSeqs]);
    // 少节点：节点间距 >= RailDotGap 就铺满全高；否则固定槽 + 内部滚动（v1 降级路径）。
    const canSpread =
        !gutter &&
        count > 0 &&
        bodyHeight > 0 &&
        (count === 1 || bodyHeight - RailDotActiveSize >= (count - 1) * RailDotGap);
    const contentHeight = canSpread ? bodyHeight : count * RailDotGap;

    // 时间分布 + 最小间距松弛：挤在一起的批注不重叠，有空间时保留时间比例（v1 降级路径）。
    const spreadTops = React.useMemo(() => {
        if (!canSpread || bodyHeight <= 0) return null;
        const usable = Math.max(0, bodyHeight - RailDotActiveSize);
        const ideal = positions.map((position) => RailDotActiveSize / 2 + position * usable);
        return relaxTimelinePositions(ideal, RailDotGap, RailDotActiveSize / 2, bodyHeight - RailDotActiveSize / 2);
    }, [canSpread, bodyHeight, positions]);

    // gutter 定位（§4.2b 纯函数）：最小错开 MarkerMinGap + 视口裁剪。
    const markerYBySeq = React.useMemo(() => {
        const map = new Map<number, number>();
        for (const marker of markers ?? []) map.set(marker.seq, marker.y);
        return map;
    }, [markers]);
    const gutterLayout = React.useMemo(() => {
        if (!gutter) return [];
        return layoutGutterMarkers(
            clusters.map((cluster) => ({ seq: cluster.seq })),
            (seq) => markerYBySeq.get(seq),
            { height: bodyHeight }
        );
    }, [gutter, clusters, markerYBySeq, bodyHeight]);

    const topFor = (index: number): number => {
        if (gutter) return gutterLayout[index]?.y ?? 0;
        if (canSpread) {
            return spreadTops?.[index] ?? bodyHeight / 2;
        }
        return index * RailDotGap + RailDotGap / 2;
    };

    // 当前滚动位置在时间轴上的落点（v1 降级路径）：当前消息 timestamp 归一化到批注时间跨度。
    const playheadTop = React.useMemo(() => {
        if (gutter || !canSpread || timeRange == null || scrollSeq == null || seqToTimestamp == null) return null;
        const ts = seqToTimestamp.get(scrollSeq);
        if (ts == null) return null;
        const fraction = (ts - timeRange.min) / (timeRange.max - timeRange.min);
        const usable = Math.max(0, bodyHeight - RailDotActiveSize);
        return RailDotActiveSize / 2 + Math.max(0, Math.min(1, fraction)) * usable;
    }, [gutter, canSpread, timeRange, scrollSeq, seqToTimestamp, bodyHeight]);

    // ── 键盘 roving focus（§4.4）──
    // 默认落点 = 当前 active（liveSeq/activeSeq 命中的簇）或第一个标记。
    const defaultFocusIndex = React.useMemo(() => {
        const target = liveSeq ?? activeSeq;
        if (target != null) {
            const index = clusters.findIndex((cluster) => cluster.items.some((item) => item.seq === target));
            if (index >= 0) return index;
        }
        return 0;
    }, [liveSeq, activeSeq, clusters]);
    const safeFocusIndex =
        focusIndex != null && Number.isInteger(focusIndex) && focusIndex >= 0 && focusIndex < clusters.length
            ? focusIndex
            : null;
    const rovingIndex = safeFocusIndex ?? defaultFocusIndex;

    const focusMarker = React.useCallback(
        (index: number) => {
            const total = clusters.length;
            if (total === 0) return;
            const clamped = Math.min(Math.max(0, index), total - 1);
            setFocusIndex(clamped);
            markerRefs.current.get(clamped)?.focus();
        },
        [clusters.length]
    );

    // 端帽三态（§4.2b）：↑N（还有 N 条更早）/ …（加载中脉冲）/ !（失败可重试）。
    const olderRemaining = Math.max(0, Math.floor(olderCount ?? 0));
    const endcapVisible = showLoadOlder && (loadingOlder || olderError != null || olderRemaining > 0);
    const endcapAria = loadingOlder
        ? t("aisessions:annotationRail.loadingOlder")
        : olderError != null
          ? t("aisessions:annotationRail.loadOlderError")
          : i18n.t("aisessions:annotationRail.loadOlderTitle", { count: olderRemaining });

    const toggleKindFilter = (kind: string) => {
        setKindFilter((prev) => {
            const allKinds = AnnotationKindMetaTable.map((meta) => meta.kind);
            const enabled = prev ?? new Set<string>(allKinds);
            const next = new Set<string>(enabled);
            if (next.has(kind)) next.delete(kind);
            else next.add(kind);
            // 全开 = 回到「不过滤」，读数 / 标记恢复整窗语义。
            return next.size === allKinds.length ? null : next;
        });
    };

    // Esc 逐层关闭（§4.4）：悬浮卡 → 过滤弹层。
    const handleRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape") return;
        if (pinnedIndex != null || openIndex != null) {
            event.preventDefault();
            clearTimers();
            setPinnedIndex(null);
            setOpenIndex(null);
            setHoverIndex(null);
            return;
        }
        if (filterOpen) {
            event.preventDefault();
            setFilterOpen(false);
        }
    };

    // ↑/↓ 逐条批注（更新 focus，不自动跳转）；Home/End 首尾（§4.4）。
    const handleBodyKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isTypingTarget(event.target)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        // 卡片 / 弹层里的按键不归 rail 导航管（卡片有自己的 ←/→ 模型）。
        if (target != null && target !== event.currentTarget && !target.closest(".annotation-rail-marker-btn")) return;
        const total = clusters.length;
        if (total === 0) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const current = safeFocusIndex ?? defaultFocusIndex;
            const next = event.key === "ArrowDown" ? Math.min(total - 1, current + 1) : Math.max(0, current - 1);
            focusMarker(next);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            focusMarker(0);
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            focusMarker(total - 1);
        }
    };

    const cardIndex = pinnedIndex ?? openIndex;
    React.useEffect(() => {
        setCardNavIndex(0);
    }, [cardIndex]);
    const hoveredCluster = cardIndex != null ? clusters[cardIndex] ?? null : null;

    const railContentHeight = bodyOffsetTop + bodyHeight;
    // 悬浮卡上提到 rail 根节点渲染。dotTop = 圆点中心在 rail 根坐标系里的纵向位置
    // （减去 body 的滚动量，保证滚动后卡片仍贴着对应圆点；gutter 分支 body 不滚动）。
    const cardTop = cardIndex != null ? bodyOffsetTop + topFor(cardIndex) - bodyScrollTop : 0;
    // 圆点在 rail 上半部 → 卡片向下长；在下半部 → 向上翻转，避免长出 rail 底部。
    const cardPlaceBelow = cardTop < railContentHeight / 2;
    const cardAnnotationCount =
        hoveredCluster == null
            ? 0
            : hoveredCluster.items.reduce((sum, item) => sum + item.annotations.length, 0);

    // 折叠态（§4.3 collapsed）：16px 轴；有未读新批注时轴顶留 4px 亮点；点击展开。
    if (collapsed) {
        return (
            <div
                ref={railRootRef}
                className="annotation-rail is-collapsed"
                style={railBoxStyle}
                data-testid="annotation-rail"
                role="button"
                tabIndex={0}
                title={t("aisessions:annotationRail.expand")}
                aria-label={t("aisessions:annotationRail.expand")}
                onClick={toggleCollapsed}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleCollapsed();
                    }
                }}
            >
                <div className="annotation-rail-body" aria-hidden="true">
                    <div className="annotation-rail-axis" />
                </div>
                {pendingNewCount > 0 ? (
                    <div
                        className="annotation-rail-collapsed-dot"
                        data-testid="annotation-rail-collapsed-dot"
                        aria-hidden="true"
                    />
                ) : null}
            </div>
        );
    }

    const emptyState = items.length === 0 ? (
        <div className="annotation-rail-empty" data-testid="annotation-rail-empty">
            {onGenerateTimeline != null ? (
                <button
                    type="button"
                    className="annotation-rail-generate"
                    disabled={generating}
                    title={
                        generating ? t("aisessions:annotationRail.generating") : t("aisessions:annotationRail.generate")
                    }
                    aria-label={t("aisessions:annotationRail.generate")}
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
            <span
                className={cn("annotation-rail-empty-text", generating && "text-accent")}
                data-testid="annotation-rail-empty-text"
            >
                {generating
                    ? t("aisessions:annotationRail.generatingShort")
                    : t("aisessions:annotationRail.noAnnotations")}
            </span>
        </div>
    ) : null;

    // 加载骨架（§4.3 loading）：3 个 8px 淡点，不闪、无动画。
    const loadingSkeleton = items.length === 0 && generating ? (
        <div data-testid="annotation-rail-skeleton" aria-hidden="true">
            {[25, 50, 75].map((percent) => (
                <div key={percent} className="annotation-rail-skeleton" style={{ top: `${percent}%` }} />
            ))}
        </div>
    ) : null;

    const renderGutterMarker = (index: number, y: number) => {
        const cluster = clusters[index];
        const isActive =
            (liveSeq != null && cluster.items.some((item) => item.seq === liveSeq)) ||
            (activeSeq != null && cluster.items.some((item) => item.seq === activeSeq));
        const meta = clusterKindMeta(cluster);
        const shape = meta?.shape === "diamond" ? "diamond" : "dot";
        const markerStyle: React.CSSProperties = {
            top: y,
            ["--ann-kind-color" as string]: `var(${meta?.colorToken ?? "--secondary-text-color"})`,
        };
        return (
            <div
                key={cluster.key}
                className="annotation-rail-marker"
                data-testid="annotation-rail-marker"
                data-seq={cluster.seq}
                data-index={index}
                data-shape={shape}
                data-draft={cluster.hasDraft}
                data-orphan={cluster.hasOrphan}
                data-active={isActive}
                data-agent={clusterHasAgentSource(cluster)}
                style={markerStyle}
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
                    role="button"
                    ref={(el) => {
                        if (el != null) markerRefs.current.set(index, el);
                        else markerRefs.current.delete(index);
                    }}
                    className="annotation-rail-marker-btn"
                    aria-label={i18n.t("aisessions:annotationRail.jumpTo", { seq: cluster.seq })}
                    aria-current={isActive ? "true" : undefined}
                    tabIndex={rovingIndex === index ? 0 : -1}
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
                        setFocusIndex(index);
                        onJump(cluster.seq, cluster.items[0]?.anchorKey);
                    }}
                >
                    <span className="annotation-rail-pip" />
                </button>
            </div>
        );
    };

    return (
        // z-10：rail 自成一个 stacking level，悬浮卡（z-50）绘制在右侧聊天列（z-auto）之上。
        // 约束：本节点禁止 overflow:hidden / transform，否则悬浮卡会再次被裁切或困在局部层叠上下文。
        <div
            ref={railRootRef}
            className="annotation-rail"
            style={railBoxStyle}
            data-testid="annotation-rail"
            onKeyDown={handleRootKeyDown}
        >
            {/* 浮动工具条（§4.2b）：绝对定位不占轴线高度。 */}
            <div className="annotation-rail-head" data-testid="annotation-rail-head">
                <div className="annotation-rail-head-row">
                    <button
                        type="button"
                        className="annotation-rail-title"
                        onClick={toggleCollapsed}
                        title={t("aisessions:annotationRail.collapse")}
                        aria-label={t("aisessions:annotationRail.collapse")}
                    >
                        {t("aisessions:annotationRail.notes")}
                    </button>
                    <span className="annotation-rail-count" data-testid="annotation-rail-count">
                        {count}
                    </span>
                    <button
                        type="button"
                        className="annotation-rail-collapse"
                        onClick={toggleCollapsed}
                        title={t("aisessions:annotationRail.collapse")}
                        aria-label={t("aisessions:annotationRail.collapse")}
                    >
                        <i className="fa-sharp fa-solid fa-chevron-left annotation-rail-tool-icon" />
                    </button>
                </div>
                <div className="annotation-rail-tools">
                    {onGenerateTimeline != null ? (
                        <button
                            type="button"
                            className={cn("annotation-rail-tool", generating && "is-accent")}
                            disabled={generating}
                            title={
                                generating
                                    ? t("aisessions:annotationRail.generating")
                                    : t("aisessions:annotationRail.generate")
                            }
                            aria-label={t("aisessions:annotationRail.generate")}
                            onClick={(event) => {
                                event.stopPropagation();
                                onGenerateTimeline();
                            }}
                        >
                            <i
                                className={cn(
                                    "annotation-rail-tool-icon fa-sharp fa-solid",
                                    generating ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles"
                                )}
                            />
                        </button>
                    ) : null}
                    {scopedAnnotations.length > 0 || kindFilter != null ? (
                        <button
                            type="button"
                            className={cn("annotation-rail-tool", kindFilter != null && "is-accent")}
                            aria-expanded={filterOpen}
                            title={t("aisessions:annotationRail.filterTitle")}
                            aria-label={t("aisessions:annotationRail.filterTitle")}
                            onClick={() => setFilterOpen((current) => !current)}
                        >
                            <i className="annotation-rail-tool-icon fa-sharp fa-solid fa-filter" />
                        </button>
                    ) : null}
                    {endcapVisible ? (
                        <button
                            type="button"
                            data-testid="annotation-rail-endcap"
                            className={cn(
                                "annotation-rail-tool",
                                "is-more",
                                loadingOlder && "is-loading",
                                olderError != null && "is-error"
                            )}
                            disabled={loadingOlder}
                            title={endcapAria}
                            aria-label={endcapAria}
                            onClick={() => {
                                if (loadingOlder) return;
                                onLoadOlder?.();
                            }}
                        >
                            {loadingOlder ? (
                                <span className="annotation-rail-tool-icon" aria-hidden="true">
                                    …
                                </span>
                            ) : olderError != null ? (
                                <span className="annotation-rail-tool-icon" aria-hidden="true">
                                    !
                                </span>
                            ) : (
                                <span className="annotation-rail-tool-icon" aria-hidden="true">
                                    ↑{olderRemaining}
                                </span>
                            )}
                        </button>
                    ) : null}
                </div>
                {/* 草稿条（§4.3 drafts）：✎ N + 丢弃全部 / 采纳全部两个图标钮。 */}
                {draftCount > 0 ? (
                    <div
                        className="annotation-rail-drafts"
                        data-testid="annotation-rail-drafts"
                        title={i18n.t("aisessions:annotationRail.drafts", { count: draftCount })}
                    >
                        <span className="annotation-rail-drafts-count">
                            <i className="fa-sharp fa-solid fa-pen-to-square text-[7px]" />
                            <span data-testid="annotation-rail-drafts-count">{draftCount}</span>
                        </span>
                        <span className="annotation-rail-drafts-actions">
                            {onDiscardAllDrafts != null ? (
                                <button
                                    type="button"
                                    title={t("aisessions:annotationRail.discardAll")}
                                    aria-label={t("aisessions:annotationRail.discardAll")}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onDiscardAllDrafts();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-xmark" />
                                </button>
                            ) : null}
                            {onAcceptAllDrafts != null ? (
                                <button
                                    type="button"
                                    title={t("aisessions:annotationRail.acceptAll")}
                                    aria-label={t("aisessions:annotationRail.acceptAll")}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onAcceptAllDrafts();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-check" />
                                </button>
                            ) : null}
                        </span>
                    </div>
                ) : null}
                {/* 新批注 pill（§3.6）：视口外新到的批注只播报一次，点击才跳转。 */}
                {pendingNewCount > 0 ? (
                    <button
                        type="button"
                        className="annotation-rail-newpill"
                        data-testid="annotation-rail-newpill"
                        role="status"
                        aria-live="polite"
                        title={t("aisessions:annotationRail.newAnnotationsAria")}
                        aria-label={t("aisessions:annotationRail.newAnnotationsAria")}
                        onClick={(event) => {
                            event.stopPropagation();
                            onJumpToNew?.();
                        }}
                    >
                        <span aria-hidden="true">↓</span> {i18n.t("aisessions:annotationRail.newAnnotations", { count: pendingNewCount })}
                    </button>
                ) : null}
            </div>
            {/* rail 本体：永不滚动（overflow 两轴 hidden，§4.2b 硬约束）；v1 降级分支
                例外地按旧契约开内部滚动（密集时固定 28px 槽）。 */}
            <div
                ref={bodyRef}
                data-testid="annotation-rail-body"
                className="annotation-rail-body"
                role="navigation"
                aria-label={t("aisessions:annotationRail.railAria")}
                style={
                    gutter
                        ? undefined
                        : { overflowY: canSpread ? "visible" : "auto", overflowX: "visible" }
                }
                onScroll={railScrollCoalescer.schedule}
                onKeyDown={handleBodyKeyDown}
            >
                {gutter ? (
                    <>
                        <div className="annotation-rail-axis" aria-hidden="true" />
                        {emptyState}
                        {loadingSkeleton}
                        {gutterLayout.map((layout, index) =>
                            layout.visible ? renderGutterMarker(index, layout.y) : null
                        )}
                    </>
                ) : (
                    <div className="relative w-full" style={{ height: contentHeight }}>
                        {/* 2px 竖轴贯穿全高；居中于圆点列。 */}
                        <div
                            className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 bg-border"
                            style={{ width: RailAxisWidth, height: contentHeight }}
                            aria-hidden="true"
                        />
                        {emptyState}
                        {loadingSkeleton}
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
                                        aria-label={i18n.t("aisessions:annotationRail.jumpTo", { seq: cluster.seq })}
                                        aria-current={isActive ? "true" : undefined}
                                        tabIndex={rovingIndex === index ? 0 : -1}
                                        ref={(el) => {
                                            if (el != null) markerRefs.current.set(index, el);
                                            else markerRefs.current.delete(index);
                                        }}
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
                                            setFocusIndex(index);
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
                )}
            </div>
            {/* 类型过滤弹层（§4.2b：5 类含 node；点行切换，带计数与清除）。 */}
            {filterOpen ? (
                <div
                    className="annotation-rail-filter"
                    data-testid="annotation-rail-filter"
                    role="dialog"
                    aria-label={t("aisessions:annotationRail.filterTitle")}
                >
                    <div className="annotation-rail-filter-head">{t("aisessions:annotationRail.filterHead")}</div>
                    {[...AnnotationKindMetaTable]
                        .sort((left, right) => left.order - right.order)
                        .map((meta) => {
                            const pressed = kindFilter == null ? true : kindFilter.has(meta.kind);
                            return (
                                <button
                                    key={meta.kind}
                                    type="button"
                                    className="annotation-rail-filter-row"
                                    data-kind={meta.kind}
                                    data-shape={meta.shape}
                                    data-testid="annotation-rail-filter-row"
                                    aria-pressed={pressed}
                                    onClick={() => toggleKindFilter(meta.kind)}
                                >
                                    <span
                                        className="annotation-rail-filter-dot"
                                        style={{
                                            ["--ann-kind-color" as string]: `var(${meta.colorToken})`,
                                        }}
                                    />
                                    <span>{i18n.t(meta.labelKey as never)}</span>
                                    <span className="annotation-rail-filter-count" data-testid="annotation-rail-filter-count">
                                        {kindCounts.get(meta.kind) ?? 0}
                                    </span>
                                </button>
                            );
                        })}
                    <button
                        type="button"
                        className="annotation-rail-filter-clear"
                        onClick={() => setKindFilter(null)}
                    >
                        {t("aisessions:annotationRail.filterClear")}
                    </button>
                </div>
            ) : null}
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
                        navIndex={cardNavIndex}
                        navTotal={cardAnnotationCount}
                        onNavigate={
                            cardAnnotationCount > 1
                                ? (delta) => {
                                      setCardNavIndex((current) =>
                                          Math.min(Math.max(0, current + delta), cardAnnotationCount - 1)
                                      );
                                  }
                                : undefined
                        }
                    />
                </div>
            ) : null}
        </div>
    );
}
