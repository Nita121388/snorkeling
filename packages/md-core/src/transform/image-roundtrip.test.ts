// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 图片的往返保真。
 *
 * 为什么这一类最要紧：**alt 文本是纯损失**。`![重要截图](a.png)` 一旦被写成
 * `![](a.png)`，那个说明就永久没了，而且没有任何提示。
 * 同理，尺寸后缀 `|300` 是用户的排版意图，丢了图片尺寸就变。
 *
 * 第三类是实测发生过的更糟情况：图片加载失败时渲染器输出英文占位文案，
 * 用户在这个段落里打一个字，文件里的图片语法**整个被文案替换掉**。
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

describe("图片往返：带原始源码 → 逐字节保真", () => {
    const cases = [
        ["![重要截图](a.png)", "alt 必须保住（纯损失）"],
        ["![](a.png)", "空 alt 不能凭空长出文字"],
        ["![alt](a.png|300)", "尺寸后缀住"],
        ["![中文说明](目录/图 片.png)", "中文目录 + 空格路径"],
        ["![a](图.png =300x200)", "历史尺寸语法"],
    ] as const;

    for (const [source, why] of cases) {
        it(`${source} —— ${why}`, () => {
            const el = root(
                `<p>前 <img src="file:///resolved.png" alt="x" data-source-markdown='${source}'> 后</p>`
            );
            expect(ser(el)).toBe(`前 ${source} 后`);
        });
    }

    it("一整段都是图片 → 逐字还原（不是只保一半）", () => {
        const src = "![截图](p.png|120)";
        expect(ser(root(`<p><img src="file:///r.png" alt="" data-source-markdown='${src}'></p>`))).toBe(src);
    });
});

describe("图片加载失败：占位文案不能吃掉语法（实测事故）", () => {
    it("`.markdown-img-error` 带源码 → 还原图片语法，而不是英文文案", () => {
        const el = root(
            '<p>看 <span class="markdown-img-error" data-source-markdown="![](a.png|100)">[Image unavailable: a.png|100]</span> 这里</p>'
        );
        expect(ser(el)).toBe("看 ![](a.png|100) 这里");
    });

    it("无 class 的裸占位 `<span>[img:…]</span>` 带源码 → 同样还原", () => {
        const el = root('<p><span data-source-markdown="![x](a.png)">[img:a.png]</span></p>');
        expect(ser(el)).toBe("![x](a.png)");
    });

    it("占位 span **没有**源码 → 退回文案（交给 gate 判为有损，不能猜）", () => {
        const el = root('<p>看 <span class="markdown-img-error">[Image unavailable: a.png]</span></p>');
        expect(ser(el)).toBe("看 [Image unavailable: a.png]");
    });
});

describe("图片往返：老 DOM / 无关 span 不受影响", () => {
    it("没有源码属性的 `<img>` → 退回复刻行为（不因为新逻辑崩掉）", () => {
        expect(ser(root('<p><img src="a.png" alt="t"></p>'))).toBe("![t](a.png)");
    });

    it("用户自己写的普通 `<span>` 不会被当成占位而误吞", () => {
        // 文本不像占位 → 正常按子节点序列化
        expect(ser(root("<p><span>普通文字</span></p>"))).toBe("普通文字");
    });

    it("**非叶子**的 span 即使带源码也不吞（只认图片占位这种叶子形态）", () => {
        const el = root('<p><span data-source-markdown="![x](a.png)">前<b>后</b></span></p>');
        expect(ser(el)).toBe("前**后**");
    });
});