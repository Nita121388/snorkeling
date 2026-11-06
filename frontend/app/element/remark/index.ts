// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createContentBlockPlugin } from "@/app/element/markdown-contentblock-plugin";
import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import remarkMermaidToTag from "@/app/element/remark-mermaid-to-tag";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";
import remarkBlankLineSpacers from "./blank-line-spacers";
import remarkCalloutAlert from "./callout-alert";
import remarkLooseListSpacing from "./loose-list-spacing";
import remarkMarkdownFileReferences from "./markdown-file-refs";
import remarkSoftBreaks from "./soft-breaks";
import remarkSplitLooseLists from "./split-loose-lists";
import type { BlankSpacerOptions } from "./types";

export { default as remarkBlankLineSpacers } from "./blank-line-spacers";
export { linkifyMarkdownFileReferences, default as remarkMarkdownFileReferences } from "./markdown-file-refs";
export { default as remarkSoftBreaks } from "./soft-breaks";
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
    /**
     * 呼出块（blockquote → callout）是否带「加 emoji」按钮。预览默认 true；
     * 静态导出 / 打印传 false，避免产物里出现不可点的按钮。
     */
    calloutInteractive?: boolean;
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
    const blankSpacerOpts = blankSpacerDisabled ? null : { ...DEFAULT_BLANK_SPACER, ...(opts.blankSpacer ?? {}) };
    const enableBlankSpacers = opts.enableBlankSpacers !== false && !blankSpacerDisabled;
    return [
        remarkMermaidToTag,
        remarkMarkdownFileReferences,
        remarkSoftBreaks,
        remarkGfm,
        [remarkCalloutAlert, { interactive: opts.calloutInteractive !== false }],
        // Split BEFORE loose-list spacing + blank-line spacers so split groups become tight
        // lists and the blank rows between groups render as real spacer paragraphs.
        remarkSplitLooseLists,
        remarkLooseListSpacing,
        enableBlankSpacers && blankSpacerOpts !== null ? [remarkBlankLineSpacers, blankSpacerOpts] : null,
        [createContentBlockPlugin, { blocks: opts.contentBlocksMap }],
    ].filter(Boolean);
}
