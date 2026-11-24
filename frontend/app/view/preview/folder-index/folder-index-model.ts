// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（实验插件）— 纯逻辑层：状态表解析 / 脚本返回值归一化 / 合并。
// 契约见 .trellis/tasks/11-24-folder-index-badges/prd.md。
// 与 vcs-tree-status.ts 同一定位：无 React / RPC 依赖，便于单测。

/** 徽标数据源：index.md 状态表 vs .index/badges.js 用户脚本 */
export type BadgeSource = "index" | "script";

/** 归一化之后的徽标（渲染层只认这个形状） */
export interface BadgeDeco {
    /** 内置状态名（会改版 / 冻结 / 只读 / 归档）；自定义徽标时缺省 */
    status?: string;
    emoji: string;
    /** 展示名；内置状态默认等于 status */
    label?: string;
    /** 覆盖颜色（#rrggbb）；缺省用注册表色 */
    color?: string;
    /** 悬停/读屏语义 */
    title?: string;
    /** 索引备注或脚本说明 */
    note?: string;
    source?: BadgeSource;
}

/** 脚本 decorate(entry) 的返回形状（宽松，坏形状由 normalizeDeco 判定） */
export interface RawDeco {
    status?: string;
    emoji?: string;
    label?: string;
    color?: string;
    title?: string;
    note?: string;
}

/** 脚本入参（只读视图；真实实现不得暴露可变对象） */
export interface FolderIndexEntry {
    name: string;
    path: string;
    /** 相对根目录的路径（徽标 key） */
    relPath: string;
    isDir: boolean;
    modtime?: number;
}

/** 内置状态注册表：四态 + emoji/颜色/中文说明（唯一事实源） */
export const STATUS_DEF: Record<string, { emoji: string; color: string; desc: string }> = {
    会改版: { emoji: "🔄", color: "#e0a83a", desc: "还会改动，别当定稿引用" },
    冻结: { emoji: "🧊", color: "#5cb8d6", desc: "已定稿，改动需走流程" },
    只读: { emoji: "🔒", color: "#9aa2ab", desc: "不允许修改" },
    归档: { emoji: "🗄", color: "#a78bfa", desc: "历史资料，仅查阅" },
};

const TableSeparatorRe = /^:?-{2,}:?$/;

/**
 * 解析 index.md 的 `| 文件 | 状态 | 备注 |` 状态表。
 * lenient：表头/分隔行跳过；未知状态行跳过（不抛错）；无表格返回 rows=0 + 空 map。
 * key 取表格第一列原样（相对路径或文件名），匹配时由调用方两路都试。
 */
export function parseIndexDoc(text: string): { map: Record<string, BadgeDeco>; rows: number } {
    const map: Record<string, BadgeDeco> = {};
    let rows = 0;
    for (const rawLine of (text ?? "").replace(/\r\n/g, "\n").split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("|")) {
            continue;
        }
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        if (cells.length < 2) {
            continue;
        }
        const [file, status, note] = cells;
        if (!file || TableSeparatorRe.test(file) || status === "" || TableSeparatorRe.test(status)) {
            continue;
        }
        // 表头行（支持「文件 | 状态」，也容忍任意首列名 + 状态列名）
        if (status === "状态") {
            continue;
        }
        const def = STATUS_DEF[status];
        if (def == null) {
            continue; // 未知状态：跳过该条，不整体降级
        }
        map[file] = {
            status,
            emoji: def.emoji,
            color: def.color,
            label: status,
            title: def.desc,
            note: note || undefined,
            source: "index",
        };
        rows++;
    }
    return { map, rows };
}

/**
 * 归一化脚本返回值：
 * - `{ status }` 合法 → 注册表 emoji/颜色/说明，允许字段覆盖；
 * - `{ emoji }` 自定义 → 全自定义徽标；
 * - 其余（含非法 status 且无 emoji）→ null（调用方跳过该条）。
 */
export function normalizeDeco(raw: RawDeco, source: BadgeSource = "script"): BadgeDeco | null {
    if (raw == null || typeof raw !== "object") {
        return null;
    }
    if (raw.status != null) {
        const def = STATUS_DEF[raw.status];
        if (def != null) {
            return {
                status: raw.status,
                emoji: raw.emoji || def.emoji,
                label: raw.label || raw.status,
                color: raw.color || def.color,
                title: raw.title || def.desc,
                note: raw.note || undefined,
                source,
            };
        }
    }
    if (raw.emoji) {
        return {
            emoji: raw.emoji,
            label: raw.label || undefined,
            color: raw.color || undefined,
            title: raw.title || "自定义徽标",
            note: raw.note || undefined,
            source,
        };
    }
    return null;
}

/** 合并策略：脚本 > 表格 > 无徽标。 */
export function mergeDecorations(
    indexMap: Record<string, BadgeDeco>,
    scriptMap: Record<string, BadgeDeco>
): Record<string, BadgeDeco> {
    const merged: Record<string, BadgeDeco> = {};
    for (const [key, deco] of Object.entries(indexMap ?? {})) {
        merged[key] = deco;
    }
    for (const [key, deco] of Object.entries(scriptMap ?? {})) {
        merged[key] = deco;
    }
    return merged;
}

/**
 * 按「相对根目录路径优先，文件名兜底」查徽标。
 * 索引表可写 `评审记录/2024-年报.md`，也可写文件名；两路都试。
 */
export function lookupDecoration(
    decorations: Record<string, BadgeDeco>,
    relPath: string,
    name?: string
): BadgeDeco | null {
    if (decorations == null) {
        return null;
    }
    const byPath = decorations[relPath];
    if (byPath != null) {
        return byPath;
    }
    if (name != null && decorations[name] != null) {
        return decorations[name];
    }
    return null;
}

/** 把绝对/相对路径换算成相对 rootPath 的 key（统一 "/"）。 */
export function toRelPath(rootPath: string, path: string): string {
    const normRoot = (rootPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    const normPath = (path ?? "").replace(/\\/g, "/");
    if (normPath === normRoot) {
        return "";
    }
    if (normRoot !== "" && normPath.startsWith(normRoot + "/")) {
        return normPath.slice(normRoot.length + 1);
    }
    return normPath;
}

/** 可渲染判断：开 = meta 有值且非 off；缺省 = 关。 */
export function hasRenderableBadge(deco: BadgeDeco | null | undefined): boolean {
    return deco != null && typeof deco.emoji === "string" && deco.emoji !== "";
}
