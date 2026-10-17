// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 给图片挂上**原始源码**。
 *
 * ## 为什么必须带原文
 *
 * 渲染器把 `src` 换成了**解析后**的 URL（`resolveImageSrc`：相对路径 → 可加载 URL），
 * 尺寸与 alt 分散在别的属性上。序列化器若按 DOM 重建，会同时丢三样东西：
 *
 * - alt 文本（`![重要截图](a.png)` → `![](a.png)` —— 纯损失，不可恢复）
 * - 尺寸后缀（`|300`）
 * - 图片解析失败时，**整个图片语法被英文占位文案吃掉**
 *   （`<span class="markdown-img-error">[Image unavailable: …]</span>`）
 *
 * 最后一条已实测发生：在一个引用了不存在图片的段落里打一个字，
 * 文件里的 `![](a.png|100)` 就变成了 `[Image unavailable: a.png%7C100]`。
 *
 * ## 取值方式：**按位置切原文**，不重建
 *
 * `![${alt}](${url})` 重建出来的东西不一定等于原文（`![](<a b>)`、带 title、
 * 反斜杠转义、空 alt 等形态都会走样）。而 mdast 的 `image` 节点带 `position`，
 * 直接按 offset 从源文件切那一段 —— **逐字节精确，零重建**。
 *
 * ## `![[...]]` 不在这里
 * Obsidian embed 语法 `![[a.png|300]]` 在 remark 眼里是**普通 text 节点**（不是 image），
 * 原样渲染成文字、往返无损，所以不需要也不应该在这里管它。
 */

import { SOURCE_MARKDOWN_HAST_ATTR } from "../shared/source-markdown-attr";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

const remarkImageSource: Plugin<[], Root> = function () {
    return (tree: Root, file: any) => {
        // 拿不到源文本就放弃标注：宁可让调用方判定为有损，也不能给一个可能错的原文。
        const source: string | null = typeof file?.value === "string" ? file.value : null;
        if (source == null) {
            return;
        }
        visit(tree, "image", (node: any) => {
            const start = node?.position?.start?.offset;
            const end = node?.position?.end?.offset;
            if (typeof start !== "number" || typeof end !== "number" || end <= start || end > source.length) {
                return;
            }
            const raw = source.slice(start, end);
            // 防御：切出来的必须是图片语法。位置信息来自同一个解析器，正常不会错；
            // 但这里多花一行去确认 —— 一旦切错，序列化器会把**错的东西**写进用户文件。
            if (!/^!\[[^\]]*\]\(/.test(raw)) {
                return;
            }
            node.data = node.data ?? {};
            node.data.hProperties = {
                ...(node.data.hProperties ?? {}),
                [SOURCE_MARKDOWN_HAST_ATTR]: raw,
            };
        });
    };
};

export default remarkImageSource;