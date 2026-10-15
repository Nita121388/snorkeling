// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 往返有损判定的测试面。
 *
 * 这一层的失败模式是**方向性的**：漏判一条 = 用户文件被静默改写（不可恢复）；
 * 误判一条 = 用户看到原始标记（可恢复，只是难看）。所以用例刻意偏向「宁可多拒绝」，
 * 每条的期望都写明它对应哪次实测。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { canEditInPlaceLosslessly, findLossyInlineConstructs } from "./lossy";

let root: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
});

function el(html: string): HTMLElement {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
}

describe("findLossyInlineConstructs：有损构造必须判出来", () => {
    it("脚注引用 <sup> → footnote-ref（实测：`[^1]` 往返成 `[1](#fn-1)`）", () => {
        expect(findLossyInlineConstructs(el('<p>文字<sup class="footnote-ref"><a href="#fn-1">1</a></sup>后续</p>'))).toEqual([
            "footnote-ref",
        ]);
    });

    it("wiki 链接 <a href=wave-wiki:> → wiki-link（实测：`[[n|label]]` 变成 `[label](wave-wiki:n)`）", () => {
        expect(findLossyInlineConstructs(el('<p>见 <a class="internal-link" href="wave-wiki:note">label</a></p>'))).toEqual([
            "wiki-link",
        ]);
    });

    it("图片 <img> → image（src 是解析后 URL；alt 与 `|300` 尺寸都还原不回去）", () => {
        expect(findLossyInlineConstructs(el('<p><img src="file:///resolved/a.png" alt=""></p>'))).toEqual(["image"]);
    });

    it("**根自己就是 <img>** 也要判出来（图片单独成块时根就是它）", () => {
        const img = document.createElement("img");
        img.setAttribute("src", "file:///resolved/a.png");
        expect(findLossyInlineConstructs(img)).toEqual(["image"]);
    });

    it("图片解析失败 → image（选择器支）", () => {
        expect(
            findLossyInlineConstructs(
                el('<p><span class="markdown-img-error" title="Unable to load image: a.png">[Image unavailable: a.png]</span></p>')
            )
        ).toContain("image-unresolved");
    });

    // 实测复现过的第二种数据损坏：图片文件不存在时，渲染成**无 class 的裸 span**
    // `<span>[img:missing.png|100]</span>`，按选择器完全抓不到，只能认文本。
    it("图片占位是无 class 的裸 span `<span>[img:…]</span>` → 按**文本**也要判出来", () => {
        expect(findLossyInlineConstructs(el('<p><span>[img:missing.png|100]</span> 正文</p>'))).toContain(
            "image-unresolved"
        );
    });

    it("实测原样（沙箱里真的把 `![](...)` 改写成了占位文本）", () => {
        // 原始源码：![](scratch-parity-all.png|100) 图片也要保持原样。
        // 提交后文件里出现了这个渲染产物：
        expect(
            findLossyInlineConstructs(
                el('<p><span class="markdown-img-error">[Image unavailable: scratch-parity-all.png%7C100]</span></p>')
            )
        ).toContain("image-unresolved");
    });

    it("多种构造同时存在 → 全部列出并去重（调用方要能知道是哪些）", () => {
        const got = findLossyInlineConstructs(
            el('<p><img src="x.png"><sup><a href="#fn-1">1</a></sup> <a href="wave-wiki:a">a</a> <a href="wave-wiki:b">b</a></p>')
        );
        expect(got.sort()).toEqual(["footnote-ref", "image", "wiki-link"]);
    });
});

describe("无损内容必须放行（误判会让用户平白失去原位编辑）", () => {
    it("普通段落（含看起来像标记的普通文本）", () => {
        expect(findLossyInlineConstructs(el("<p>hello</p>"))).toEqual([]);
        // `[img:` 之外的方括号文本不受影响
        expect(findLossyInlineConstructs(el("<p>数组 a[0] 与 [link] 都不算</p>"))).toEqual([]);
    });

    it("行内强调四件套（序列化器有分支，逐字还原）", () => {
        expect(findLossyInlineConstructs(el("<p><strong>a</strong><em>b</em><del>c</del><code>d</code></p>"))).toEqual([]);
    });

    it("普通外链 `[t](https://x)` → 无损，必须放行（实测往返一致）", () => {
        expect(findLossyInlineConstructs(el('<p><a href="https://x.com">t</a></p>'))).toEqual([]);
    });

    it("相对路径普通链接也必须放行（只有 wave-wiki: 才是有损的）", () => {
        expect(findLossyInlineConstructs(el('<p><a href="./other.md">other</a></p>'))).toEqual([]);
    });

    it("任务列表的 <input type=checkbox> 不是有损构造（勾选状态有专门的还原通道）", () => {
        expect(findLossyInlineConstructs(el('<ul><li><input type="checkbox" checked>task</li></ul>'))).toEqual([]);
    });

    it("软换行 <br> 不是有损构造（有 brToken 通道）", () => {
        expect(findLossyInlineConstructs(el("<p>a<br>b</p>"))).toEqual([]);
    });

    it("空根 / null → 放行（没有内容可丢；调用方另有空种子防线）", () => {
        expect(findLossyInlineConstructs(el(""))).toEqual([]);
        expect(findLossyInlineConstructs(null)).toEqual([]);
        expect(findLossyInlineConstructs(undefined)).toEqual([]);
    });
});

describe("canEditInPlaceLosslessly：调用方用的布尔门", () => {
    it("有损 → false；无损 → true", () => {
        expect(canEditInPlaceLosslessly(el('<p><a href="wave-wiki:a">a</a></p>'))).toBe(false);
        expect(canEditInPlaceLosslessly(el("<p>plain</p>"))).toBe(true);
    });
});
