// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 图片尺寸语法（10-12 image-block · 切片 1）。
 *
 * ## 语法决策（对齐 08 方案 §2.2 / design.md C1）
 * - **写**：只用 Obsidian 约定 `![alt|WxH](path)` —— 生态可读、git diff 干净；
 * - **读**：三种都认 —— `![alt|WxH](path)`（首选）、`![alt](path =WxH)`（历史自研，只读兼容）、
 *   纯 `![alt](path)`；
 * - **不再写** `=WxH`。
 *
 * ## 为什么必须改（数据级事故，不是美化）
 * 历史写路径产出 `![alt](path =WxH)`。CommonMark 的**未加尖括号**的链接目的地不得含空白字符，
 * 于是 `remark-parse` 根本不把它当图片节点（产出 text 节点）→ 渲染层拿不到 `<img>`，
 * 用户拖过尺寸的图片在重开笔记后**直接消失**（变成一行字面文本）。先红用例见
 * `render/image.render.test.tsx` 的 REPRO describe。
 *
 * ## 数据安全三条（design.md）
 * 1. 序列化产出**必须能被本模块自己重新解析**：`parseImageFragment(serializeImageFragment(p))` 与
 *    `p` 在 (alt, src, title, width, height) 上回同（`image-size.test.ts` 逐形态断言）；
 * 2. **降级铁律**：尺寸解析失败 → 回落纯 `![alt](path)`（宁可丢尺寸，绝不丢图）；
 * 3. 目的地含空白/括号不平衡时用 `<...>` 包裹（唯一能让 remark 读回图片的形式）。
 *
 * ## 边界
 * 纯函数：零 DOM、零宿主、零 React（包内禁 `@/`，见 `frontend/app/element/markdown-core-boundary.test.ts`）。
 */

/** 尺寸写法来源（往返/诊断用）。 */
export type ImageSizeSyntax = "alt" | "legacy-src" | null;

export type ParsedImageSize = {
    /** 真实路径（去尺寸后缀）。 */
    src: string;
    /** 真实 alt（去尺寸后缀）。 */
    alt: string;
    width: number | null;
    height: number | null;
    /** 尺寸来自哪种写法：alt（Obsidian，首选）/ legacy-src（历史自研 `=WxH`）/ null（无尺寸）。 */
    sizeSyntax: ImageSizeSyntax;
};

export type ParsedImageFragment = {
    /** 原始 alt（可能含 `|WxH`）。 */
    rawAlt: string;
    /** 真实 alt（去尺寸、去转义）。 */
    alt: string;
    /** 原始目的地（可能含 `=WxH` 后缀，已去 `<...>`）。 */
    rawSrc: string;
    /** 真实路径（去尺寸后缀、去转义）——可交给宿主 resolveImageSrc。 */
    src: string;
    title: string | null;
    width: number | null;
    height: number | null;
    sizeSyntax: ImageSizeSyntax;
};

export type ImageFragmentParts = {
    alt?: string | null;
    src: string;
    title?: string | null;
    width?: number | null;
    height?: number | null;
};

/** Obsidian 约定：`alt|WxH` / `alt|W`（取最后一个 `|`，alt 自身可含 `|`）。 */
const altSizeRe = /^(.*)\|(\d+)(?:x(\d+))?$/;
/** 历史自研：`src =WxH` / `src =W`（`=` 前必须有空白，避免误吃路径里的 `=`）。 */
const legacySizeRe = /\s+=\s*(\d+)(?:x(\d+))?\s*$/;
/** 目的地 + 可选标题（`dest "title"` / `dest 'title'`）。 */
const titleRe = /^(.*?)\s+(?:"([\s\S]*)"|'([\s\S]*)')\s*$/;
/**
 * 历史写路径的**坏**尺寸尾缀形状（`path =abc` / `path =0x0`）。
 * 专属于「普通目的地」（`![]()`，不含尖括号）：我们的老写路径只可能产出这一种形状，
 * 而尖括号目的地是我们/作者**显式**写出的合法形式，里面的 `=…` 是路径的一部分，不得动。
 */
const plainLegacyTailRe = /^([\s\S]*?)\s+=(\S*)\s*$/;

/**
 * 扫描一行里所有图片片段。两个分支：
 * - `<dest>`：尖括号目的地（含空白/括号不平衡时我们写出的唯一形式）；
 * - `dest`：普通目的地（不含 `)`，与既有定位器同宽）。
 * alt 允许 `\]` / `\\` 转义。
 *
 * 工厂函数（而不是共享常量）：带 `g` 的正则带 `lastIndex` 状态，跨调用共享会漏匹配。
 */
export function makeImageFragmentRe(): RegExp {
    return /!\[((?:\\.|[^\]\\])*)\]\((?:<([^>]*)>|([^)]*))\)/g;
}

/** 单片段版本的同一语法（`parseImageFragment` 用）。 */
function makeAnchoredFragmentRe(): RegExp {
    return /^!\[((?:\\.|[^\]\\])*)\]\((?:<([^>]*)>|([^)]*))\)$/;
}

function toSize(raw: string | null | undefined): number | null {
    if (raw == null) {
        return null;
    }
    const n = Number.parseInt(raw, 10);
    // 尺寸必须是有意义的正整数：0/NaN 视为无效（回落到「无尺寸」，绝不写成 width:0）。
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** 规范化宽度/高度（供序列化使用）。 */
function normalizeImageSize(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value)) {
        return null;
    }
    const n = Math.round(value);
    return n > 0 ? n : null;
}

/** `\` 转义的 ASCII 标点还原（CommonMark 的 backslash escapes），是本模块转义的逆运算。 */
function unescapePunctuation(value: string): string {
    return value.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** 转义 alt 里会破坏语法的字符（`]` 会提前闭合 alt；`\` 自身必须双写才可逆）。 */
function escapeAlt(alt: string): string {
    return alt.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

/** 目的地里的括号是否平衡（不平衡时必须用 `<...>` 包裹，否则 remark 读不到图片）。 */
function parensBalanced(value: string): boolean {
    let depth = 0;
    for (const ch of value) {
        if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            depth--;
            if (depth < 0) {
                return false;
            }
        }
    }
    return depth === 0;
}

/**
 * 目的地转义（写路径的**数据安全**关键）：
 * 含空白 / 括号不平衡 → `<...>` 包裹（尖括号目的地允许空白、不允许 `<>`）；
 * 包裹后若仍含 `<`/`>`（Windows 非法字符，Unix 下极罕见）→ 百分号编码，宁可变形也绝不丢图。
 */
function escapeDestination(src: string): string {
    const clean = src.replace(/[\r\n]/g, "");
    if (/[ \t]/.test(clean) || !parensBalanced(clean)) {
        return `<${clean.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
    }
    return clean;
}

function formatTitle(title: string | null | undefined): string {
    if (title == null || title === "") {
        return "";
    }
    if (!title.includes('"')) {
        return ` "${title}"`;
    }
    if (!title.includes("'")) {
        return ` '${title}'`;
    }
    // 同时含两种引号 → 无法在不改变内容的前提下表达为标题（markdown 无转义形式）→ 丢标题。
    return "";
}

/**
 * 尺寸 → Obsidian 约定后缀。
 * 只有高度（无宽度）无法用 Obsidian 约定表达 → 返回 null（降级为无尺寸）。
 */
export function formatImageSize(width: number | null | undefined, height: number | null | undefined): string | null {
    const w = normalizeImageSize(width);
    if (w == null) {
        return null;
    }
    const h = normalizeImageSize(height);
    return h == null ? `${w}` : `${w}x${h}`;
}

/**
 * 解析尺寸。`rawSrc` 是**目的地**（可含历史 `=WxH` 后缀，不应含 `<...>`），
 * `rawAlt` 是 markdown alt（可含 `|WxH`）。
 *
 * 优先级：alt（Obsidian，首选）> src 后缀（历史自研）。
 * 匹配到尺寸形状但数值无效（如 `=0x0`）时**吃掉后缀但不带尺寸** —— 即「降级为纯 `![](path)`」。
 */
export function parseImageSize(rawSrc: string | null | undefined, rawAlt?: string | null): ParsedImageSize {
    const src = rawSrc ?? "";
    const alt = rawAlt ?? "";

    const altMatch = alt.match(altSizeRe);
    if (altMatch != null) {
        const width = toSize(altMatch[2]);
        const height = altMatch[3] != null ? toSize(altMatch[3]) : null;
        return {
            src: src.trim(),
            alt: altMatch[1],
            width,
            height: width == null ? null : height,
            sizeSyntax: "alt",
        };
    }

    const legacyMatch = src.match(legacySizeRe);
    if (legacyMatch != null) {
        const width = toSize(legacyMatch[1]);
        const height = legacyMatch[2] != null ? toSize(legacyMatch[2]) : null;
        return {
            src: src.slice(0, legacyMatch.index).trim(),
            alt,
            width,
            height: width == null ? null : height,
            sizeSyntax: "legacy-src",
        };
    }

    return { src: src.trim(), alt, width: null, height: null, sizeSyntax: null };
}

function splitDestinationAndTitle(inner: string): { dest: string; title: string | null } {
    const m = inner.match(titleRe);
    if (m == null) {
        return { dest: inner, title: null };
    }
    const title = m[2] != null ? m[2] : m[3];
    return { dest: m[1], title: title ?? null };
}

/**
 * 解析**单个** markdown 图片片段（`![alt](dest "title")`，含两种尺寸写法）。
 * 不是图片片段（或 alt 未闭合）→ null。
 */
export function parseImageFragment(fragment: string): ParsedImageFragment | null {
    if (typeof fragment !== "string" || !fragment.startsWith("![")) {
        return null;
    }
    const m = fragment.match(makeAnchoredFragmentRe());
    if (m == null) {
        return null;
    }
    const rawAlt = unescapePunctuation(m[1]);
    // 尖括号目的地不含标题（`<...>` 内部只有目的地）。
    const isAngle = m[2] != null;
    const { dest, title } = isAngle
        ? { dest: m[2], title: null }
        : splitDestinationAndTitle(m[3] ?? "");
    const size = parseImageSize(dest, rawAlt);
    let src = size.src;
    let sizeSyntax = size.sizeSyntax;
    if (sizeSyntax == null && !isAngle) {
        // 历史写路径的坏尾缀（`path =abc`）：吃掉尾缀、保住路径 —— 「宁可丢尺寸，宁可不丢图」。
        // 吃掉后 sizeSyntax 记为 legacy-src（=「这个片段消费过一个尺寸槽」），
        // 读兼容插件据此把它还原成图片节点，而不是让它继续当可见的乱码文本。
        const tail = dest.match(plainLegacyTailRe);
        if (tail != null && tail[1].trim() !== "") {
            src = tail[1].trim();
            sizeSyntax = "legacy-src";
        }
    }
    return {
        rawAlt,
        alt: size.alt,
        rawSrc: size.src,
        src: unescapePunctuation(src),
        title: title == null ? null : unescapePunctuation(title),
        width: size.width,
        height: size.height,
        sizeSyntax,
    };
}

/**
 * 序列化图片片段。**唯一**的写路径形式：`![alt|WxH](dest "title")`。
 * 不变量：产出必须能被 `parseImageFragment` 读回同一组 (alt, src, title, width, height)，
 * 且必须能被 remark 解析成 `image` 节点（尺寸只落在 alt 里，绝不出现在目的地）。
 */
export function serializeImageFragment(parts: ImageFragmentParts): string {
    const size = formatImageSize(parts.width, parts.height);
    const baseAlt = parts.alt ?? "";
    const alt = escapeAlt(size == null ? baseAlt : `${baseAlt}|${size}`);
    const dest = escapeDestination(parts.src ?? "");
    return `![${alt}](${dest}${formatTitle(parts.title)})`;
}
