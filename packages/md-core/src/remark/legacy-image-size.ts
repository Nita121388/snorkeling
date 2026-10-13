// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 历史自研图片尺寸语法（`![alt](path =WxH)`）的**读兼容**插件（10-12 image-block · 切片 1）。
 *
 * ## 为什么必须在 remark 层修
 * `![alt](path =300x200)` 在 CommonMark 里**不是图片**：未加尖括号的链接目的地不得含空白字符，
 * 所以 remark-parse 产出的是 text 节点（字面 `![alt](path =300x200)`），渲染层拿不到 `<img>`。
 * 组件层再怎么写都救不回来 —— 事故的源头在解析树里。本插件把这类 text 节点就地还原成 image 节点，
 * 于是**已经写盘的历史文件（用户调过尺寸的笔记）仍然看得见图**，而不是变成一行乱码文本。
 *
 * ## 判定范围（刻意收窄）
 * 只还原目的地里带 `=…` 尾缀的形态（即历史写路径唯一产出过的形态）：
 *   - `path =300x200`（合法尺寸）→ `![alt|300x200](path)`（尺寸保留）；
 *   - `path =abc` / `path =0x0`（坏语法）→ `![alt](path)`（**丢尺寸、保图**）。
 * 「含空白但没有 `=`」的 `![a](p q.png)` **不还原**：那在 CommonMark 里本来就是字面文本，
 * 擅自还原会把用户刻意写的文本变成图片。新写路径产出的一律是尖括号目的地 `![a](<p q.png>)`，
 * remark 自己就能读成图片，不需要本插件。
 *
 * 必须是 remark 管线里的**第一个**插件：后续插件（file-ref linkify / soft-breaks）会把 text 节点
 * 拆开，届时 `![…](… =WxH)` 再也不是一个完整的 text 节点了。
 */

import type { Image, PhrasingContent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { makeImageFragmentRe, parseImageFragment } from "../transform/image-size";

type Point = { line: number; column: number; offset?: number };

/** text 节点内第 `index` 个字符的坐标（只依赖父节点起点 + 前缀里的换行数）。 */
function pointAt(value: string, start: Point, index: number): Point {
    const before = value.slice(0, index);
    const newlines = before.split("\n").length - 1;
    const column = newlines === 0 ? (start.column ?? 1) + index : before.length - before.lastIndexOf("\n");
    const point: Point = { line: (start.line ?? 1) + newlines, column };
    if (start.offset != null) {
        point.offset = start.offset + index;
    }
    return point;
}

function spanAt(value: string, start: Point, index: number, length: number): Image["position"] {
    return { start: pointAt(value, start, index), end: pointAt(value, start, index + length) } as Image["position"];
}

/**
 * 把一个 text 字符串（历史形态）还原成 image 节点参数；不是历史形态 → null（不消费）。
 * 尺寸合法 → 保留尺寸（写回 alt 的 `|WxH`）；尺寸坏 → 只保留干净路径（宁丢尺寸，绝不丢图）。
 * 路径与尺寸的提取全部走 `parseImageFragment`（单一解析真源，含坏尾缀净化）。
 */
export function repairLegacyImageFragment(fragment: string): { url: string; alt: string; title: string | null } | null {
    const parsed = parseImageFragment(fragment);
    // 只处理历史写路径的形状（`=尾缀`，含坏尾缀）；普通目的地里没有 `=` 的不动。
    if (parsed == null || parsed.src === "" || parsed.sizeSyntax !== "legacy-src") {
        return null;
    }
    const size = parsed.width == null ? "" : `|${parsed.width}${parsed.height == null ? "" : `x${parsed.height}`}`;
    return { url: parsed.src, alt: `${parsed.alt}${size}`, title: parsed.title };
}

export default function remarkLegacyImageSize() {
    return (tree: Root) => {
        visit(tree, "text", (node: Text, index, parent) => {
            if (parent == null || index == null) {
                return;
            }
            const value = node.value;
            const start: Point = (node.position?.start as Point) ?? { line: 1, column: 1 };
            const re = makeImageFragmentRe();
            const replacement: PhrasingContent[] = [];
            let cursor = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(value)) != null) {
                const repaired = repairLegacyImageFragment(m[0]);
                if (repaired == null) {
                    continue;
                }
                if (m.index > cursor) {
                    const text = value.slice(cursor, m.index);
                    replacement.push({
                        type: "text",
                        value: text,
                        position: spanAt(value, start, cursor, text.length),
                    } as Text);
                }
                const image: Image = {
                    type: "image",
                    url: repaired.url,
                    alt: repaired.alt,
                    title: repaired.title,
                };
                image.position = spanAt(value, start, m.index, m[0].length);
                replacement.push(image);
                cursor = m.index + m[0].length;
            }
            if (replacement.length === 0) {
                return;
            }
            if (cursor < value.length) {
                const text = value.slice(cursor);
                replacement.push({
                    type: "text",
                    value: text,
                    position: spanAt(value, start, cursor, text.length),
                } as Text);
            }
            parent.children.splice(index, 1, ...replacement);
            return [SKIP, index + replacement.length];
        });
    };
}
