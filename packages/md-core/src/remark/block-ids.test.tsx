// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// step3 S1：块身份（data-block-id）的纯函数契约 + 真实渲染链路验证。
//
// 两层断言：
//   1) mdast 层（remark 插件直测）：确定性、内容寻址、重复块消歧、hProperties 合并不覆盖；
//   2) 渲染层（真实管线 remark → rehype-sanitize → 渲染器）：id 未被 sanitize 剥离、
//      且真的落到「可编辑块元素」上（这是 R3 重定位的前提）。

import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { makeMarkdownSanitizeSchema } from "../shared/markdown-sanitize-schema";
import { buildMarkdownComponents } from "../render/renderer-registry";
import remarkBlockIds, { blockIdForNode, collectBlockText, deriveBlockId, fnv1a } from "./block-ids";
import { makeRemarkPlugins } from "./index";

const schema = makeMarkdownSanitizeSchema();

/** 解析 + 只跑块身份插件（不引入 spacer / callout 等其它变换）的轻量处理器。 */
function parseWithBlockIds(md: string) {
    const processor = remark().use(remarkGfm).use(remarkBlockIds);
    const tree = processor.parse(md);
    processor.runSync(tree);
    return tree;
}

/** 解析 + 跑**完整** remark 管线（callout 提升 / 列表拆分 / spacer / 块身份），用于验证
 *  块身份与其它插件的属性共存。与 markdown.tsx 的插件顺序完全同源（makeRemarkPlugins）。 */
function parsePipeline(md: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processor: any = remark();
    for (const plugin of makeRemarkPlugins({ contentBlocksMap: new Map() }) as any[]) {
        processor = Array.isArray(plugin) ? processor.use(plugin[0], plugin[1]) : processor.use(plugin);
    }
    const tree = processor.parse(md);
    processor.runSync(tree);
    return tree;
}

/** 收集所有被打上 dataBlockId 的节点（含嵌套块），按文档序返回 { type, id }。 */
function idsOf(tree: any): Array<{ type: string; id: string }> {
    const out: Array<{ type: string; id: string }> = [];
    const walk = (node: any) => {
        if (node?.data?.hProperties?.dataBlockId != null) {
            out.push({ type: node.type, id: String(node.data.hProperties.dataBlockId) });
        }
        (node?.children ?? []).forEach(walk);
    };
    walk(tree);
    return out;
}

function renderReal(md: string): string {
    const ctx: any = {
        text: md,
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
        calloutEmojiButtonRef: { current: null },
        openCalloutEmojiPicker: () => {},
    };
    return renderToStaticMarkup(
        <ReactMarkdown
            remarkPlugins={makeRemarkPlugins({ contentBlocksMap: new Map() })}
            rehypePlugins={[[rehypeSanitize, schema]]}
            components={buildMarkdownComponents(ctx) as any}
        >
            {md}
        </ReactMarkdown>
    );
}

const SampleDoc = ["# title", "", "para one", "", "- item", "- item", "", "```js", "code", "```", "", "---"].join(
    "\n"
);

describe("remarkBlockIds — 内容寻址的稳定块身份（S1）", () => {
    it("同一文档两次解析 → 所有块 id 完全相同（纯函数、与渲染顺序无关）", () => {
        const first = idsOf(parseWithBlockIds(SampleDoc));
        const second = idsOf(parseWithBlockIds(SampleDoc));
        expect(second).toEqual(first);
        expect(first.length).toBeGreaterThan(0);
        // 每个 id 都形如 blk-<8位摘要>-<序号>
        for (const { id } of first) {
            expect(id).toMatch(/^blk-[0-9a-f]{8}-\d+$/);
        }
    });

    it("块内容改动 → 该块 id 变、其它块 id 不变", () => {
        const before = idsOf(parseWithBlockIds(SampleDoc));
        const after = idsOf(parseWithBlockIds(SampleDoc.replace("para one", "para CHANGED")));
        // 两个文档的结构一致（spacer 未参与 → 1:1 对齐），逐位比较
        expect(after.map((n) => n.type)).toEqual(before.map((n) => n.type));
        const changedIdx: number[] = [];
        for (let i = 0; i < before.length; i++) {
            if (before[i].id !== after[i].id) {
                changedIdx.push(i);
            }
        }
        expect(changedIdx).toHaveLength(1);
        expect(before[changedIdx[0]].type).toBe("paragraph");
        // 被改的那块确实是内容变了（而不是序号重排导致的假阳性）
        expect(after[changedIdx[0]].id).not.toBe(before[changedIdx[0]].id);
    });

    it("两个内容完全相同的块 → id 不同（重复块消歧）", () => {
        // 两个相同段落
        const paraIds = idsOf(parseWithBlockIds("same\n\nsame")).map((n) => n.id);
        expect(paraIds).toHaveLength(2);
        expect(paraIds[0]).not.toBe(paraIds[1]);
        // 两个相同围栏代码块（code 节点也是块身份）
        const codeIds = idsOf(parseWithBlockIds("```\nx\n```\n\n```\nx\n```")).map((n) => n.id);
        expect(codeIds).toHaveLength(2);
        expect(codeIds[0]).not.toBe(codeIds[1]);
        // 摘要相同、只有出现序号不同
        const digests = paraIds.map((id) => id.replace(/^blk-/, "").replace(/-\d+$/, ""));
        expect(digests[0]).toBe(digests[1]);
    });

    it("三个相同段落 → 序号 0/1/2，querySelector 语义下全文档唯一", () => {
        const ids = idsOf(parseWithBlockIds("same\n\nsame\n\nsame")).map((n) => n.id);
        expect(new Set(ids).size).toBe(3);
        expect(ids).toEqual([deriveBlockId(fnv1a("same"), 0), deriveBlockId(fnv1a("same"), 1), deriveBlockId(fnv1a("same"), 2)]);
    });

    it("只给块级节点打 id，inline 节点不被打（白名单而非「除 inline 之外」）", () => {
        const tree: any = parseWithBlockIds("para with **bold** and `code`\n\n```\nfenced\n```");
        const ids = idsOf(tree);
        expect(ids.map((n) => n.type)).toEqual(["paragraph", "code"]);
        // 强调查询：inline 的 strong/inlineCode 没有 hProperties.dataBlockId
        const strong = (tree.children[0].children as any[]).find((c) => c.type === "strong");
        expect(strong.data?.hProperties?.dataBlockId).toBeUndefined();
    });

    it("hProperties 合并而非覆盖：callout 的 hName/className 与 dataBlockId 共存", () => {
        const tree = parsePipeline("> [!note] 标题");
        const alert = (tree.children as any[]).find((n) => n?.data?.hName === "calloutalert");
        expect(alert).toBeTruthy();
        expect(alert.data.hProperties.className).toBe("markdown-alert markdown-alert-note");
        expect(String(alert.data.hProperties.dataBlockId)).toMatch(/^blk-/);
        // 渲染标记（hName）没被覆盖
        expect(alert.data.hName).toBe("calloutalert");
    });

    it("spacer 段的 dataSpacerLines 与 dataBlockId 共存（块身份不抹掉已有 hProperties）", () => {
        const tree = parsePipeline("a\n\n\n\nb");
        const spacer = (tree.children as any[]).find(
            (n) => n?.data?.hProperties?.["data-spacer-lines"] != null
        );
        expect(spacer).toBeTruthy();
        expect(spacer.data.hProperties.className).toContain("blank-spacer");
        expect(String(spacer.data.hProperties.dataBlockId)).toMatch(/^blk-/);
    });

    it("loose-list-spacing 的 dataLoose 与 dataBlockId 共存（两插件写同一个 hProperties）", () => {
        // 用无序 list：remarkSplitLooseLists 只拆有序列表，故这个 list 会保持 loose。
        const tree: any = parsePipeline("- a\n\n- b");
        const list = (tree.children as any[]).find((n) => n.type === "list");
        expect(list.data.hProperties.dataLoose).toBe("true");
        expect(String(list.data.hProperties.dataBlockId)).toMatch(/^blk-/);
    });

    it("collectBlockText 覆盖嵌套结构（列表/表格取整块文本），fnv1a 是稳定纯函数", () => {
        const tree: any = parseWithBlockIds("- parent\n  - child");
        const list = tree.children[0];
        expect(collectBlockText(list)).toContain("parent");
        expect(collectBlockText(list)).toContain("child");
        expect(fnv1a(collectBlockText(list))).toBe(fnv1a(collectBlockText(list)));
        expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
        expect(fnv1a("a")).not.toBe(fnv1a("b"));
        expect(blockIdForNode(list, 0)).toMatch(/^blk-[0-9a-f]{8}-0$/);
    });
});

describe("remarkBlockIds — 真实管线后身份落到可编辑块元素上（S1/R2）", () => {
    it("paragraph / heading / list / code / table / hr / callout 的 DOM 都带 data-block-id", () => {
        const html = renderReal(SampleDoc + "\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> quote");
        // 属性顺序由 React 决定 → 先取出所有“带 data-block-id 的开标签”，再按特征匹配，
        // 不对同标签内的属性顺序做断言。
        const tagsWithId = [...html.matchAll(/<[a-z0-9]+[^>]*data-block-id="blk-[^"]+"[^>]*>/g)].map((m) => m[0]);
        const hasTag = (pred: (tag: string) => boolean) => tagsWithId.some(pred);
        expect(hasTag((t) => t.startsWith("<div ") && t.includes('class="paragraph"'))).toBe(true);
        expect(hasTag((t) => t.includes('class="heading is-1"'))).toBe(true);
        expect(hasTag((t) => t.startsWith("<ul "))).toBe(true);
        expect(hasTag((t) => t.includes('class="codeblock"'))).toBe(true);
        expect(hasTag((t) => t.startsWith("<table "))).toBe(true);
        expect(hasTag((t) => t.startsWith("<hr "))).toBe(true);
        // callout（blockquote 被 remarkCalloutAlert 提升为 calloutalert）也带身份
        expect(hasTag((t) => t.startsWith("<calloutalert "))).toBe(true);
    });

    it("id 未被 sanitize 剥离，且每次渲染稳定（同一文档两次渲染 id 相同）", () => {
        const md = "# h\n\npara\n";
        const first = renderReal(md);
        const ids = [...first.matchAll(/data-block-id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids.length).toBeGreaterThanOrEqual(2);
        expect(new Set(ids).size).toBe(ids.length);
        expect(renderReal(md)).toBe(first);
    });

    it("duplicate 段落经真实管线后 DOM 上仍得到两个不同的 id", () => {
        const html = renderReal("same\n\nsame");
        const ids = [...html.matchAll(/<div class="paragraph" data-block-id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids).toHaveLength(2);
        expect(ids[0]).not.toBe(ids[1]);
    });
});
