// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话详情消息流的「页内过滤 + 日分段头 / GapRow 插入」纯逻辑
// （v2 设计 §4.2c 页内渲染 / §3.2 时间桶 / §4.1 组件树）。
//
// 为什么单独成文件：这两步都是纯数组变换 —— 过滤只改变行集合，插入只改变渲染行 ——
// 放这里可以脱离 React / 虚拟滚动 / 真实布局直接单测。session-detail 只负责喂数据：
//
//     renderItems（全量） → filterTimelineItemsToPage（非 all 模式页内过滤）
//     → groupConsecutiveTools（既有工具折叠）
//     → insertBucketHeaders（日分段头 + 跨天 GapRow）
//
// all 模式的回归底线：page 为 null 时过滤函数**原样返回同一引用**，插入函数在
// buckets 为空时也原样返回 —— 两条路径下 flow 与现状逐字节等价。

import {
    UnknownBucketKey,
    annotationKindMeta,
    type AnnotationRailItem,
    type TimeBucket,
    type TimeBucketRelative,
} from "./annotation-model";
import type { SessionDetailBucketHeader, SessionDetailGapRow, SessionFlowRow } from "./timeline-virtual";
import { formatSessionDateCompact } from "./utils";
import type { SessionDetailRow, SessionDetailTimelineItem } from "./utils";

/**
 * 页空间（页内过滤用）：只需要区间边界 —— 区间过滤比 Set 查询便宜，且能把区间内
 * 锚定到消息的工具行 / thinking 行一并带上。live turn 的行 seq 从 10_000_000 起
 * （use-live-turn 的 LiveSeqBase），永远在页区间之外，由 `alwaysIncludeFromSeq` 保留。
 */
export type PageSeqRange = {
    /** 页内首条消息 seq（含）。 */
    startSeq: number;
    /** 页内末条消息 seq（含）。 */
    endSeq: number;
};

/** 行的锚点 seq：消息行 = 自身 seq；工具行 / 折叠组 = 锚定的消息 seq。 */
export function rowAnchorSeq(row: SessionDetailRow): number {
    if (row.kind === "message") return row.message.seq;
    return row.anchorSeq;
}

/**
 * 页内过滤（§4.2c「分页只在前端渲染层」）。
 *
 * - `page` 为 null（all 模式）：**返回同一引用**，行为与现状逐字节等价。
 * - 非 all 模式：只保留 `startSeq..endSeq` 区间内的行（工具行按 anchorSeq 判）。
 *   过滤发生在 groupConsecutiveTools 之前，页边界天然把连续工具行切开，
 *   不会出现「一个折叠组横跨两页」。
 * - `alwaysIncludeFromSeq`：seq ≥ 该值的行无条件保留（实时 turn 的合成行；
 *   见 use-live-turn 的 LiveSeqBase —— 不保留的话，分页模式下发消息后内容凭空消失）。
 */
export function filterTimelineItemsToPage(
    items: SessionDetailTimelineItem[],
    page: PageSeqRange | null | undefined,
    opts: { alwaysIncludeFromSeq?: number } = {}
): SessionDetailTimelineItem[] {
    if (page == null) return items;
    const alwaysFrom = opts.alwaysIncludeFromSeq ?? Number.POSITIVE_INFINITY;
    return items.filter((item) => {
        const seq = item.kind === "message" ? item.message.seq : item.anchorSeq;
        if (seq >= alwaysFrom) return true;
        return seq >= page.startSeq && seq <= page.endSeq;
    });
}

function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

/** 本地日历日 "YYYY-MM-DD"（直接读 Date 的本地日历字段，无时区换算 / DST 换算）。 */
function localDateKeyOf(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * dateKey → 本地日历日序号（天粒度）。
 *
 * 日界线**必须**走本地日历构造：把 dateKey 的字段放进 `Date.UTC` 再除以 86400000。
 * `Date.UTC` 不受 DST 影响，23h / 25h 的墙钟日也能得到正好差 1 的序号；禁止
 * `ts / 86400000` 反推（DST 日会差 1 小时，§3.2 / §3.9 同源约束 —— 与
 * annotation-model 的 calendarDayIndexOf 同一算法，那边不导出，这里复刻一份）。
 */
function calendarDayIndexOfDateKey(dateKey: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (match == null) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/** 相对日期档（今天/昨天）；unknown / 非法 dateKey / 其余日子返回 null。 */
export function relativeOfDateKey(dateKey: string, now: number): TimeBucketRelative {
    if (dateKey === UnknownBucketKey) return null;
    const nowDate = new Date(now);
    const todayKey = localDateKeyOf(nowDate);
    if (dateKey === todayKey) return "today";
    // 「昨天」用本地日历构造（new Date(y, m, d-1)），月份/年份回退由 Date 自己处理，DST 安全。
    const yesterdayKey = localDateKeyOf(new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1));
    return dateKey === yesterdayKey ? "yesterday" : null;
}

/** 时间戳（ms）→ 本地日历日 "YYYY-MM-DD"（虚拟化路径「当前日」悬浮 chip 用）。 */
export function dateKeyOfTimestamp(ts: number): string {
    return localDateKeyOf(new Date(ts));
}

/** dateKey（"YYYY-MM-DD"）→ 本地日历当日 0 点的 ms；非法 / unknown 返回 null。 */
export function dateKeyToTimestamp(dateKey: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (match == null) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

/**
 * 分段头的绝对日期展示：与列表 / 翻页条同款紧凑格式（同年省略年份）。
 * 11-02-datetime-format-config 落地后，把 formatSessionDateCompact 换成配置驱动的
 * 格式化器即可（与 annotation-pager 的 formatDateKeyLabel 同一对接点）。
 */
export function bucketHeaderAbsoluteLabel(dateKey: string, now: number = Date.now()): string {
    const ts = dateKeyToTimestamp(dateKey);
    if (ts == null) return dateKey;
    return formatSessionDateCompact(ts, now);
}

/**
 * 密度微条数据：桶内各 kind 的**批注条数**（不是节点数 —— 同一节点多条批注都算），
 * 按 AnnotationKindMetaTable.order 升序；未知 kind 排最后（不静默丢弃）。
 */
export function bucketKindCounts(items: AnnotationRailItem[]): SessionDetailBucketHeader["kindCounts"] {
    const counts = new Map<string, number>();
    for (const item of items) {
        for (const annotation of item.annotations) {
            counts.set(annotation.kind, (counts.get(annotation.kind) ?? 0) + 1);
        }
    }
    const orderOf = (kind: string) => annotationKindMeta(kind)?.order ?? Number.MAX_SAFE_INTEGER;
    return [...counts.entries()]
        .filter(([, count]) => count > 0)
        .sort((left, right) => orderOf(left[0]) - orderOf(right[0]) || left[0].localeCompare(right[0]))
        .map(([kind, count]) => ({ kind, count }));
}

type PendingHeader = {
    header: SessionDetailBucketHeader;
    gapRow: SessionDetailGapRow | null;
    /** 桶内首个可定位锚点 seq（> 0 的最小 seq）；决定插入位置。 */
    firstSeq: number;
    /** 插入点：首个 anchorSeq ≥ firstSeq 的行下标；-1 = 桶在当前行集合之外。 */
    insertIndex: number;
};

/**
 * 桶内首个可定位锚点：> 0 的最小 seq。
 *
 * seq=0 是 AI 草稿落库时的占位（未重锚定），没有可对应的渲染行 —— 整桶都找不到
 * 锚点时跳过该桶（分段头是「行对齐」的：没有行可贴，头浮在未知位置比不出更糟；
 * rail 的 unknown 桶仍兜底展示这些条目，不静默丢弃）。
 */
function firstAnchorableSeq(items: AnnotationRailItem[]): number | null {
    let first: number | null = null;
    for (const item of items) {
        if (item.seq <= 0) continue;
        if (first == null || item.seq < first) first = item.seq;
    }
    return first;
}

export type InsertBucketHeadersOptions = {
    /** 当前页渲染作用域（§4.2c）：非 all 模式只保留与当前页有交集的桶，count/kindCounts 同步收窄；all 模式不传。 */
    scopeSeqs?: Set<number>;
    /** 计算相对日期档（今天/昨天）的基准时刻；缺省 Date.now()。 */
    now?: number;
};

/**
 * 把日分段头 / 跨天 GapRow 插进渲染行（§4.1 BucketSection + GapRow）。
 *
 * - 分段头只在「有批注锚定的日子」生成（buildTimeBuckets 只产有批注的桶）；
 *   buckets 为空（空态 / 加载中）时**原样返回同一引用**，flow 与现状等价。
 * - 头插在「首个 anchorSeq ≥ 桶首条 seq」的行前面 —— 与 gutter 标记同一对齐语义。
 *   桶首条 seq 超出当前行集合（页外 / 已被过滤）→ 不出头。
 * - GapRow 的天数按「相邻两个**可见**分段头」之间的日历差重算：all 模式下与桶的
 *   gapDaysBefore 逐值相等（可见 = 全部）；分页模式下首个可见头之前不出 GapRow。
 * - 同一个插入点撞上多个桶（不同 firstSeq、同一行）时按 firstSeq 升序排列。
 */
export function insertBucketHeaders(
    rows: SessionDetailRow[],
    buckets: TimeBucket[],
    opts: InsertBucketHeadersOptions = {}
): SessionFlowRow[] {
    if (buckets.length === 0) return rows;
    const scopeSeqs = opts.scopeSeqs;
    const now = opts.now ?? Date.now();

    const pending: PendingHeader[] = [];
    let previousDayIndex: number | null = null;
    for (const bucket of buckets) {
        const scopedItems = scopeSeqs == null ? bucket.items : bucket.items.filter((item) => scopeSeqs.has(item.seq));
        if (scopedItems.length === 0) continue;
        const firstSeq = firstAnchorableSeq(scopedItems);
        if (firstSeq == null) continue;
        // 桶首条 seq 超出当前渲染集合（页外 / 已被过滤 / 孤儿锚点）→ 不出头：
        // 头会浮在流末尾而不是贴着它的行，与 gutter 标记（拿不到行位置不出点）同语义。
        const insertIndex = rows.findIndex((row) => rowAnchorSeq(row) >= firstSeq);
        if (insertIndex < 0) continue;
        // 桶序即时间正序（unknown 恒最后、无日历位置）：gap 只在两个可见日之间产生。
        const dayIndex = calendarDayIndexOfDateKey(bucket.dateKey);
        const gapDays =
            dayIndex == null || previousDayIndex == null ? 0 : Math.max(0, dayIndex - previousDayIndex - 1);
        if (dayIndex != null) previousDayIndex = dayIndex;
        pending.push({
            header: {
                kind: "bucketHeader",
                dateKey: bucket.dateKey,
                relative: relativeOfDateKey(bucket.dateKey, now),
                count: scopedItems.length,
                kindCounts: bucketKindCounts(scopedItems),
            },
            gapRow: gapDays > 0 ? { kind: "gapRow", dateKey: bucket.dateKey, gapDays } : null,
            firstSeq,
            insertIndex,
        });
    }
    if (pending.length === 0) return rows;

    // 按 firstSeq 升序插入保证插入点单调（时间戳乱序的桶不会交叉）。
    pending.sort((left, right) => left.firstSeq - right.firstSeq);
    const out: SessionFlowRow[] = [];
    let cursor = 0;
    for (const entry of pending) {
        while (cursor < entry.insertIndex) {
            out.push(rows[cursor]);
            cursor += 1;
        }
        if (entry.gapRow != null) out.push(entry.gapRow);
        out.push(entry.header);
    }
    while (cursor < rows.length) {
        out.push(rows[cursor]);
        cursor += 1;
    }
    return out;
}
