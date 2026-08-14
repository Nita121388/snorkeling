// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// .base 视图配置文件解析（Obsidian Bases 格式的子集）。
// 设计原则：纯函数、与 Obsidian 解耦 —— 只把 .base 当作纯文本 YAML 解析，
// 不依赖 Obsidian 应用/API。Phase 1 支持 filters/properties/views 的子集。

import YAML from "yaml";

export type BaseFilter =
    | { kind: "predicate"; expr: string }
    | { kind: "and"; items: BaseFilter[] }
    | { kind: "or"; items: BaseFilter[] }
    | { kind: "not"; items: BaseFilter[] };

export type BaseColumnConfig = {
    property: string;
    displayName: string;
};

export type BaseViewConfig = {
    name: string;
    order: string[];
    groupBy?: string;
    hasFormulaColumn: boolean;
};

export type BaseConfig = {
    filters?: BaseFilter;
    columns: BaseColumnConfig[];
    views: BaseViewConfig[];
};

export type ParseResult =
    | { ok: true; config: BaseConfig }
    | { ok: false; error: string };

function parseFilterNode(node: unknown): BaseFilter | null {
    if (typeof node === "string") {
        return { kind: "predicate", expr: node };
    }
    if (node == null || typeof node !== "object") {
        return null;
    }
    const obj = node as Record<string, unknown>;
    for (const [op, items] of Object.entries(obj)) {
        if (op === "and" || op === "or" || op === "not") {
            if (!Array.isArray(items)) {
                return null;
            }
            const parsed: BaseFilter[] = [];
            for (const item of items) {
                const child = parseFilterNode(item);
                if (child == null) {
                    return null;
                }
                parsed.push(child);
            }
            return { kind: op, items: parsed };
        }
    }
    return null;
}

export function parseBaseConfig(content: string): ParseResult {
    let doc: unknown;
    try {
        doc = YAML.parse(content);
    } catch (e) {
        return { ok: false, error: `YAML 解析失败: ${e}` };
    }
    if (doc == null || typeof doc !== "object") {
        return { ok: false, error: "空配置" };
    }
    const raw = doc as Record<string, unknown>;

    let filters: BaseFilter | undefined;
    if (raw.filters != null) {
        const parsed = parseFilterNode(raw.filters);
        if (parsed == null) {
            return { ok: false, error: "filters 格式无法解析" };
        }
        filters = parsed;
    }

    const columns: BaseColumnConfig[] = [];
    if (raw.properties != null && typeof raw.properties === "object") {
        for (const [key, val] of Object.entries(raw.properties as Record<string, unknown>)) {
            const displayName =
                val != null && typeof val === "object"
                    ? (val as Record<string, unknown>).displayName
                    : undefined;
            columns.push({
                property: key,
                displayName: typeof displayName === "string" ? displayName : key,
            });
        }
    }

    const views: BaseViewConfig[] = [];
    if (Array.isArray(raw.views)) {
        for (const view of raw.views) {
            if (view == null || typeof view !== "object") {
                continue;
            }
            const v = view as Record<string, unknown>;
            views.push({
                name: typeof v.name === "string" ? v.name : "视图",
                order: Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === "string") : [],
                groupBy: typeof v.groupBy === "string" ? v.groupBy : undefined,
                hasFormulaColumn: Array.isArray(v.order)
                    ? v.order.some(
                          (x) =>
                              typeof x === "string" &&
                              (x.startsWith("formula.") || x.startsWith("file.mtime") || x.startsWith("file.ctime"))
                      )
                    : false,
            });
        }
    }

    return {
        ok: true,
        config: {
            filters,
            columns,
            views,
        },
    };
}
