// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 风格属性卡片（Phase 2：支持值编辑）。
// 由 md-properties 插件的 waveBlockRenderers 委托渲染：block.content = frontmatter 的 YAML 纯文本。
// 编辑语义：点击行进入编辑（text/number/date/json 用输入框，boolean 点击切换，tag/list 逗号分隔），
// Enter 保存（触发 onDataChange → 上层写回草稿）、Esc 取消。只改值、不增删属性键。
// 卡片不携带 data-source-line → Markdown 容器 inline-edit 点击天然不拦截本区域。

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { buildPropertyEntries, parseFrontmatterYamlText, type PropertyEntry } from "./frontmatter-block";
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
            return trimmed === "" ? [] : trimmed.split(",").map((s) => s.trim()).filter((s) => s !== "");
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
};

export function ObsidianPropertiesCard({ block, onDataChange }: ObsidianPropertiesCardProps) {
    const data = useMemo(() => parseFrontmatterYamlText(block.content), [block.content]);
    const entries = useMemo(() => buildPropertyEntries(data), [data]);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const editable = onDataChange != null;

    const startEdit = (entry: PropertyEntry) => {
        if (!editable) return;
        if (entry.type === "boolean") {
            // boolean 点击直接切换，不进输入框
            onDataChange?.({ ...data, [entry.key]: String(entry.value) !== "true" });
            return;
        }
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

    const cancelEdit = () => {
        setEditingKey(null);
    };

    return (
        <div className="obsidian-props-card" data-obsidian-props-card="true">
            <div className="obsidian-props-header">
                <i className="fa-solid fa-asterisk" aria-hidden="true" />
                <span className="obsidian-props-title">属性</span>
                <span className="obsidian-props-count">{entries.length}</span>
            </div>
            {entries.map((entry) => {
                const isEditing = editingKey === entry.key;
                return (
                    <div
                        className={clsx("obsidian-props-row", editable && "is-editable", isEditing && "is-editing")}
                        key={entry.key}
                        onClick={() => startEdit(entry)}
                        title={editable ? "点击编辑" : undefined}
                    >
                        <i className={clsx("obsidian-props-icon", typeIcons[entry.type])} aria-hidden="true" />
                        <span className="obsidian-props-key" title={entry.key}>
                            {entry.key}
                        </span>
                        <span className="obsidian-props-value">
                            {isEditing ? (
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
                            ) : (
                                renderValue(entry)
                            )}
                        </span>
                        {editable && !isEditing && (
                            <i className="fa-regular fa-pen-to-square obsidian-props-edit-icon" aria-hidden="true" />
                        )}
                    </div>
                );
            })}
        </div>
    );
}