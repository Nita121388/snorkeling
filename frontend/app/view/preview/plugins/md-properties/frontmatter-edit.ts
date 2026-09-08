// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// frontmatter 属性写回（最小 diff，行级）。
//
// 背景：旧实现用 YAML.stringify(整个 data) 重写 frontmatter，会丢注释、改写引号与
// flow/block 序列风格，并在 git diff 里产生无关噪声。本模块改为「只动目标属性那几行」：
//   - 未涉及的行：字节级原样保留
//   - 目标属性：保留缩进、行尾注释、序列风格（flow `[a, b]` / block `- a`）、引号风格
//
// 实现：YAML.parseDocument 拿到源位置（node.range）+ 节点元信息（flow/type/comment），
// 据此定位目标属性占用的行范围，只替换这几行；其余行切片拼接。
// 前提：yamlText 内部统一为 \n（parseFrontmatterBlock 已保证），EOL 风格由上层
// replaceFrontmatter 还原。
//
// 失败语义：YAML 有语法错误 / 顶层不是映射 / 找不到目标 key（除 set 追加）→ 返回 null，
// 上层回退或提示，绝不产出可疑文本。

import YAML from "yaml";
import type { PropertyValue } from "./frontmatter-block";

/** 写回可接受的值类型（与卡片条目同构）。 */
export type PropertyEditValue = PropertyValue;

const IndentUnit = "  ";

type QuoteStyle = "PLAIN" | "QUOTE_SINGLE" | "QUOTE_DOUBLE";

/** 写入值时尽量沿用的原风格。 */
type ValueHint = {
    /** 原值为 flow 序列（`[a, b]`）→ 新值也用 flow。 */
    flow?: boolean;
    /** 原值为字符串且带引号 → 新字符串沿用同种引号。 */
    quote?: QuoteStyle;
};

type PairLike = { key: unknown; value: unknown };

function parseTopMap(yamlText: string): YAML.Document.Parsed | null {
    const doc = YAML.parseDocument(yamlText);
    if (doc.errors != null && doc.errors.length > 0) {
        return null; // 语法错误（含重复 key）→ 不做猜测式改写
    }
    if (!YAML.isMap(doc.contents)) {
        return null;
    }
    return doc;
}

function pairKey(pair: PairLike): string | null {
    return YAML.isScalar(pair.key) ? String(pair.key.value) : null;
}

function findPair(doc: YAML.Document.Parsed, key: string): PairLike | null {
    const map = doc.contents;
    if (!YAML.isMap(map)) return null;
    for (const item of map.items) {
        if (YAML.isPair(item) && pairKey(item as PairLike) === key) {
            return item as unknown as PairLike;
        }
    }
    return null;
}

/** 节点源偏移：优先 value，回退 key。 */
function nodeRange(node: unknown): [number, number, number] | null {
    if (node != null && typeof node === "object" && "range" in node) {
        const r = (node as { range?: [number, number, number] }).range;
        if (Array.isArray(r) && r.length >= 2) return r;
    }
    return null;
}

/**
 * 值结束偏移（不含换行）。
 * 坑：yaml 的 range[1] 对 block 集合（`- a` 序列）会越过行尾、指向下一个节点的起点，
 * 直接取整行会把后面的属性一起吞掉。因此集合取「最后一个子项的结束」，标量取 range[1]。
 * 行尾注释与值同行，lineRange 取整行时会自然保留。
 */
function valueEndOffset(yamlText: string, value: unknown): number {
    const range = nodeRange(value);
    if (range == null) return -1;
    const items = (value as { items?: unknown[] }).items;
    if (Array.isArray(items) && items.length > 0) {
        const last = items[items.length - 1];
        const lastNode = YAML.isPair(last) ? ((last as { value?: unknown }).value ?? last) : last;
        const inner = valueEndOffset(yamlText, lastNode);
        if (inner > 0) return inner;
    }
    let end = range[1];
    if (end > range[0] && yamlText[end - 1] === "\n") end -= 1;
    return end;
}

/** 目标属性占用的行范围（不含换行符）：[lineStart, lineEnd)。 */
function lineRange(yamlText: string, pair: PairLike): { lineStart: number; lineEnd: number; indent: string } | null {
    const keyRange = nodeRange(pair.key);
    const valueRange = nodeRange(pair.value);
    if (keyRange == null || valueRange == null) return null;
    const startOffset = keyRange[0];
    const endOffset = valueEndOffset(yamlText, pair.value);
    if (endOffset < 0) return null;
    const lineStart = yamlText.lastIndexOf("\n", startOffset - 1) + 1;
    let lineEnd = yamlText.indexOf("\n", endOffset);
    if (lineEnd < 0) lineEnd = yamlText.length;
    // 缩进 = 行首到 key 之间
    const indent = yamlText.slice(lineStart, startOffset);
    if (indent.trim() !== "") return null; // 非空白前缀（异常结构）→ 不猜
    return { lineStart, lineEnd, indent };
}

/** 行尾注释原文（形如 "  # xxx"），没有则空串。 */
function tailComment(yamlText: string, pair: PairLike): string {
    const valueRange = nodeRange(pair.value);
    if (valueRange == null) return "";
    const endOffset = valueEndOffset(yamlText, pair.value);
    if (endOffset < 0) return "";
    let lineEnd = yamlText.indexOf("\n", endOffset);
    if (lineEnd < 0) lineEnd = yamlText.length;
    const raw = yamlText.slice(valueRange[1], lineEnd);
    return raw.includes("#") ? raw : "";
}

/** 渲染一行（多行值时不留尾随空格：`key:\n  - a`）。 */
function renderLine(indent: string, key: string, valueText: string): string {
    const keyText = /^[A-Za-z0-9_\-\u0080-\uFFFF][A-Za-z0-9_\-.\u0080-\uFFFF]*$/.test(key)
        ? key
        : YAML.stringify(key).replace(/\n$/, "");
    const sep = valueText.startsWith("\n") ? ":" : ": ";
    return `${indent}${keyText}${sep}${valueText}`;
}

function scalarText(value: string | number | boolean | Record<string, unknown>, quote: QuoteStyle | undefined): string {
    if (value != null && typeof value === "object") {
        // 列表里的对象元素：无法用标量表达，退化为紧凑 JSON
        return JSON.stringify(value);
    }
    if (typeof value === "string") {
        if (quote === "QUOTE_SINGLE" && !value.includes("'") && !value.includes("\n")) {
            return `'${value}'`;
        }
        if (quote === "QUOTE_DOUBLE" && !value.includes('"') && !value.includes("\n")) {
            return `"${value}"`;
        }
    }
    // 其余交给 yaml 包决定引号/转义（含含特殊字符的字符串）
    return YAML.stringify(value).replace(/\n$/, "");
}

/** 值 → 冒号右侧文本（不含 key 与缩进）。 */
function serializeValue(value: PropertyValue, indent: string, hint: ValueHint): string {
    if (Array.isArray(value)) {
        if (hint.flow) {
            return "[" + value.map((v) => scalarText(v, hint.quote)).join(", ") + "]";
        }
        if (value.length === 0) {
            return "[]"; // 空数组：block 形式无内容，用 flow 空序列表达
        }
        const itemIndent = indent + IndentUnit;
        return "\n" + value.map((v) => `${itemIndent}- ${scalarText(v, hint.quote)}`).join("\n");
    }
    const text = scalarText(value, hint.quote);
    // 多行值（含 \n）：续行按值缩进对齐
    return text.replace(/\n/g, "\n" + indent + IndentUnit);
}

function hintOf(pair: PairLike | null): ValueHint {
    if (pair == null) return {};
    const value = pair.value as { flow?: boolean; type?: string } | null;
    const hint: ValueHint = {};
    if (value != null && value.flow === true) hint.flow = true;
    if (typeof value?.type === "string" && (value.type === "QUOTE_SINGLE" || value.type === "QUOTE_DOUBLE")) {
        hint.quote = value.type;
    }
    return hint;
}

/**
 * 设置属性值（不存在则追加到末尾）。
 * 保留：其他行字节不变、缩进、行尾注释、flow/block 与引号风格。
 * 返回新 yamlText；无法安全改写返回 null。
 */
export function setProperty(yamlText: string, key: string, value: PropertyValue): string | null {
    const doc = parseTopMap(yamlText);
    if (doc == null) return null;
    const pair = findPair(doc, key);
    if (pair == null) {
        // 追加：沿用文档缩进风格（首属性缩进，否则顶格）
        const body = yamlText.endsWith("\n") || yamlText === "" ? yamlText : yamlText + "\n";
        return body + renderLine("", key, serializeValue(value, "", {}));
    }
    const range = lineRange(yamlText, pair);
    if (range == null) return null;
    const comment = tailComment(yamlText, pair);
    const newLine = renderLine(range.indent, key, serializeValue(value, range.indent, hintOf(pair))) + comment;
    return yamlText.slice(0, range.lineStart) + newLine + yamlText.slice(range.lineEnd);
}

/** 删除属性（整块移除，含其多行值）。空结果返回 ""。 */
export function deleteProperty(yamlText: string, key: string): string | null {
    const doc = parseTopMap(yamlText);
    if (doc == null) return null;
    const pair = findPair(doc, key);
    if (pair == null) return null;
    const range = lineRange(yamlText, pair);
    if (range == null) return null;
    // 连带删除行尾换行符（若有）
    let end = range.lineEnd;
    if (yamlText[end] === "\n") end += 1;
    const next = yamlText.slice(0, range.lineStart) + yamlText.slice(end);
    return next;
}

/** 重命名属性（保持位置与值不变）。 */
export function renameProperty(yamlText: string, fromKey: string, toKey: string): string | null {
    const doc = parseTopMap(yamlText);
    if (doc == null) return null;
    if (findPair(doc, toKey) != null) return null; // 目标名已存在 → 不做
    const pair = findPair(doc, fromKey);
    if (pair == null) return null;
    const keyRange = nodeRange(pair.key);
    const range = lineRange(yamlText, pair);
    if (keyRange == null || range == null) return null;
    const newKeyText = YAML.stringify(toKey).replace(/\n$/, "");
    return (
        yamlText.slice(0, keyRange[0]) +
        newKeyText +
        yamlText.slice(keyRange[1], range.lineEnd) +
        yamlText.slice(range.lineEnd)
    );
}

/**
 * 调整属性顺序：把 key 移到 beforeKey 之前；beforeKey 为 null → 移到末尾。
 * 保留被移动属性的完整文本块（含注释与多行值）。
 */
export function setPropertyBefore(yamlText: string, key: string, beforeKey: string | null): string | null {
    const doc = parseTopMap(yamlText);
    if (doc == null) return null;
    const pair = findPair(doc, key);
    if (pair == null) return null;
    const range = lineRange(yamlText, pair);
    if (range == null) return null;
    let end = range.lineEnd;
    if (yamlText[end] === "\n") end += 1;
    const block = yamlText.slice(range.lineStart, end);
    const without = yamlText.slice(0, range.lineStart) + yamlText.slice(end);
    if (beforeKey == null) {
        const base = without.endsWith("\n") || without === "" ? without : without + "\n";
        return base + yamlText.slice(range.lineStart, range.lineEnd);
    }
    const target = findPair(doc, beforeKey);
    if (target == null) return null;
    const targetRange = lineRange(yamlText, target);
    if (targetRange == null) return null;
    // 目标在移动块之后时，偏移要减去被删掉的字符数
    const removed = end - range.lineStart;
    const shift = targetRange.lineStart > range.lineStart ? removed : 0;
    const insertAt = targetRange.lineStart - shift;
    const blockText = yamlText.slice(range.lineStart, range.lineEnd);
    return without.slice(0, insertAt) + blockText + "\n" + without.slice(insertAt);
}
