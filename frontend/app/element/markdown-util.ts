// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import parseSrcSet from "parse-srcset";

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

// Resolved image URL cache. The URL for a given (conn, baseDir, filepath) is deterministic
// (/wave/stream-file?path=... always serves the file's current content), so a memoized promise
// is safe and kills the flicker that came from re-resolving on every Markdown remount (inline
// edit commit, LivePreview buffer switch): the resolving frame that rendered `null` (image
// unmounts) is gone once the key is warm.
// ponytail: cache lives for the lifetime of the module. The stream-file endpoint streams fresh
// content per request, so staleness is never an issue. Failed resolves are NOT cached — a
// transient error would otherwise poison the key forever. If we ever need eviction (huge dirs),
// upgrade to a bounded LRU keyed the same way.
const remoteFileResolveCache = new Map<string, Promise<string | null>>();

export const resolveRemoteFile = async (filepath: string, resolveOpts: MarkdownResolveOpts): Promise<string | null> => {
    if (!filepath || filepath.startsWith("http://") || filepath.startsWith("https://")) {
        return filepath;
    }
    const cacheKey = `${resolveOpts.connName ?? ""}|${resolveOpts.baseDir ?? ""}|${filepath}`;
    const cached = remoteFileResolveCache.get(cacheKey);
    if (cached != null) {
        return cached;
    }
    const promise = (async (): Promise<string | null> => {
        try {
            const baseDirUri = formatRemoteUri(resolveOpts.baseDir, resolveOpts.connName);
            const fileInfo = await RpcApi.FileJoinCommand(TabRpcClient, [baseDirUri, filepath]);
            const remoteUri = formatRemoteUri(fileInfo.path, resolveOpts.connName);
            const usp = new URLSearchParams();
            usp.set("path", remoteUri);
            return getWebServerEndpoint() + "/wave/stream-file?" + usp.toString();
        } catch (err) {
            console.warn("Failed to resolve remote file:", filepath, err);
            return null;
        }
    })();
    remoteFileResolveCache.set(cacheKey, promise);
    promise.then(
        (url) => {
            if (url == null) {
                remoteFileResolveCache.delete(cacheKey);
            }
        },
        () => {
            remoteFileResolveCache.delete(cacheKey);
        }
    );
    return promise;
};

export const resolveSrcSet = async (srcSet: string, resolveOpts: MarkdownResolveOpts): Promise<string> => {
    if (!srcSet) return null;

    // Parse the srcset
    const candidates = parseSrcSet(srcSet);

    // Resolve each URL in the array of candidates
    const resolvedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
            const resolvedUrl = await resolveRemoteFile(candidate.url, resolveOpts);
            return {
                ...candidate,
                url: resolvedUrl,
            };
        })
    );

    // Reconstruct the srcset string
    return resolvedCandidates
        .map((candidate) => {
            let part = candidate.url;
            if (candidate.w) part += ` ${candidate.w}w`;
            if (candidate.h) part += ` ${candidate.h}h`;
            if (candidate.d) part += ` ${candidate.d}x`;
            return part;
        })
        .join(", ");
};

// ---------------------------------------------------------------------------
// Image syntax editing helpers (used by the markdown preview image context menu
// for "edit path" / "delete image"). They operate on one source line at a time:
// locate the `![alt](src "title")` fragment whose src matches, then rewrite or
// remove just that fragment.
//
// The rendering pipeline (rehype) gives each <img> a node.position with
// start.line + start.column (1-based) pointing at the start of the image syntax.
// We trust the src match over the exact column (a line can hold several images,
// and column is unreliable across soft-wrapped paragraphs), so these helpers scan
// the line for a fragment whose src equals the one the user clicked.
// ponytail: handles `![alt](src)` and `![alt](src "title")`; does NOT handle
// escaped brackets inside alt or src, HTML `<img src=...>` tags, or srcset. For
// those the menu falls back to whole-line editing (beginEdit) rather than a
// targeted rewrite. Upgrade path: a real markdown parser on the source line.
// ---------------------------------------------------------------------------

// Splits the inside of `(...)` into (src, title|null). `src "title"` / `src 'title'`
// are the two common shapes; anything else is treated as pure src.
function splitImageSrcAndTitle(inner: string): { src: string; title: string | null } {
    // [\s\S] replaces the `s` flag (dotAll) which needs target es2018+; a source line
    // never contains a newline anyway.
    const m = inner.match(/^(.*?)\s+["']([\s\S]*)["']$/);
    if (m != null) {
        return { src: m[1], title: m[2] };
    }
    return { src: inner, title: null };
}

// Returns the range of the first image fragment in `lineText` whose src equals `src`,
// or null. Range is [start, end) as char offsets within the line, covering the whole
// `![alt](src "title")` fragment.
function locateImageSyntaxInLine(lineText: string, src: string): { start: number; end: number } | null {
    const re = /!\[[^\]]*\]\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) != null) {
        const { src: curSrc } = splitImageSrcAndTitle(m[1]);
        // Also match the stripped src so sized images (=WxH) are found by raw URL.
        const curStripped = curSrc.replace(/\s+=\d+(?:x\d+)?\s*$/, "");
        if (curSrc === src || curStripped === src) {
            return { start: m.index, end: m.index + m[0].length };
        }
    }
    return null;
}

// Replace the src of the matched image fragment in `lineText`, preserving alt + title.
// Returns null when the fragment isn't found.
export function replaceImageSrcInLine(lineText: string, src: string, newSrc: string): string | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const frag = lineText.slice(loc.start, loc.end);
    const parenStart = frag.indexOf("(");
    const { src: curSrc } = splitImageSrcAndTitle(frag.slice(parenStart + 1, -1));
    const curStripped = curSrc.replace(/\s+=\d+(?:x\d+)?\s*$/, "");
    if (curSrc !== src && curStripped !== src) {
        return null;
    }
    const srcStart = loc.start + parenStart + 1;
    const srcEnd = srcStart + curSrc.length;
    return lineText.slice(0, srcStart) + newSrc + lineText.slice(srcEnd);
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

// Parse an optional size suffix (=WxH) from an image src string.
// Returns { src, width, height } where src is the real URL without the size suffix.
// Example: "path.png =300x200" → { src: "path.png", width: 300, height: 200 }
export function parseImageSizeSuffix(rawSrc: string): {
    src: string;
    width: number | null;
    height: number | null;
} {
    if (rawSrc == null) {
        return { src: rawSrc ?? "", width: null, height: null };
    }
    const m = rawSrc.match(/^(.+?)\s+=(\d+)(?:x(\d+))?\s*$/);
    if (m == null) {
        return { src: rawSrc, width: null, height: null };
    }
    const src = m[1];
    const width = parseInt(m[2], 10);
    const height = m[3] != null ? parseInt(m[3], 10) : null;
    return { src, width, height };
}

// Replace the size suffix in a markdown image fragment's src, preserving alt + title.
// If the image has no existing size suffix, it is appended.
// Example:
//   updateImageSizeInLine("![alt](path.png)", "path.png", 300, 200)
//   → "![alt](path.png =300x200)"
export function updateImageSizeInLine(
    lineText: string,
    src: string,
    width: number,
    height: number
): string | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const frag = lineText.slice(loc.start, loc.end);
    const parenStart = frag.indexOf("(");
    const inner = frag.slice(parenStart + 1, -1);
    const { src: curSrc, title } = splitImageSrcAndTitle(inner);
    if (curSrc !== src && curSrc.replace(/\s+=\d+(?:x\d+)?\s*$/, "") !== src) {
        return null;
    }
    // Build new inner: src =WxH "title"
    const realSrc = curSrc.replace(/\s+=\d+(?:x\d+)?\s*$/, "");
    let newInner = `${realSrc} =${width}x${height}`;
    if (title != null) {
        newInner += ` "${title}"`;
    }
    const newFrag = frag.slice(0, parenStart + 1) + newInner + ")";
    return lineText.slice(0, loc.start) + newFrag + lineText.slice(loc.end);
}

// Remove the size suffix from a markdown image fragment's src.
export function removeImageSizeInLine(lineText: string, src: string): string | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const frag = lineText.slice(loc.start, loc.end);
    const parenStart = frag.indexOf("(");
    const inner = frag.slice(parenStart + 1, -1);
    const { src: curSrc, title } = splitImageSrcAndTitle(inner);
    const realSrc = curSrc.replace(/\s+=\d+(?:x\d+)?\s*$/, "");
    if (realSrc === curSrc) {
        return null; // no size suffix to remove
    }
    let newInner = realSrc;
    if (title != null) {
        newInner += ` "${title}"`;
    }
    const newFrag = frag.slice(0, parenStart + 1) + newInner + ")";
    return lineText.slice(0, loc.start) + newFrag + lineText.slice(loc.end);
}

// Replace the alt text of the matched image fragment in `lineText`, preserving src + title.
// Returns null when the fragment isn't found.
export function updateImageAltInLine(lineText: string, src: string, newAlt: string): string | null {
    const loc = locateImageSyntaxInLine(lineText, src);
    if (loc == null) {
        return null;
    }
    const frag = lineText.slice(loc.start, loc.end);
    // frag = "![old alt](src ...)" — alt is between ![ and ]
    const bracketEnd = frag.indexOf("]");
    if (bracketEnd < 0) {
        return null;
    }
    // Rebuild: "![newAlt](rest..."
    const newFrag = "![" + newAlt + "]" + frag.slice(bracketEnd + 1);
    return lineText.slice(0, loc.start) + newFrag + lineText.slice(loc.end);
}
