// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 笔记标题判定工具。
//
// 对齐 Obsidian 的习惯称谓规则：
//   - 正文第一个 H1（`# `）视作"笔记标题"；
//   - 正文没有 H1 时，回退用文件名（去掉扩展名）当标题。
// 供 .md 只读预览（md-properties / banner 等插件）复用，避免各自复制标题判定逻辑。

import { findFrontmatterSpan } from "@/app/element/markdown-transform/doc-meta";
import { basename } from "@/util/util";

/**
 * 提取正文里第一个 H1 标题的文本（不含 `# ` 前缀，已 trim）。
 *
 * 只匹配"行首井号 + 空白"（CommonMark 对 H1 的要求是 `# ` 后跟一个以上空格），
 * 因此 `#标题`（无空格）不算、`## 子标题`（H2）不算。
 * 解析前会跳过文档开头的 frontmatter fenced 块，避免把 YAML 注释行误当标题。
 */
export function extractFirstH1(text: string | null | undefined): string | null {
    if (!text) return null;
    const span = findFrontmatterSpan(text);
    let body = text;
    if (span != null) {
        const lines = text.split(/\r\n|\n/);
        let off = 0;
        for (let i = 0; i <= span.end && i < lines.length; i++) {
            off += lines[i].length;
            if (i < lines.length - 1) off += 1; // 后续行前的换行符
        }
        body = off <= text.length ? text.slice(off) : "";
    }
    const m = body.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : null;
}

/**
 * 计算笔记标题：优先正文第一个 H1；没有 H1 时回退为文件名（去掉扩展名）。
 * 两者都拿不到时返回 null，由调用方决定是否隐藏标题区。
 */
export function resolveNoteTitle(text: string | null | undefined, filePath: string | null | undefined): string | null {
    const fromH1 = extractFirstH1(text);
    if (fromH1 != null) return fromH1;
    if (filePath != null && filePath.trim() !== "") {
        const base = basename(filePath).replace(/\.mdx?$/i, "");
        if (base.trim() !== "") return base;
    }
    return null;
}
