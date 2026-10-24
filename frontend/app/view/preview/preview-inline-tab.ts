// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank, isLocalConnName } from "@/util/util";

export type InlineTabCandidate = {
    blockId: string;
    meta?: Record<string, any> | null;
};

function normalizeMetaPath(value: any): string {
    if (typeof value !== "string") {
        return "";
    }
    const unified = value.replace(/\\/g, "/").replace(/\/+/g, "/");
    // 尾斜杠不参与相等判断：/repo 与 /repo/ 是同一个仓库根。
    return unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
}

/**
 * 在同一个 inline tab group 里找"同一个旁支视图"的已有 Block，用于点击时聚焦而不是重复堆 Tab。
 *
 * 匹配条件：
 * - `view` 相同；
 * - `connection` 相同（本地连接名之间视为等价）；
 * - `dedupeMetaKeys` 里**非空**的键逐一相等（路径类做分隔符归一）。
 *
 * 值为空/undefined 的键不参与相等判断，避免把"还没选文件"的块误判为同一目标。
 * `dedupeMetaKeys` 全为空时返回 null（无法可靠判定，交给调用方新建）。
 */
export function findInlineTabDedupeMatch(
    candidates: InlineTabCandidate[],
    targetMeta: Record<string, any> | null | undefined,
    dedupeMetaKeys: string[]
): string | null {
    const view = targetMeta?.view;
    const connection = targetMeta?.connection;
    if (isBlank(view)) {
        return null;
    }
    const activeKeys = dedupeMetaKeys.filter((key) => !isBlank(targetMeta?.[key]));
    if (activeKeys.length === 0) {
        return null;
    }
    for (const candidate of candidates) {
        const meta = candidate.meta;
        if (meta?.view !== view) {
            continue;
        }
        const sameConnection =
            meta.connection === connection || (isLocalConnName(meta.connection) && isLocalConnName(connection));
        if (!sameConnection) {
            continue;
        }
        const sameTarget = activeKeys.every(
            (key) => normalizeMetaPath(meta[key]) === normalizeMetaPath(targetMeta?.[key])
        );
        if (sameTarget) {
            return candidate.blockId;
        }
    }
    return null;
}
