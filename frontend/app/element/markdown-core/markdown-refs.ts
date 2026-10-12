// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Markdown 引用语法（wiki link / `path/file.md:12`）的**纯解析函数**（md-core 抽离 P0 · C2）。
 *
 * 这些函数先前住在 `@/app/view/preview/file-link-navigation`（宿主导航模块），
 * 于是 `remark/markdown-file-refs.ts` 为了三个纯字符串解析函数不得不静态 import 整个宿主模块
 * （连带 store / layout / util）。下沉到本模块后：
 *   - md-core 侧只依赖本文件（零宿主依赖）；
 *   - 宿主侧 `file-link-navigation` 反过来 import 本文件并 re-export（对外 API 不变）。
 *
 * 本文件为**纯函数模块**：禁止 import React / DOM / store / view / util 等宿主依赖。
 */

const MarkdownFileLineReferenceRe = /^((?:[A-Za-z]:[\\/]|\/|~\/).+\.(?:md|markdown|mdx)):(\d+)$/i;
const MarkdownWikiLinkPrefix = "wave-wiki:";

/** `decodeURIComponent` 的安全包装：非法百分号序列（如 `100%`）原样返回而不抛。 */
export function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function parseMarkdownFileLineReference(value: string): { filePath: string; lineNumber: number } | null {
    if (typeof value !== "string") {
        return null;
    }
    const match = safeDecodeURIComponent(value.trim()).match(MarkdownFileLineReferenceRe);
    if (match == null) {
        return null;
    }
    const lineNumber = Number(match[2]);
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) {
        return null;
    }
    return {
        filePath: match[1].replace(/\\/g, "/"),
        lineNumber,
    };
}

export type MarkdownWikiLink = {
    target: string;
    label: string;
    heading?: string;
};

export function parseMarkdownWikiLink(value: string): MarkdownWikiLink | null {
    if (typeof value !== "string") {
        return null;
    }
    let raw = value.trim();
    if (raw.startsWith(MarkdownWikiLinkPrefix)) {
        raw = safeDecodeURIComponent(raw.slice(MarkdownWikiLinkPrefix.length));
    } else if (raw.startsWith("[[") && raw.endsWith("]]")) {
        raw = raw.slice(2, -2);
    } else {
        return null;
    }
    const [targetAndHeading, labelPart] = raw.split("|", 2);
    const [targetPart, headingPart] = targetAndHeading.split("#", 2);
    const target = targetPart?.trim() ?? "";
    if (target === "") {
        return null;
    }
    return {
        target: /\.(?:md|markdown|mdx)$/i.test(target) ? target : `${target}.md`,
        label: labelPart?.trim() || target,
        heading: headingPart?.trim() || undefined,
    };
}

export function makeMarkdownWikiLinkHref(target: string, heading?: string): string {
    const payload = heading == null || heading === "" ? target : `${target}#${heading}`;
    return `${MarkdownWikiLinkPrefix}${encodeURIComponent(payload)}`;
}
