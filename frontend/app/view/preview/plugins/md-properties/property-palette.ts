// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 属性标签配色：12 色系（对齐 Wolai 的 calendar-graph 调色板）。
//
// 关键取舍：**不存储颜色**。frontmatter 是纯文本，没有地方挂"这个标签是什么颜色"，
// 因此用 hash(标签文本) → 色系，保证同一个词在任何文件、任何会话里都是同一个颜色。
// 明暗两套前景色由 CSS 变量切换（见 property-tag-editor.scss），这里只给基色与两个前景色。

export type TagColor = {
    /** 色系基色（用于 20%~30% 透明背景）。 */
    base: string;
    /** 亮色主题下的文字色（Wolai 的 L5，深色）。 */
    fgLight: string;
    /** 暗色主题下的文字色（Wolai 的 L2，浅色）。 */
    fgDark: string;
};

// 顺序即色系索引：default / gray / darkGray / brown / orange / yellow /
// green / blue / indigo / purple / pink / red
export const tagPalette: TagColor[] = [
    { base: "#cf5659", fgLight: "#63102f", fgDark: "#f0a89c" },
    { base: "#8c8c8c", fgLight: "#1a1a1a", fgDark: "#dcdcdc" },
    { base: "#5c5c5c", fgLight: "#111111", fgDark: "#cecece" },
    { base: "#a3431f", fgLight: "#4e0506", fgDark: "#e3a274" },
    { base: "#f06b05", fgLight: "#731900", fgDark: "#fab767" },
    { base: "#dfab01", fgLight: "#6b4700", fgDark: "#f5da62" },
    { base: "#038766", fgLight: "#003840", fgDark: "#5adba2" },
    { base: "#0575c5", fgLight: "#00225e", fgDark: "#62c3ed" },
    { base: "#4a52c7", fgLight: "#0e115f", fgDark: "#949bee" },
    { base: "#8831cc", fgLight: "#270961", fgDark: "#cb82ef" },
    { base: "#c815b6", fgLight: "#470460", fgDark: "#ee6eca" },
    { base: "#e91e2c", fgLight: "#6f0533", fgDark: "#f88476" },
];

/** FNV-1a 32 位哈希（稳定、无依赖、跨会话一致）。 */
export function hashString(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** 标签文本 → 色系索引（0..11）。 */
export function tagColorIndexFor(value: string): number {
    return hashString(value) % tagPalette.length;
}

/** 标签文本 → 配色。 */
export function tagColorFor(value: string): TagColor {
    return tagPalette[tagColorIndexFor(value)];
}

/** 写进 style 的 CSS 变量，供 scss 按主题取用。 */
export function tagColorVars(value: string): React.CSSProperties {
    const c = tagColorFor(value);
    return {
        "--ptag-base": c.base,
        "--ptag-fg-light": c.fgLight,
        "--ptag-fg-dark": c.fgDark,
    } as React.CSSProperties;
}
