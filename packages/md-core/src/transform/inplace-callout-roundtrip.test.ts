// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * A3 在位编辑：callout 的 DOM → markdown 往返**必须是无损恒等**。
 *
 * 实测事故（沙箱 scratch-parity-all.md 被改写）：在位编辑 callout 后失焦提交，
 * 源文件里被插入了一行多余的裸 `>`：
 *
 *   输入：> [!NOTE] 这是一个 callout
 *         > 标题行与正文
 *   输出：> [!NOTE] 这是一个 callout
 *         >                      ← 凭空多出来的空引用行
 *         > 标题行与正文
 *
 * 这是**数据安全**问题（写盘内容被改），不是视觉问题，所以必须锁在往返层。
 *
 * 下面的 fixture 是**从真实渲染 DOM 逐字抄下来的**（沙箱
 * `[data-source-line="14"]` 的 innerHTML，只去掉 emoji 按钮——那是种子采集器会剔的），
 * 不是手搓的近似 HTML：注意 `<br>` 后面跟着一个**字面换行**，这正是触发点。
 */

import { describe, expect, it } from "vitest";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

/** 真实渲染器产出的 callout 内部结构（emoji 按钮已按 captureInplaceSeedHtml 剔除）。 */
const REAL_CALLOUT_INNER =
    '<div class="markdown-alert-title" data-block-id="blk-1899c9d8-1">' +
    '<span class="markdown-alert-title-text" data-block-id="blk-fb7acc10-0">这是一个 callout<br>\n标题行与正文</span>' +
    "</div>";

function calloutRoot(inner: string): HTMLElement {
    const el = document.createElement("calloutalert");
    el.className = "markdown-alert markdown-alert-note";
    el.innerHTML = inner;
    return el;
}

describe("A3 callout 往返：不得凭空插入空引用行", () => {
    it("真实渲染 DOM（两行：标题 + 正文）往返恒等，且无空引用行", () => {
        const root = calloutRoot(REAL_CALLOUT_INNER);
        const out = serializeBlockDomToMarkdown(root, { kind: "quote" } as any);
        expect(out.split("\n").filter((l) => l.trim() === ">")).toHaveLength(0);
        expect(out).toBe("> 这是一个 callout\n> 标题行与正文");
    });

    it("单行 callout 往返恒等", () => {
        const root = calloutRoot(
            '<div class="markdown-alert-title"><span class="markdown-alert-title-text">只有一行</span></div>'
        );
        expect(serializeBlockDomToMarkdown(root, { kind: "quote" } as any)).toBe("> 只有一行");
    });

    it("普通引用块（blockquote，无 title 容器）往返恒等", () => {
        const el = document.createElement("blockquote");
        el.innerHTML = "引用块内容";
        expect(serializeBlockDomToMarkdown(el, { kind: "quote" } as any)).toBe("> 引用块内容");
    });

    it("两个段落级子元素的引用块：保留空 `>` 分隔（既有正确行为，别回归）", () => {
        const el = document.createElement("blockquote");
        el.innerHTML = "<p>第一段</p><p>第二段</p>";
        expect(serializeBlockDomToMarkdown(el, { kind: "quote" } as any)).toBe("> 第一段\n>\n> 第二段");
    });

    it("往返幂等：同一 DOM 序列化两次结果相同", () => {
        const root = calloutRoot(REAL_CALLOUT_INNER);
        const a = serializeBlockDomToMarkdown(root, { kind: "quote" } as any);
        const b = serializeBlockDomToMarkdown(root, { kind: "quote" } as any);
        expect(a).toBe(b);
    });
});
