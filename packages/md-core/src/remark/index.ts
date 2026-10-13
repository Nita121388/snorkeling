// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Plugin } from "unified";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import { getMdHost } from "../core/host";
import type { MarkdownContentBlockType } from "../shared/markdown-util";
import remarkMermaidToTag from "../shared/mermaid-to-tag";
import remarkCalloutAlert from "./callout-alert";
import { createContentBlockPlugin } from "./contentblock";
import remarkSoftBreaks from "./soft-breaks";
import remarkMarkdownFileReferences from "./markdown-file-refs";
import remarkBlankLineSpacers from "./blank-line-spacers";
import remarkLooseListSpacing from "./loose-list-spacing";
import remarkSplitLooseLists from "./split-loose-lists";
import remarkBlockIds from "./block-ids";
import remarkLegacyImageSize from "./legacy-image-size";
import type { BlankSpacerOptions } from "./types";

export { linkifyMarkdownFileReferences } from "./markdown-file-refs";
export { default as remarkSoftBreaks } from "./soft-breaks";
export { default as remarkMarkdownFileReferences } from "./markdown-file-refs";
export { default as remarkBlankLineSpacers } from "./blank-line-spacers";
export { default as remarkBlockIds } from "./block-ids";
export { default as remarkLegacyImageSize } from "./legacy-image-size";
export type { BlankSpacerOptions } from "./types";

export interface RemarkPipelineOptions {
    contentBlocksMap: Map<string, MarkdownContentBlockType>;
    /**
     * Pass null to disable spacer insertion entirely (legacy 1-blank-line =
     * collapse behaviour). Pass an options object to tune; omit for defaults.
     */
    blankSpacer?: BlankSpacerOptions | null;
    /**
     * Build-time switch for the whole plugin. Defaults true. Mostly here so
     * tests can opt out of the pipeline without stubbing individual plugins.
     */
    enableBlankSpacers?: boolean;
}

const DEFAULT_BLANK_SPACER: BlankSpacerOptions = {
    linesPerSpacer: 1,
    minSpacerLines: 1,
};

/**
 * Assembles the canonical remark plugin chain in the order the renderer
 * expects: wave-block transform → file-ref linkification → soft break
 * materialisation → GFM tables/strikethrough → blank-line spacers → wave
 * content-block placeholders.
 *
 * The blank-line-spacers plugin runs *after* remarkGfm so its position-based
 * gaps reflect the canonical mdast (GFM may split or merge some nodes).
 * Soft-breaks runs before spacers encounter their text content: spacer
 * paragraphs hold an empty text node, which soft-breaks leaves untouched.
 */
export function makeRemarkPlugins(opts: RemarkPipelineOptions): Array<Plugin<any, Root> | any> {
    // blankSpacer: undefined = use defaults; {...} = use those opts; null = disable.
    const blankSpacerDisabled = opts.blankSpacer === null;
    const blankSpacerOpts = blankSpacerDisabled
        ? null
        : { ...DEFAULT_BLANK_SPACER, ...(opts.blankSpacer ?? {}) };
    const enableBlankSpacers = opts.enableBlankSpacers !== false && !blankSpacerDisabled;
    // 内容块占位符插件：宿主可经 adapter 换一套语法；未注入时用包内纯实现（md-core 10-12）。
    const contentBlockPlugin = getMdHost().contentBlockPlugin ?? createContentBlockPlugin;
    return [
        // 必须是第一个：历史图片尺寸语法 `![alt](path =WxH)` 在 remark 眼里是**文本**，
        // 后续插件会先把 text 节点拆开 —— 拆完就再也拼不回一个完整片段了。
        remarkLegacyImageSize,
        remarkMermaidToTag,
        remarkMarkdownFileReferences,
        remarkSoftBreaks,
        remarkGfm,
        remarkCalloutAlert,
        // Split BEFORE loose-list spacing + blank-line spacers so split groups become tight
        // lists and the blank rows between groups render as real spacer paragraphs.
        remarkSplitLooseLists,
        remarkLooseListSpacing,
        enableBlankSpacers && blankSpacerOpts !== null ? [remarkBlankLineSpacers, blankSpacerOpts] : null,
        // step3：块身份必须打在**定型之后**的节点上（callout 替换、列表拆分、spacer 插入
        // 都已完成），否则 id 会落到一个随后被替换掉的节点上。放在 content block 之前：
        // 后者只动 paragraph 的 inline children，不会替换 paragraph 本身。
        remarkBlockIds,
        [contentBlockPlugin, { blocks: opts.contentBlocksMap }],
    ].filter(Boolean);
}
