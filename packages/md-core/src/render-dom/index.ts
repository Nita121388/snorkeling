// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * **框架无关的渲染真源**：markdown → DOM。
 *
 * ## 为什么要有它
 *
 * 在此之前 md-core 唯一的渲染路径是 React 组件（`render/*.tsx`，依赖 react / react-dom /
 * react-markdown）。后果：
 * - 非 React 消费者（journal 这类「纯 ESM、零框架、无打包器」的项目）**没有渲染路径**；
 * - 「编辑态 ≡ 预览态」只能在 React 侧成立。
 *
 * 本模块走**同一条 remark 管线**（`makeRemarkPlugins`，与 React 侧完全一致），
 * 只是把「mdast → hast → React 元素」换成「mdast → hast → HTML → DOM」。
 * 同一条管线意味着插件、sanitize、行号坐标、`data-source-markdown` **天然一致**；
 * 差异只可能在"最后一跳"的标签结构上，而那由契约测试盯住。
 *
 * ## 与 React 侧的关系（诚实说明）
 *
 * 这是**迁移期**的第二条渲染路径，不是终点。终点是单轨（见
 * `design/plans/md-kernel-render-contract.md` §6）。因此本模块必须满足两条纪律：
 * 1. **契约一致**：产出的 DOM 满足 md-dom 读取的所有字段（行号 / 块身份 / 原文）；
 * 2. **不引框架**：本目录零 React —— 由 `render-dom-boundary.test.ts` 断言。
 *
 * ## 怎么用（零配置）
 *
 * ```js
 * import { renderMarkdownToDom } from "@snorkeling/md-core";
 * container.append(renderMarkdownToDom("# 标题\n\n正文"));
 * ```
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

import { makeMarkdownSanitizeSchema } from "../shared/markdown-sanitize-schema";
import { makeRemarkPlugins } from "../remark";
import { rehypeSourceLines } from "./source-lines";

/** 渲染选项。**全部可选** —— 零配置必须能直接用。 */
export type RenderDomOptions = {
    /**
     * 追加的 remark 插件（在默认管线**之后**执行）。
     * 用于消费者加自己的语法；不传即用默认管线。
     */
    remarkPlugins?: unknown[];
    /** 追加的 rehype 插件（在 sanitize **之后**执行：本进程可信代码，可自由添加节点/属性）。 */
    rehypePlugins?: unknown[];
    /**
     * 是否做 sanitize。默认 **true**。
     * 关掉它的唯一正当理由：消费者已在别处做了等价的白名单（例如服务端直出）。
     */
    sanitize?: boolean;
};

/**
 * markdown → HTML 字符串（同步）。
 *
 * 同步实现的前提：管线里**没有异步插件**。默认管线满足；消费者若追加了异步插件，
 * 请用 `renderMarkdownToHtmlAsync`。
 */
export function renderMarkdownToHtml(markdown: string, opts: RenderDomOptions = {}): string {
    const processor = unified()
        .use(remarkParse)
        // 与 React 侧**同一条**管线：插件、行号坐标（remarkBlockIds）、
        // 有损构造的原始源码（data-source-markdown）都在这里产生。
        .use(makeRemarkPlugins({}) as any)
        .use(remarkRehype, { allowDangerousHtml: false })
        // 源码坐标必须在 sanitize **之前**写进属性（否则被剥掉），且属性形式让门禁看得见
        // —— React 侧是靠 position 元数据绕过白名单的，那条路在字符串化时丢了。
        .use(rehypeSourceLines);
    for (const p of opts.remarkPlugins ?? []) {
        processor.use(p as any);
    }
    if (opts.sanitize !== false) {
        // 与 React 侧同一张白名单。⚠ 新增 `data-*` 时必须同时放行它，
        // 否则 sanitize 会**静默剥掉**（本项目踩过：代码在、测试全绿、真机 DOM 上没有属性）。
        processor.use(rehypeSanitize, makeMarkdownSanitizeSchema() as any);
    }
    // 消费方的 rehype 插件在 sanitize **之后**跑：它们是本进程内的可信代码，
    // 且这样它们才能添加自己的属性/节点（放前面会被白名单剥掉，等于白写）。
    for (const p of opts.rehypePlugins ?? []) {
        processor.use(p as any);
    }
    processor.use(rehypeStringify, { allowDangerousHtml: false });

    // ⚠ 用 `processSync` 而不是 `parse()` + `runSync(tree)`：
    // 后者**不把 vfile 传给插件**，于是"按 position 从源文件切原文"这类插件
    // （image-source）拿不到 `file.value`，会**静默什么都不做**（实测踩过）。
    return String(processor.processSync(markdown));
}

/**
 * markdown → **DOM 树**（同步）。
 *
 * 用 `innerHTML` 交给浏览器的 HTML 解析器建 DOM —— 那是浏览器里最快的 HTML→DOM 路径，
 * 而且 happens-before 任何消费者拿到的时刻，不存在"半渲染"状态。
 *
 * 安全性：字符串已过 sanitize（默认开），因此 `innerHTML` 在这里是**受控输入**。
 * 若消费者显式 `sanitize: false`，则输入即信任边界 —— 调用方自负（选项注释里已写明）。
 */
export function renderMarkdownToDom(markdown: string, opts: RenderDomOptions = {}): HTMLElement {
    const html = renderMarkdownToHtml(markdown, opts);
    const container = document.createElement("div");
    container.className = "markdown-render-root";
    container.innerHTML = html;
    return container;
}

/**
 * markdown → HTML 字符串（**异步**版本）：消费者追加了异步插件时用。
 */
export async function renderMarkdownToHtmlAsync(markdown: string, opts: RenderDomOptions = {}): Promise<string> {
    const processor = unified()
        .use(remarkParse)
        .use(makeRemarkPlugins({}) as any)
        .use(remarkRehype, { allowDangerousHtml: false })
        // 源码坐标必须在 sanitize **之前**写进属性（否则被剥掉），且属性形式让门禁看得见
        // —— React 侧是靠 position 元数据绕过白名单的，那条路在字符串化时丢了。
        .use(rehypeSourceLines);
    for (const p of opts.remarkPlugins ?? []) {
        processor.use(p as any);
    }
    if (opts.sanitize !== false) {
        processor.use(rehypeSanitize, makeMarkdownSanitizeSchema() as any);
    }
    // 同同步版：消费方插件在 sanitize 之后
    for (const p of opts.rehypePlugins ?? []) {
        processor.use(p as any);
    }
    processor.use(rehypeStringify, { allowDangerousHtml: false });
    const file = await processor.process(markdown);
    return String(file);
}
