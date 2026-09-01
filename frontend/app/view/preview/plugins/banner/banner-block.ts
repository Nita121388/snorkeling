// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian Banner 插件属性解析。
// 从 frontmatter 中提取 banner、banner_y、banner_lock 属性。

export type BannerBlock = {
    /** 图片路径或 wikilink [[path]] */
    banner: string;
    /** 垂直位置 0-1 (0 = 顶部, 1 = 底部) */
    bannerY: number;
    /** 是否锁定（滚动时固定） */
    bannerLock: boolean;
};

/**
 * 从 frontmatter 数据中解析 banner 相关属性。
 *
 * 支持的属性格式：
 * - banner: "[[path/to/image.png]]" 或 "path/to/image.png"
 * - banner_y: 0.5 (0-1 之间的数字)
 * - banner_lock: true/false
 *
 * @returns BannerBlock 对象，如果没有 banner 属性则返回 null
 */
export function parseBannerFromFrontmatter(data: Record<string, unknown>): BannerBlock | null {
    const banner = data.banner;
    if (typeof banner !== "string" || banner.trim() === "") {
        return null;
    }

    // 解析 wikilink [[path]] 或直接路径
    const path = banner.trim().replace(/^\[\[|\]\]$/g, "");

    return {
        banner: path,
        bannerY: typeof data.banner_y === "number" ? Math.max(0, Math.min(1, data.banner_y)) : 0.5,
        bannerLock: typeof data.banner_lock === "boolean" ? data.banner_lock : false,
    };
}

/**
 * 检查 frontmatter 数据是否包含 banner 属性。
 */
export function hasBannerProperty(data: Record<string, unknown>): boolean {
    return "banner" in data && typeof data.banner === "string" && (data.banner as string).trim() !== "";
}
