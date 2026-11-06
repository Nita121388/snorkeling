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
    /** 新建自定义属性（detail 模式 + canEdit 时展示入口）。saveToTemplate=true 时同时写入全局模板。 */
    onAddProperty?: (key: string, type: PropertyType, saveToTemplate: boolean) => void;
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
    /** 尾部插槽（详情卡放 AI 自动填入）。 */
    footer?: React.ReactNode;
    canEdit?: boolean;
};

const CreatableTypes: PropertyType[] = ["text", "number", "select", "multi_select", "status", "date", "person", "checkbox", "url"];

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
 * 浮层候选：schema 里声明的选项 + 当前值。
 * 去重保序（选项顺序就是 schema 顺序），未登记的自定义值也要在列表里可见。
 */
function dropdownOptions(def: PropertyDef, value: PropertyValue): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string) => {
        const text = String(raw);
        if (text === "" || seen.has(text)) return;
        seen.add(text);
        out.push(text);
    };
    for (const option of def.options ?? []) push(option.id);
    for (const item of itemsFromValue(value)) push(item);
    return out;
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

function AddPropertyForm({
    existingKeys,
    adding,
    setAdding,
    onSubmit,
    inline = false,
}: {
    existingKeys: string[];
    adding: boolean;
    setAdding: (value: boolean) => void;
    onSubmit: (key: string, type: PropertyType, saveToTemplate: boolean) => void;
    /** hover 卡底部单行：触发器文字更短、无内边距，展开后的表单占满一整行。 */
    inline?: boolean;
}) {
    const [name, setName] = React.useState("");
    const [type, setType] = React.useState<PropertyType>("text");
    const [saveToTemplate, setSaveToTemplate] = React.useState(true);
    const [error, setError] = React.useState("");

    if (!adding) {
        return (
            <button
                type="button"
                className={cn("property-add", inline && "property-add--inline")}
                onClick={() => setAdding(true)}
            >
                <i className="fa-sharp fa-solid fa-plus" /> {inline ? "Add property" : "Add a property"}
            </button>
        );
    }

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
        setError("");
        onSubmit(key, type, saveToTemplate);
        setName("");
        setType("text");
        setSaveToTemplate(true);
    };

    return (
        <div className="property-add-form">
            <input
                autoFocus
                className="property-edit-input"
                aria-label="Property name"
                placeholder="Property name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                    if (event.key === "Escape") setAdding(false);
                }}
            />
            <select
                className="property-select"
                aria-label="Property type"
                value={type}
                onChange={(event) => setType(event.target.value as PropertyType)}
            >
                {CreatableTypes.map((t) => (
                    <option key={t} value={t}>
                        {typeLabel(t)}
                    </option>
                ))}
            </select>
            <label className="property-add-template">
                <input
                    type="checkbox"
                    checked={saveToTemplate}
                    onChange={(event) => setSaveToTemplate(event.target.checked)}
                />
                Save to template
            </label>
            <button type="button" className="property-add-ok" onClick={submit}>
                Add
            </button>
            <button type="button" className="property-add-cancel" onClick={() => setAdding(false)} aria-label="Cancel">
                <i className="fa-sharp fa-solid fa-xmark" />
            </button>
            {error ? <span className="property-add-error">{error}</span> : null}
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
                        <AddPropertyForm
                            inline
                            existingKeys={entries.map((entry) => entry.def.key)}
                            adding={adding}
                            setAdding={setAdding}
                            onSubmit={(key, type, saveToTemplate) => {
                                setAdding(false);
                                onAddProperty(key, type, saveToTemplate);
                            }}
                        />
                    ) : null}
                    {footer != null ? <div className="property-footer__right">{footer}</div> : null}
                </div>
            ) : mode === "detail" && canEdit && onAddProperty != null ? (
                <div className="property-actions">
                    <AddPropertyForm
                        existingKeys={entries.map((entry) => entry.def.key)}
                        adding={adding}
                        setAdding={setAdding}
                        onSubmit={(key, type, saveToTemplate) => {
                            setAdding(false);
                            onAddProperty(key, type, saveToTemplate);
                        }}
                    />
                    {footer != null ? <div className="property-actions__aux">{footer}</div> : null}
                </div>
            ) : (
                footer
            )}
            {/* 浮层下拉编辑器（共享层，与 md 预览属性卡同源）。
                挂在列表尾部、portal 到 body：不参与行内布局，不会被窄卡宽度挤压。 */}
            {popoverEntry != null ? (
                <PropertyValuePopover open anchor={popoverAnchor} onClose={closePopover}>
                    <PropertyTagEditor
                        items={itemsFromValue(popoverEntry.cell.value)}
                        options={dropdownOptions(popoverEntry.def, popoverEntry.cell.value)}
                        multiple={MultiValueTypes.has(popoverEntry.def.type)}
                        onChange={(items) => commitDropdown(popoverEntry, items)}
                        onClose={closePopover}
                    />
                </PropertyValuePopover>
            ) : null}
        </div>
    );
}
