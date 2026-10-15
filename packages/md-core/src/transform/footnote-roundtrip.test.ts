// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 脚注引用的往返保真。
 *
 * 与 wiki 链接同样的不变量：**没动过的脚注引用必须逐字节保真**。
 * 差别在于它只有一种情况能救 —— remark-gfm 的「重复引用」形态拿不到原始源码标注，
 * 而那个形态从 DOM 反推不出 label（实测 `<sup>2</sup>` 里没有 `<a>`）。
 * 所以这里除了「能还原」的用例，还要钉住**「还原不了时不猜」**。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

beforeEach(() => {
    document.body.innerHTML = "";
});

function root(html: string): HTMLElement {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
}

function ser(el: HTMLElement): string {
    return serializeBlockDomToMarkdown(el, { kind: "p" as any });
}

describe("脚注引用往返", () => {
    it("带原始源码 → 逐字节还原 `[^1]`", () => {
        expect(ser(root('<p>字<sup data-source-markdown="[^1]"><a href="#user-content-fn-1">1</a></sup>后</p>'))).toBe(
            "字[^1]后"
        );
    });

    it("命名脚注 → 还原的是 label（显示的是序号，但源码里写的是 label）", () => {
        expect(
            ser(root('<p>字<sup data-source-markdown="[^note]"><a href="#user-content-fn-note">1</a></sup>后</p>'))
        ).toBe("字[^note]后");
    });

    it("没有原始源码 → **不猜**：退回子节点内容（= 序号），由调用方判为有损", () => {
        // 猜错标签比不猜更糟：会把用户的 [^note] 写成 [^1]，且完全不报错。
        expect(ser(root('<p>字<sup><a href="#user-content-fn-note">1</a></sup>后</p>'))).toBe("字[1](#user-content-fn-note)后");
    });

    it("无标注的 sup（脚注定义区回链的真实形状）→ 退回序号，不编造 label", () => {
        expect(ser(root("<p>字<sup>2</sup>后</p>"))).toBe("字2后");
    });

    it("一个段落里多个脚注 + 其他行内标记 → 都保住", () => {
        expect(
            ser(
                root(
                    '<p>甲<sup data-source-markdown="[^a]"><a href="#user-content-fn-a">1</a></sup>乙<sup data-source-markdown="[^b]"><a href="#user-content-fn-b">2</a></sup><strong>丙</strong></p>'
                )
            )
        ).toBe("甲[^a]乙[^b]**丙**");
    });
});