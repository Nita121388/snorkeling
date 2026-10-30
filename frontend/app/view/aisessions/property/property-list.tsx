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
import * as React from "react";
import {
    formatDateValue,
    formatDateTimeValue,
    formatValue,
    isEmptyValue,
    slugifyPropertyKey,
    typeLabel,
    type PropertyDef,
    type PropertyEntry,
    type PropertySource,
    type PropertyType,
    type PropertyValue,
    type SelectOption,
    toPropertyDefs,
} from "./property-model";
import "./property-list.scss";

const CardPropertyLimit = 5;

export type PropertyListProps = {
    summary: SessionSummary | null;
    mode?: "card" | "detail";
    className?: string;
    /** 内置 note 行被点击（进入既有 note 编辑器）。 */
    onEditNote?: () => void;
    /** 值变更（内置与自定义都走这里，由上层决定写哪个 RPC）。 */
    onChange?: (key: string, value: PropertyValue, def: PropertyDef) => void;
    /** 新建自定义属性（detail 模式 + canEdit 时展示入口）。 */
    onAddProperty?: (key: string, type: PropertyType) => void;
    /** 删除自定义属性（仅 non-builtin）。 */
    onDeleteProperty?: (key: string) => void;
    canEdit?: boolean;
};

const CreatableTypes: PropertyType[] = ["text", "number", "select", "multi_select", "status", "date", "person", "checkbox", "url"];

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
            options.push({ id: v, name: v, color: "default" });
        }
    }
    return options;
}

function ValueDisplay({ def, value }: { def: PropertyDef; value: PropertyValue }) {
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
                return <span className="property-empty">Empty</span>;
            }
            const option = optionsFor(def, value).find((o) => o.id === String(value));
            return <span className={chipClass(option?.color)}>{option?.name ?? String(value)}</span>;
        }
        case "multi_select":
        case "person":
        case "relation": {
            const values = Array.isArray(value) ? value : value != null && value !== "" ? [String(value)] : [];
            if (values.length === 0) return <span className="property-empty">Empty</span>;
            return (
                <span className="property-chips">
                    {values.map((v) => {
                        const option = optionsFor(def, value).find((o) => o.id === v);
                        return (
                            <span key={v} className={chipClass(option?.color)}>
                                {option?.name ?? v}
                            </span>
                        );
                    })}
                </span>
            );
        }
        case "date":
            return <span className="property-text">{formatDateValue(value) || <span className="property-empty">Empty</span>}</span>;
        case "created_time":
        case "updated_time":
            return <span className="property-readonly">{formatDateTimeValue(value) || "—"}</span>;
        case "url": {
            const text = typeof value === "string" ? value : "";
            if (text === "") return <span className="property-empty">Empty</span>;
            return (
                <span className="property-url" title={text}>
                    {text}
                </span>
            );
        }
        case "formula":
            return <span className="property-readonly"><i className="fa-solid fa-function" /> {formatValue(def, value)}</span>;
        default:
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
        if (def.type === "multi_select" || def.type === "person" || def.type === "relation") {
            const values = draft
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v !== "");
            return onSubmit(values);
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

    if (def.type === "select" || def.type === "status") {
        const options = optionsFor(def, value);
        return (
            <select
                autoFocus
                className="property-select"
                aria-label={`Edit ${def.name}`}
                value={value == null ? "" : String(value)}
                onChange={(event) => onSubmit(event.target.value === "" ? null : event.target.value)}
                onBlur={onCancel}
            >
                <option value="">Empty</option>
                {options.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.name}
                    </option>
                ))}
            </select>
        );
    }

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
}: {
    existingKeys: string[];
    adding: boolean;
    setAdding: (value: boolean) => void;
    onSubmit: (key: string, type: PropertyType) => void;
}) {
    const [name, setName] = React.useState("");
    const [type, setType] = React.useState<PropertyType>("text");
    const [error, setError] = React.useState("");

    if (!adding) {
        return (
            <button type="button" className="property-add" onClick={() => setAdding(true)}>
                <i className="fa-sharp fa-solid fa-plus" /> Add a property
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
        onSubmit(key, type);
        setName("");
        setType("text");
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
    className,
    onEditNote,
    onChange,
    onAddProperty,
    onDeleteProperty,
    canEdit = false,
}: PropertyListProps) {
    const entries = React.useMemo(() => toPropertyDefs(summary), [summary]);
    const [expanded, setExpanded] = React.useState(false);
    const [editingKey, setEditingKey] = React.useState<string | null>(null);
    const [adding, setAdding] = React.useState(false);

    const visible = React.useMemo(() => {
        if (mode === "detail") return entries;
        return entries.filter((entry) => !isEmptyValue(entry.def, entry.cell.value));
    }, [entries, mode]);

    const shown = mode === "card" && !expanded ? visible.slice(0, CardPropertyLimit) : visible;
    const hiddenCount = mode === "card" && !expanded ? Math.max(0, visible.length - CardPropertyLimit) : 0;

    const startEdit = (entry: PropertyEntry) => {
        if (!canEdit || entry.def.readOnly || onChange == null) return;
        if (entry.def.key === "note" && onEditNote != null) {
            onEditNote();
            return;
        }
        setEditingKey(entry.def.key);
    };

    const submit = (entry: PropertyEntry, next: PropertyValue) => {
        setEditingKey(null);
        onChange?.(entry.def.key, next, entry.def);
    };

    const renderRow = (entry: PropertyEntry) => {
        const { def, cell } = entry;
        const isNote = def.key === "note";
        const empty = isEmptyValue(def, cell.value);
        const editable = canEdit && !def.readOnly && onChange != null;
        const deletable = canEdit && !def.builtin && onDeleteProperty != null;
        const isEditing = editingKey === def.key && editable;
        void empty;
        return (
            <div
                key={def.key}
                className={cn(
                    "property-row",
                    def.readOnly && "is-readonly",
                    isNote && "is-note",
                    editable && "is-editable",
                    isEditing && "is-editing"
                )}
                data-property-key={def.key}
                data-property-type={def.type}
            >
                <span className="property-row__name" title={def.name}>
                    {def.name}
                </span>
                <span className="property-row__value">
                    {isEditing ? (
                        <InlineEditor
                            def={def}
                            value={cell.value}
                            onSubmit={(next) => submit(entry, next)}
                            onCancel={() => setEditingKey(null)}
                        />
                    ) : (
                        <button
                            type="button"
                            className="property-row__button"
                            aria-label={`Set ${def.name}`}
                            disabled={!editable}
                            onClick={() => startEdit(entry)}
                        >
                            <ValueDisplay def={def} value={cell.value} />
                            {sourceMarker(cell.source)}
                            {empty && mode === "detail" && def.type !== "checkbox" ? null : null}
                        </button>
                    )}
                    {deletable ? (
                        <button
                            type="button"
                            className="property-row__delete"
                            aria-label={`Delete ${def.name}`}
                            title={`Delete ${def.name}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                onDeleteProperty?.(def.key);
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-xmark" />
                        </button>
                    ) : null}
                </span>
            </div>
        );
    };

    // card 模式全空时：给一个可点的 note 占位，保留"添加备注"的入口（与今天一致）。
    const showNotePlaceholder = mode === "card" && shown.length === 0;
    const noteEntry = entries.find((entry) => entry.def.key === "note");

    return (
        <div className={cn("property-list", mode === "card" && "property-list--card", className)}>
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
                shown.map(renderRow)
            )}
            {hiddenCount > 0 ? (
                <button type="button" className="property-more" onClick={() => setExpanded(true)} aria-label={`Show ${hiddenCount} more properties`}>
                    +{hiddenCount} more {hiddenCount === 1 ? "property" : "properties"}
                </button>
            ) : null}
            {mode === "detail" && canEdit && onAddProperty != null ? (
                <AddPropertyForm
                    existingKeys={entries.map((entry) => entry.def.key)}
                    adding={adding}
                    setAdding={setAdding}
                    onSubmit={(key, type) => {
                        setAdding(false);
                        onAddProperty(key, type);
                    }}
                />
            ) : null}
        </div>
    );
}
