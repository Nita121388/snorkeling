// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// callout（blockquote → 呼出块）渲染开关。
//
// 锁定的行为：预览里的 callout 带一个「加/换 emoji」按钮（可点）；
// 静态导出 / 打印场景传 `interactive: false` 时**不能**出现任何 <button> ——
// 导出的 HTML 里它只是个死按钮（历史 bug：导出文件里塞了不可点的按钮）。

import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkCalloutAlert, { type CalloutAlertOptions } from "./callout-alert";

async function render(source: string, options?: CalloutAlertOptions): Promise<string> {
    const out = await unified()
        .use(remarkParse)
        .use(remarkCalloutAlert, options)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(source);
    return String(out);
}

describe("remarkCalloutAlert", () => {
    it("renders a callout with the emoji affordance by default (preview)", async () => {
        const html = await render("> 引用");
        expect(html).toContain("markdown-alert markdown-alert-quote");
        expect(html).toContain("markdown-alert-emoji-btn");
        expect(html).toContain("引用");
    });

    it("drops the emoji button when interactive is false (static export)", async () => {
        const html = await render("> 引用", { interactive: false });
        expect(html).toContain("markdown-alert markdown-alert-quote");
        expect(html).toContain("引用");
        expect(html).not.toContain("markdown-alert-emoji-btn");
        expect(html).not.toContain("<button");
    });

    it("keeps explicit alert types and their marker text", async () => {
        const html = await render("> [!WARNING]\n> 小心");
        expect(html).toContain("markdown-alert-warning");
        expect(html).toContain("小心");
        expect(html).not.toContain("[!WARNING]");
    });
});
