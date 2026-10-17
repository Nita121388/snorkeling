// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 「渲染有损构造的原始源码」属性的**唯一定义处**。
 *
 * ## 为什么需要这个文件（而不是各处写字符串）
 *
 * 同一个属性在三个世界里名字不同，**写错一处就是静默失效**（本会话真的踩到）：
 *
 * | 世界 | 形态 | 例 |
 * |---|---|---|
 * | hast / mdast `hProperties` / React props | **camelCase** | `dataSourceMarkdown` |
 * | 真实 DOM（浏览器规范化后） | kebab | `data-source-markdown` |
 * | sanitize schema 条目 | **camelCase** | `"dataSourceMarkdown"` |
 *
 * 实测教训：wiki 链接插件写了 **kebab** → `rehype-sanitize` 按 camelCase 匹配不上 →
 * 属性被**静默剥掉** → 真机 DOM 上没有它 → 编辑会被降级为"有损"。
 * 而脚注插件恰好写了 camelCase 所以活着 —— 同一个功能两个插件行为不同，极难归因。
 *
 * 所以：**写入方一律用 `SOURCE_MARKDOWN_HAST_ATTR`，读取方一律用 `readSourceMarkdown`**。
 */

/** hast / props / schema 里的形态（写入方与白名单都必须用这个）。 */
export const SOURCE_MARKDOWN_HAST_ATTR = "dataSourceMarkdown";

/** 真实 DOM 上的形态（浏览器把 camelCase 的 data 属性规范化为 kebab）。 */
export const SOURCE_MARKDOWN_DOM_ATTR = "data-source-markdown";

/**
 * 从 React props 或 hast properties 里读出原始源码，**两种形态都认**。
 *
 * 宽容读取是有意的：写入方可能来自第三方渲染器（它未必知道我们的命名约定），
 * 而读错的代价是"用户源码被改写"这种不可恢复的事故。多试一个 key 几乎零成本。
 */
export function readSourceMarkdown(props: any): string | undefined {
    const direct =
        props?.[SOURCE_MARKDOWN_HAST_ATTR] ??
        props?.[SOURCE_MARKDOWN_DOM_ATTR] ??
        props?.node?.properties?.[SOURCE_MARKDOWN_HAST_ATTR] ??
        props?.node?.properties?.[SOURCE_MARKDOWN_DOM_ATTR];
    return typeof direct === "string" ? direct : undefined;
}
