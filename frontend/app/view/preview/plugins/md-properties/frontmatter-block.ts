// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 笔记属性（frontmatter）解析与类型推断。
// 与 Obsidian 应用解耦：纯文本解析 + YAML.parse（yaml 包已在依赖，base-view 同款）。
// 输出：frontmatter 行范围（供 mdast 替换）+ 结构化属性条目（供卡片渲染）。

import YAML from "yaml";

export type FrontmatterBlock = {
    /** 1-based, inclusive — 起始 `---` 行号（文件坐标）。 */
    startLine: number;
    /** 1-based, inclusive — 结束 `---`/`...` 行号。 */
    endLine: number;
    /** 去分隔符后的 YAML 纯文本（保留原始换行，供内容块悬挂）。 */
    yamlText: string;
    /** YAML.parse 结果；空/纯注释 frontmatter 为 {}。 */
    data: Record<string, unknown>;
};

export type PropertyDisplayType =
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "tag"
    | "tags"
    | "list"
    | "link"
    | "json";

export type PropertyValue = string | number | boolean | string[] | Record<string, unknown>;

export type PropertyEntry = {
    key: string;
    type: PropertyDisplayType;
    value: PropertyValue;
};

const KNOWN_LIST_KEYS = new Set(["tags", "tag", "aliases", "cssclasses"]);
const KNOWN_BOOL_KEYS = new Set(["publish", "draft", "permalink", "toc", "manual", "slider"]);

const ISODateOnlyRe = /^\d{4}-\d{2}-\d{2}$/;
const ISODateTimeRe = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?$/;
const WikiLinkRe = /\[\[[^\]]+\]\]/;

function isTagString(s: string): boolean {
    return typeof s === "string" && s.length > 0 && s.startsWith("#") && s.indexOf(" ") < 0;
}

function isWikiLink(s: string): boolean {
    return typeof s === "string" && WikiLinkRe.test(s);
}

function isNullish(v: unknown): v is null | undefined {
    return v == null;
}

/**
 * 解析文件头部 YAML frontmatter。
 *
 * 规则（对齐 Obsidian）：frontmatter 必须位于文件开头——第一个非空行必须是 `---`；
 * 结束符为 `---` 或 `...`（YAML doc-end）。空/纯注释 frontmatter 返回 data = {}。
 *
 * 结束符探测使用「候选扫描 + YAML.parse 验证」：若 YAML 值中误含独立 `---` 行（多行字符串），
 * 提前截断解析会失败，自动尝试更靠后的候选，取第一个可解析的对象。
 * 行号基于原始文本（split 后索引 + 1），CRLF 兼容。
 */
export function parseFrontmatterBlock(content: string): FrontmatterBlock | null {
    if (content == null || content === "") {
        return null;
    }
    const lines = content.split(/\r?\n/);
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") {
            continue;
        }
        if (lines[i].trim() === "---") {
            startIdx = i;
        }
        break; // 第一个非空行不是 `---` → 无 frontmatter
    }
    if (startIdx < 0) {
        return null;
    }

    for (let candidate = startIdx + 1; candidate < lines.length; candidate++) {
        // 结束符必须顶格（column 1）：块标量内容里的缩进 `---`（multi-line 值）不算结束。
        const rawLine = lines[candidate];
        if (!/^---[ \t]*$/.test(rawLine) && !/^\.\.[.][ \t]*$/.test(rawLine)) {
            continue;
        }
        const yamlText = lines.slice(startIdx + 1, candidate).join("\n");
        // 空 / 纯空白 frontmatter → 空属性面板（数据 = {}）
        if (yamlText.trim() === "") {
            return {
                startLine: startIdx + 1,
                endLine: candidate + 1,
                yamlText,
                data: {},
            };
        }
        try {
            const parsed = YAML.parse(yamlText);
            if (parsed == null) {
                // 纯注释 / 空文档：合法但无对象 → 空属性面板（Obsidian 同行为）
                return {
                    startLine: startIdx + 1,
                    endLine: candidate + 1,
                    yamlText,
                    data: {},
                };
            }
            if (typeof parsed === "object" && !Array.isArray(parsed)) {
                return {
                    startLine: startIdx + 1,
                    endLine: candidate + 1,
                    yamlText,
                    data: parsed as Record<string, unknown>,
                };
            }
            // 标量/数组映射 → 非属性 frontmatter，尝试更靠后的结束符
        } catch {
            // 截断/非法 YAML → 尝试更靠后的结束符
        }
    }
    return null;
}

/**
 * Obsidian 风格属性类型推断：
 * 1. 键名 known table（tags/aliases/date/…）优先
 * 2. 否则按 YAML 值类型推断（boolean/number/tag/link/日期/数组/json）
 */
export function inferPropertyType(key: string, value: unknown): PropertyDisplayType {
    if (typeof value === "boolean") {
        return "boolean";
    }
    if (typeof value === "number") {
        return "number";
    }
    if (typeof value === "string") {
        if (value === "") {
            return "text";
        }
        const k = key.trim().toLowerCase();
        // Obsidian：tags/aliases 等列表键即使值是单个字符串也按标签列表展示
        if (KNOWN_LIST_KEYS.has(k)) {
            return "tags";
        }
        if (isTagString(value)) {
            return "tag";
        }
        if (isWikiLink(value)) {
            return "link";
        }
        if (ISODateOnlyRe.test(value)) {
            return "date";
        }
        if (ISODateTimeRe.test(value)) {
            return "datetime";
        }
        if (KNOWN_BOOL_KEYS.has(k)) {
            return "boolean";
        }
        return "text";
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "list";
        }
        if (value.every(isTagString)) {
            return "tags";
        }
        return "list";
    }
    if (typeof value === "object" && value !== null) {
        return "json";
    }
    return "text";
}

function normalizeListValue(v: unknown): string[] {
    if (!Array.isArray(v)) {
        return [String(v ?? "")];
    }
    return v.map((item) => String(item ?? ""));
}

/**
 * 解析纯 YAML 文本（frontmatter 去分隔符后的内容）为属性对象。
 * 失败 / 非对象（截断、标量、数组）一律返回 {}（卡片渲染为空面板）。
 */
export function parseFrontmatterYamlText(yamlText: string): Record<string, unknown> {
    try {
        const parsed = YAML.parse(yamlText);
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

/**
 * 把 frontmatter 数据规整为可渲染的属性条目。
 * - 数组：tag 元素保留 # 前缀（渲染为标签）；其余元素按字符串呈现（list）
 * - 对象：保留原始对象（json 渲染）
 */
export function buildPropertyEntries(data: Record<string, unknown>): PropertyEntry[] {
    const entries: PropertyEntry[] = [];
    for (const [key, raw] of Object.entries(data)) {
        if (raw == null) {
            continue; // 空值属性忽略（Obsidian 亦不显示）
        }
        const type = inferPropertyType(key, raw);
        if (type === "list" || type === "tags") {
            entries.push({ key, type, value: normalizeListValue(raw) });
            continue;
        }
        if (type === "json") {
            entries.push({ key, type, value: raw as Record<string, unknown> });
            continue;
        }
        entries.push({ key, type, value: raw as string | number | boolean });
    }
    return entries;
}