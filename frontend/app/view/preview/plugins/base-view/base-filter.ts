// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// .base filters 子集求值（纯函数）。
// Phase 1 支持：and/or/not 结构 + 字符串谓词（file.ext / file.name / file.inFolder / != ==）。
// 谓词语法对齐 Obsidian Bases：如 `file.ext == "md"`、`!file.inFolder("_archive")`。
// 设计原则：只依赖纯文本路径/文件名，不依赖 Obsidian。

import YAML from "yaml";
import type { BaseFilter } from "./base-config";

export type NoteMeta = {
    filePath: string;
    fileName: string;
    ext: string;
    frontmatter: Record<string, unknown>;
};

// 从 .md 内容提取 YAML frontmatter（--- 分隔的头部块）。无 frontmatter 返回空对象。
export function parseFrontmatter(content: string): Record<string, unknown> {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) {
        return {};
    }
    try {
        const parsed = YAML.parse(match[1]);
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

// 归一化路径用于 folder 匹配：统一 / 分隔、去尾部斜杠。
function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

// 谓词求值：`file.ext == "md"` / `file.name != "CLAUDE"` / `file.inFolder("方案")`。
function evalPredicate(expr: string, meta: NoteMeta): boolean {
    const trimmed = expr.trim();

    // 取反前缀：`!file.inFolder("_archive")`
    if (trimmed.startsWith("!")) {
        return !evalPredicate(trimmed.slice(1), meta);
    }

    // 函数式：file.inFolder("path")
    const inFolderMatch = /^file\.inFolder\(\s*"([^"]*)"\s*\)$/.exec(trimmed);
    if (inFolderMatch) {
        const target = normPath(inFolderMatch[1]);
        const path = normPath(meta.filePath);
        // 文件路径中包含 "/target/" 段（或位于 target 目录内）即视为在文件夹中（含子目录）。
        return path === target || path.startsWith(target + "/") || path.includes("/" + target + "/");
    }

    // 函数式：file.path.contains("...")
    // 函数式：file.path.contains("...")
    const pathContains = /^file\.path\.contains\(\s*"([^"]*)"\s*\)$/.exec(trimmed);
    if (pathContains) {
        const path = normPath(meta.filePath);
        return path.includes(normPath(pathContains[1]));
    }

    // 函数式：file.hasProperty("...")
    const hasProp = /^file\.hasProperty\(\s*"([^"]*)"\s*\)$/.exec(trimmed);
    if (hasProp) {
        return hasOwn(meta.frontmatter, hasProp[1]);
    }

    // 比较式：<lhs> <op> "rhs"
    const cmpMatch = /^(\S+)\s*(==|!=)\s*"([^"]*)"$/.exec(trimmed);
    if (cmpMatch) {
        const [, lhs, op, rhs] = cmpMatch;
        let actual: string;
        switch (lhs) {
            case "file.name":
                actual = meta.fileName;
                break;
            case "file.ext":
                actual = meta.ext;
                break;
            case "file.path":
                actual = meta.filePath;
                break;
            default: {
                // 属性谓词（note.* 或裸属性名）：从 frontmatter 取，非字符串按 toString。
                const propVal = meta.frontmatter[lhs.startsWith("note.") ? lhs.slice(5) : lhs];
                actual = propVal == null ? "" : String(propVal);
                break;
            }
        }
        return op === "==" ? actual === rhs : actual !== rhs;
    }

    // 不支持的谓词：保守返回 false（不误纳行），Phase 1 明确不支持公式/正则等。
    return false;
}

// 与 hasOwnProperty 等价但更安全（frontmatter 是普通对象）。
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

export function evalFilter(filter: BaseFilter | undefined, meta: NoteMeta): boolean {
    if (filter == null) {
        return true;
    }
    switch (filter.kind) {
        case "predicate":
            return evalPredicate(filter.expr, meta);
        case "and":
            return filter.items.every((item) => evalFilter(item, meta));
        case "or":
            return filter.items.some((item) => evalFilter(item, meta));
        case "not":
            return filter.items.every((item) => !evalFilter(item, meta));
    }
}

// 从 filters 收集 inFolder 引用的文件夹（相对 vault 根），用于限定扫描范围。
// ponytail: Phase 1 仅收集 inFolder 谓词；无 inFolder 时调用方退化为扫 vault 根。
// 上限：避免遍历爆炸，超出返回 null 表示不限定。
export function collectScanFolders(filter: BaseFilter | undefined, acc: Set<string> = new Set()): Set<string> {
    if (filter == null) {
        return acc;
    }
    switch (filter.kind) {
        case "predicate": {
            const trimmed = filter.expr.trim();
            const negated = trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
            const inFolderMatch = /^file\.inFolder\(\s*"([^"]*)"\s*\)$/.exec(negated);
            if (inFolderMatch) {
                acc.add(inFolderMatch[1]);
            }
            return acc;
        }
        case "and":
        case "or":
        case "not":
            for (const item of filter.items) {
                collectScanFolders(item, acc);
            }
            return acc;
    }
}
