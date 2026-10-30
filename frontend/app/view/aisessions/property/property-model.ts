// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-model — Notion 式属性系统的类型与纯函数核心。
//
// 设计：property 是「叠加层」，不替代旧字段。note / tags / starred / title_source /
// 创建时间 / 更新时间作为内置属性存在，旧数据零迁移（靠 toPropertyDefs 的虚拟映射）。
// 自定义属性来自 summary.props。渲染与编辑都只看这里产出的 PropertyDef[]，不再各自
// 维护 noteDraft / tagDraft。

// 与 Obsidian frontmatter 的类型推断对齐（复用其判定，但映射成 Notion 的 type 集）。
import { inferPropertyType } from "@/app/view/preview/plugins/md-properties/frontmatter-block";

export type PropertyType =
    | "text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "person"
    | "checkbox"
    | "url"
    | "formula"
    | "relation"
    | "created_time"
    | "updated_time";

export type ColorToken =
    | "gray"
    | "brown"
    | "orange"
    | "yellow"
    | "green"
    | "blue"
    | "purple"
    | "pink"
    | "red"
    | "default";

export type SelectOption = {
    id: string;
    name: string;
    color: ColorToken;
};

// value 形状对齐 design §3.2，但序列化为 JSON 时统一成 any（生成器对 any 友好）。
export type PropertyValue =
    | string
    | number
    | boolean
    | string[]
    | { start: number; end?: number; hasTime?: boolean }
    | null;

export type PropertySource = "user" | "ai" | "system";

export type PropertyCell = {
    value: PropertyValue;
    source: PropertySource;
    updatedAt: number;
    /** 类型冗余在 cell 上，使自定义属性自描述（无需 per-session schema 表）。 */
    type?: PropertyType;
};

export type PropertyDef = {
    key: string;
    name: string;
    type: PropertyType;
    options?: SelectOption[];
    order: number;
    scope: "session" | "agent";
    builtin: boolean;
    /** 允许后台 AI 自动写（仅自定义属性可 true）。 */
    aiManaged?: boolean;
    aiInstruction?: string;
    readOnly?: boolean;
    /** formula 的派生种类（只读）。 */
    formula?: "message_count" | "duration" | "cost" | "subagent_count";
};

export type PropertyEntry = {
    def: PropertyDef;
    cell: PropertyCell;
};

export const BUILTIN_PROP_KEYS = {
    note: "note",
    tags: "tags",
    starred: "starred",
    titleSource: "title_source",
    createdAt: "created_at",
    updatedAt: "updated_at",
} as const;

const BUILTIN_ORDER: Record<string, number> = {
    [BUILTIN_PROP_KEYS.titleSource]: 0,
    [BUILTIN_PROP_KEYS.starred]: 1,
    [BUILTIN_PROP_KEYS.createdAt]: 2,
    [BUILTIN_PROP_KEYS.updatedAt]: 3,
    [BUILTIN_PROP_KEYS.tags]: 4,
    [BUILTIN_PROP_KEYS.note]: 5,
};

const BUILTIN_NAMES: Record<string, string> = {
    [BUILTIN_PROP_KEYS.titleSource]: "Title Source",
    [BUILTIN_PROP_KEYS.starred]: "Starred",
    [BUILTIN_PROP_KEYS.createdAt]: "Created",
    [BUILTIN_PROP_KEYS.updatedAt]: "Updated",
    [BUILTIN_PROP_KEYS.tags]: "Tags",
    [BUILTIN_PROP_KEYS.note]: "Note",
};

const TAG_COLORS: ColorToken[] = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "brown", "gray"];

// 把旧 tags（字符串数组）稳定映射成 multi_select 选项（按字母哈希上色，保证同 tag 同色）。
export function tagToOption(tag: string): SelectOption {
    const clean = tag.replace(/^#+/, "").trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
    }
    const color = TAG_COLORS[hash % TAG_COLORS.length];
    return { id: clean, name: clean, color };
}

function inferPropertyTypeFor(key: string, value: PropertyValue): PropertyType {
    if (value == null) return "text";
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    if (Array.isArray(value)) return "multi_select";
    if (typeof value === "object" && "start" in (value as Record<string, unknown>)) return "date";
    const obsidian = inferPropertyType(key, value);
    switch (obsidian) {
        case "boolean":
            return "checkbox";
        case "number":
            return "number";
        case "tags":
        case "tag":
            return "multi_select";
        case "date":
        case "datetime":
            return "date";
        case "link":
            return "url";
        default:
            return "text";
    }
}

/**
 * 合并旧字段 + 自定义 props，产出带顺序的 PropertyDef 列表。
 *
 * - 旧字段全部虚拟映射为内置属性（builtin=true），与 summary.props 的 key 不冲突
 *   （因为内置 key 用 title_source / starred / created_at / updated_at / tags / note）。
 * - 自定义 props 追加在后面，按其 cell.type 或推断决定 type。
 * - 旧数据：summary 没有 props 时只看到内置属性，UI 与今天等价。
 */
export function toPropertyDefs(summary: SessionSummary | null | undefined): PropertyEntry[] {
    if (summary == null) return [];
    const entries: PropertyEntry[] = [];

    const pushBuiltin = (key: string, type: PropertyType, value: PropertyValue, readOnly = false, options?: SelectOption[]) => {
        entries.push({
            def: {
                key,
                name: BUILTIN_NAMES[key] ?? key,
                type,
                options,
                order: BUILTIN_ORDER[key] ?? 100,
                scope: "session",
                builtin: true,
                readOnly,
            },
            cell: { value, source: "user", updatedAt: summary.updatedAt ?? 0, type },
        });
    };

    if (summary.titleSource != null && summary.titleSource !== "") {
        pushBuiltin(BUILTIN_PROP_KEYS.titleSource, "select", summary.titleSource, true);
    }
    pushBuiltin(BUILTIN_PROP_KEYS.starred, "checkbox", Boolean(summary.marked));
    if (summary.createdAt != null && summary.createdAt > 0) {
        pushBuiltin(BUILTIN_PROP_KEYS.createdAt, "created_time", summary.createdAt, true);
    }
    if (summary.updatedAt != null && summary.updatedAt > 0) {
        pushBuiltin(BUILTIN_PROP_KEYS.updatedAt, "updated_time", summary.updatedAt, true);
    }
    const tags = Array.isArray(summary.tags) ? summary.tags.map((t) => t.replace(/^#+/, "")) : [];
    pushBuiltin(BUILTIN_PROP_KEYS.tags, "multi_select", tags, false, tags.map(tagToOption));
    pushBuiltin(BUILTIN_PROP_KEYS.note, "text", summary.note ?? "");

    // 自定义 props（叠加层）。
    const props = summary.props;
    if (props != null) {
        let order = 100;
        const customKeys = Object.keys(props).sort();
        for (const key of customKeys) {
            const cell = props[key];
            if (cell == null) continue;
            const type: PropertyType =
                (cell.type as PropertyType) || inferPropertyTypeFor(key, cell.value as PropertyValue);
            let options: SelectOption[] | undefined;
            if (type === "select" || type === "status" || type === "multi_select") {
                const values = Array.isArray(cell.value)
                    ? (cell.value as string[])
                    : cell.value != null
                      ? [String(cell.value)]
                      : [];
                options = values.map(tagToOption);
            }
            entries.push({
                def: {
                    key,
                    name: humanizeKey(key),
                    type,
                    options,
                    order: order++,
                    scope: "session",
                    builtin: false,
                },
                cell: {
                    value: (cell.value as PropertyValue) ?? null,
                    source: (cell.source as PropertySource) || "user",
                    updatedAt: cell.updatedAt ?? 0,
                    type,
                },
            });
        }
    }

    entries.sort((a, b) => a.def.order - b.def.order || a.def.key.localeCompare(b.def.key));
    return entries;
}

export function humanizeKey(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

export function isEmptyValue(def: PropertyDef, value: PropertyValue): boolean {
    if (value == null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "boolean") return value === false;
    return false;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDateValue(value: PropertyValue): string {
    if (value == null || typeof value === "object") return "";
    const ms = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatDateTimeValue(value: PropertyValue): string {
    if (value == null || typeof value === "object") return "";
    const ms = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${formatDateValue(ms)} ${hh}:${mm}`;
}

export function formatValue(def: PropertyDef, value: PropertyValue): string {
    if (value == null) return "";
    switch (def.type) {
        case "checkbox":
            return value ? "Yes" : "";
        case "date":
            return formatDateValue(value);
        case "created_time":
        case "updated_time":
            return formatDateValue(value);
        case "multi_select":
            return Array.isArray(value) ? value.join(", ") : "";
        case "number":
            return typeof value === "number" ? String(value) : String(value ?? "");
        case "url":
            return typeof value === "string" ? value : "";
        default:
            return typeof value === "string" ? value : "";
    }
}

export const ALL_PROPERTY_TYPES: PropertyType[] = [
    "text",
    "number",
    "select",
    "multi_select",
    "status",
    "date",
    "person",
    "checkbox",
    "url",
    "formula",
    "relation",
    "created_time",
    "updated_time",
];

export function typeLabel(type: PropertyType): string {
    const map: Record<PropertyType, string> = {
        text: "Text",
        number: "Number",
        select: "Select",
        multi_select: "Multi-select",
        status: "Status",
        date: "Date",
        person: "Person",
        checkbox: "Checkbox",
        url: "URL",
        formula: "Formula",
        relation: "Relation",
        created_time: "Created time",
        updated_time: "Updated time",
    };
    return map[type];
}
