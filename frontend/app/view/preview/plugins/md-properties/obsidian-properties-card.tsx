// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 风格属性卡片（Phase 2：支持值编辑）。
// 由 md-properties 插件的 waveBlockRenderers 委托渲染：block.content = frontmatter 的 YAML 纯文本。
// 编辑语义：点击行进入编辑（text/number/date/json 用输入框，boolean 点击切换，tag/list 逗号分隔），
// Enter 保存（触发 onDataChange → 上层写回草稿）、Esc 取消。只改值、不增删属性键。
// 卡片不携带 data-source-line → Markdown 容器 inline-edit 点击天然不拦截本区域。

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { buildPropertyEntries, parseFrontmatterYamlText, type PropertyEntry } from "./frontmatter-block";
import { ListPropertyEditor } from "./list-property-editor";
import "./obsidian-properties-card.scss";

const JsonPreviewMaxLen = 300;

const typeIcons: Record<PropertyEntry["type"], string> = {
    text: "fa-solid fa-font",
    number: "fa-solid fa-hashtag",
    boolean: "fa-solid fa-toggle-on",
    date: "fa-regular fa-calendar",
    datetime: "fa-solid fa-clock",
    tag: "fa-solid fa-tag",
    tags: "fa-solid fa-tag",
    list: "fa-solid fa-list-ul",
    link: "fa-solid fa-link",
    json: "fa-solid fa-braces",
};

// ---------- 编辑产物（纯函数，供测试） ----------

/** 属性值 → 编辑框初始文本（list/tags 逗号分隔，json 压缩字符串）。 */
export function propertyValueToEditString(entry: PropertyEntry): string {
    switch (entry.type) {
        case "tags":
        case "list":
            return (entry.value as string[]).join(", ");
        case "json":
            return JSON.stringify(entry.value);
        default:
            return String(entry.value);
    }
}

/**
 * 编辑框文本 → 属性值。
 * - list/tags：逗号分隔 → 数组（空 → []）
 * - number：可解析数字 → number，否则原文本
 * - json：可解析 JSON → 结构化，否则原文本
 * - 其他：原文本
 */
export function parsePropertyEditString(entry: PropertyEntry, raw: string): unknown {
    const trimmed = raw.trim();
    switch (entry.type) {
        case "tags":
        case "list":
            return trimmed === ""
                ? []
                : trimmed
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s !== "");
        case "number": {
            const n = Number(trimmed);
            return trimmed !== "" && Number.isFinite(n) ? n : trimmed;
        }
        case "json": {
            try {
                return JSON.parse(trimmed);
            } catch {
                return trimmed;
            }
        }
        default:
            return trimmed;
    }
}

// ---------- 渲染 ----------

function renderValue(entry: PropertyEntry): React.ReactNode {
    const { type, value } = entry;
    switch (type) {
        case "tags":
        case "list": {
            const items = value as string[];
            return (
                <span className="obsidian-props-chips">
                    {items.map((item, i) => (
                        <span key={i} className={clsx("obsidian-props-chip", item.startsWith("#") && "is-tag")}>
                            {item}
                        </span>
                    ))}
                </span>
            );
        }
        case "tag": {
            return <span className={clsx("obsidian-props-chip", "is-tag")}>{String(value)}</span>;
        }
        case "json": {
            const raw = JSON.stringify(value);
            const text = raw.length > JsonPreviewMaxLen ? raw.slice(0, JsonPreviewMaxLen) + "…" : raw;
            return <span className="obsidian-props-json">{text}</span>;
        }
        case "boolean": {
            return (
                <span className={clsx("obsidian-props-boolean", String(value) === "true" && "is-true")}>
                    {String(value)}
                </span>
            );
        }
        default: {
            return <span className="obsidian-props-text">{String(value)}</span>;
        }
    }
}

type ObsidianPropertiesCardProps = {
    block: MarkdownContentBlockType;
    /** 属性变更回调（上层负责写回草稿/保存）。缺省 = 只读模式。 */
    onDataChange?: (newData: Record<string, unknown>) => void;
    /** 属性顺序变更回调。 */
    onReorder?: (fromIndex: number, toIndex: number) => void;
    /** 折叠状态持久化（可选）：重挂后恢复的种子值（true=收起）。与标题折叠同模式。 */
    collapsedSeed?: boolean;
    /** 折叠变更回写（可选）：折叠/展开时回调，上层持久化，供下次重挂恢复。 */
    onCollapsedChange?: (next: boolean) => void;
};

// 折叠状态跨 remount 持久化缓存（key = blockId）。
// 波块子树可能因父层重挂而丢失内部 state（方案 B 已根治同一次重挂内的丢失；跨块重开/
// tab 切换仍会卸载整个预览），与 preview-model 的 collapsedHeadings 缓存同一职责。
// ponytail: 缓存只增不减，无清理路径；条目数 ≈ 预览过的文件数，可接受（同 collapsedHeadings）。
const obsidianPropsCollapsedCache = new Map<string, boolean>();

export function getObsidianPropsCollapsed(key: string): boolean {
    return obsidianPropsCollapsedCache.get(key) ?? false;
}

export function setObsidianPropsCollapsed(key: string, next: boolean): void {
    obsidianPropsCollapsedCache.set(key, next);
}

export function ObsidianPropertiesCard({ block, onDataChange, onReorder, collapsedSeed, onCollapsedChange }: ObsidianPropertiesCardProps) {
    const data = useMemo(() => parseFrontmatterYamlText(block.content), [block.content]);
    const entries = useMemo(() => buildPropertyEntries(data), [data]);
    const [collapsed, setCollapsed] = useState<boolean>(() => collapsedSeed ?? false);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const editable = onDataChange != null;
    const dragable = onReorder != null;

    // Add property state
    const [addingNew, setAddingNew] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [newValue, setNewValue] = useState("");
    const newKeyRef = useRef<HTMLInputElement>(null);
    const newValueRef = useRef<HTMLInputElement>(null);

    // Drag-and-drop state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const overIndexRef = useRef<number | null>(null);

    const toggleCollapsed = () => {
        // 折叠时若有编辑进行中，直接放弃编辑态（行不可见后输入框无意义）
        setEditingKey(null);
        setCollapsed((c) => {
            const next = !c;
            onCollapsedChange?.(next);
            return next;
        });
    };

    const startEdit = (entry: PropertyEntry) => {
        if (!editable) return;
        if (entry.type === "boolean") {
            // boolean 点击直接切换，不进输入框
            onDataChange?.({ ...data, [entry.key]: String(entry.value) !== "true" });
            return;
        }
        // list/tags 类型直接进入编辑态（使用 ListPropertyEditor）
        setEditingKey(entry.key);
        setEditDraft(propertyValueToEditString(entry));
        // 等一帧聚焦，输入框挂载后
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const commitEdit = () => {
        if (editingKey == null) return;
        const entry = entries.find((e) => e.key === editingKey);
        if (entry != null) {
            onDataChange?.({ ...data, [editingKey]: parsePropertyEditString(entry, editDraft) });
        }
        setEditingKey(null);
    };

    const commitListEdit = (entry: PropertyEntry, newItems: string[]) => {
        onDataChange?.({ ...data, [entry.key]: newItems });
        setEditingKey(null);
    };

    const cancelEdit = () => {
        setEditingKey(null);
    };

    // ---------- Add property ----------

    const startAdd = useCallback(() => {
        setAddingNew(true);
        setNewKey("");
        setNewValue("");
        requestAnimationFrame(() => newKeyRef.current?.focus());
    }, []);

    const commitAdd = useCallback(() => {
        const trimmedKey = newKey.trim();
        if (trimmedKey === "") {
            setAddingNew(false);
            return;
        }
        onDataChange?.({ ...data, [trimmedKey]: newValue.trim() || "" });
        setAddingNew(false);
    }, [newKey, newValue, data, onDataChange]);

    const cancelAdd = useCallback(() => {
        setAddingNew(false);
    }, []);

    // Drag-and-drop handlers
    const handleDragStart = (e: React.DragEvent, index: number) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        setDragIndex(index);
        dragIndexRef.current = index;
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverIndex(index);
        overIndexRef.current = index;
    };

    const handleDragEnd = () => {
        setDragIndex(null);
        setOverIndex(null);
        dragIndexRef.current = null;
        overIndexRef.current = null;
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const from = dragIndexRef.current;
        const to = overIndexRef.current;
        if (from !== null && to !== null && from !== to) {
            onReorder?.(from, to);
        }
        setDragIndex(null);
        setOverIndex(null);
        dragIndexRef.current = null;
        overIndexRef.current = null;
    };

    return (
        <div className="obsidian-props-card" data-obsidian-props-card="true">
            <button
                type="button"
                className={clsx("obsidian-props-header", collapsed && "is-collapsed")}
                aria-expanded={!collapsed}
                data-state={collapsed ? "closed" : "open"}
                onClick={toggleCollapsed}
                title={collapsed ? "Expand properties" : "Collapse properties"}
            >
                <span className="obsidian-props-title">Properties</span>
                <span className="obsidian-props-chevron" aria-hidden="true">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="1em"
                        height="1em"
                        fill="none"
                        data-collapsed={collapsed}
                        style={{ userSelect: "none", flexShrink: 0 }}
                    >
                        <path
                            fill="currentColor"
                            d="M13.15 15.132a.757.757 0 0 1-1.3 0L8.602 9.605c-.29-.491.072-1.105.65-1.105h6.497c.577 0 .938.614.65 1.105z"
                        />
                    </svg>
                </span>
            </button>
            <div className="obsidian-props-separator" />
            {!collapsed &&
                entries.map((entry, index) => {
                    const isEditing = editingKey === entry.key;
                    return (
                        <div
                            className={clsx(
                                "obsidian-props-row",
                                editable && "is-editable",
                                isEditing && "is-editing",
                                dragable && "is-draggable",
                                dragIndex === index && "is-dragging",
                                overIndex === index && dragIndex !== index && "is-drag-over",
                            )}
                            key={entry.key}
                            draggable={dragable && !isEditing}
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragEnd={handleDragEnd}
                            onDrop={handleDrop}
                            onClick={() => startEdit(entry)}
                        >
                            {dragable && !isEditing && (
                                <span
                                    className="obsidian-props-drag-handle"
                                    title="Drag to reorder"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
                                </span>
                            )}
                            <i className={clsx("obsidian-props-icon", typeIcons[entry.type])} aria-hidden="true" />
                            <span className="obsidian-props-key" title={entry.key}>
                                {entry.key}
                            </span>
                            <span className="obsidian-props-value">
                                {isEditing ? (
                                    (entry.type === "tags" || entry.type === "list") ? (
                                        <ListPropertyEditor
                                            items={entry.value as string[]}
                                            onChange={(items) => commitListEdit(entry, items)}
                                            onClose={() => setEditingKey(null)}
                                        />
                                    ) : (
                                        <input
                                            ref={inputRef}
                                            className="obsidian-props-input"
                                            value={editDraft}
                                            onChange={(e) => setEditDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.stopPropagation();
                                                    commitEdit();
                                                } else if (e.key === "Escape") {
                                                    e.stopPropagation();
                                                    cancelEdit();
                                                }
                                            }}
                                            onBlur={() => setEditingKey(null)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    )
                                ) : (
                                    renderValue(entry)
                                )}
                            </span>
                        </div>
                    );
                })}
            {!collapsed && editable && (
                addingNew ? (
                    <div className="obsidian-props-add-row is-adding">
                        <i className="obsidian-props-icon fa-solid fa-font" aria-hidden="true" />
                        <input
                            ref={newKeyRef}
                            className="obsidian-props-add-key-input"
                            placeholder="key"
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.stopPropagation();
                                    // Enter 在 key 输入框：跳到 value 输入框
                                    newValueRef.current?.focus();
                                } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    cancelAdd();
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                        <input
                            ref={newValueRef}
                            className="obsidian-props-add-value-input"
                            placeholder="value"
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.stopPropagation();
                                    commitAdd();
                                } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    cancelAdd();
                                }
                            }}
                            onBlur={() => commitAdd()}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                ) : (
                    <div
                        className="obsidian-props-add-row"
                        onClick={() => startAdd()}
                        title="Add property"
                    >
                        <i className="obsidian-props-icon fa-solid fa-plus" aria-hidden="true" />
                        <span className="obsidian-props-add-text">Add property</span>
                    </div>
                )
            )}
        </div>
    );
}
