// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// step3 S1：块身份（data-block-id）。
//
// 关键判断：**id 是「身份」，不是「坐标」**。本仓库的源码是 markdown 文件，行号依旧是唯一的
// 写盘坐标（data-source-line 必须保留）。id 的用途只有三个：
//   1) 陈旧检测：提交前确认「我要写的这段源码」仍是我打开编辑器时读到的那个块；
//   2) 重定位：别的提交让行号整体位移后，仍能靠 id 找回同一个块、取到当前行号；
//   3) 记账：为阶段 4 的块级结构操作准备精确逆操作数据。
//
// 之所以不能用随机/持久 id：源文件是用户资产，绝不能把 id 写进 .md（对比思源把 id 写进
// .sy）。所以 id 必须由**块内容**确定性派生——同一份文档解析两次得到完全相同的 id。

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * 参与块身份的 mdast 节点类型（白名单，而不是「除 inline 之外」）。
 *
 * 与渲染出的「可编辑块元素」对齐：paragraph（含 blank-spacer 占位段、callout 的
 * calloutalert/title 段）、heading、blockquote、list、table、code、thematicBreak(hr)。
 * 用白名单是为了绝不给 inline 节点（text/strong/em/link/…）打 id。
 *
 * 注意 remarkCalloutAlert 会把 blockquote **替换成** hName=calloutalert 的 paragraph，
 * 所以 callout 天然落在 paragraph 这一档；remarkBlankLineSpacers 的 spacer 也是 paragraph。
 */
export const BlockIdNodeTypes: ReadonlySet<string> = new Set([
    "paragraph",
    "heading",
    "blockquote",
    "list",
    "table",
    "code",
    "thematicBreak",
]);

/**
 * 32-bit FNV-1a：内容 → 8 位十六进制摘要。
 *
 * 为什么不用 crypto：需要的是「同内容同摘要、异内容大概率异摘要」的短指纹，不是密码学强度；
 * 且 FNV-1a 是纯同步纯函数，可在 remark 插件里零依赖调用，测试里也能直测。
 */
export function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        // Math.imul 保证 32 位整数乘法（普通 `*` 会溢出成浮点、丢低位）。
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 递归收集 mdast 节点的文本。手写而不是引 mdast-util-to-string：后者要为一个短摘要再加
 * 一个依赖，且它对 table/code 的行为（丢 code 的 value、丢表格结构）并不完全符合我们的
 * 「块内容指纹」语义。
 *
 * 用 "\n" 连接子节点，让「同样几段文字、不同结构」也得到不同摘要（比如一个段落的
 * "a\nb" 与一个两行文本的列表项）。文本节点取 value；code/inlineCode/html/yaml
 * 这类叶子节点也带 value，同样被收进来。
 */
export function collectBlockText(node: any): string {
    if (node == null) {
        return "";
    }
    if (typeof node.value === "string") {
        return node.value;
    }
    if (Array.isArray(node.children)) {
        return node.children.map(collectBlockText).join("\n");
    }
    return "";
}

/**
 * id 派生：`blk-<内容摘要>-<同摘要块在文档中的出现序号>`。
 *
 * - 只依赖**内容**与**文档内顺序** → 同一文档两次解析结果完全相同（纯函数、与渲染顺序无关）；
 * - 内容相同的重复块（两个都写着 `- item` 的列表）靠序号区分 → 全文档唯一，
 *   `querySelector('[data-block-id="…"]')` 永远只命中自己那一块；
 * - 不写进源文件 → 用户资产零污染。
 */
export function deriveBlockId(contentDigest: string, occurrence: number): string {
    return `blk-${contentDigest}-${occurrence}`;
}

/** 某个块节点的确定性身份（供测试与调试复用，等价于插件内的计算）。 */
export function blockIdForNode(node: any, occurrence: number): string {
    return deriveBlockId(fnv1a(collectBlockText(node)), occurrence);
}

/**
 * 给每个块级节点打 `data.hProperties.dataBlockId`。
 *
 * `data.hProperties` 可能已被别的插件占用（callout 设了 hName/hProperties、blank-spacer 设了
 * className/data-spacer-lines、loose-list-spacing 设了 dataLoose）→ 必须**合并而不是覆盖**，
 * 否则会把别人的属性抹掉。
 *
 * 管线位置：必须插在 **loose-list-spacing / blank-line-spacers 之后**（这些插件会插入/替换
 * 节点），否则 id 会打在一个随后被替换掉的节点上。见 remark/index.ts。
 */
export const remarkBlockIds: Plugin<[], Root> = () => (tree) => {
    // 摘要 → 已出现次数。作用域是整次解析（含嵌套块），保证全文档 id 唯一。
    const seen = new Map<string, number>();
    visit(tree, (node: any) => {
        if (node == null || !BlockIdNodeTypes.has(node.type)) {
            return;
        }
        const digest = fnv1a(collectBlockText(node));
        const occurrence = seen.get(digest) ?? 0;
        seen.set(digest, occurrence + 1);
        node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, dataBlockId: deriveBlockId(digest, occurrence) },
        };
    });
};

export default remarkBlockIds;
