// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * wiki 链接的**往返保真**测试。
 *
 * 核心不变量：**用户没碰过这个链接时，序列化结果必须与源码逐字节相同。**
 * 这不是洁癖 —— wiki 链接的 href 是 `wave-wiki:` 且被补过 `.md`，任何「按语义重建」
 * 都会把用户文件里的 `[[note]]` 写成 `[[note.md]]`。语义相同，但对用户是改写。
 *
 * 第二条不变量：**用户改了显示名时，改动不能被吞掉**。逐字输出原始源码是有代价的
 * （它会丢弃用户的编辑），所以必须先判「有没有被改过」。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

beforeEach(() => {
    document.body.innerHTML = "";
});

/** 模拟 remark + 渲染器对一段源码的输出（hProperties → data-source-markdown）。 */
function renderWiki(source: string, visibleText?: string): HTMLElement {
    const inner = source.slice(2, -2).trim();
    const [targetAndHeading, labelPart] = inner.split("|", 2);
    const [targetPart, headingPart] = targetAndHeading.split("#", 2);
    const target = (targetPart ?? "").trim();
    const label = labelPart == null || labelPart.trim() === "" ? target : labelPart.trim();
    const payload = headingPart != null && headingPart.trim() !== "" ? `${target}#${headingPart.trim()}` : target;
    const root = document.createElement("div");
    root.innerHTML =
        `<span>见 </span>` +
        `<a href="wave-wiki:${encodeURIComponent(payload)}" data-source-markdown='${source}'>${visibleText ?? label}</a>` +
        `<span> 后</span>`;
    return root;
}

function ser(root: HTMLElement): string {
    return serializeBlockDomToMarkdown(root, { kind: "p" as any });
}

describe("wiki 链接往返：未改动 → 必须逐字节保真", () => {
    const cases = [
        ["[[note]]", "无 label（最容易丢：解析时会补 .md）"],
        ["[[note|label]]", "有 label"],
        ["[[note#heading]]", "带锚点"],
        ["[[note#heading|label]]", "带锚点 + label"],
        ["[[04-官网级-智检实验室解决方案.md]]", "带中文与连字符的路径"],
        ["[[dir/note]]", "带子目录"],
    ] as const;

    for (const [source, why] of cases) {
        it(`${source} —— ${why}`, () => {
            expect(ser(renderWiki(source))).toBe(`见 ${source} 后`);
        });
    }

    it("百分号编码的目标也能逐字还原（href 里是编码后的，原文是原文）", () => {
        const src = "[[100%方案]]";
        expect(ser(renderWiki(src))).toBe(`见 ${src} 后`);
    });
});

describe("wiki 链接往返：用户改了显示名 → 改动不能被吞", () => {
    it("改 label → 只换 label，目标原样", () => {
        expect(ser(renderWiki("[[note|旧名]]", "新名"))).toBe("见 [[note|新名]] 后");
    });

    it("改 label 且原文无 label → 补出 label 形式（用户显式打了文字）", () => {
        expect(ser(renderWiki("[[note]]", "我的备注"))).toBe("见 [[note|我的备注]] 后");
    });

    it("清空显示名 → 退回无 label 形式（不留 `[[note|]]` 这种坏语法）", () => {
        expect(ser(renderWiki("[[note|旧名]]", ""))).toBe("见 [[note]] 后");
    });

    it("改 label 且带锚点 → 锚点必须保住", () => {
        expect(ser(renderWiki("[[note#sec|旧名]]", "新名"))).toBe("见 [[note#sec|新名]] 后");
    });
});

describe("wiki 链接往返：没有 data-source-markdown 的老 DOM → 退回复刻行为", () => {
    it("缺属性时仍输出 `[text](href)`（旧路径不变，不因为新逻辑崩掉）", () => {
        const root = document.createElement("div");
        root.innerHTML = `<a href="https://x.com">t</a>`;
        expect(ser(root)).toBe("[t](https://x.com)");
    });

    it("href 是 wave-wiki 但没带原始源码 → 退回复刻形式（宁可退化也不能崩）", () => {
        const root = document.createElement("div");
        root.innerHTML = `<a href="wave-wiki:note.md">label</a>`;
        expect(ser(root)).toBe("[label](wave-wiki:note.md)");
    });
});