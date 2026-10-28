// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the annotation timeline. No React / jotai / DOM imports so it
// can be unit-tested directly.
//
// 只画「有批注的节点」；节点数量过多时按时间顺序聚成簇，避免 rail 被
// 几千条消息撑爆。簇内 hover 仍能看到该簇的全部批注。

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
