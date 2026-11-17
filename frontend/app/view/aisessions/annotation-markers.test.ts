// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// gutter 标记纯函数 + 前插锚定（v2 设计 §4.2b / §3.8）单测。
//
// 锁定的契约：
//   1. 坐标公式 y = rowTop - scrollTop - railBodyTop + anchorOffset（非虚拟化路径可退化为
//      「行屏幕 y − rail 本体屏幕 y」，见 description 里的自证）。
//   2. 同一行多条批注 = 一个标记（组内保持 (seq,id) 升序）。
//   3. 视口外先裁（railBodyHeight ± margin），未测量（<=0）不裁。
//   4. 拿不到行位置的行不产出标记（虚拟化视区外 / 非虚拟化未挂载）。
//   5. 滚动路径的 diff：内容等价 → 同一引用（不 setState）。
//   6. 前插补偿：delta = scrollHeight_after - scrollHeight_before，同帧写回 scrollTop。

import { describe, expect, it } from "vitest";
import type { AnnotationLike } from "./annotation-model";
import {
    GutterMarkerRowAnchorOffset,
    GutterMarkerViewportMargin,
    applyPrependAnchor,
    computeGutterMarkers,
    createSeqTimestampOf,
    groupAnnotationsBySeq,
    gutterMarkersEqual,
    prependAnchorDelta,
} from "./annotation-markers";

function annotation(seq: number, id: number, overrides: Partial<AnnotationLike> = {}): AnnotationLike {
    return {
        id,
        sessionKey: "s1",
        anchorKey: `seq:${seq}`,
        seq,
        kind: "note",
        title: `t${id}`,
        body: "",
        tags: [],
        status: "accepted",
        source: "user",
        ...overrides,
    };
}

const metrics = { scrollTop: 0, railBodyTop: 0, railBodyHeight: 600 };

describe("groupAnnotationsBySeq", () => {
    it("按行分组并保持 (seq,id) 升序（多条目同行不丢）", () => {
        const groups = groupAnnotationsBySeq([
            annotation(3, 1),
            annotation(3, 2),
            annotation(7, 3),
        ]);
        expect([...groups.keys()]).toEqual([3, 7]);
        expect(groups.get(3)!.map((entry) => entry.id)).toEqual([1, 2]);
        expect(groups.get(7)!.map((entry) => entry.id)).toEqual([3]);
    });

    it("空输入 → 空表", () => {
        expect(groupAnnotationsBySeq([]).size).toBe(0);
    });
});

describe("computeGutterMarkers — 坐标公式", () => {
    it("y = rowTop - scrollTop - railBodyTop + anchorOffset", () => {
        const markers = computeGutterMarkers([annotation(5, 1)], () => 300, {
            scrollTop: 100,
            railBodyTop: 20,
            railBodyHeight: 600,
        });
        expect(markers).toHaveLength(1);
        expect(markers[0].seq).toBe(5);
        expect(markers[0].y).toBe(300 - 100 - 20 + GutterMarkerRowAnchorOffset);
    });

    it("非虚拟化路径自证：y 等价于「行屏幕 y − rail 本体屏幕 y + anchorOffset」", () => {
        // 假布局：padding-box 顶在视口 y=40，滚动容器 paddingTop=12，rail 本体顶在视口 y=88。
        const paddingBoxTop = 40;
        const padTop = 12;
        const railBodyScreenTop = 88;
        const scrollTop = 130;
        // 行 DOM rect（视口坐标）：内容坐标系 rowTop = padTop + 行内容偏移
        const rowContentOffset = 250;
        const rowScreenTop = paddingBoxTop + padTop + rowContentOffset - scrollTop;
        const rowTop = rowScreenTop - paddingBoxTop + scrollTop;
        const railBodyTop = railBodyScreenTop - paddingBoxTop;
        const markers = computeGutterMarkers([annotation(1, 1)], () => rowTop, {
            scrollTop,
            railBodyTop,
            railBodyHeight: 600,
        });
        expect(markers[0].y).toBe(rowScreenTop - railBodyScreenTop + GutterMarkerRowAnchorOffset);
    });

    it("scrollTop 增大时标记上移（跟随内容，不漂浮）", () => {
        const before = computeGutterMarkers([annotation(1, 1)], () => 400, metrics)[0].y;
        const after = computeGutterMarkers([annotation(1, 1)], () => 400, { ...metrics, scrollTop: 120 })[0].y;
        expect(before - after).toBe(120);
    });

    it("anchorOffset 可覆盖（默认 GutterMarkerRowAnchorOffset）", () => {
        const markers = computeGutterMarkers([annotation(1, 1)], () => 100, { ...metrics, anchorOffset: 0 });
        expect(markers[0].y).toBe(100);
    });
});

describe("computeGutterMarkers — 合簇 / 裁剪 / 缺行", () => {
    it("同一行多条批注合成一个标记，items 保留全部", () => {
        const markers = computeGutterMarkers(
            [annotation(2, 1), annotation(2, 2), annotation(9, 3)],
            (seq) => (seq === 2 ? 100 : 200),
            metrics
        );
        expect(markers.map((marker) => marker.seq)).toEqual([2, 9]);
        expect(markers[0].items.map((entry) => entry.id)).toEqual([1, 2]);
        expect(markers[1].items.map((entry) => entry.id)).toEqual([3]);
    });

    it("视口外（超出 railBodyHeight ± margin）先裁掉", () => {
        const markers = computeGutterMarkers(
            [annotation(1, 1), annotation(2, 2), annotation(3, 3)],
            (seq) => (seq === 1 ? -200 : seq === 2 ? 100 : 900),
            { scrollTop: 0, railBodyTop: 0, railBodyHeight: 600 }
        );
        expect(markers.map((marker) => marker.seq)).toEqual([2]);
    });

    it("边缘半露（±margin 内）仍产出，交给 rail 再裁", () => {
        const markers = computeGutterMarkers([annotation(1, 1), annotation(2, 2)], (seq) => (seq === 1 ? -10 : 605), {
            scrollTop: 0,
            railBodyTop: 0,
            railBodyHeight: 600,
        });
        expect(markers.map((marker) => marker.seq)).toEqual([1, 2]);
        expect(GutterMarkerViewportMargin).toBeGreaterThanOrEqual(10);
    });

    it("railBodyHeight <= 0（尚未测量）不裁剪", () => {
        const markers = computeGutterMarkers([annotation(1, 1)], () => 5000, {
            scrollTop: 0,
            railBodyTop: 0,
            railBodyHeight: 0,
        });
        expect(markers).toHaveLength(1);
    });

    it("拿不到行位置 → 不产出标记", () => {
        const markers = computeGutterMarkers([annotation(1, 1), annotation(2, 2)], (seq) => (seq === 1 ? 50 : undefined), metrics);
        expect(markers.map((marker) => marker.seq)).toEqual([1]);
    });

    it("作用域收窄（§4.2c）：只算当前页 seq 集合内的批注", () => {
        const markers = computeGutterMarkers(
            [annotation(1, 1), annotation(2, 2), annotation(3, 3)],
            (seq) => seq * 100,
            { ...metrics, scopeSeqs: new Set([2]) }
        );
        expect(markers.map((marker) => marker.seq)).toEqual([2]);
        expect(markers[0].items.map((entry) => entry.id)).toEqual([2]);
    });

    it("输出按 seq 升序（rail 的 MarkerMinGap 错开依赖单调 y）", () => {
        const markers = computeGutterMarkers(
            [annotation(5, 1), annotation(1, 2), annotation(3, 3)],
            (seq) => seq * 50,
            metrics
        );
        expect(markers.map((marker) => marker.seq)).toEqual([1, 3, 5]);
    });

    it("空批注 → 空数组（不返回值之外的任何东西）", () => {
        expect(computeGutterMarkers([], () => 10, metrics)).toEqual([]);
    });
});

describe("gutterMarkersEqual — 滚动路径不每帧 setState", () => {
    const base = computeGutterMarkers([annotation(1, 1), annotation(2, 2)], (seq) => seq * 100, metrics);

    it("内容一致（含重新计算的同值数组）→ 相等", () => {
        const again = computeGutterMarkers([annotation(1, 1), annotation(2, 2)], (seq) => seq * 100, metrics);
        expect(again).not.toBe(base);
        expect(gutterMarkersEqual(base, again)).toBe(true);
    });

    it("y 变化（滚动后）→ 不等", () => {
        const moved = computeGutterMarkers([annotation(1, 1), annotation(2, 2)], (seq) => seq * 100, {
            ...metrics,
            scrollTop: 30,
        });
        expect(gutterMarkersEqual(base, moved)).toBe(false);
    });

    it("条数不同 / seq 不同 → 不等", () => {
        expect(gutterMarkersEqual(base, base.slice(0, 1))).toBe(false);
        const otherSeq = computeGutterMarkers([annotation(1, 1), annotation(9, 9)], (seq) => seq * 100, metrics);
        expect(gutterMarkersEqual(base, otherSeq)).toBe(false);
    });

    it("同一行的批注条数变化 → 不等（卡片内容要跟着换）", () => {
        const withExtra = computeGutterMarkers(
            [annotation(1, 1), annotation(1, 2), annotation(2, 2)],
            (seq) => seq * 100,
            metrics
        );
        expect(gutterMarkersEqual(base, withExtra)).toBe(false);
    });
});

describe("createSeqTimestampOf", () => {
    it("命中返回时间戳，缺失返回 undefined，无表时恒 undefined", () => {
        const of = createSeqTimestampOf(new Map([[1, 1000]]));
        expect(of(1)).toBe(1000);
        expect(of(2)).toBeUndefined();
        expect(createSeqTimestampOf(undefined)(1)).toBeUndefined();
        expect(createSeqTimestampOf(null)(1)).toBeUndefined();
    });

    it("同一份表返回同一引用语义的解析结果（store 的窗口派生按引用比对）", () => {
        const map = new Map([[3, 42]]);
        const of = createSeqTimestampOf(map);
        expect(of(3)).toBe(of(3));
    });
});

describe("前插锚定（§3.8 / 判据 S2）", () => {
    it("内容长高 240 → scrollTop +240（视口像素不动）", () => {
        const container = { scrollTop: 500 };
        const applied = applyPrependAnchor(container, { scrollHeight: 1000, scrollTop: 500 }, 1240);
        expect(applied).toBe(740);
        expect(container.scrollTop).toBe(740);
    });

    it("内容长度不变（本批只有标记、没有插行）→ scrollTop 原样", () => {
        const container = { scrollTop: 500 };
        expect(applyPrependAnchor(container, { scrollHeight: 1000, scrollTop: 500 }, 1000)).toBe(500);
    });

    it("内容变短（驱逐更早桶）→ scrollTop 回落且不低于 0", () => {
        expect(prependAnchorDelta({ scrollHeight: 1000, scrollTop: 0 }, 700)).toBe(-300);
        const container = { scrollTop: 50 };
        expect(applyPrependAnchor(container, { scrollHeight: 1000, scrollTop: 50 }, 700)).toBe(0);
    });

    it("拿到非法高度 → delta 0，保持原 scrollTop（不做假补偿）", () => {
        expect(prependAnchorDelta({ scrollHeight: Number.NaN, scrollTop: 10 }, 100)).toBe(0);
        const container = { scrollTop: 120 };
        expect(applyPrependAnchor(container, { scrollHeight: 100, scrollTop: 120 }, Number.NaN)).toBe(120);
    });
});
