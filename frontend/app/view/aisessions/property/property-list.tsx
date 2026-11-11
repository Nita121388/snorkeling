// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PropertyList — Notion 式属性行渲染（单一渲染器，替代分散的 note/tags UI）。
//
// 行为对齐 design/plans/aisession-notion-properties.md §5：
//  - name 列 + value 列；card 模式隐藏空值、默认 5 行 + "+N more"；detail 模式全部显示。
//  - readonly（formula / created / updated / title_source）灰字不可编辑。
//  - AI 写入的值右侧 ✨，hover 显示来源。
//  - note 作为长文本单独占行（点击进入既有 note 编辑态）。

import { cn } from "@/util/util";
import { PropertyTagEditor, PropertyValuePopover } from "@/app/element/property-editor";
import * as React from "react";
import {
    formatDateValue,
    formatDateTimeValue,
    formatValue,
    humanizeKey,
    isEmptyValue,
    type SchemaDef,
    slugifyPropertyKey,
    typeLabel,
    type PropertyDef,
    type PropertyEntry,
    type PropertySource,
    type PropertyType,
    type PropertyValue,
    type SelectOption,
    toPropertyDefs,
    BUILTIN_PROP_KEYS,
} from "./property-model";
import { formatSessionRelativeTime } from "../utils";
import "./property-list.scss";

const CardPropertyLimit = 5;
/** detail（弹窗 / 详情卡）的主区行数上限。比悬浮卡大，但不再是无限铺 schema 空属性。 */
const DetailPropertyLimit = 8;
/** agent 布局（hover 卡）：4 行内置 + 最多 5 条自定义属性。 */
const AgentCardRowLimit = 9;

/**
 * detail 模式下默认折叠的只读 / 低价值内置行。
 * 弹窗的主要用途是写 Note/Tags 和看自定义属性，Title Source / Starred / Created / Updated
 * 常驻占掉 4 行会把真正要用的挤到最底下。
 */
const SecondaryBuiltinKeys: ReadonlySet<string> = new Set<string>([
    BUILTIN_PROP_KEYS.titleSource,
    BUILTIN_PROP_KEYS.starred,
    BUILTIN_PROP_KEYS.createdAt,
    BUILTIN_PROP_KEYS.updatedAt,
]);

/**
 * agent 布局（hover 卡）不渲染的内置行：
 *  - starred 已搬到卡片右上角；
 *  - title_source 已并入副标题（model · titleSource）。
 * 它们的信息没有丢，只是换了承载位置。
 */
const AgentHiddenBuiltinKeys: ReadonlySet<string> = new Set<string>([
    BUILTIN_PROP_KEYS.starred,
    BUILTIN_PROP_KEYS.titleSource,
]);

/** agent 布局的行顺序：先「新鲜度」再「标签/备注」，其余按 order。 */
const AgentBuiltinOrder: Record<string, number> = {
    [BUILTIN_PROP_KEYS.updatedAt]: 0,
    [BUILTIN_PROP_KEYS.createdAt]: 1,
    [BUILTIN_PROP_KEYS.tags]: 2,
    [BUILTIN_PROP_KEYS.note]: 3,
};

export type PropertyListProps = {
    summary: SessionSummary | null;
    mode?: "card" | "detail";
    /**
     * 行骨架。
     *  - notion：现状（Notion 属性面板：label 固定宽 + 左对齐值，空值 Empty）；
     *  - agent：hover 卡紧凑行（icon + label 左 / value 右，空值 —，时间相对化）。
     */
    layout?: "notion" | "agent";
    className?: string;
    /** 内置 note 行被点击（进入既有 note 编辑器）。 */
    onEditNote?: () => void;
    /** 内置 note 行弹窗编辑按钮（打开放大 Note 弹窗，类似 aisessions 列表）。 */
    onOpenNoteDialog?: () => void;
    /** 值变更（内置与自定义都走这里，由上层决定写哪个 RPC）。 */
    onChange?: (key: string, value: PropertyValue, def: PropertyDef) => void;
    /** 新建自定义属性（detail / agent 布局 + canEdit 时展示入口）。范围三选一见 PropertyAddScope。 */
    onAddProperty?: (key: string, type: PropertyType, scope: PropertyAddScope) => void;
    /** 删除自定义属性（仅 non-builtin）。 */
    onDeleteProperty?: (key: string) => void;
    /** 重命名自定义属性（改显示名，不改 key）。 */
    onRenameProperty?: (key: string, name: string) => void;
    /** 修改自定义属性类型。 */
    onRetypeProperty?: (key: string, type: PropertyType) => void;
    /** 调整自定义属性顺序（-1 上移 / 1 下移）。 */
    onMoveProperty?: (key: string, direction: -1 | 1) => void;
    /** 全局属性模板（wconfig agent:propertyschema）。 */
    schema?: SchemaDef[];
    /**
     * 全局标签清单（含 count），按属性 key 索引。
     *
     * 缺省时候选池与今天完全一致（def.options + 已选值）—— md 预览属性卡与
     * 所有未接入该通道的调用方行为零变化。
     */
    tagCatalog?: Record<string, SessionTagSummary[]>;
    /** 尾部插槽（详情卡放 AI 自动填入）。 */
    footer?: React.ReactNode;
    canEdit?: boolean;
};

const CreatableTypes: PropertyType[] = ["text", "number", "select", "multi_select", "status", "date", "person", "checkbox", "url"];

/**
 * 新建属性的定义范围（决定「定义」写到哪里；「值」永远只写当前会话）：
 *  - session：只写当前会话 props，不动模板（默认）；
 *  - agent：额外把定义写进全局模板，scope="agent:<source>"（仅该 Agent 的会话可见）；
 *  - global：额外把定义写进全局模板，scope=""（所有会话可见）。
 */
export type PropertyAddScope = "session" | "agent" | "global";

/** 多值类型：浮层里点击是 toggle，写回数组。 */
const MultiValueTypes: ReadonlySet<PropertyType> = new Set<PropertyType>(["multi_select", "person", "relation"]);

/** 用浮层下拉编辑的类型：多值类型 + 单选（select / status）。 */
const DropdownTypes: ReadonlySet<PropertyType> = new Set<PropertyType>([
    "multi_select",
    "person",
    "relation",
    "select",
    "status",
]);

/** 属性值 → 浮层 chips 的字符串数组（单选也归一成数组）。 */
function itemsFromValue(value: PropertyValue): string[] {
    if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v !== "");
    if (value == null || value === "") return [];
    return [String(value)];
}

/**
 * 浮层候选：当前值 → schema 声明的选项 → 全局清单。
 * 去重保序，未登记的自定义值也要在列表里可见。
 *
 * 顺序决策：
 *   1. 已选值在前 —— 用户刚输入的新标签不会被清单末尾吞掉，也不因清单缺失而消失；
 *   2. def.options 次之 —— 保持 md 预览与自定义 select 的既有顺序语义；
 *   3. 全局清单最后 —— 按 count 降序、同 count 字母序，让「用得多的」浮上来。
 */
function dropdownOptions(
    def: PropertyDef,
    value: PropertyValue,
    catalog?: SessionTagSummary[]
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string) => {
        const text = String(raw);
        if (text === "" || seen.has(text)) return;
        seen.add(text);
        out.push(text);
    };
    for (const item of itemsFromValue(value)) push(item);
    for (const option of def.options ?? []) push(option.id);
    const catalogTags = Array.isArray(catalog) ? [...catalog] : [];
    catalogTags.sort((left, right) => {
        const byCount = (right.count ?? 0) - (left.count ?? 0);
        return byCount !== 0 ? byCount : String(left.tag).localeCompare(String(right.tag));
    });
    for (const entry of catalogTags) push(entry.tag);
    return out;
}

/**
 * 浮层候选的 count 映射。
 *
 * 只收录清单里确实出现过的 tag —— 已选值 / def.options / 用户新建值没有 count 数据源，
 * 不伪造 0（编辑器那边对缺失的 key 直接不渲染计数字段）。
 */
function optionCountsFor(def: PropertyDef, catalog?: SessionTagSummary[]): Record<string, number> {
    const counts: Record<string, number> = {};
    if (Array.isArray(catalog)) {
        for (const entry of catalog) {
            if (entry?.tag != null && Number.isFinite(entry.count)) {
                counts[String(entry.tag)] = entry.count;
            }
        }
    }
    return counts;
}

function sourceMarker(source: PropertySource): React.ReactNode {
    if (source !== "ai") return null;
    return (
        <span className="property-ai-mark" title="AI generated">
            ✨
        </span>
    );
}

function chipClass(color?: string): string {
    return cn("property-chip", color != null && `property-chip--${color}`);
}

function optionsFor(def: PropertyDef, value: PropertyValue): SelectOption[] {
    const options = def.options ? [...def.options] : [];
    const known = new Set(options.map((o) => o.id));
    const values = Array.isArray(value) ? value : value != null && value !== "" ? [String(value)] : [];
    for (const v of values) {
        if (!known.has(v)) {
            // 未在选项表里登记的原始值（如内置 select 的 first_user_message）也要可读，
            // 不能用下划线原串直接渲染。
            options.push({ id: v, name: humanizeKey(v), color: "default" });
        }
    }
    return options;
}

const AgentRowIcons: Record<string, string> = {
    [BUILTIN_PROP_KEYS.createdAt]: "fa-calendar",
    [BUILTIN_PROP_KEYS.updatedAt]: "fa-clock",
    // 12px 以内单形图标更清楚：双标签 / 便签在 10px 会糊成一团。
    [BUILTIN_PROP_KEYS.tags]: "fa-tag",
    [BUILTIN_PROP_KEYS.note]: "fa-align-left",
};

/** agent 布局的行首图标：内置行固定映射，自定义属性用 hashtag 占位（不抢视觉）。 */
function agentRowIcon(def: PropertyDef): string {
    return AgentRowIcons[def.key] ?? (def.builtin ? "fa-circle-small" : "fa-hashtag");
}

function ValueDisplay({
    def,
    value,
    layout = "notion",
}: {
    def: PropertyDef;
    value: PropertyValue;
    layout?: "notion" | "agent";
}) {
    const isAgent = layout === "agent";
    // agent 布局用 — 代替 Empty（英文斜体单词在窄卡里是可扫读性负债）。
    const emptyNode = isAgent ? (
        <span className="property-empty property-empty--dash">—</span>
    ) : (
        <span className="property-empty">Empty</span>
    );
    switch (def.type) {
        case "checkbox":
            return (
                <span className={cn("property-checkbox", value === true && "is-checked")}>
                    {value === true ? <i className="fa-sharp fa-solid fa-check" /> : null}
                </span>
            );
        case "select":
        case "status": {
            if (value == null || value === "") {
                return emptyNode;
            }
            const option = optionsFor(def, value).find((o) => o.id === String(value));
            return <span className={chipClass(option?.color)}>{option?.name ?? humanizeKey(String(value))}</span>;
        }
        case "multi_select":
        case "person":
        case "relation": {
            const values = Array.isArray(value) ? value : value != null && value !== "" ? [String(value)] : [];
            if (values.length === 0) return emptyNode;
            return (
                <span className="property-chips">
                    {values.map((v) => {
                        const option = optionsFor(def, value).find((o) => o.id === v);
                        return (
                            <span key={v} className={chipClass(option?.color)}>
                                {option?.name ?? humanizeKey(v)}
                            </span>
                        );
                    })}
                </span>
            );
        }
        case "date":
            return <span className="property-text">{formatDateValue(value) || emptyNode}</span>;
        case "created_time":
        case "updated_time": {
            if (isAgent) {
                // hover 卡看「多久以前」；绝对值挂 title，需要精确时间时悬停即得。
                const ms = typeof value === "number" ? value : Date.parse(String(value ?? ""));
                if (Number.isFinite(ms)) {
                    return (
                        <span className="property-text" title={formatDateTimeValue(value)}>
                            {formatSessionRelativeTime(ms)}
                        </span>
                    );
                }
                return emptyNode;
            }
            return <span className="property-readonly">{formatDateTimeValue(value) || "—"}</span>;
        }
        case "url": {
            const text = typeof value === "string" ? value : "";
            if (text === "") return emptyNode;
            return (
                <span className="property-url" title={text}>
                    {text}
                </span>
            );
        }
        case "formula":
            return <span className="property-readonly"><i className="fa-solid fa-function" /> {formatValue(def, value)}</span>;
        default:
            // 内置 note 为空时与其它属性同形（Tags 空也显示 Empty），
            // 不再留一个既不显示 Empty、也没有占位文案的空白行。
            if (def.key === "note" && isEmptyValue(def, value)) {
                return emptyNode;
            }
            return <span className="property-text property-clamp">{formatValue(def, value)}</span>;
    }
}

function InlineEditor({
    def,
    value,
    onSubmit,
    onCancel,
}: {
    def: PropertyDef;
    value: PropertyValue;
    onSubmit: (next: PropertyValue) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = React.useState<string>(() => {
        if (Array.isArray(value)) return value.join(", ");
        if (typeof value === "number") return String(value);
        if (value == null) return "";
        return String(value);
    });

    const commit = () => {
        if (def.type === "number") {
            const trimmed = draft.trim();
            if (trimmed === "") return onSubmit(null);
            const num = Number(trimmed);
            return onSubmit(Number.isFinite(num) ? num : null);
        }
        if (def.type === "date") {
            if (draft === "") return onSubmit(null);
            const parsed = Date.parse(draft);
            return onSubmit(Number.isFinite(parsed) ? parsed : null);
        }
        return onSubmit(draft);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit();
        }
    };

    return (
        <input
            autoFocus
            className="property-edit-input"
            aria-label={`Edit ${def.name}`}
            type={def.type === "date" ? "date" : def.type === "number" ? "number" : "text"}
            value={def.type === "date" && typeof value === "number" ? new Date(value).toISOString().slice(0, 10) : draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            placeholder="Empty"
        />
    );
}

/** 新建属性的类型菜单图标（与 retype 下拉共用 CreatableTypes）。 */
const AddableTypeIcons: Record<string, string> = {
    text: "fa-font",
    number: "fa-hashtag",
    select: "fa-circle-dot",
    multi_select: "fa-tags",
    status: "fa-circle-half-stroke",
    date: "fa-calendar",
    person: "fa-user",
    checkbox: "fa-square-check",
    url: "fa-link",
};

type AddPropertyPanelProps = {
    existingKeys: string[];
    /** 「仅此 Agent」的标签（当前会话 source，如 pi）；空则禁用该选项。 */
    agentLabel?: string;
    onSubmit: (key: string, type: PropertyType, scope: PropertyAddScope) => void;
    onClose: () => void;
};

/**
 * 新建属性浮层面板（替换旧的内联表单，见原型 design/prototypes/agent/property-add-scope/）：
 *  - 名字（图标输入框）+ 类型（自定义下拉，替掉 native select）+ 范围三选一（默认「仅此会话」）；
 *  - Enter 提交 / Esc 关闭；空名禁用 Add；重名 / 空名行内报错；
 *  - 外壳用 PropertyValuePopover（portal 到 body + 视口铺位 + info-card pin），
 *    与属性值编辑浮层同一套定位语义。
 */
function AddPropertyPanel({ existingKeys, agentLabel, onSubmit, onClose }: AddPropertyPanelProps) {
    const [name, setName] = React.useState("");
    const [type, setType] = React.useState<PropertyType>("text");
    const [scope, setScope] = React.useState<PropertyAddScope>("session");
    const [typeMenuOpen, setTypeMenuOpen] = React.useState(false);
    const [error, setError] = React.useState("");

    const agentDisabled = (agentLabel ?? "").trim() === "";

    const submit = () => {
        const key = slugifyPropertyKey(name);
        if (key === "") {
            setError("Name is required");
            return;
        }
        if (existingKeys.includes(key)) {
            setError("Property already exists");
            return;
        }
        onSubmit(key, type, scope);
        onClose();
    };

    return (
        <div className="property-add-panel" data-testid="property-add-popover" role="dialog" aria-label="Add property">
            <div className="property-add-panel__name">
                <i className="fa-sharp fa-solid fa-pen" aria-hidden="true" />
                <input
                    autoFocus
                    data-testid="property-add-name"
                    className="property-edit-input"
                    aria-label="Property name"
                    placeholder="Property name"
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        if (error !== "") setError("");
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            submit();
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            onClose();
                        }
                    }}
                />
            </div>
            <button
                type="button"
                data-testid="property-add-type"
                className="property-add-panel__type"
                aria-haspopup="listbox"
                aria-expanded={typeMenuOpen}
                onClick={() => setTypeMenuOpen(!typeMenuOpen)}
            >
                <i className={cn("fa-sharp fa-solid", AddableTypeIcons[type] ?? "fa-font")} aria-hidden="true" />
                <span className="property-add-panel__type-name">{typeLabel(type)}</span>
                <i className="fa-sharp fa-solid fa-chevron-down property-add-panel__caret" aria-hidden="true" />
            </button>
            {typeMenuOpen ? (
                <div className="property-add-panel__type-menu" role="listbox" aria-label="Property type">
                    {CreatableTypes.map((t) => (
                        <button
                            key={t}
                            type="button"
                            role="option"
                            aria-selected={t === type}
                            data-testid="property-add-type-option"
                            data-type={t}
                            className={cn("property-add-panel__type-item", t === type && "is-active")}
                            onClick={() => {
                                setType(t);
                                setTypeMenuOpen(false);
                            }}
                        >
                            <i className={cn("fa-sharp fa-solid", AddableTypeIcons[t] ?? "fa-font")} aria-hidden="true" />
                            <span>{typeLabel(t)}</span>
                            {t === type ? <i className="fa-sharp fa-solid fa-check" aria-hidden="true" /> : null}
                        </button>
                    ))}
                </div>
            ) : null}
            <div className="property-add-panel__scope" role="radiogroup" aria-label="Apply to">
                <div className="property-add-panel__scope-title">Apply to</div>
                {(
                    [
                        {
                            id: "session",
                            icon: "fa-file-lines",
                            title: "仅此会话",
                            desc: "只写到当前会话，不动任何模板",
                            chip: "默认",
                        },
                        {
                            id: "agent",
                            icon: "fa-robot",
                            title: agentDisabled ? "仅此 Agent" : `仅此 Agent（${agentLabel}）`,
                            desc: agentDisabled
                                ? "当前会话没有 Agent 标识，不可用"
                                : `所有 ${agentLabel} 会话出现该属性，其它 Agent 不受影响`,
                        },
                        {
                            id: "global",
                            icon: "fa-globe",
                            title: "所有会话",
                            desc: "写入全局模板，全部 Agent 的会话可见",
                        },
                    ] as Array<{ id: PropertyAddScope; icon: string; title: string; desc: string; chip?: string }>
                ).map((opt) => {
                    const disabled = opt.id === "agent" && agentDisabled;
                    return (
                        <label
                            key={opt.id}
                            data-testid="property-add-scope"
                            data-scope={opt.id}
                            className={cn(
                                "property-add-panel__scope-opt",
                                scope === opt.id && "is-active",
                                disabled && "is-disabled"
                            )}
                        >
                            <input
                                type="radio"
                                name="property-add-scope"
                                value={opt.id}
                                checked={scope === opt.id}
                                disabled={disabled}
                                onChange={() => setScope(opt.id)}
                            />
                            <i className={cn("fa-sharp fa-solid", opt.icon)} aria-hidden="true" />
                            <span className="property-add-panel__scope-txt">
                                <span className="property-add-panel__scope-t">{opt.title}</span>
                                <span className="property-add-panel__scope-d">{opt.desc}</span>
                            </span>
                            {opt.chip != null ? <span className="property-add-panel__scope-chip">{opt.chip}</span> : null}
                        </label>
                    );
                })}
            </div>
            {error !== "" ? (
                <div className="property-add-panel__error" data-testid="property-add-error">
                    {error}
                </div>
            ) : null}
            <div className="property-add-panel__footer">
                <span className="property-add-panel__hint">Enter 创建 · Esc 关闭</span>
                <button
                    type="button"
                    data-testid="property-add-cancel"
                    className="property-add-panel__cancel"
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    data-testid="property-add-submit"
                    className="property-add-panel__ok"
                    disabled={slugifyPropertyKey(name) === ""}
                    onClick={submit}
                >
                    Add
                </button>
            </div>
        </div>
    );
}

export function PropertyList({
    summary,
    mode = "card",
    layout = "notion",
    className,
    onEditNote,
    onOpenNoteDialog,
    onChange,
    onAddProperty,
    onDeleteProperty,
    onRenameProperty,
    onRetypeProperty,
    onMoveProperty,
    schema,
    tagCatalog,
    footer,
    canEdit = false,
}: PropertyListProps) {
    const isAgent = layout === "agent";
    const entries = React.useMemo(() => {
        const all = toPropertyDefs(summary, schema);
        if (!isAgent) {
            return all;
        }
        // hover 卡：starred / title_source 已搬到头部与副标题，这里不再重复。
        // 顺序固定为「新鲜度 → 标签/备注 → 自定义」，自定义内部仍按 order 排。
        return all
            .filter((entry) => !AgentHiddenBuiltinKeys.has(entry.def.key))
            .sort((left, right) => {
                const lo = AgentBuiltinOrder[left.def.key];
                const ro = AgentBuiltinOrder[right.def.key];
                if (lo == null && ro == null) return left.def.order - right.def.order;
                if (lo == null) return 1;
                if (ro == null) return -1;
                return lo - ro;
            });
    }, [summary, schema, isAgent]);
    const [expanded, setExpanded] = React.useState(false);
    const [editingKey, setEditingKey] = React.useState<string | null>(null);
    // 浮层下拉编辑（多值标签 / 单选）：锚点用行内值按钮的 DOM，因为浮层要贴在值单元格下方。
    const [popoverKey, setPopoverKey] = React.useState<string | null>(null);
    const [popoverAnchor, setPopoverAnchor] = React.useState<HTMLElement | null>(null);
    const valueBtnRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
    const [adding, setAdding] = React.useState(false);
    // 新建属性浮层的锚点（+ Add property 按钮）。
    const addBtnRef = React.useRef<HTMLButtonElement | null>(null);
    const [menuKey, setMenuKey] = React.useState<string | null>(null);
    const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
    const [retypeKey, setRetypeKey] = React.useState<string | null>(null);

    const { primary, secondary } = React.useMemo(() => {
        if (isAgent) {
            // agent 布局不分组：内置 4 行恒显（空值用 —），自定义行按数量截断。
            return { primary: entries, secondary: [] };
        }
        if (mode !== "detail") {
            return { primary: entries.filter((entry) => !isEmptyValue(entry.def, entry.cell.value)), secondary: [] };
        }
        // detail：主区 = Tags / Note / 有值的自定义属性；
        // 副区 = 只读低价值内置行 + 模板里定义但本会话无值的自定义属性（默认折叠）。
        const primary: PropertyEntry[] = [];
        const secondary: PropertyEntry[] = [];
        for (const entry of entries) {
            if (SecondaryBuiltinKeys.has(entry.def.key)) {
                secondary.push(entry);
                continue;
            }
            if (entry.def.builtin || !isEmptyValue(entry.def, entry.cell.value)) {
                primary.push(entry);
            } else {
                secondary.push(entry);
            }
        }
        return { primary, secondary };
    }, [entries, mode, isAgent]);

    const limit = isAgent ? AgentCardRowLimit : mode === "detail" ? DetailPropertyLimit : CardPropertyLimit;
    const shownPrimary = expanded ? primary : primary.slice(0, limit);
    const moreCount = expanded ? 0 : Math.max(0, primary.length - limit) + secondary.length;

    const closePopover = React.useCallback(() => {
        setPopoverKey(null);
        setPopoverAnchor(null);
    }, []);

    // 属性被删除 / 列表换会话后，悬空的浮层要自己收起来（锚点已经不在树上）。
    React.useEffect(() => {
        if (popoverKey == null) return;
        if (!entries.some((entry) => entry.def.key === popoverKey)) {
            closePopover();
        }
    }, [entries, popoverKey, closePopover]);

    const startEdit = (entry: PropertyEntry) => {
        if (!canEdit || entry.def.readOnly || onChange == null) return;
        // checkbox 不是“编辑”而是“切换”：直接落值，不进编辑态。
        // 以前落入 InlineEditor 的默认 <input type="text">，框里显示字符串 "false"，
        // 提交后 starred 走 value === true 判断 → 永远勾不上。
        if (entry.def.type === "checkbox") {
            onChange(entry.def.key, entry.cell.value !== true, entry.def);
            return;
        }
        if (entry.def.key === "note" && onEditNote != null) {
            onEditNote();
            return;
        }
        // 多值标签 / 单选：走浮层下拉（与 md 预览属性卡同一套 Wolai 风格编辑器），
        // 不再要求用户在窄卡里手打逗号串。
        if (DropdownTypes.has(entry.def.type)) {
            setEditingKey(null);
            setMenuKey(null);
            setPopoverAnchor(valueBtnRefs.current[entry.def.key] ?? null);
            setPopoverKey(entry.def.key);
            return;
        }
        setPopoverKey(null);
        setEditingKey(entry.def.key);
    };

    const submit = (entry: PropertyEntry, next: PropertyValue) => {
        setEditingKey(null);
        onChange?.(entry.def.key, next, entry.def);
    };

    /**
     * 浮层里的即时写回：多值 → 数组；单选 → 标量（清空 → null）。
     * 刻意不关浮层（toggle 连着点几个值时不能在第一个值后就消失）。
     */
    const commitDropdown = (entry: PropertyEntry, items: string[]) => {
        const multiple = MultiValueTypes.has(entry.def.type);
        onChange?.(entry.def.key, multiple ? items : (items[0] ?? null), entry.def);
    };

    const customKeys = entries.filter((e) => !e.def.builtin).map((e) => e.def.key);
    const customIndex = (key: string) => customKeys.indexOf(key);

    const renderRow = (entry: PropertyEntry) => {
        const { def, cell } = entry;
        const isNote = def.key === "note";
        const isCheckbox = def.type === "checkbox";
        const editable = canEdit && !def.readOnly && onChange != null;
        const manageable = canEdit && !def.builtin && (onDeleteProperty != null || onRenameProperty != null || onRetypeProperty != null);
        const isEditing = editingKey === def.key && editable;
        // 可下拉编辑（多值标签 / 单选）：当前行的浮层是不是开着。
        const isDropdown = editable && DropdownTypes.has(def.type);
        const isPopoverOpen = isDropdown && popoverKey === def.key;
        const isRenaming = renamingKey === def.key;
        const isRetyping = retypeKey === def.key;
        const idx = customIndex(def.key);
        const canUp = manageable && onMoveProperty != null && idx > 0;
        const canDown = manageable && onMoveProperty != null && idx >= 0 && idx < customKeys.length - 1;
        return (
            <div
                key={def.key}
                className={cn(
                    "property-row",
                    isAgent && "property-row--agent",
                    def.readOnly && "is-readonly",
                    isNote && "is-note",
                    editable && "is-editable",
                    (isEditing || isPopoverOpen || isRenaming || isRetyping) && "is-editing"
                )}
                data-property-key={def.key}
                data-property-type={def.type}
            >
                {isAgent ? (
                    <span className="property-row__icon" aria-hidden="true">
                        <i className={cn("fa-sharp", "fa-solid", agentRowIcon(def))} />
                    </span>
                ) : null}
                <span className="property-row__name" title={def.name}>
                    {isRenaming ? (
                        <input
                            autoFocus
                            className="property-edit-input"
                            aria-label={`Rename ${def.name}`}
                            defaultValue={def.name}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                    setRenamingKey(null);
                                } else if (event.key === "Enter") {
                                    const next = event.currentTarget.value.trim();
                                    setRenamingKey(null);
                                    if (next !== "" && next !== def.name) onRenameProperty?.(def.key, next);
                                }
                            }}
                            onBlur={(event) => {
                                const next = event.currentTarget.value.trim();
                                setRenamingKey(null);
                                if (next !== "" && next !== def.name) onRenameProperty?.(def.key, next);
                            }}
                        />
                    ) : (
                        def.name
                    )}
                </span>
                <span className="property-row__value">
                    {isEditing ? (
                        <InlineEditor
                            def={def}
                            value={cell.value}
                            onSubmit={(next) => submit(entry, next)}
                            onCancel={() => setEditingKey(null)}
                        />
                    ) : isRetyping ? (
                        <select
                            autoFocus
                            className="property-select"
                            aria-label={`Change type of ${def.name}`}
                            value={def.type}
                            onChange={(event) => {
                                const next = event.target.value as PropertyType;
                                setRetypeKey(null);
                                onRetypeProperty?.(def.key, next);
                            }}
                            onBlur={() => setRetypeKey(null)}
                        >
                            {CreatableTypes.map((t) => (
                                <option key={t} value={t}>
                                    {typeLabel(t)}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <button
                            type="button"
                            className="property-row__button"
                            ref={(el) => {
                                valueBtnRefs.current[def.key] = el;
                            }}
                            aria-label={`Set ${def.name}`}
                            // checkbox 用 switch 语义：点击即切换，读屏能报出当前状态。
                            role={isCheckbox ? "switch" : undefined}
                            aria-checked={isCheckbox ? cell.value === true : undefined}
                            aria-expanded={isDropdown ? popoverKey === def.key : undefined}
                            disabled={!editable}
                            onClick={() => startEdit(entry)}
                        >
                            <ValueDisplay def={def} value={cell.value} layout={layout} />
                            {sourceMarker(cell.source)}
                        </button>
                    )}
                    {isNote && onOpenNoteDialog != null ? (
                        <button
                            type="button"
                            className="property-row__dialog-btn"
                            aria-label="Open note in dialog"
                            title="Open note in dialog"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenNoteDialog();
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-up-right-and-down-left-from-center" />
                        </button>
                    ) : null}
                    {manageable ? (
                        <button
                            type="button"
                            className="property-row__menu-btn"
                            aria-label={`Property menu for ${def.name}`}
                            title="Property menu"
                            onClick={(event) => {
                                event.stopPropagation();
                                setMenuKey(menuKey === def.key ? null : def.key);
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-ellipsis" />
                        </button>
                    ) : null}
                    {manageable && menuKey === def.key ? (
                        <div className="property-row__menu" role="menu">
                            {onRenameProperty != null ? (
                                <button type="button" role="menuitem" onClick={() => { setMenuKey(null); setRenamingKey(def.key); }}>
                                    Rename
                                </button>
                            ) : null}
                            {onRetypeProperty != null ? (
                                <button type="button" role="menuitem" onClick={() => { setMenuKey(null); setRetypeKey(def.key); }}>
                                    Change type
                                </button>
                            ) : null}
                            {onMoveProperty != null ? (
                                <>
                                    <button type="button" role="menuitem" disabled={!canUp} onClick={() => { setMenuKey(null); onMoveProperty(def.key, -1); }}>
                                        Move up
                                    </button>
                                    <button type="button" role="menuitem" disabled={!canDown} onClick={() => { setMenuKey(null); onMoveProperty(def.key, 1); }}>
                                        Move down
                                    </button>
                                </>
                            ) : null}
                            {onDeleteProperty != null ? (
                                <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuKey(null); onDeleteProperty(def.key); }}>
                                    Delete
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </span>
            </div>
        );
    };

    // card 模式全空时：给一个可点的 note 占位，保留“添加备注”的入口（与今天一致）。
    const showNotePlaceholder = !isAgent && mode === "card" && shownPrimary.length === 0;
    const noteEntry = entries.find((entry) => entry.def.key === "note");
    // 当前打开的浮层对应的属性行（取最新 entry：值变更后梯子里的值也要跟上）。
    const popoverEntry =
        popoverKey == null ? null : (entries.find((entry) => entry.def.key === popoverKey) ?? null);

    return (
        <div
            className={cn(
                "property-list",
                mode === "card" && "property-list--card",
                isAgent && "property-list--agent",
                className
            )}
        >
            {showNotePlaceholder && noteEntry != null ? (
                <div className="property-row is-note is-editable" data-property-key="note">
                    <span className="property-row__name">Note</span>
                    <span className="property-row__value">
                        <button type="button" className="property-row__button" onClick={() => onEditNote?.()}>
                            <span className="property-empty">Click to add a note...</span>
                        </button>
                    </span>
                </div>
            ) : (
                <>
                    {shownPrimary.map(renderRow)}
                    {expanded && secondary.length > 0 ? (
                        <>
                            <div className="property-divider" aria-hidden="true" />
                            {secondary.map(renderRow)}
                        </>
                    ) : null}
                </>
            )}
            {moreCount > 0 ? (
                <button
                    type="button"
                    className="property-more"
                    onClick={() => setExpanded(true)}
                    aria-label={`Show ${moreCount} more properties`}
                >
                    More properties ({moreCount})
                </button>
            ) : null}
            {isAgent ? (
                <div className="property-footer">
                    {canEdit && onAddProperty != null ? (
                        <button
                            type="button"
                            ref={addBtnRef}
                            className="property-add property-add--inline"
                            aria-expanded={adding}
                            onClick={() => setAdding(!adding)}
                        >
                            <i className="fa-sharp fa-solid fa-plus" aria-hidden="true" /> Add property
                        </button>
                    ) : null}
                    {footer != null ? <div className="property-footer__right">{footer}</div> : null}
                </div>
            ) : mode === "detail" && canEdit && onAddProperty != null ? (
                <div className="property-actions">
                    <button
                        type="button"
                        ref={addBtnRef}
                        className="property-add"
                        aria-expanded={adding}
                        onClick={() => setAdding(!adding)}
                    >
                        <i className="fa-sharp fa-solid fa-plus" aria-hidden="true" /> Add a property
                    </button>
                    {footer != null ? <div className="property-actions__aux">{footer}</div> : null}
                </div>
            ) : (
                footer
            )}
            {/* 新建属性浮层面板（替换旧的内联表单）。portal 到 body + 视口钳位，
                agent 悬停卡与 detail 弹窗共用同一个组件。 */}
            {canEdit && onAddProperty != null && adding ? (
                <PropertyValuePopover open anchor={addBtnRef.current} onClose={() => setAdding(false)}>
                    <AddPropertyPanel
                        existingKeys={entries.map((entry) => entry.def.key)}
                        agentLabel={(summary?.source ?? "").trim()}
                        onSubmit={(key, type, scope) => {
                            setAdding(false);
                            onAddProperty(key, type, scope);
                        }}
                        onClose={() => setAdding(false)}
                    />
                </PropertyValuePopover>
            ) : null}
            {/* 浮层下拉编辑器（共享层，与 md 预览属性卡同源）。
                挂在列表尾部、portal 到 body：不参与行内布局，不会被窄卡宽度挤压。 */}
            {popoverEntry != null ? (
                <PropertyValuePopover open anchor={popoverAnchor} onClose={closePopover}>
                    <PropertyTagEditor
                        items={itemsFromValue(popoverEntry.cell.value)}
                        options={dropdownOptions(
                            popoverEntry.def,
                            popoverEntry.cell.value,
                            tagCatalog?.[popoverEntry.def.key]
                        )}
                        optionCounts={optionCountsFor(popoverEntry.def, tagCatalog?.[popoverEntry.def.key])}
                        multiple={MultiValueTypes.has(popoverEntry.def.type)}
                        onChange={(items) => commitDropdown(popoverEntry, items)}
                        onClose={closePopover}
                    />
                </PropertyValuePopover>
            ) : null}
        </div>
    );
}
