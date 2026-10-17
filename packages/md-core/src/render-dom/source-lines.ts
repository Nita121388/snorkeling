// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 把**源码坐标**写进 hast：`dataSourceLine` / `dataSourceLineEnd`。
 *
 * ## 为什么框架无关路径必须自带这一步
 *
 * 在 React 侧，这两个属性是**渲染器在渲染时**从 rehype 节点的 `position` 元数据加上去的
 * （`srcLineAttrs(props)` 读 `props.node.position`）。也就是说：
 *
 * - 坐标**不是**管线产出的属性，而是 React 组件的副产物；
 * - `position` 是**元数据**，sanitize 不会碰它 —— 所以 React 侧绕过了白名单；
 * - 而一旦换成「mdast → hast → HTML」，`position` 元数据**在字符串化时就丢了**。
 *
 * 后果：非 React 消费者拿到的 DOM **没有写盘坐标** → `md-dom` 无法编辑
 * （锚点解析、陈旧检测、写盘全都要它）。这曾是最隐蔽的一处复用阻碍。
 *
 * 因此这里把坐标显式写成**属性**，并同步在 sanitize 白名单里放行 ——
 * 属性会被 sanitize 检查，这正是我们想要的（能从门禁里看见），而不是靠"元数据恰好没被剥"。
 *
 * ## 只标块级元素
 *
 * 行内元素也带 position，但加上去会让 `[data-source-line]` 查询命中行内节点，
 * 干扰锚点解析。所以只对**块级 tag** 打标，与 React 侧给哪些渲染器加 `srcLineAttrs` 对齐。
 */

/** 会被打上源码坐标的块级 tag（与 React 侧 `srcLineAttrs` 的使用点对齐）。 */
export const SOURCE_LINE_BLOCK_TAGS: ReadonlySet<string> = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "table",
    "hr",
    "calloutalert",
]);

/**
 * rehype 插件：从 `node.position` 写入源码坐标属性。
 *
 * 语义与 React 侧 `sourceLineAttrs` **逐条对齐**（避免两条路径坐标不同）：
 * - 起始行 1-based，非法/缺失则**不打标**（宁可没有，也不要错的坐标）；
 * - 结束行仅在 `!== 起始行` 时写入（单行块的属性保持最小集）。
 */
export function rehypeSourceLines() {
    return (tree: any) => {
        const visit = (node: any): void => {
            if (node?.type === "element" && SOURCE_LINE_BLOCK_TAGS.has(String(node.tagName).toLowerCase())) {
                const start = node?.position?.start?.line;
                const end = node?.position?.end?.line;
                if (Number.isInteger(start) && start > 0) {
                    node.properties = { ...(node.properties ?? {}), dataSourceLine: start };
                    if (Number.isInteger(end) && end !== start) {
                        node.properties.dataSourceLineEnd = end;
                    }
                }
            }
            for (const child of node?.children ?? []) {
                visit(child);
            }
        };
        visit(tree);
    };
}
