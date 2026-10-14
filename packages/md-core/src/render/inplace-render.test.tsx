// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// A3 在位编辑（wysiwyg-inplace）：渲染器对命中活跃会话的块改渲染为 EditableBlock，
// 且 EditableBlock 根 tag+className 必须与预览渲染器输出逐字一致（同一套样式）。
// 本测试验证 md-core 渲染分支：
//   1) inplaceSession 为 null（flag 关 / 无会话）→ p/h/quote/callout 走正常预览渲染；
//   2) inplaceSession 命中该块 → 渲染宿主 EditableBlock（经 host adapter 注入）；
//   3) 未命中会话的块不受影响。

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setMdHost } from "../core/host";
import {
    buildMarkdownComponents,
    getMarkdownRenderer,
    resetMarkdownRenderersForTests,
    type MarkdownRenderContext,
} from "./renderer-registry";

const fakeNode = (line: number, endLine = line) => ({
    type: "element",
    tagName: "p",
    position: { start: { line, column: 1 }, end: { line: endLine, column: 5 } },
});

function makeCtx(extra: Partial<MarkdownRenderContext> = {}): MarkdownRenderContext {
    return {
        text: "",
        focusHeading: () => {},
        collapsedHeadings: new Set(),
        toggleHeadingCollapse: () => {},
        collapsedTables: new Set(),
        toggleTableCollapse: () => {},
        collapsibleOrderedLists: false,
        collapsedOrderedListItems: new Set(),
        toggleOrderedListItemCollapse: () => {},
        handleTaskCheckboxToggle: () => {},
        contentBlocksMap: new Map(),
        waveBlockRenderers: undefined,
        calloutEmojiButtonRef: { current: null },
        openCalloutEmojiPicker: () => {},
        ...extra,
    } as MarkdownRenderContext;
}

// 宿主组件打桩：EditableBlock 渲染出「可被静态标记嗅探」的根结构（根 tag+class 与预览一致）。
// 真正组件在 editable-block.tsx，此处只验证渲染器分支正确把控制权交给宿主组件。
setMdHost({
    components: {
        EditableBlock: (({ session }: any) => (
            <div
                data-testid="EditableBlock"
                data-kind={session.kind}
                data-start-line={session.startLine}
                data-seed={session.seedHtml}
            />
        )) as any,
    } as any,
});

beforeEach(() => resetMarkdownRenderersForTests());

describe("A3 inplace: no session → normal preview render", () => {
    const ctx = makeCtx({ inplaceCommit: () => {} });
    const keys: Array<[string, string]> = [
        ["p", "paragraph"],
        ["blockquote", "blockquote"],
        ["calloutalert", "markdown-alert"],
    ];
    for (const [key, klass] of keys) {
        it(`${key}: renders preview root (tag ${klass}) when no inplaceSession`, () => {
            const spec = getMarkdownRenderer(key)!;
            const props: any =
                key === "calloutalert"
                    ? { className: "markdown-alert", node: fakeNode(3), children: <p>hi</p> }
                    : { node: fakeNode(3), children: "hi" };
            const html = renderToStaticMarkup(spec.render(props, ctx) as any);
            // blockquote 的 root 是 tag 本身（无 class）；其余命中 className。
            if (key === "blockquote") {
                expect(html).toContain("blockquote");
            } else {
                expect(html).toContain(`class="${klass}"`);
            }
            expect(html).not.toContain("EditableBlock");
        });
    }
});

describe("A3 inplace: session hit → EditableBlock branch", () => {
    it("p: session hit renders EditableBlock (not .paragraph)", () => {
        const ctx = makeCtx({
            inplaceCommit: () => {},
            inplaceSession: {
                kind: "p",
                startLine: 3,
                endLine: 3,
                blockId: "blk-abc-0",
                seedHtml: "<strong>hi</strong>",
            },
        });
        const spec = getMarkdownRenderer("p")!;
        const props: any = { node: fakeNode(3), children: "hi", "data-block-id": "blk-abc-0" };
        const html = renderToStaticMarkup(spec.render(props, ctx) as any);
        expect(html).toContain("EditableBlock");
        expect(html).toContain("data-kind=\"p\"");
        expect(html).toContain("data-start-line=\"3\"");
        expect(html).not.toContain("class=\"paragraph\"");
    });

    it("p: session does NOT hit another block (different line / blockId)", () => {
        const ctx = makeCtx({
            inplaceCommit: () => {},
            inplaceSession: {
                kind: "p",
                startLine: 7,
                endLine: 7,
                blockId: "blk-other-0",
                seedHtml: "x",
            },
        });
        const spec = getMarkdownRenderer("p")!;
        const props: any = { node: fakeNode(3), children: "hi", "data-block-id": "blk-abc-0" };
        const html = renderToStaticMarkup(spec.render(props, ctx) as any);
        expect(html).toContain("class=\"paragraph\"");
        expect(html).not.toContain("EditableBlock");
    });

    it("h: session hit renders EditableBlock from heading renderer", () => {
        const ctx = makeCtx({
            inplaceCommit: () => {},
            inplaceSession: {
                kind: "h",
                startLine: 2,
                endLine: 2,
                headingLevel: 2,
                seedHtml: "Title",
            },
        });
        const spec = getMarkdownRenderer("h2")!;
        const props: any = { node: fakeNode(2), children: "Title", "data-block-id": "blk-title-0" };
        const html = renderToStaticMarkup(spec.render(props, ctx) as any);
        expect(html).toContain("EditableBlock");
        expect(html).toContain("data-kind=\"h\"");
    });

    it("calloutalert: session hit renders EditableBlock with isCallout marker", () => {
        const ctx = makeCtx({
            inplaceCommit: () => {},
            inplaceSession: {
                kind: "quote",
                startLine: 5,
                endLine: 5,
                isCallout: true,
                seedHtml: "<p>note</p>",
            },
        });
        const spec = getMarkdownRenderer("calloutalert")!;
        const props: any = { className: "markdown-alert", node: fakeNode(5) };
        const html = renderToStaticMarkup(spec.render(props, ctx) as any);
        expect(html).toContain("EditableBlock");
        expect(html).toContain("data-kind=\"quote\"");
        expect(html).toContain("data-start-line=\"5\"");
    });

    it("inplaceSession present but ctx.inplaceCommit undefined (read-only) → no branch", () => {
        const ctx = makeCtx({
            inplaceSession: {
                kind: "p",
                startLine: 3,
                endLine: 3,
                seedHtml: "x",
            },
        });
        const spec = getMarkdownRenderer("p")!;
        const html = renderToStaticMarkup(spec.render({ node: fakeNode(3), children: "hi" }, ctx) as any);
        expect(html).toContain("class=\"paragraph\"");
        expect(html).not.toContain("EditableBlock");
    });

    // 回归锁（实测事故）：闸门曾写成 ctx.onInlineEditCommit —— 那是 **overlay** 的提交回调。
    // 后果：只传 inplaceCommit、不用 overlay 的宿主（正是纯 inplace 消费方）会被静默降级成
    // 永不渲染 EditableBlock，且没有任何报错。闸门必须只看 inplace 自己的提交回调。
    it("inplaceCommit present but onInlineEditCommit absent → STILL renders EditableBlock", () => {
        const ctx = makeCtx({
            inplaceCommit: () => {},
            inplaceSession: {
                kind: "p",
                startLine: 3,
                endLine: 3,
                seedHtml: "x",
            },
        });
        expect(ctx.onInlineEditCommit).toBeUndefined();
        const spec = getMarkdownRenderer("p")!;
        const html = renderToStaticMarkup(spec.render({ node: fakeNode(3), children: "hi" }, ctx) as any);
        expect(html).toContain("EditableBlock");
        expect(html).not.toContain("class=\"paragraph\"");
    });
});

describe("A3 inplace: buildMarkdownComponents passes ctx through", () => {
    it("components map keys stable with built-in renderers", () => {
        const components = buildMarkdownComponents(makeCtx());
        for (const key of ["p", "h1", "h2", "blockquote", "calloutalert"]) {
            expect(typeof (components as Record<string, any>)[key]).toBe("function");
        }
    });
});