// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（实验插件）— 纯逻辑层：状态表解析 / 自定义状态注册 / 脚本返回值归一化 / 合并 / 节点装饰。
// 契约见 .trellis/tasks/11-24-folder-index-badges/prd.md 与 11-24-idxbadges-decoration-protocol/prd.md。
// 与 vcs-tree-status.ts 同一定位：无 React / RPC 依赖，便于单测。

import type { TreeNodeData } from "@/app/treeview/treeview";

/** 徽标数据源：index.md 状态表 vs .index/badges.js 用户脚本 */
export type BadgeSource = "index" | "script";

/** 归一化之后的装饰（渲染层只认这个形状；badge 只是词表之一） */
export interface BadgeDeco {
    /** 内置/自定义状态名；全自定义徽标时缺省 */
    status?: string;
    /** 前缀 emoji；纯 icon/labelColor 装饰时可缺省 */
    emoji?: string;
    /** 展示名；内置状态默认等于 status */
    label?: string;
    /** 徽标颜色（#rrggbb）；缺省用注册表色 */
    color?: string;
    /** 悬停/读屏语义 */
    title?: string;
    /** 索引备注或脚本说明 */
    note?: string;
    /** 替换文件图标（FontAwesome 名，如 fa-flask）；缺省 = 按 mimetype 的默认图标 */
    icon?: string;
    /** 图标颜色（#rrggbb）；缺省 = 继承行色 */
    iconColor?: string;
    /** 文件名颜色（#rrggbb）；缺省 = 继承行色 */
    labelColor?: string;
    /** 不显示该文件行（目录行不生效，避免树结构歧义） */
    hidden?: boolean;
    /** 同目录排序权重（小的在前；缺省保持后端顺序） */
    order?: number;
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
    icon?: string;
    iconColor?: string;
    labelColor?: string;
    hidden?: boolean;
    order?: number;
}

/** 脚本入参（只读视图；真实实现不得暴露可变对象） */
export interface FolderIndexEntry {
    name: string;
    path: string;
    /** 相对根目录的路径（装饰 key） */
    relPath: string;
    isDir: boolean;
    modtime?: number;
    /** 文件字节数；目录不设置 */
    size?: number;
}

/** 状态注册表条目：emoji + 颜色 + 中文说明 */
export interface StatusDefEntry {
    emoji: string;
    color: string;
    desc: string;
}

export type StatusRegistry = Record<string, StatusDefEntry>;

/** 内置状态注册表：四态 + emoji/颜色/中文说明（唯一事实源） */
export const STATUS_DEF: StatusRegistry = {
    会改版: { emoji: "🔄", color: "#e0a83a", desc: "还会改动，别当定稿引用" },
    冻结: { emoji: "🧊", color: "#5cb8d6", desc: "已定稿，改动需走流程" },
    只读: { emoji: "🔒", color: "#9aa2ab", desc: "不允许修改" },
    归档: { emoji: "🗄", color: "#a78bfa", desc: "历史资料，仅查阅" },
};

const TableSeparatorRe = /^:?-{2,}:?$/;
const HexColorRe = /^#[0-9a-f]{6}$/i;

/**
 * 解析 index.md 里的自定义状态注册表：`| 状态 | 徽标 | 颜色 | 说明 |`。
 * 与内置四态合成（自定义可覆盖内置，显式声明为准）；没有注册表 = 只用内置四态。
 * lenient：坏行（缺状态/缺徽标/颜色非法）跳过该行，不抛错。
 */
export function buildStatusRegistry(text: string): StatusRegistry {
    const registry: StatusRegistry = { ...STATUS_DEF };
    const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
    let inRegistryTable = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("|")) {
            inRegistryTable = false;
            continue;
        }
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
        if (cells.length < 2) {
            continue;
        }
        const [status, emoji, color, desc] = cells;
        // 注册表表头：| 状态 | 徽标 | ...；状态表的表头是 | 文件 | 状态 |，不冲突
        if (status === "状态" && emoji === "徽标") {
            inRegistryTable = true;
            continue;
        }
        if (!inRegistryTable) {
            continue;
        }
        if (!status || !emoji || TableSeparatorRe.test(status) || TableSeparatorRe.test(emoji)) {
            continue;
        }
        if (color && !HexColorRe.test(color)) {
            continue; // 颜色非法：跳过该行（lenient）
        }
        registry[status] = { emoji, color: color || "#9aa2ab", desc: desc || status };
    }
    return registry;
}

/**
 * 解析 index.md 的 `| 文件 | 状态 | 备注 |` 状态表。
 * lenient：表头/分隔行跳过；未知状态行跳过（不抛错）；无表格返回 rows=0 + 空 map。
 * registry 缺省 = 内置四态（v1 兼容：旧表格/旧脚本零改动照常工作）。
 * key 取表格第一列原样（相对路径或文件名），匹配时由调用方两路都试。
 */
export function parseIndexDoc(
    text: string,
    registry: StatusRegistry = STATUS_DEF
): { map: Record<string, BadgeDeco>; rows: number } {
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
        // 表头行：状态表（| 文件 | 状态 |...）与注册表（| 状态 | 徽标 |...）都跳过
        if (status === "状态" || file === "状态") {
            continue;
        }
        const def = registry[status];
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
 * - `{ emoji }` 等自定义字段 → 全自定义装饰（icon/labelColor/hidden/order 同样合法）；
 * - 什么有效字段都没有 → null（调用方跳过该条）。
 * registry 缺省 = 内置四态（v1 脚本兼容）。
 */
export function normalizeDeco(raw: RawDeco, registry: StatusRegistry = STATUS_DEF, source: BadgeSource = "script"): BadgeDeco | null {
    if (raw == null || typeof raw !== "object") {
        return null;
    }
    let base: { emoji: string; color: string; title: string } | null = null;
    if (raw.status != null) {
        const def = registry[raw.status];
        if (def != null) {
            base = { emoji: raw.emoji || def.emoji, color: raw.color || def.color, title: raw.title || def.desc };
        }
    }
    const hasCustomVisual =
        raw.emoji != null || raw.icon != null || raw.labelColor != null || raw.iconColor != null ||
        raw.hidden != null || raw.order != null;
    if (base == null && !hasCustomVisual) {
        return null;
    }
    const emoji = base?.emoji ?? raw.emoji;
    return {
        status: base != null ? raw.status : undefined,
        emoji,
        label: raw.label || raw.status || undefined,
        color: base != null ? (raw.color || base.color) : raw.color || undefined,
        title: base != null ? base.title : raw.title || (emoji != null ? "自定义徽标" : undefined),
        note: raw.note || undefined,
        icon: raw.icon || undefined,
        iconColor: raw.iconColor || undefined,
        labelColor: raw.labelColor || undefined,
        hidden: raw.hidden === true ? true : undefined,
        order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : undefined,
        source,
    };
}

/** 合并策略：脚本 > 表格 > 无装饰。 */
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
 * 按「相对根目录路径优先，文件名兜底」查装饰。
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

/** 可渲染判断：至少一个可见字段（emoji/icon/labelColor）。 */
export function hasRenderableBadge(deco: BadgeDeco | null | undefined): boolean {
    if (deco == null) {
        return false;
    }
    return (deco.emoji != null && deco.emoji !== "") || deco.icon != null || deco.labelColor != null;
}

/**
 * 把装饰落到树节点（v2：badge / icon / iconColor / labelColor 一站式）。
 * `hidden` / `order` 不落节点，由 explorer 的 fetchDir 消费（过滤 + 排序）。
 * null/无可见字段的装饰 = 原样返回（树零变化）。
 */
export function applyDecorationToNode(node: TreeNodeData, deco: BadgeDeco | null | undefined): TreeNodeData {
    if (deco == null || !hasRenderableBadge(deco)) {
        return node;
    }
    if (deco.emoji != null && deco.emoji !== "") {
        node.badge = {
            emoji: deco.emoji,
            title: [deco.title, deco.note].filter(Boolean).join(" — ") || undefined,
            color: deco.color,
        };
    }
    if (deco.icon != null) {
        node.icon = deco.icon;
    }
    if (deco.iconColor != null) {
        node.iconColor = deco.iconColor;
    }
    if (deco.labelColor != null) {
        node.labelColor = deco.labelColor;
    }
    return node;
}
