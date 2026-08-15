// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 风格属性卡片（Phase 1 只读）。
// 由 md-properties 插件的 waveBlockRenderers 委托渲染：block.content = frontmatter 的 YAML 纯文本。
// 只读：不做编辑/折叠/排序；不携带 data-source-line → inline-edit 点击自然不进入编辑。

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import clsx from "clsx";
import { useMemo } from "react";
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
            const raw = String(value);
            return <span className={clsx("obsidian-props-chip", "is-tag")}>{raw}</span>;
        }
        case "json": {
            const raw = JSON.stringify(value);
            const text = raw.length > JsonPreviewMaxLen ? raw.slice(0, JsonPreviewMaxLen) + "…" : raw;
            return <span className="obsidian-props-json">{text}</span>;
        }
        case "boolean": {
            return <span className={clsx("obsidian-props-boolean", String(value) === "true" && "is-true")}>{String(value)}</span>;
        }
        default: {
            return <span className="obsidian-props-text">{String(value)}</span>;
        }
    }
}

export function ObsidianPropertiesCard({ block }: { block: MarkdownContentBlockType }) {
    const data = useMemo(() => parseFrontmatterYamlText(block.content), [block.content]);
    const entries = useMemo(() => buildPropertyEntries(data), [data]);
    return (
        <div className="obsidian-props-card" data-obsidian-props-card="true">
            <div className="obsidian-props-header">
                <i className="fa-solid fa-asterisk" aria-hidden="true" />
                <span className="obsidian-props-title">属性</span>
                <span className="obsidian-props-count">{entries.length}</span>
            </div>
            {entries.map((entry) => (
                <div className="obsidian-props-row" key={entry.key}>
                    <i className={clsx("obsidian-props-icon", typeIcons[entry.type])} aria-hidden="true" />
                    <span className="obsidian-props-key" title={entry.key}>
                        {entry.key}
                    </span>
                    <span className="obsidian-props-value">{renderValue(entry)}</span>
                </div>
            ))}
        </div>
    );
}