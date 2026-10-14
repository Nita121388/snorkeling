// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * A3 在位编辑的**决定性测试**：预览渲染器输出 ⟷ EditableBlock 输出，逐属性对拍。
 *
 * 为什么必须是对拍而不是各写一份期望：
 * prd R1 的主张是「渲染面就是编辑面，只有一套样式」。这句话要成立，根元素的
 * tag / className / data-* 就不能是「两处各自维护、约定相同」——**任何一边改了而
 * 另一边没跟上，样式就会静默分叉，而且不会有任何测试变红**。历史上 overlay 的
 * CSS 镜像就是这么漂掉的（渲染器改了，镜像没跟上）。
 *
 * 所以本测试只做一件事：把**同一个块**分别交给
 *   ① 预览渲染器（md-core renderer-registry，srcLineAttrs 是真源）
 *   ② EditableBlock（宿主组件，previewRootAttrs 应复用同一个真源）
 * 然后断言两者的根元素属性集合完全一致。
 *
 * 一旦有人改了渲染器的根形态而没同步（或反之），这里立刻红。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
    getMarkdownRenderer,
    resetMarkdownRenderersForTests,
    type MarkdownRenderContext,
} from "@md/core/render";
import { EditableBlock } from "./editable-block";

/** 造一个 react-markdown 会传给块渲染器的 props（hast 节点 + 身份 + slug）。 */
function blockProps(opts: { startLine: number; endLine?: number; blockId?: string; id?: string; className?: string }) {
    return {
        node: {
            type: "element",
            tagName: "p",
            position: { start: { line: opts.startLine, column: 1 }, end: { line: opts.endLine ?? opts.startLine, column: 5 } },
        },
        ...(opts.blockId != null ? { "data-block-id": opts.blockId } : {}),
        ...(opts.id != null ? { id: opts.id } : {}),
        ...(opts.className != null ? { className: opts.className } : {}),
    } as any;
}

/** 只读预览渲染器的 ctx：inplace 字段全空 → 渲染器必定走预览分支。 */
function previewCtx(): MarkdownRenderContext {
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
    } as MarkdownRenderContext;
}

const OBSERVED_ATTRS = [
    "class",
    "id",
    "data-source-line",
    "data-source-line-end",
    "data-block-id",
    "data-heading-level",
    "data-heading-id",
    // overlay 专属标记：在位根不得携带（SCSS 里该属性只在 .inline-edit-overlay 下有意义）
    "data-block-kind",
] as const;

/** 抽出根元素上「参与样式匹配/块定位」的属性集合。 */
function rootAttrsOf(html: string): { tag: string; attrs: Record<string, string | null> } {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.body.firstElementChild;
    if (el == null) {
        throw new Error(`no root element in: ${html}`);
    }
    const attrs: Record<string, string | null> = {};
    for (const name of OBSERVED_ATTRS) {
        attrs[name] = el.getAttribute(name);
    }
    return { tag: el.tagName.toLowerCase(), attrs };
}

/** 渲染预览态（registry 的真实输出）。 */
function renderPreview(key: string, props: any): string {
    const spec = getMarkdownRenderer(key)!;
    return renderToStaticMarkup(spec.render(props, previewCtx()) as any);
}

/** 渲染编辑态（宿主 EditableBlock）。 */
function renderEditable(session: any, props: any): string {
    return renderToStaticMarkup(
        <EditableBlock session={session} blockProps={props} onCommit={() => {}} />
    );
}

describe("A3 根同构：预览渲染器输出 ⟷ EditableBlock 输出", () => {
    const CASES: Array<{
        name: string;
        previewKey: string;
        session: any;
        propsOpts: Parameters<typeof blockProps>[0];
        children?: React.ReactNode;
    }> = [
        {
            name: "p（单行，带块身份）",
            previewKey: "p",
            session: { kind: "p", startLine: 7, endLine: 7, seedHtml: "hello" },
            propsOpts: { startLine: 7, blockId: "blk-p-0" },
        },
        {
            name: "p（多行段落，start≠end）",
            previewKey: "p",
            session: { kind: "p", startLine: 7, endLine: 9, seedHtml: "hello" },
            propsOpts: { startLine: 7, endLine: 9, blockId: "blk-multi-0" },
        },
        {
            name: "h2（带 slug id + 块身份）",
            previewKey: "h2",
            session: { kind: "h", headingLevel: 2, startLine: 3, endLine: 3, seedHtml: "Title" },
            propsOpts: { startLine: 3, blockId: "blk-h-0", id: "slug-title" },
        },
        {
            name: "h3（标题身份 + 身份 id）",
            previewKey: "h3",
            session: { kind: "h", headingLevel: 3, startLine: 4, endLine: 4, seedHtml: "Sub" },
            propsOpts: { startLine: 4, blockId: "blk-h3-0", id: "slug-sub" },
        },
        {
            name: "quote（无 className）",
            previewKey: "blockquote",
            session: { kind: "quote", startLine: 11, endLine: 12, seedHtml: "quoted" },
            propsOpts: { startLine: 11, endLine: 12, blockId: "blk-q-0" },
        },
        {
            name: "callout（markdown-alert + 类型后缀）",
            previewKey: "calloutalert",
            session: { kind: "quote", isCallout: true, startLine: 5, endLine: 5, seedHtml: "note" },
            propsOpts: { startLine: 5, blockId: "blk-c-0", className: "markdown-alert markdown-alert-note" },
        },
    ];

    for (const c of CASES) {
        it(`${c.name}：根 tag 与全部块属性逐项一致`, () => {
            resetMarkdownRenderersForTests();
            const props = blockProps(c.propsOpts);
            const preview = rootAttrsOf(renderPreview(c.previewKey, props));
            const editable = rootAttrsOf(renderEditable(c.session, props));

            expect(editable.tag).toBe(preview.tag);
            for (const name of OBSERVED_ATTRS) {
                expect(
                    editable.attrs[name],
                    `属性 ${name} 不一致：预览=${String(preview.attrs[name])} 编辑=${String(editable.attrs[name])}`
                ).toBe(preview.attrs[name]);
            }
        });
    }

    // 退化节点对拍：position.end.line < start.line（真实存在于压缩/拼接后的文档）。
    // 真源 getSourceLineEnd 会把 end 回退成 start；任何手抄逻辑都会在这里露馅。
    it("退化节点（end.line < start.line）：两边都回退成 start，不出现倒置区间", () => {
        resetMarkdownRenderersForTests();
        const props = {
            node: {
                type: "element",
                tagName: "p",
                position: { start: { line: 9, column: 1 }, end: { line: 4, column: 1 } },
            },
            "data-block-id": "blk-degenerate-0",
        } as any;
        const preview = rootAttrsOf(renderPreview("p", props));
        const editable = rootAttrsOf(renderEditable({ kind: "p", startLine: 9, endLine: 9, seedHtml: "x" }, props));

        expect(preview.attrs["data-source-line"]).toBe("9");
        expect(preview.attrs["data-source-line-end"]).toBeNull(); // end==start → 真源不发该属性
        expect(editable.attrs["data-source-line"]).toBe("9");
        expect(editable.attrs["data-source-line-end"]).toBeNull();
    });
});

describe("A3 根同构：渲染器形态变更会立刻被对拍抓住（负向锁）", () => {
    it("故意让预览渲染器多发一个 data-* → 对拍必须能发现（证明对拍不是空转）", () => {
        resetMarkdownRenderersForTests();
        // 直接用 EditableBlock 不透传该属性的一面：模拟「渲染器加了属性、编辑面没跟上」
        const props = blockProps({ startLine: 2, blockId: "blk-x-0" });
        const preview = rootAttrsOf(renderPreview("p", props));
        // 手工造一个「落后」的一侧：抹掉块身份
        const staleEditable = rootAttrsOf(
            renderEditable({ kind: "p", startLine: 2, endLine: 2, seedHtml: "x" }, {
                ...props,
                "data-block-id": undefined,
            } as any)
        );
        expect(preview.attrs["data-block-id"]).toBe("blk-x-0");
        // 落后的一侧确实与预览不一致 —— 说明对拍读的是真实属性，不是恒真断言。
        expect(staleEditable.attrs["data-block-id"]).not.toBe(preview.attrs["data-block-id"]);
    });
});