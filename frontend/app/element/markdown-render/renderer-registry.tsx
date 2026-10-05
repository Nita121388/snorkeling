// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * P0 Markdown block-renderer registry.
 *
 * Central source of truth for "which renderer serves which react-markdown element key".
 * markdown.tsx no longer inlines block renderers — it asks this registry via
 * `buildMarkdownComponents(ctx)` and gets the full `Components` map back.
 *
 * Contract (mirrors block-editor/registry.ts):
 *   - a block capability = one `registerMarkdownRenderer()` spec
 *   - `buildMarkdownComponents` assembles the react-markdown map from registered renderers
 *   - block renderers are plain React components; host wiring (handlers, collapse state)
 *     flows in through `MarkdownRenderContext` so memo semantics in markdown.tsx stay intact
 */

import type { Components } from "react-markdown";
import { isBlockEditorFeatureEnabled } from "@/app/element/block-editor/flags";
import { TableBlock } from "@/app/element/block-editor/components/table-block";
import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { setCodeBlockLanguage } from "@/app/element/markdown-transform/code-block";
import { CollapsibleHeading } from "./heading";
import { MarkdownListItem, MarkdownOrderedList, MarkdownTaskCheckbox, MarkdownUnorderedList } from "./list";
import { CollapsibleTable } from "./table";
import { Code, Mermaid } from "./mermaid";
import { CodeBlock } from "./code-block";
import { MarkdownImg, MarkdownSource } from "./image";
import { Link } from "./link";
import { WaveBlock } from "./waveblock";
import { getOrderedListItemId, getSourceLine, getSourceLineEnd, getTextContent, srcLineAttrs } from "./shared";

// ---------------------------------------------------------------------------
// Context: everything a block renderer may need from the host Markdown instance.
// ---------------------------------------------------------------------------

export interface MarkdownRenderContext {
    /** Current full document text. */
    text: string;
    resolveOpts?: MarkdownResolveOpts; // global type (frontend/types/custom.d.ts)
    onClickExecute?: (cmd: string) => void;
    focusHeading: (href: string) => void;
    collapsedHeadings: Set<string>;
    toggleHeadingCollapse: (id: string) => void;
    collapsedTables: Set<string>;
    toggleTableCollapse: (key: string) => void;
    collapsibleOrderedLists: boolean;
    collapsedOrderedListItems: Set<string>;
    toggleOrderedListItemCollapse: (itemId: string) => void;
    /** Function to toggle a task checkbox at a given source line. */
    handleTaskCheckboxToggle: (line: number) => void;
    /** Raw host commit prop (null in read-only contexts). Used ONLY for presence gating
     *  (link-hover tooltip, task checkbox, code-language affordance). Not used for commits. */
    onInlineEditCommit?: (newFullText: string) => void;
    /** Wrapped full-text commit funnel from the host Markdown instance (renumber-safe + drives
     *  the Markdown-level autosave flush). Always defined; no-ops in read-only via its own check.
     *  Used by image edits and code-block language edits, mirroring the original inline wiring
     *  which passed `handleInlineEditCommit` to those renderers. */
    commitFullText?: (newFullText: string) => void;
    handleLinkHoverIn?: (el: HTMLAnchorElement, nodeOffsets?: { start?: number; end?: number }) => void;
    handleLinkHoverOut?: () => void;
    contentBlocksMap: Map<string, MarkdownContentBlockType>;
    waveBlockRenderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
    /** Callout emoji picker affordance: ref + opener passed through from the host. */
    calloutEmojiButtonRef: React.RefObject<HTMLButtonElement | null>;
    openCalloutEmojiPicker: (button: HTMLButtonElement) => void;
}

export interface MarkdownRendererSpec {
    /** react-markdown element key (h1/h2/p/li/table/pre/img/a/ol/ul/...). */
    key: string;
    /** Turn element props + host context into a rendered block. */
    render: (props: any, ctx: MarkdownRenderContext) => React.ReactNode;
    /** Optional availability filter. When it returns false, the key is left unset so
     *  react-markdown's default handles it (used for clickable task `input`). */
    when?: (ctx: MarkdownRenderContext) => boolean;
}

const renderers = new Map<string, MarkdownRendererSpec>();

/** Register a block renderer. Returns an unregister disposer. */
export function registerMarkdownRenderer(spec: MarkdownRendererSpec): () => void {
    renderers.set(spec.key, spec);
    return () => {
        renderers.delete(spec.key);
    };
}

export function getMarkdownRenderer(key: string): MarkdownRendererSpec | undefined {
    return renderers.get(key);
}

export function listMarkdownRenderers(): MarkdownRendererSpec[] {
    return [...renderers.values()];
}

/**
 * Assemble the full react-markdown `Components` map for a given host context.
 * Keys whose `when` predicate fails are left unset so react-markdown defaults apply.
 */
export function buildMarkdownComponents(ctx: MarkdownRenderContext): Partial<Components> {
    const components: Partial<Components> = {};
    for (const spec of renderers.values()) {
        if (spec.when != null && !spec.when(ctx)) {
            continue;
        }
        const render = spec.render;
        (components as Record<string, any>)[spec.key] = (props: any) => render(props, ctx);
    }
    return components;
}

// ---------------------------------------------------------------------------
// Built-in block renderers (self-registering, idempotent).
// ---------------------------------------------------------------------------

function headingRenderer(hnum: number) {
    return (props: React.HTMLAttributes<HTMLHeadingElement>, ctx: MarkdownRenderContext) => (
        <CollapsibleHeading
            props={props}
            hnum={hnum}
            collapsed={ctx.collapsedHeadings.has(String(props.id))}
            onToggle={ctx.toggleHeadingCollapse}
        />
    );
}

/** Re-run idempotent built-in registration (also used after a test reset). */
export function registerBuiltinRenderers(): void {
    registerMarkdownRenderer({
        key: "a",
        render: (props: React.HTMLAttributes<HTMLAnchorElement>, ctx) => (
            <Link
                props={props}
                focusHeading={ctx.focusHeading}
                resolveOpts={ctx.resolveOpts}
                onHoverIn={ctx.onInlineEditCommit != null ? ctx.handleLinkHoverIn : undefined}
                onHoverOut={ctx.onInlineEditCommit != null ? ctx.handleLinkHoverOut : undefined}
            />
        ),
    });
    registerMarkdownRenderer({ key: "h1", render: headingRenderer(1) });
    registerMarkdownRenderer({ key: "h2", render: headingRenderer(2) });
    registerMarkdownRenderer({ key: "h3", render: headingRenderer(3) });
    registerMarkdownRenderer({ key: "h4", render: headingRenderer(4) });
    registerMarkdownRenderer({ key: "h5", render: headingRenderer(5) });
    registerMarkdownRenderer({ key: "h6", render: headingRenderer(6) });
    registerMarkdownRenderer({
        key: "table",
        render: (props: React.HTMLAttributes<HTMLTableElement>, ctx) => {
            const collapsed = ctx.collapsedTables.has(String(getSourceLine(props)));
            const toggle = () => ctx.toggleTableCollapse(String(getSourceLine(props)));
            if (isBlockEditorFeatureEnabled("tablecell")) {
                return <TableBlock props={props} collapsed={collapsed} onToggle={toggle} />;
            }
            return <CollapsibleTable props={props} collapsed={collapsed} onToggle={toggle} />;
        },
    });
    registerMarkdownRenderer({
        key: "ol",
        render: (props: React.OlHTMLAttributes<HTMLOListElement>, ctx) => (
            <MarkdownOrderedList props={props} collapsible={ctx.collapsibleOrderedLists} />
        ),
    });
    registerMarkdownRenderer({
        key: "ul",
        render: (props: React.HTMLAttributes<HTMLUListElement>, ctx) => <MarkdownUnorderedList {...props} />,
    });
    registerMarkdownRenderer({
        key: "li",
        render: (props: React.HTMLAttributes<HTMLLIElement>, ctx) => (
            <MarkdownListItem
                props={props}
                collapsed={ctx.collapsedOrderedListItems.has(getOrderedListItemId(props))}
                onToggle={ctx.toggleOrderedListItemCollapse}
            />
        ),
    });
    registerMarkdownRenderer({
        key: "img",
        render: (props: React.HTMLAttributes<HTMLImageElement>, ctx) => (
            <MarkdownImg
                props={props}
                resolveOpts={ctx.resolveOpts}
                fullText={ctx.text}
                onInlineEditCommit={ctx.commitFullText}
            />
        ),
    });
    registerMarkdownRenderer({
        key: "source",
        render: (props: React.HTMLAttributes<HTMLSourceElement>, ctx) => (
            <MarkdownSource props={props} resolveOpts={ctx.resolveOpts} />
        ),
    });
    registerMarkdownRenderer({
        key: "code",
        render: (props: any, ctx) => <Code className={props.className}>{props.children}</Code>,
    });
    registerMarkdownRenderer({
        key: "pre",
        render: (props: React.HTMLAttributes<HTMLPreElement>, ctx) => {
            const langMatch = (props.children as any)?.props?.className?.match(/language-([\w+#.-]+)/);
            const lang: string | null = langMatch?.[1] ?? null;
            const srcLine = getSourceLine(props);
            return (
                <CodeBlock
                    children={props.children}
                    onClickExecute={ctx.onClickExecute}
                    sourceLine={srcLine}
                    sourceLineEnd={getSourceLineEnd(props)}
                    language={lang}
                    onApplyLanguage={
                        ctx.onInlineEditCommit != null && srcLine != null && isBlockEditorFeatureEnabled("codelang")
                            ? (nextLang) => {
                                  const next = setCodeBlockLanguage(ctx.text, srcLine, nextLang);
                                  if (next != null) {
                                      ctx.commitFullText?.(next);
                                  }
                              }
                            : undefined
                    }
                />
            );
        },
    });
    registerMarkdownRenderer({
        key: "waveblock",
        render: (props: any, ctx) => (
            <WaveBlock {...props} blockmap={ctx.contentBlocksMap} renderers={ctx.waveBlockRenderers} />
        ),
    });
    registerMarkdownRenderer({
        key: "mermaidblock",
        render: (props: any, ctx) => {
            const chartText = getTextContent(props.children);
            return <Mermaid chart={chartText} />;
        },
    });
    registerMarkdownRenderer({
        key: "input",
        when: (ctx) => ctx.onInlineEditCommit != null,
        render: (props: React.InputHTMLAttributes<HTMLInputElement>, ctx) => (
            <MarkdownTaskCheckbox props={props} onToggle={ctx.handleTaskCheckboxToggle} />
        ),
    });
    registerMarkdownRenderer({
        key: "p",
        render: (props: React.HTMLAttributes<HTMLParagraphElement>, ctx) => (
            <div className="paragraph" {...props} {...srcLineAttrs(props)} />
        ),
    });
    registerMarkdownRenderer({
        key: "hr",
        render: (props: React.HTMLAttributes<HTMLHRElement>, ctx) => <hr {...props} {...srcLineAttrs(props)} />,
    });
    registerMarkdownRenderer({
        key: "blockquote",
        render: (props: React.HTMLAttributes<HTMLQuoteElement>, ctx) => (
            <blockquote {...props} {...srcLineAttrs(props)} />
        ),
    });
    registerMarkdownRenderer({
        key: "span",
        render: (props: React.HTMLAttributes<HTMLSpanElement>, ctx) => {
            if (!String(props.className ?? "").includes("markdown-alert-emoji-btn")) return <span {...props} />;
            const buttonProps = props as React.HTMLAttributes<HTMLButtonElement>;
            return (
                <button
                    {...buttonProps}
                    type="button"
                    ref={ctx.calloutEmojiButtonRef}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ctx.openCalloutEmojiPicker(e.currentTarget);
                    }}
                />
            );
        },
    });
    registerMarkdownRenderer({
        key: "button",
        render: (props: React.ButtonHTMLAttributes<HTMLButtonElement>, ctx) => {
            if (!String(props.className ?? "").includes("markdown-alert-emoji-btn")) return <button {...props} />;
            return (
                <button
                    {...props}
                    ref={ctx.calloutEmojiButtonRef}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ctx.openCalloutEmojiPicker(e.currentTarget);
                    }}
                />
            );
        },
    });
}

/** Test helper: drop all renderer registrations, then re-register built-ins. */
export function resetMarkdownRenderersForTests(): void {
    renderers.clear();
    registerBuiltinRenderers();
}

// Module-scope self-registration (idempotent due to Map key overwrite).
registerBuiltinRenderers();