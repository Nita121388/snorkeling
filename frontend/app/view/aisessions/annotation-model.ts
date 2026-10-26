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
    updatedAt?: number;
};

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

/** rail 折叠/展开宽度与刻度尺寸（与 session-outline-rail 对齐的视觉规范）。 */
export const AnnotationRailCollapsedWidth = 16;
export const AnnotationRailExpandedWidth = 36;
export const AnnotationRailSlotHeight = 8;
export const AnnotationRailMaxSlots = 40;
export const AnnotationFlashMs = 1200;

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
    for (const message of messages) {
        const anchorKey = message.itemKey?.trim();
        if (!anchorKey) continue;
        anchors.push({
            anchorKey,
            seq: message.seq,
            role: message.role,
            hash: anchorHash(message.text ?? message.thinking ?? ""),
        });
    }
    for (const toolCall of toolCalls) {
        const anchorKey = toolCall.itemKey?.trim();
        if (!anchorKey) continue;
        anchors.push({
            anchorKey,
            seq: toolCall.seq,
            role: "tool",
            hash: anchorHash([toolCall.name, toolCall.summary].filter(Boolean).join("\n")),
        });
    }
    return anchors;
}
