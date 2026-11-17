// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// gutter 行对齐标记的纯计算 + 前插 scrollTop 锚定（v2 设计 §4.2b / §3.8）。
//
// 为什么单独成文件：这两个都是纯数字逻辑 —— 「行顶 y → rail body 坐标」的换算和
// 「前插一页后 scrollTop 补多少」—— 放这里可以脱离 React / 虚拟滚动 / 真实布局单测。
// session-detail 只负责把「目标行顶部位置」喂进来：
//   - 虚拟化（>60 行）：`virtualizer.getVirtualItems()` 的 `item.start`（不读 DOM rect）；
//   - 非虚拟化（短会话，主路径）：`messageRefs` 拿到的行 DOM 的 rect。
//
// 坐标契约（唯一公式，两边都按它算）：
//
//     y = rowTop - scrollTop - railBodyTop + anchorOffset
//
// 其中
//   rowTop       目标消息行顶边在**滚动内容坐标系**里的位置（0 = 滚动容器 padding-box 顶）；
//   scrollTop    滚动容器当前 scrollTop（同一坐标系里滚动位移）；
//   railBodyTop  rail 本体（`.annotation-rail-body`）顶边在同一坐标系里的位置 —— 布局常量，
//                session-detail 首帧实测一次、ResizeObserver / resize 时失效重测；
//   anchorOffset marker 锚点相对行顶的偏移（落在「行首内容」中线上）。
//
// 自证（非虚拟化路径务必对得上）：
//   rowTop = nodeRect.top - paddingBoxTop + scrollTop
//   ⇒ y = nodeRect.top - paddingBoxTop - railBodyTop + anchorOffset
//   而 railBodyRect.top = paddingBoxTop + railBodyTop
//   ⇒ y = nodeRect.top - railBodyRect.top + anchorOffset
//   即「行的屏幕 y − rail 本体的屏幕 y」，与设计文档 §4.2b「marker y = 目标消息行屏幕 y」一致。

import type { AnnotationLike } from "./annotation-model";
import type { AnnotationGutterMarker } from "./annotation-rail";

/** 视口裁剪容差（px）：边缘半露的标记仍然送出去（rail 内部还会按真实高度再裁一次）。 */
export const GutterMarkerViewportMargin = 24;

/**
 * marker 锚点相对目标行顶边的偏移（px）。
 *
 * 标记要贴「行首内容」的中线，而不是行盒顶边：消息行首行约 14px 行高的一半。
 * 行高不同的行（tool 行 / 代码块）误差都在几 px 内，视觉上仍读作「贴着这一行」。
 */
export const GutterMarkerRowAnchorOffset = 14;

export type GutterMarkerMetrics = {
    /** 滚动容器当前 scrollTop（px，滚动内容坐标系）。 */
    scrollTop: number;
    /** rail 本体顶边在滚动内容坐标系里的位置（px）。 */
    railBodyTop: number;
    /** rail 本体高度（px）：视口裁剪用；<= 0 视为尚未测量 → 不裁剪（宁可先画，不闪空白）。 */
    railBodyHeight: number;
    /** marker 锚点偏移，缺省 `GutterMarkerRowAnchorOffset`。 */
    anchorOffset?: number;
    /** 视口裁剪容差，缺省 `GutterMarkerViewportMargin`。 */
    margin?: number;
};

export type GutterMarkerOptions = GutterMarkerMetrics & {
    /** 当前页渲染作用域（§4.2c）：非 all 模式只算当前页的批注，缺省 = 整窗口。 */
    scopeSeqs?: Set<number>;
};

/**
 * 按行分组（seq 升序，组内保持 (seq,id) 升序 —— 入参已是该顺序）。
 * 同一行多条批注 = 一个标记（§4.2b「两个标记指向同一行 → 合成一个 cluster」）。
 */
export function groupAnnotationsBySeq(annotations: AnnotationLike[]): Map<number, AnnotationLike[]> {
    const groups = new Map<number, AnnotationLike[]>();
    for (const annotation of annotations) {
        const existing = groups.get(annotation.seq);
        if (existing == null) groups.set(annotation.seq, [annotation]);
        else existing.push(annotation);
    }
    return groups;
}

/**
 * 计算 gutter 标记（§4.2b）。
 *
 * - 同一行多条合一个标记；组内保持 (seq,id) 升序，卡片仍能列出该行全部批注。
 * - 拿不到行位置（行不在当前渲染窗口 / 虚拟化视区外）→ 不产出标记（视口外本来不渲染）。
 * - 超出「rail body ± margin」的标记先在这里裁掉，减少传给 rail 的数据量
 *   （rail 的 `layoutGutterMarkers` 还会按最小间距与真实高度再裁一次）。
 * - 输出按 seq 升序：rail 的 `layoutGutterMarkers` 依赖 y 单调递增做 `MarkerMinGap` 错开。
 */
export function computeGutterMarkers(
    annotations: AnnotationLike[],
    rowTopOf: (seq: number) => number | undefined,
    options: GutterMarkerOptions
): AnnotationGutterMarker[] {
    if (annotations.length === 0) return [];
    const scopeSeqs = options.scopeSeqs;
    const anchorOffset = options.anchorOffset ?? GutterMarkerRowAnchorOffset;
    const margin = options.margin ?? GutterMarkerViewportMargin;
    const measured = Number.isFinite(options.railBodyHeight) && options.railBodyHeight > 0;
    const groups = groupAnnotationsBySeq(scopeSeqs == null ? annotations : annotations.filter((entry) => scopeSeqs.has(entry.seq)));
    const markers: AnnotationGutterMarker[] = [];
    for (const [seq, items] of groups) {
        const rowTop = rowTopOf(seq);
        if (rowTop == null || !Number.isFinite(rowTop)) continue;
        const y = rowTop - options.scrollTop - options.railBodyTop + anchorOffset;
        if (measured && (y < -margin || y > options.railBodyHeight + margin)) continue;
        markers.push({ seq, y, items });
    }
    markers.sort((left, right) => left.seq - right.seq);
    return markers;
}

/**
 * 标记数组等价判定（滚动路径的性能契约：内容没变就不 setState，避免每帧重渲 rail）。
 * 只比 `(seq, y)` 与批注条数：`items` 内部引用变化不影响 rail 渲染（rail 以
 * `annotations` prop 为渲染真相源，markers 只用来定位）。
 */
export function gutterMarkersEqual(
    left: ReadonlyArray<AnnotationGutterMarker>,
    right: ReadonlyArray<AnnotationGutterMarker>
): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        const a = left[index];
        const b = right[index];
        if (a.seq !== b.seq || a.y !== b.y || a.items.length !== b.items.length) return false;
    }
    return true;
}

/**
 * seq → 锚点消息时间戳的解析器（store 的 `tsOf` 入参）。
 *
 * 必须是**引用稳定**的函数（`useAnnotationWindow` 的窗口派生 memo 按引用比对），
 * 所以调用方要 `useMemo(() => createSeqTimestampOf(map), [map])`。
 */
export function createSeqTimestampOf(
    timestamps: ReadonlyMap<number, number> | null | undefined
): (seq: number) => number | undefined {
    if (timestamps == null) return () => undefined;
    return (seq: number) => timestamps.get(seq);
}

/** 前插前的滚动几何（§3.8）：内容高度与滚动位置。 */
export type PrependAnchorSnapshot = {
    /** 前插**之前**的内容总高（虚拟化下取 virtualizer.getTotalSize()）。 */
    scrollHeight: number;
    /** 前插**之前**的 scrollTop。 */
    scrollTop: number;
};

/**
 * §3.8 前插补偿量：内容长高多少，scrollTop 就要跟着加多少，视口像素才不动。
 * 非法值一律当 0（拿不到高度时保持现状，不做假补偿）。
 */
export function prependAnchorDelta(snapshot: PrependAnchorSnapshot, scrollHeightAfter: number): number {
    if (!Number.isFinite(snapshot.scrollHeight) || !Number.isFinite(scrollHeightAfter)) return 0;
    return scrollHeightAfter - snapshot.scrollHeight;
}

/**
 * 应用前插补偿（纯对象写入，jsdom 下可用假容器单测）。
 *
 * 调用方必须在数据落地后的**同一帧**（useLayoutEffect）执行，否则会先渲染再补偿，
 * 闪一帧空白（§3.8 / 10-27 virtual-row-stability 同源约束）。
 */
export function applyPrependAnchor(
    container: { scrollTop: number },
    snapshot: PrependAnchorSnapshot,
    scrollHeightAfter: number
): number {
    const delta = prependAnchorDelta(snapshot, scrollHeightAfter);
    const next = snapshot.scrollTop + delta;
    container.scrollTop = Number.isFinite(next) ? Math.max(0, next) : snapshot.scrollTop;
    return container.scrollTop;
}
