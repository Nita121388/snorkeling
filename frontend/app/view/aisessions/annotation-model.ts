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

/** rail 折叠/展开宽度与圆点尺寸（2026-10-26 视觉重构：药丸 → 竖向圆点）。 */
export const AnnotationRailCollapsedWidth = 16;
export const AnnotationRailExpandedWidth = 44;
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
