// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the annotation timeline. No React component / jotai / DOM imports so it
// can be unit-tested directly. (i18n 是项目级单例：默认桶 label 的「今天/昨天/未知时间」
// 文案走 i18n key，与同目录 annotation-assist.ts 的做法一致；日期部分的格式可经
// `labelFor` 注入点覆盖 —— 见 buildTimeBuckets 的注释。)
//
// 只画「有批注的节点」；节点数量过多时按时间顺序聚成簇，避免 rail 被
// 几千条消息撑爆。簇内 hover 仍能看到该簇的全部批注。

import { i18n } from "@/i18n/config";

export type AnnotationLike = {
    id: number;
    sessionKey: string;
    anchorKey: string;
    seq: number;
    kind: string;
    title: string;
    body: string;
    tags?: string[];
    status: string;
    source: string;
    userEdited?: boolean;
    orphaned?: boolean;
    anchorPreview?: string;
    /** 用户手改的「节点原文」副本；空/undefined 表示未覆盖，回落活节点文本。 */
    nodeText?: string;
    updatedAt?: number;
};

/**
 * 一条消息的批注锚点 key。
 *
 * 正常情况用 provider 给的 ItemKey；但会话详情里的消息是从 SQLite 缓存读出来的
 * （`ai_session_messages` 没有 item_key 列），ItemKey 恒为空 —— 此时必须回落到
 * 一个仍然稳定的标识，否则「手动添加批注」的入口整块消失。消息 seq 来自文件顺序，
 * 对同一份会话文件是稳定的，用 `seq:<n>` 作合成锚点，前后端都能精确匹配。
 */
export function messageAnchorKey(message: { itemKey?: string; seq: number }): string {
    const key = message.itemKey?.trim();
    return key != null && key !== "" ? key : `seq:${message.seq}`;
}

/** 合成锚点 `seq:<n>` → n；不是合成锚点返回 null。 */
export function seqFromSyntheticAnchorKey(anchorKey: string | undefined): number | null {
    if (anchorKey == null) return null;
    const match = /^seq:(\d+)$/.exec(anchorKey.trim());
    if (match == null) return null;
    const seq = Number.parseInt(match[1], 10);
    return Number.isFinite(seq) ? seq : null;
}

export type AnnotationRailItem = {
    key: string;
    anchorKey: string;
    seq: number;
    annotations: AnnotationLike[];
    hasAccepted: boolean;
    hasDraft: boolean;
    hasOrphan: boolean;
};

export type AnnotationRailCluster = {
    key: string;
    seq: number;
    items: AnnotationRailItem[];
    hasAccepted: boolean;
    hasDraft: boolean;
    hasOrphan: boolean;
};

/** rail 折叠/展开宽度与圆点尺寸（2026-10-26 视觉重构：药丸 → 竖向圆点）。
 * 展开宽 44 → 52：v2 §4.2 给「类型色实心核 + 日期微标 + 24px hover 光晕」腾出空间。 */
export const AnnotationRailCollapsedWidth = 16;
export const AnnotationRailExpandedWidth = 52;
export const AnnotationRailSlotHeight = 8; // legacy：密集分支的单槽高度（保留兜底）
export const AnnotationRailMaxSlots = 40;
export const AnnotationFlashMs = 1200;

/** 竖向圆点 rail 的视觉常量（design.md §2）。 */
export const RailDotRestingSize = 10;
export const RailDotActiveSize = 16;
export const RailDotGap = 28; // design 的 RailMinDotGap：两态自适应阈值 + 密集分支槽距
export const RailAxisWidth = 2;

function annotationSortKey(annotation: AnnotationLike): string {
    return `${annotation.anchorKey}|${annotation.seq}`;
}

export function sortAnnotations(annotations: AnnotationLike[]): AnnotationLike[] {
    return [...annotations].sort((left, right) => {
        if (left.seq !== right.seq) return left.seq - right.seq;
        return left.id - right.id;
    });
}

/** Group annotations by their message node; only nodes that have annotations survive. */
export function buildRailItems(annotations: AnnotationLike[]): AnnotationRailItem[] {
    const groups = new Map<string, AnnotationLike[]>();
    for (const annotation of annotations) {
        const key = annotationSortKey(annotation);
        const bucket = groups.get(key);
        if (bucket == null) {
            groups.set(key, [annotation]);
        } else {
            bucket.push(annotation);
        }
    }
    const items: AnnotationRailItem[] = [];
    for (const [key, group] of groups) {
        const sorted = sortAnnotations(group);
        const first = sorted[0];
        items.push({
            key,
            anchorKey: first.anchorKey,
            seq: first.seq,
            annotations: sorted,
            hasAccepted: sorted.some((annotation) => annotation.status === "accepted"),
            hasDraft: sorted.some((annotation) => annotation.status === "draft"),
            hasOrphan: sorted.some((annotation) => annotation.orphaned === true),
        });
    }
    items.sort((left, right) => {
        if (left.seq !== right.seq) return left.seq - right.seq;
        return left.anchorKey.localeCompare(right.anchorKey);
    });
    return items;
}

/** Bucket rail items into at most `maxSlots` visual slots (keeps chronological order). */
export function clusterRailItems(
    items: AnnotationRailItem[],
    maxSlots: number = AnnotationRailMaxSlots
): AnnotationRailCluster[] {
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.floor(maxSlots));
    if (items.length <= limit) {
        return items.map((item) => ({
            key: item.key,
            seq: item.seq,
            items: [item],
            hasAccepted: item.hasAccepted,
            hasDraft: item.hasDraft,
            hasOrphan: item.hasOrphan,
        }));
    }
    const clusters: AnnotationRailCluster[] = [];
    for (let slot = 0; slot < limit; slot++) {
        const start = Math.floor((slot * items.length) / limit);
        const end = Math.floor(((slot + 1) * items.length) / limit);
        const slice = items.slice(start, Math.max(start + 1, end));
        if (slice.length === 0) continue;
        clusters.push({
            key: `cluster-${slot}`,
            seq: slice[0].seq,
            items: slice,
            hasAccepted: slice.some((item) => item.hasAccepted),
            hasDraft: slice.some((item) => item.hasDraft),
            hasOrphan: slice.some((item) => item.hasOrphan),
        });
    }
    return clusters;
}

// ---------------------------------------------------------------------------
// 行对齐 gutter（design/plans/aisessions-annotation-timeline-v2.md §4.2b）
// ---------------------------------------------------------------------------
//
// 结论：不做「独立时间轴上按时间分布圆点」——圆点会浮在没有内容的位置（空白轴上的
// 孤点），这是 v1 被评价为「丑」的根因。改为 gutter 模式（VS Code SCM gutter /
// GitHub PR 行内批注）：标记 y = 它批注的那条消息行的屏幕 y，滚动时由父级 rAF 批量
// 重算后传进来；本模块只做纯几何（最小错开 / 视口裁剪），不读 DOM。

/** 同屏相邻标记最小错开（§4.2b MarkerMinGap：正常行距 ≥28px 不触发）。 */
export const RailMarkerMinGap = 16;

/** gutter 标记数上限：超过先聚簇（§4.2b「点名 > 120 时聚合为簇，不允许缩到看不见」）。 */
export const RailGutterMaxMarkers = 120;

/**
 * gutter 合簇：同一内容行（同 seq）上的多条 rail item 合成一个标记（§4.2b：
 * 「两个标记指向同一行（多批注）→ 合成一个 cluster 标记」）。
 *
 * 与 `clusterRailItems`（按槽位压缩时间轴）不同：gutter 只按**行**合并，不压缩顺序；
 * 簇内 items 保持 buildRailItems 的 (seq, anchorKey) 升序，卡片仍能列出该行全部批注。
 */
export function mergeRailItemsBySeq(items: AnnotationRailItem[]): AnnotationRailCluster[] {
    const bySeq = new Map<number, AnnotationRailCluster>();
    for (const item of items) {
        const existing = bySeq.get(item.seq);
        if (existing == null) {
            bySeq.set(item.seq, {
                key: `row:${item.seq}`,
                seq: item.seq,
                items: [item],
                hasAccepted: item.hasAccepted,
                hasDraft: item.hasDraft,
                hasOrphan: item.hasOrphan,
            });
            continue;
        }
        existing.items.push(item);
        existing.hasAccepted = existing.hasAccepted || item.hasAccepted;
        existing.hasDraft = existing.hasDraft || item.hasDraft;
        existing.hasOrphan = existing.hasOrphan || item.hasOrphan;
    }
    // 行序 = seq 升序（buildRailItems 已排序，这里显式再排一次，纯函数不信任调用方）。
    return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export type GutterMarkerLayout = {
    seq: number;
    /** 调整后的 y（px，rail body 坐标系）：已应用 MarkerMinGap 最小错开。 */
    y: number;
    /** 是否渲染：行不在视口内（或拿不到行位置）的标记不渲染（§4.2b）。 */
    visible: boolean;
};

export type GutterLayoutOptions = {
    /** rail body 的高度（px）。<= 0 视为「尚未测量」：此时不裁剪，只按位置渲染。 */
    height: number;
    /** 相邻标记最小错开，缺省 RailMarkerMinGap。 */
    minGap?: number;
    /** 视口上下各留的容差（px），缺省 8：边缘半露的标记仍渲染。 */
    margin?: number;
};

/**
 * 行对齐 gutter 定位（§4.2b 纯函数）。
 *
 * - `yOf` 取目标消息行的屏幕 y（父级从 `virtualizer.getOffsetForIndex` 批量算好）；
 *   拿不到位置（行未加载 / 不在窗口内）→ `visible: false`，不渲染。
 * - 相邻标记 `y - lastY < minGap` 时向下错开到 `lastY + minGap`（prototype v4 行为），
 *   避免两行几乎重叠时圆点叠圆点；错开后被推出 body 的标记同样不渲染。
 * - `height <= 0`（首帧 / 未挂载测量）不裁剪：宁可先画出来，也不要闪一帧空白。
 */
export function layoutGutterMarkers(
    clusters: Array<{ seq: number }>,
    yOf: (seq: number) => number | undefined,
    opts: GutterLayoutOptions
): GutterMarkerLayout[] {
    const minGap = opts.minGap ?? RailMarkerMinGap;
    const margin = opts.margin ?? 8;
    const height = Number.isFinite(opts.height) ? opts.height : 0;
    const measured = height > 0;
    const out: GutterMarkerLayout[] = [];
    let lastY = Number.NEGATIVE_INFINITY;
    for (const cluster of clusters) {
        const rawY = yOf(cluster.seq);
        if (rawY == null || !Number.isFinite(rawY)) {
            out.push({ seq: cluster.seq, y: 0, visible: false });
            continue;
        }
        let y = rawY;
        if (y - lastY < minGap) y = lastY + minGap;
        lastY = y;
        const visible = !measured || (y >= -margin && y <= height + margin);
        out.push({ seq: cluster.seq, y, visible });
    }
    return out;
}

export function annotationsForSeq(annotations: AnnotationLike[], seq: number): AnnotationLike[] {
    return sortAnnotations(annotations.filter((annotation) => annotation.seq === seq));
}

export function annotationCountBySeq(annotations: AnnotationLike[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const annotation of annotations) {
        counts.set(annotation.seq, (counts.get(annotation.seq) ?? 0) + 1);
    }
    return counts;
}

/** FNV-1a 64-bit, matching pkg/aisessions AnchorHash (decimal string). */
export function anchorHash(text: string): string {
    const normalized = text.trim().split(/\s+/).filter(Boolean).join(" ");
    if (normalized === "") return "0";
    const bytes = new TextEncoder().encode(normalized);
    let hash = BigInt("0xcbf29ce484222325");
    const prime = BigInt("0x100000001b3");
    const mask = BigInt("0xffffffffffffffff");
    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = (hash * prime) & mask;
    }
    return hash.toString(10);
}

export type AnnotationAnchorRequest = {
    anchorKey: string;
    seq: number;
    role: string;
    hash: string;
};

// ---------------------------------------------------------------------------
// kind 元数据（design/plans/aisessions-annotation-timeline-v2.md §4.2 / §4.2d）
// ---------------------------------------------------------------------------

/** 批注 kind 枚举；`node` 是 v2 新增的第 5 类（关键位置标记，非内容批注）。 */
export const AnnotationKinds = ["note", "milestone", "decision", "question", "node"] as const;
export type AnnotationKind = (typeof AnnotationKinds)[number];

export type AnnotationKindMeta = {
    kind: AnnotationKind;
    /** 过滤弹层 / 卡片的展示名 i18n key（本模块不渲染，调用方 t(labelKey)）。 */
    labelKey: string;
    /** 图标字形（原型 script.js KINDS；node 是菱形 ◇，四种批注是圆形语义）。 */
    glyph: string;
    /** 过滤弹层与密度微条的排序序（note → milestone → decision → question → node）。 */
    order: number;
    /** rail 实心核的主题 token 名（§4.2 类型色表；node 是中性灰阶，§4.2d）。 */
    colorToken: string;
    /** rail 标记形状：四种批注 = 圆点，node = 菱形（rotate 45deg）。 */
    shape: "dot" | "diamond";
};

/** kind → 元数据的唯一真相源；过滤弹层（5 类）/ 密度微条 / rail 图标都读这张表。 */
export const AnnotationKindMetaTable: readonly AnnotationKindMeta[] = [
    {
        kind: "note",
        labelKey: "aisessions:annotationCard.kind.note",
        glyph: "✎",
        order: 0,
        colorToken: "--secondary-text-color",
        shape: "dot",
    },
    {
        kind: "milestone",
        labelKey: "aisessions:annotationCard.kind.milestone",
        glyph: "◆",
        order: 1,
        colorToken: "--accent-color",
        shape: "dot",
    },
    {
        kind: "decision",
        labelKey: "aisessions:annotationCard.kind.decision",
        glyph: "⚖",
        order: 2,
        colorToken: "--warning-color",
        shape: "dot",
    },
    {
        kind: "question",
        labelKey: "aisessions:annotationCard.kind.question",
        glyph: "?",
        order: 3,
        colorToken: "--error-color",
        shape: "dot",
    },
    {
        kind: "node",
        labelKey: "aisessions:annotationCard.kind.node",
        glyph: "◇",
        order: 4,
        colorToken: "--grey-text-color",
        shape: "diamond",
    },
];

/** 查 kind 元数据；未知 kind 返回 null（调用方自行兜底，不要静默映射成 note）。 */
export function annotationKindMeta(kind: string): AnnotationKindMeta | null {
    return AnnotationKindMetaTable.find((meta) => meta.kind === kind) ?? null;
}

// ---------------------------------------------------------------------------
// 时间桶（design/plans/aisessions-annotation-timeline-v2.md §3.2）
// ---------------------------------------------------------------------------

/** dateKey 取**锚点消息时间**（不是批注创建时间）：时间线的语义是「这段对话发生在哪天」。 */
export type TimeBucket = {
    /** 本地日历日 "YYYY-MM-DD"；缺锚点时间的条目归 "unknown" 桶（排最后，不静默丢弃）。 */
    dateKey: string;
    /** 展示名：今天 / 昨天（按 opts.now 算）/ 其余 "MM-DD"（可经 opts.labelFor 覆盖）。 */
    label: string;
    /** 桶内 rail 条目，按 (seq, anchorKey) 升序。 */
    items: AnnotationRailItem[];
    /** 与更早相邻桶之间被跳过的整天数（0 = 相邻日）；空桶不生成，只计数。 */
    gapDaysBefore: number;
    /** items 条数（= 圆点数 / 分段头计数）。 */
    count: number;
};

/** 缺锚点时间（seq 未命中消息）的条目归入的 dateKey。 */
export const UnknownBucketKey = "unknown";

export type TimeBucketRelative = "today" | "yesterday" | null;

/**
 * 桶展示名注入点 —— 与 11-02-datetime-format-config 的对接点。
 *
 * 默认实现：relative（今天/昨天）与 unknown 走 i18n key；其余硬排 "MM-DD"。
 * 日期格式配置（`app:dateformat`）落地后，渲染层应传入读取配置的 labelFor，
 * 让绝对日期部分跟随用户设置，而不是改这里的默认值。
 */
export type TimeBucketLabelFor = (dateKey: string, relative: TimeBucketRelative) => string;

export type TimeBucketOptions = {
    /** 计算相对 label（今天/昨天）的基准时刻；缺省 Date.now()。 */
    now?: number;
    /** 目前只支持本机本地时区（设计 §3.9：桶按系统本地时区切，跨时区用户看到的
     * 桶边界随系统时区变，与「昨天」的直觉一致）。占位字段，别无它值。 */
    timeZone?: "local";
    /** 展示名注入点；见 TimeBucketLabelFor。 */
    labelFor?: TimeBucketLabelFor;
};

function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

/** 秒级时间戳归一成 ms（对齐 ./utils.ts 的 normalizeTimestamp 口径）。 */
function normalizeTimestampMs(timestamp: number): number {
    const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    return Number.isFinite(normalized) ? normalized : 0;
}

/** 本地日历日 "YYYY-MM-DD"（直接读 Date 的本地日历字段，无时区换算）。 */
function localDateKeyOf(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 本地日历日的序号（天粒度）。
 *
 * 日界线**必须**走本地日历构造：把 Date 的本地日历字段放进 `Date.UTC` 再除以
 * 86400000。`Date.UTC` 不受 DST 影响，所以 23h / 25h 的墙钟日也能得到正好差 1
 * 的序号；禁止 `ts - i * 86400000` / `ts / 86400000` 反推（DST 日会差 1 小时，
 * 导致某桶少/多一天 —— 设计 §3.2 / §3.9）。
 */
function calendarDayIndexOf(date: Date): number {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function defaultBucketLabel(dateKey: string, relative: TimeBucketRelative): string {
    if (dateKey === UnknownBucketKey) return i18n.t("aisessions:annotationRail.unknownTime");
    if (relative === "today") return i18n.t("aisessions:annotationRail.today");
    if (relative === "yesterday") return i18n.t("aisessions:annotationRail.yesterday");
    return `${dateKey.slice(5, 7)}-${dateKey.slice(8, 10)}`;
}

/**
 * 把 rail 条目按锚点消息时间聚成本地日历日桶（design §3.2）。
 *
 * - `tsOf` 取**锚点消息**时间（seq → 消息时间戳）；缺失 → unknown 桶，排最后，不丢弃。
 * - 空桶（无批注的日子）不生成，只在前一桶记 `gapDaysBefore`；渲染层决定是否画「跳过 N 天」。
 * - 桶内 items 按 (seq, anchorKey) 升序；桶间按时间正序（旧 → 新）；unknown 恒最后。
 * - 单条批注：1 桶、gapDaysBefore = 0。
 * - 纯函数：输入乱序也产出同一定值（桶内 / 桶间都显式排序，不信任调用方）。
 */
export function buildTimeBuckets(
    items: AnnotationRailItem[],
    tsOf: (seq: number) => number | undefined,
    opts: TimeBucketOptions = {}
): TimeBucket[] {
    if (items.length === 0) return [];

    const unknownItems: AnnotationRailItem[] = [];
    const dated = new Map<string, { dayIndex: number; date: Date; items: AnnotationRailItem[] }>();
    for (const item of items) {
        const rawTs = tsOf(item.seq);
        const ts = rawTs == null ? 0 : normalizeTimestampMs(rawTs);
        const date = ts > 0 ? new Date(ts) : null;
        if (date == null || Number.isNaN(date.getTime())) {
            unknownItems.push(item);
            continue;
        }
        const key = localDateKeyOf(date);
        const bucket = dated.get(key);
        if (bucket == null) {
            dated.set(key, { dayIndex: calendarDayIndexOf(date), date, items: [item] });
        } else {
            bucket.items.push(item);
        }
    }

    // 桶按本地日历日正序（旧 → 新）；同 dateKey 的 entries 保持 Map 的插入序，再按 dayIndex 排序。
    const orderedDays = [...dated.entries()].sort(
        (left, right) => left[1].dayIndex - right[1].dayIndex || left[0].localeCompare(right[0])
    );

    const nowDate = new Date(opts.now ?? Date.now());
    const todayKey = localDateKeyOf(nowDate);
    // 「昨天」用本地日历构造（new Date(y, m, d-1)），月份/年份回退由 Date 自己处理，DST 安全。
    const yesterdayKey = localDateKeyOf(new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1));
    const labelFor: TimeBucketLabelFor = opts.labelFor ?? defaultBucketLabel;

    const buckets: TimeBucket[] = [];
    for (let index = 0; index < orderedDays.length; index++) {
        const [dateKey, entry] = orderedDays[index];
        const bucketItems = [...entry.items].sort((left, right) => {
            if (left.seq !== right.seq) return left.seq - right.seq;
            return left.anchorKey.localeCompare(right.anchorKey);
        });
        const previous = orderedDays[index - 1];
        // gapDaysBefore = 与更早相邻桶之间被跳过的整天数：日历差 - 1；首桶无更早邻居 = 0。
        const gapDaysBefore = previous == null ? 0 : Math.max(0, entry.dayIndex - previous[1].dayIndex - 1);
        const relative: TimeBucketRelative =
            dateKey === todayKey ? "today" : dateKey === yesterdayKey ? "yesterday" : null;
        buckets.push({
            dateKey,
            label: labelFor(dateKey, relative),
            items: bucketItems,
            gapDaysBefore,
            count: bucketItems.length,
        });
    }

    if (unknownItems.length > 0) {
        const bucketItems = [...unknownItems].sort((left, right) => {
            if (left.seq !== right.seq) return left.seq - right.seq;
            return left.anchorKey.localeCompare(right.anchorKey);
        });
        // unknown 桶没有日历位置：gap 记 0（不存在「跳过 N 天」语义），恒排最后。
        buckets.push({
            dateKey: UnknownBucketKey,
            label: labelFor(UnknownBucketKey, null),
            items: bucketItems,
            gapDaysBefore: 0,
            count: bucketItems.length,
        });
    }
    return buckets;
}

/** 找包含该 seq 的桶；不存在返回 null。items 在桶内按 seq 升序，可用首尾 seq 快速跳过。 */
export function bucketOf(buckets: TimeBucket[], seq: number): TimeBucket | null {
    for (const bucket of buckets) {
        if (bucket.items.length === 0) continue;
        if (seq < bucket.items[0].seq || seq > bucket.items[bucket.items.length - 1].seq) continue;
        if (bucket.items.some((item) => item.seq === seq)) return bucket;
    }
    return null;
}

// ---------------------------------------------------------------------------
// 分页模式（design/plans/aisessions-annotation-timeline-v2.md §4.2c / §4.2c-1）
// ---------------------------------------------------------------------------
//
// 分页只发生在**渲染层**：它把「当前已加载窗口」里的消息切成页，与 §3.3 的游标
// 数据加载是两件事（翻到最旧页时才按游标补一页数据）。输入是已加载消息行，输出
// 是页数组（旧 → 新）；纯函数、无 React / RPC 依赖，可直接单测。
//
// 文案一律**不在这里拼**：pageLabel() 只产出结构化字段（相对日期 / 日历日 /
// interval 窗口起点 / 页序号 / 条数），最终字符串由 UI 按 i18n key + 日期格式
// 配置渲染（11-02-datetime-format-config；禁止硬编码 MM-DD）。

export type PageMode = "all" | "day" | "turn" | "interval" | "count";

/** interval 模式的窗口档位（§4.2c 表：1h / 6h / 12h / 24h）。 */
export const IntervalHourChoices = [1, 6, 12, 24] as const;
export type IntervalHours = (typeof IntervalHourChoices)[number];

/** count 模式的页容量档位（§4.2c 表：20 / 50 / 100）。 */
export const CountSizeChoices = [20, 50, 100] as const;
export type CountSize = (typeof CountSizeChoices)[number];

/** intervalHours 缺省值：24h 窗口（与 autoPageMode 的「按日」同粒度）。 */
export const IntervalDefaultHours: IntervalHours = 24;
/** countSize 缺省值：100 条（等于 Annotations RPC 单页默认上限）。 */
export const CountDefaultSize: CountSize = 100;
/** autoPageMode 阈值：≤ 该值显示全部，> 该值按日（§4.2c-1）。 */
export const AutoPageModeThreshold = 500;

export type PagingOptions = {
    mode: PageMode;
    /** interval 窗口小时数（缺省 IntervalDefaultHours）。UI 档位见 IntervalHourChoices；
     * 非档位值只做 `floor` + 最少 1h 的夹取，不报错（持久化状态可能读到脏值）。 */
    intervalHours?: number;
    /** count 每页条数（缺省 CountDefaultSize）。UI 档位见 CountSizeChoices；非档位值同样夹取。 */
    countSize?: number;
};

/** computePages 的输入行：只要 seq 与 role（turn 模式认 user 轮首）；时间经 tsOf 注入。 */
export type PagingRow = {
    seq: number;
    role: string;
};

export type MessagePage = {
    /** 页 id，同模式内稳定且唯一（§4.2c 表；prepend 更早内容不改变已有页 id）。 */
    id: string;
    mode: PageMode;
    /** 页内首条 / 末条消息 seq（含）。 */
    startSeq: number;
    endSeq: number;
    /** 页内消息条数（= seqs.length）。 */
    messageCount: number;
    /** 页内全部 seq，升序；scopeSeqs / 卡片导航 / 收窄计数的数据源。 */
    seqs: number[];
    /** day 页的本地日历日 "YYYY-MM-DD"（"unknown" = 缺锚点时间）；其余模式 null。 */
    dateKey: string | null;
    /** interval 页的窗口起点 ms（epoch 对齐的固定窗口）；其余模式 null。 */
    windowStartTs: number | null;
    /** turn 页的轮首 user seq（首条 user 之前的引导页 = 页首条 seq）；其余 null。 */
    turnStartSeq: number | null;
};

function buildPage(
    mode: PageMode,
    id: string,
    seqs: number[],
    extra: { dateKey?: string | null; windowStartTs?: number | null; turnStartSeq?: number | null } = {}
): MessagePage {
    return {
        id,
        mode,
        startSeq: seqs[0],
        endSeq: seqs[seqs.length - 1],
        messageCount: seqs.length,
        seqs,
        dateKey: extra.dateKey ?? null,
        windowStartTs: extra.windowStartTs ?? null,
        turnStartSeq: extra.turnStartSeq ?? null,
    };
}

/** turn：一轮 = 一段连续的 user 消息（合起来算一问）+ 其后到下一段 user 前的全部非 user 消息；
 * 页 id `t:<轮首 seq>`，轮首 = 连续 user 段的第一条。
 * 只有 user 消息**跟在非 user 消息之后**（上一问已被回应）才开新轮——用户连发多条（排队补充、
 * 贴多个文件）属于同一问，必须并进同一页。首个 user 之前的行（system 前言等）自成引导页，
 * id 取页首条 seq（保证唯一稳定）。 */
function computeTurnPages(rows: PagingRow[]): MessagePage[] {
    type Draft = { turnStartSeq: number; seqs: number[]; sawReply: boolean };
    const drafts: Draft[] = [];
    let current: Draft | null = null;
    for (const row of rows) {
        if (current == null || (row.role === "user" && current.sawReply)) {
            current = { turnStartSeq: row.seq, seqs: [], sawReply: false };
            drafts.push(current);
        }
        if (row.role !== "user") current.sawReply = true;
        current.seqs.push(row.seq);
    }
    return drafts.map((draft) => buildPage("turn", `t:${draft.turnStartSeq}`, draft.seqs, { turnStartSeq: draft.turnStartSeq }));
}

/** day：页 = 本地日历日（对齐 §3.2 桶，日界线走本地日历构造）；缺锚点时间归 unknown 页（排最后）。 */
function computeDayPages(rows: PagingRow[], tsOf: (seq: number) => number | undefined): MessagePage[] {
    const byKey = new Map<string, { dayIndex: number; seqs: number[] }>();
    const unknownSeqs: number[] = [];
    for (const row of rows) {
        const ts = normalizeTimestampMs(tsOf(row.seq) ?? 0);
        const date = ts > 0 ? new Date(ts) : null;
        if (date == null || Number.isNaN(date.getTime())) {
            unknownSeqs.push(row.seq);
            continue;
        }
        const key = localDateKeyOf(date);
        const bucket = byKey.get(key);
        if (bucket == null) {
            byKey.set(key, { dayIndex: calendarDayIndexOf(date), seqs: [row.seq] });
        } else {
            bucket.seqs.push(row.seq);
        }
    }
    // 页按本地日历日正序（旧 → 新）；同日历日的乱序时间戳并回同一页，不产重复 id。
    const ordered = [...byKey.entries()].sort(
        (left, right) => left[1].dayIndex - right[1].dayIndex || left[0].localeCompare(right[0])
    );
    const pages = ordered.map(([dateKey, entry]) =>
        buildPage("day", `d:${dateKey}`, entry.seqs, { dateKey })
    );
    if (unknownSeqs.length > 0) {
        pages.push(buildPage("day", `d:${UnknownBucketKey}`, unknownSeqs, { dateKey: UnknownBucketKey }));
    }
    return pages;
}

/** interval：页 = 固定小时窗口 floor(ts / win)；页 id `i:<windowStartTs>`；缺时间归 unknown 页。 */
function computeIntervalPages(
    rows: PagingRow[],
    tsOf: (seq: number) => number | undefined,
    intervalHours: number
): MessagePage[] {
    const windowMs = Math.max(1, Math.floor(intervalHours)) * 3_600_000;
    const byStart = new Map<number, number[]>();
    const unknownSeqs: number[] = [];
    for (const row of rows) {
        const ts = normalizeTimestampMs(tsOf(row.seq) ?? 0);
        if (!(ts > 0)) {
            unknownSeqs.push(row.seq);
            continue;
        }
        const start = Math.floor(ts / windowMs) * windowMs;
        const seqs = byStart.get(start);
        if (seqs == null) {
            byStart.set(start, [row.seq]);
        } else {
            seqs.push(row.seq);
        }
    }
    const pages = [...byStart.keys()]
        .sort((left, right) => left - right)
        .map((start) => buildPage("interval", `i:${start}`, byStart.get(start), { windowStartTs: start }));
    if (unknownSeqs.length > 0) {
        pages.push(buildPage("interval", `i:${UnknownBucketKey}`, unknownSeqs));
    }
    return pages;
}

/** count：固定 N 条，**从最新端往前切块**（尾锚定）；页 id `c:<页首条 seq>`。
 * 尾锚定 ⇒ prepend 更早内容只在前面新增页：从最新端数起的每整页成员与 id 不变
 * （已知取舍：最旧端的半页会吸收新 prepend 的行，id 随页首条变化）。 */
function computeCountPages(rows: PagingRow[], countSize: number): MessagePage[] {
    const limit = Math.max(1, Math.floor(countSize));
    const pages: MessagePage[] = [];
    for (let end = rows.length; end > 0; end -= limit) {
        const start = Math.max(0, end - limit);
        const seqs = rows.slice(start, end).map((row) => row.seq);
        pages.unshift(buildPage("count", `c:${seqs[0]}`, seqs));
    }
    return pages;
}

/**
 * 把当前已加载窗口的消息切成页（旧 → 新，§4.2c）。
 *
 * - 输入乱序也会先按 seq 升序排（纯函数不信任调用方）。
 * - `tsOf` 取锚点消息时间戳（ms 或秒，自动归一）；缺失 → day/interval 归 unknown 页（排最后，不丢弃）。
 * - all：单页（id "all"），分页 UI 的「显示全部」分支；非 all 模式才出翻页条。
 */
export function computePages(
    rows: PagingRow[],
    tsOf: (seq: number) => number | undefined,
    opts: PagingOptions
): MessagePage[] {
    if (rows.length === 0) return [];
    const sorted = [...rows].sort((left, right) => left.seq - right.seq);
    switch (opts.mode) {
        case "all":
            return [buildPage("all", "all", sorted.map((row) => row.seq))];
        case "turn":
            return computeTurnPages(sorted);
        case "day":
            return computeDayPages(sorted, tsOf);
        case "interval":
            return computeIntervalPages(sorted, tsOf, opts.intervalHours ?? IntervalDefaultHours);
        case "count":
            return computeCountPages(sorted, opts.countSize ?? CountDefaultSize);
    }
}

/** 当前渲染作用域（当前页 seq 集合）：rail 标记 / 悬浮卡 / kind 过滤计数 / 草稿条 / 读数收窄到当前页。 */
export function scopeSeqs(page: MessagePage | null | undefined): Set<number> {
    return new Set(page?.seqs ?? []);
}

/** 找包含该 seq 的页下标；不在任何页返回 -1（跳转自动切页用：§4.2c「跳到不在当前页的消息 → 先切页」）。 */
export function pageIndexOfSeq(pages: MessagePage[], seq: number): number {
    for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        if (page.seqs.length === 0) continue;
        if (seq < page.startSeq || seq > page.endSeq) continue;
        if (page.seqs.includes(seq)) return index;
    }
    return -1;
}

/** 把页下标夹取进 [0, pageCount-1]；无页返回 -1（翻页条 prev/next 的边界防护）。 */
export function clampPageIndex(index: number, pageCount: number): number {
    if (pageCount <= 0) return -1;
    const safe = Number.isFinite(index) ? Math.floor(index) : 0;
    return Math.min(Math.max(safe, 0), pageCount - 1);
}

/**
 * autoPageMode 默认规则（§4.2c-1）：≤500 条 → all，>500 → day。
 * 用户手动选过（`pageModeUserSet`）后同一会话内不再被默认规则覆盖。
 */
export function autoPageMode(totalMessages: number, pageModeUserSet: boolean, currentMode: PageMode): PageMode {
    if (pageModeUserSet) return currentMode;
    const total = Number.isFinite(totalMessages) ? totalMessages : 0;
    return total > AutoPageModeThreshold ? "day" : "all";
}

/** pageLabel 的相对日期档：UI 映射 i18n key（annotationRail.today / yesterday）。 */
export type PageLabelRelative = "today" | "yesterday" | null;

/**
 * 翻页条文案的结构化字段（§4.2c：`今天 · 11-11 · 2/2 · 7 条消息` 的纯数据形态）。
 * 本模块不拼最终字符串：相对日期 / 日历日 / 窗口起点由 UI 按 i18n key 与
 * 日期格式配置渲染，`index/total` 对应「2/2」，`messageCount` 对应「7 条消息」。
 */
export type PageLabelData = {
    mode: PageMode;
    /** 相对日期（按 opts.now 算）；null = 非相对日或非 day 模式。 */
    relative: PageLabelRelative;
    /** day 页的本地日历日（"unknown" = 缺时间）；其余模式 null。 */
    dateKey: string | null;
    /** interval 页的窗口起点 ms；其余模式 null。 */
    windowStartTs: number | null;
    /** turn 页的轮首 user seq；其余模式 null。 */
    turnStartSeq: number | null;
    /** 页内消息条数。 */
    messageCount: number;
    /** 当前页序号（1-based，opts 传入）与总页数；all 模式恒 null（无翻页条）。 */
    index: number | null;
    total: number | null;
};

export type PageLabelOptions = {
    /** 计算相对日期的基准时刻；缺省 Date.now()。 */
    now?: number;
    /** 当前页序号（1-based；由调用方按 pages 数组给出）。 */
    index?: number;
    /** 总页数。 */
    total?: number;
};

/** 组出翻页条文案的结构化字段；见 PageLabelData。 */
export function pageLabel(page: MessagePage, opts: PageLabelOptions = {}): PageLabelData {
    let relative: PageLabelRelative = null;
    if (page.mode === "day" && page.dateKey != null && page.dateKey !== UnknownBucketKey) {
        const nowDate = new Date(opts.now ?? Date.now());
        const todayKey = localDateKeyOf(nowDate);
        const yesterdayKey = localDateKeyOf(
            new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1)
        );
        relative = page.dateKey === todayKey ? "today" : page.dateKey === yesterdayKey ? "yesterday" : null;
    }
    const isAll = page.mode === "all";
    return {
        mode: page.mode,
        relative,
        dateKey: page.mode === "day" ? page.dateKey : null,
        windowStartTs: page.mode === "interval" ? page.windowStartTs : null,
        turnStartSeq: page.mode === "turn" ? page.turnStartSeq : null,
        messageCount: page.messageCount,
        index: isAll ? null : (opts.index ?? null),
        total: isAll ? null : (opts.total ?? null),
    };
}

/** Build the RPC anchor list from the loaded messages / tool calls. */
export function buildAnnotationAnchors(
    messages: Array<{ itemKey?: string; seq: number; role: string; text?: string; thinking?: string }>,
    toolCalls: Array<{ itemKey?: string; seq: number; name?: string; summary?: string }> = []
): AnnotationAnchorRequest[] {
    const anchors: AnnotationAnchorRequest[] = [];
    // 同一 anchorKey 消息优先：provider 会给工具行额外产出「锚点消息」，
    // 它的 seq 才是时间线真实行号；ToolCall.seq 只是单次加载内的顺序计数。
    // 工具锚点只贡献 role/hash（与后端 BuildAnnotationAnchors 一致），
    // 绝不单独产出第二条锚点，也不写 ToolCall.seq。
    const toolByKey = new Map<string, { name?: string; summary?: string }>();
    for (const toolCall of toolCalls) {
        const anchorKey = toolCall.itemKey?.trim();
        if (!anchorKey || toolByKey.has(anchorKey)) continue;
        toolByKey.set(anchorKey, toolCall);
    }
    const seen = new Set<string>();
    for (const message of messages) {
        const anchorKey = message.itemKey?.trim();
        if (!anchorKey || seen.has(anchorKey)) continue;
        seen.add(anchorKey);
        const toolCall = toolByKey.get(anchorKey);
        anchors.push({
            anchorKey,
            seq: message.seq,
            role: toolCall ? "tool" : message.role,
            hash: toolCall
                ? anchorHash([toolCall.name, toolCall.summary].filter(Boolean).join("\n"))
                : anchorHash(message.text ?? message.thinking ?? ""),
        });
    }
    return anchors;
}
