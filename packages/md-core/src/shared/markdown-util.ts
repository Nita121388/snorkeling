// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 纯 markdown 语法 helper（md-core 物理抽包 10-12，原 `frontend/app/element/markdown-util.ts`）。
 *
 * 不变量：**零宿主依赖**（不得 import `@/...`）。图片 src 的解析需要 RPC，留在宿主侧的
 * `frontend/app/element/markdown-util.ts`，渲染层通过 `MdHostAdapter.resolveImageSrc` 间接使用。
 * 本文件只做文本层面的解析/改写：content-block 切分 + 图片语法（路径/尺寸/alt）编辑。
 */

import { makeImageFragmentRe, parseImageFragment, serializeImageFragment } from "../transform/image-size";

export type MarkdownContentBlockType = {
    type: string;
    id: string;
    content: string;
    opts?: Record<string, any>;
};

const idMatchRe = /^("(?:[^"\\]|\\.)*")/;

function formatInlineContentBlock(block: MarkdownContentBlockType): string {
    return `!!!${block.type}[${block.id}]!!!`;
}

function parseOptions(str: string): Record<string, any> {
    const trimmed = str.trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);
        // Ensure it's an object (not array or primitive)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function makeMarkdownWaveBlockKey(block: MarkdownContentBlockType): string {
    return `${block.type}[${block.id}]`;
}

export function transformBlocks(content: string): { content: string; blocks: Map<string, MarkdownContentBlockType> } {
    const lines = content.split("\n");
    const blocks = new Map();
    let currentBlock = null;
    let currentContent = [];
    let processedLines = [];

    for (const line of lines) {
        // Check for start marker
        if (line.startsWith("@@@start ")) {
            // Already in a block? Add as content
            if (currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the start line
            const [, type, rest] = line.slice(9).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                // Invalid format - treat as regular content
                processedLines.push(line);
                continue;
            }

            // Get the ID (everything between first set of quotes)
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                processedLines.push(line);
                continue;
            }

            // Parse options if any exist after the ID
            const afterId = rest.slice(idMatch[0].length).trim();
            const opts = parseOptions(afterId);

            currentBlock = {
                type,
                id: idMatch[1],
                opts,
            };
            continue;
        }

        // Check for end marker
        if (line.startsWith("@@@end ")) {
            // If we're not in a block, treat as content
            if (!currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the end line
            const [, type, rest] = line.slice(7).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                currentContent.push(line);
                continue;
            }

            // Get the ID
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                currentContent.push(line);
                continue;
            }

            const endId = idMatch[1];

            // If this doesn't match our current block, treat as content
            if (type !== currentBlock.type || endId !== currentBlock.id) {
                currentContent.push(line);
                continue;
            }

            // Found matching end - store block and add placeholder
            const key = makeMarkdownWaveBlockKey(currentBlock);
            blocks.set(key, {
                type: currentBlock.type,
                id: currentBlock.id,
                opts: currentBlock.opts,
                content: currentContent.join("\n"),
            });

            processedLines.push(formatInlineContentBlock(currentBlock));
            currentBlock = null;
            currentContent = [];
            continue;
        }

        // Regular line - add to current block or processed lines
        if (currentBlock) {
            currentContent.push(line);
        } else {
            processedLines.push(line);
        }
    }

    // Handle unclosed block - add what we have so far
    if (currentBlock) {
        const key = makeMarkdownWaveBlockKey(currentBlock);
        blocks.set(key, {
            type: currentBlock.type,
            id: currentBlock.id,
            opts: currentBlock.opts,
            content: currentContent.join("\n"),
        });
        processedLines.push(formatInlineContentBlock(currentBlock));
    }

    return {
        content: processedLines.join("\n"),
        blocks: blocks,
    };
}

// ---------------------------------------------------------------------------
// Image syntax editing helpers (used by the markdown preview image context menu
// for "edit path" / "delete image" / "resize" / "edit description").
//
// 语法契约（10-12 image-block 切片 1，见 `transform/image-size.ts`）：
//   - **写**：只用 Obsidian 约定 `![alt|WxH](path)`（尺寸只在 alt 里，目的地永远干净）；
//   - **读**：`![alt|WxH](path)` / `![alt](path =WxH)`（历史自研）/ `![alt](path)` 三种都认。
//   本文件里所有改写都走 `serializeImageFragment`（单一写出口），因此**不可能**再产出
//   历史上那个让图片消失的 `![alt](path =WxH)` 形态。
//
// They operate on one source line at a time: locate the `![alt](dest "title")` fragment
// whose (去尺寸后的) src matches, then rewrite or remove just that fragment.
//
// The rendering pipeline (rehype) gives each <img> a node.position with
// start.line + start.column (1-based) pointing at the start of the image syntax.
// We trust the src match over the exact column (a line can hold several images,
// and column is unreliable across soft-wrapped paragraphs), so these helpers scan
// the line for a fragment whose src equals the one the user clicked.
// ponytail: does NOT handle HTML `<img src=...>` tags or srcset. For those the menu
// falls back to whole-line editing (beginEdit) rather than a targeted rewrite.
// ---------------------------------------------------------------------------

/** 图片片段的定位结果（[start, end) 字符区间，覆盖整个 `![alt](dest "title")`）。 */
function locateImageSyntaxInLine(lineText: string, src: string): { start: number; end: number } | null {
    const re = makeImageFragmentRe();
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) != null) {
        const parsed = parseImageFragment(m[0]);
        // 比较**去尺寸后缀**的真实路径：尺寸无论写在 alt 还是旧式 src 后缀里都能匹配上。
        if (parsed != null && parsed.src === src) {
            return { start: m.index, end: m.index + m[0].length };
        }
    }
    return null;
}

/** 用规范形式改写命中的片段（保留 alt / 尺寸 / 标题），未命中 → null。 */
function rewriteImageFragmentInLine(
    lineText: string,
    src: string,
    rewrite: (parsed: ReturnType<typeof parseImageFragment>) => string | null
): string | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const parsed = parseImageFragment(lineText.slice(loc.start, loc.end));
    if (parsed == null) {
        return null;
    }
    const next = rewrite(parsed);
    if (next == null) {
        return null;
    }
    return lineText.slice(0, loc.start) + next + lineText.slice(loc.end);
}

// Replace the src of the matched image fragment in `lineText`, preserving alt + title + size.
// Returns null when the fragment isn't found.
export function replaceImageSrcInLine(lineText: string, src: string, newSrc: string): string | null {
    return rewriteImageFragmentInLine(lineText, src, (parsed) =>
        serializeImageFragment({ ...parsed, src: newSrc })
    );
}

// Remove the matched image fragment from `lineText`. Returns { text, isEmpty } where
// isEmpty is true when the line has nothing left but whitespace (caller may then drop
// the whole line).
export function removeImageSyntaxInLine(lineText: string, src: string): { text: string; isEmpty: boolean } | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const removed = lineText.slice(0, loc.start) + lineText.slice(loc.end);
    return { text: removed, isEmpty: removed.trim().length === 0 };
}

// Apply a per-line edit to `fullText` at the given 1-based line number, then join back
// with "\n". Returns the new full text, or null when the line is out of range or the
// edit callback bailed (fragment not found).
export function editImageSyntaxInFullText(
    fullText: string,
    line: number,
    edit: (lineText: string) => string | null
): string | null {
    const lines = fullText.split("\n");
    const idx = Math.trunc(line) - 1;
    if (idx < 0 || idx >= lines.length) {
        return null;
    }
    const result = edit(lines[idx]);
    if (result == null) {
        return null;
    }
    lines[idx] = result;
    return lines.join("\n");
}

/**
 * 写入图片尺寸（拖拽缩放 / 数值改尺寸的**唯一**写路径）。
 * 产出恒为 Obsidian 约定 `![alt|WxH](path "title")`；未命中片段 → null。
 *
 * 数据安全：尺寸只落在 alt 里，目的地保持干净 —— 因此 remark 一定能读回图片节点
 * （历史 `![alt](path =WxH)` 会让图片整个消失，见 image.render.test.tsx 的 REPRO）。
 */
export function updateImageSizeInLine(
    lineText: string,
    src: string,
    width: number,
    height: number
): string | null {
    return rewriteImageFragmentInLine(lineText, src, (parsed) =>
        serializeImageFragment({ ...parsed, width, height })
    );
}

/** 去掉尺寸（回到自然尺寸）。本身就是无尺寸 → null（调用方据此跳过提交）。 */
export function removeImageSizeInLine(lineText: string, src: string): string | null {
    return rewriteImageFragmentInLine(lineText, src, (parsed) =>
        parsed.width == null ? null : serializeImageFragment({ ...parsed, width: null, height: null })
    );
}

/** 改题注（alt），**保留尺寸**（改说明文字不该丢尺寸）。 */
export function updateImageAltInLine(lineText: string, src: string, newAlt: string): string | null {
    return rewriteImageFragmentInLine(lineText, src, (parsed) =>
        serializeImageFragment({ ...parsed, alt: newAlt })
    );
}
