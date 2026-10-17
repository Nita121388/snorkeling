// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 给脚注引用挂上**原始源码** `[^label]`。
 *
 * ## 为什么不能靠 DOM 反推
 *
 * remark-gfm 把脚注渲染成三种形状：
 *
 * | 位置                | hast 形态                                       | 能反推 label 吗 |
 * |---------------------|-------------------------------------------------|-----------------|
 * | 行内首次引用 `[^1]`  | `<sup dataSourceMarkdown><a href="#user-content-fn-1">1</a></sup>` | href 后缀可以，但显示的是**序号** |
 * | 行内重复引用 `[^1]`  | 同上（也**能**拿到标注 —— 实测真机两处都有）      | 同上             |
 * | **定义区的回链**      | `<sup><a>2</a></sup>`（**无标注**）             | **不能**         |
 *
 * 第三种是 `[^1]: 定义` 那个**脚注区**渲染出来的回链，不在可编辑段落的行内内容里；
 * 它没有原始源码，所以序列化器还原不出 `[^1]`，只能退回序号。
 * 而「猜错标签」比「不猜」糟得多（会把 `[^note]` 写成 `[^1]` 且完全不报错），
 * 所以 `md-dom/lossy.ts` 用「`sup` 没有 `data-source-markdown` 就算有损」兜住。
 *
 * （更正记录：初版注释写「remark-gfm 的重复引用拿不到 hProperties」——
 * 那是隔离管线下的误测，真机重复引用是**有**标注的；当时看到的无标注 sup
 * 其实是定义区的回链。断言前要拿真机 DOM，这已是本轮第二次因此出错。）
 */

import { SOURCE_MARKDOWN_HAST_ATTR } from "../shared/source-markdown-attr";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

const remarkFootnoteSource: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, "footnoteReference", (node: any) => {
            const identifier = node?.identifier;
            if (typeof identifier !== "string" || identifier === "") {
                return;
            }
            node.data = node.data ?? {};
            node.data.hProperties = {
                ...(node.data.hProperties ?? {}),
                [SOURCE_MARKDOWN_HAST_ATTR]: `[^${identifier}]`,
            };
        });
    };
};

export default remarkFootnoteSource;