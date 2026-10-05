// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openLink } from "../../store/global";
import {
    openFileLinkInPreview,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
} from "../../view/preview/file-link-navigation";

// MarkdownResolveOpts is a global type (frontend/types/custom.d.ts).

export function shouldOpenMarkdownLinkInNewBlock(event: Pick<React.MouseEvent, "ctrlKey" | "metaKey">): boolean {
    return event.ctrlKey || event.metaKey;
}

export const Link = ({
    focusHeading,
    props,
    resolveOpts,
    onHoverIn,
    onHoverOut,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    focusHeading: (href: string) => void;
    resolveOpts?: MarkdownResolveOpts;
    /** Hover-intent hooks for the link action tooltip (markup ⑥). Undefined = no tooltip. */
    onHoverIn?: (el: HTMLAnchorElement, nodeOffsets?: { start?: number; end?: number }) => void;
    onHoverOut?: () => void;
}) => {
    // Hast node position (offsets into the ORIGINAL source text) rides along with hover, so
    // the link editor can splice this exact span even when the block holds duplicate links.
    const nodePos = (props as any)?.node?.position;
    const nodeOffsets =
        nodePos?.start?.offset != null && nodePos?.end?.offset != null
            ? { start: nodePos.start.offset, end: nodePos.end.offset }
            : undefined;
    const onClick = (e: React.MouseEvent) => {
        const href = props.href ?? "";
        const forceNewBlock = shouldOpenMarkdownLinkInNewBlock(e);
        const onOpenPath = resolveOpts?.openLink
            ? (path: string, lineNumber: number | null) => resolveOpts.openLink(path, { lineNumber, forceNewBlock })
            : undefined;
        e.preventDefault();
        if (href.startsWith("#")) {
            focusHeading(href);
        } else {
            const wikiLink = parseMarkdownWikiLink(href);
            if (wikiLink != null) {
                void openFileLinkInPreview(wikiLink.target, {
                    connection: resolveOpts?.connName,
                    baseDir: resolveOpts?.baseDir,
                    openDirectoryIndex: true,
                    heading: wikiLink.heading,
                    onOpenPath,
                }).then((opened) => {
                    if (!opened) {
                        openLink(href);
                    }
                });
                return;
            }
            const fileReference = parseMarkdownFileLineReference(href);
            void openFileLinkInPreview(fileReference?.filePath ?? href, {
                connection: resolveOpts?.connName,
                baseDir: resolveOpts?.baseDir,
                openDirectoryIndex: true,
                lineNumber: fileReference?.lineNumber,
                onOpenPath,
            }).then((opened) => {
                if (!opened) {
                    openLink(href);
                }
            });
        }
    };
    return (
        <a
            href={props.href}
            title={typeof props.href === "string" ? props.href : undefined}
            onClick={onClick}
            className="text-accent hover:underline"
            onMouseEnter={onHoverIn != null ? (e) => onHoverIn(e.currentTarget, nodeOffsets) : undefined}
            onMouseLeave={onHoverOut}
        >
            {props.children}
        </a>
    );
};

export type MarkdownLinkTooltipProps = {
    anchor: HTMLAnchorElement;
    onOpen: () => void;
    onEdit?: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    rootRef?: React.RefObject<HTMLDivElement | null>;
};

export function MarkdownLinkTooltip({
    anchor,
    onOpen,
    onEdit,
    onMouseEnter,
    onMouseLeave,
    rootRef,
}: MarkdownLinkTooltipProps) {
    const innerRef = useRef<HTMLDivElement>(null);
    const wrapRef = rootRef ?? innerRef;
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const href = anchor.getAttribute("href") ?? "";

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (el == null) {
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = rect.bottom + 2;
        if (top + h > window.innerHeight - 8) {
            top = Math.max(8, rect.top - h - 2); // flip above
        }
        setPos({ top, left });
    }, [anchor]);

    const copyHref = () => {
        navigator.clipboard.writeText(href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    return (
        <div
            ref={wrapRef}
            className="markdown-link-tooltip"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos != null ? "visible" : "hidden",
            }}
            role="dialog"
            aria-label="Link actions"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <button type="button" onClick={onOpen} title="Open link" aria-label="Open link">
                <i className="fa-sharp fa-solid fa-arrow-up-right-from-square" />
            </button>
            {onEdit != null && (
                <button type="button" onClick={onEdit} title="Edit link" aria-label="Edit link">
                    <i className="fa-sharp fa-solid fa-pen" />
                </button>
            )}
            <button
                type="button"
                onClick={copyHref}
                title={copied ? "Copied" : "Copy link"}
                aria-label={copied ? "Link copied" : "Copy link"}
            >
                <i className={`fa-sharp fa-solid ${copied ? "fa-check" : "fa-copy"}`} />
            </button>
        </div>
    );
}

// Link edit form popover (feature ⑥ refinement). Two plain inputs — 显示文本 + 链接地址 — so
// users never touch `[label](url)` syntax. Wiki links (`[[target]]`) show a single 目标 field.
export type MarkdownLinkEditorProps = {
    anchor: HTMLAnchorElement;
    mode: "markdown" | "wiki";
    initialLabel: string;
    initialUrl: string;
    onSave: (label: string, url: string) => void;
    onCancel: () => void;
};

export function MarkdownLinkEditor({ anchor, mode, initialLabel, initialUrl, onSave, onCancel }: MarkdownLinkEditorProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [label, setLabel] = useState(initialLabel);
    const [url, setUrl] = useState(initialUrl);
    const isWiki = mode === "wiki";

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (el == null) {
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = rect.bottom + 2;
        if (top + h > window.innerHeight - 8) {
            top = Math.max(8, rect.top - h - 2); // flip above
        }
        setPos({ top, left });
    }, [anchor]);

    useEffect(() => {
        firstInputRef.current?.focus();
        firstInputRef.current?.select();
    }, []);

    const submit = () => {
        const nextUrl = url.trim();
        const nextLabel = label.trim();
        if (nextUrl === "" || (!isWiki && nextLabel === "")) {
            return; // empty form = treated as cancel, never write a broken link
        }
        onSave(nextLabel, nextUrl);
    };

    return (
        <div
            ref={wrapRef}
            className="markdown-link-editor"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos != null ? "visible" : "hidden",
            }}
            role="dialog"
            aria-label="Edit link"
            // Keep the markdown root's click/dblclick handlers from firing while the form is up.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onCancel();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    submit();
                }
            }}
        >
            <div className="markdown-link-editor-header">
                <span>Edit link</span>
                <button type="button" className="markdown-link-editor-close" onClick={onCancel} aria-label="Close">
                    <i className="fa-sharp fa-solid fa-xmark" />
                </button>
            </div>
            {isWiki ? (
                <label className="markdown-link-editor-field">
                    <span>Target</span>
                    <input ref={firstInputRef} value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
            ) : (
                <>
                    <label className="markdown-link-editor-field">
                        <span>Text</span>
                        <input ref={firstInputRef} value={label} onChange={(e) => setLabel(e.target.value)} />
                    </label>
                    <label className="markdown-link-editor-field">
                        <span>URL</span>
                        <input value={url} onChange={(e) => setUrl(e.target.value)} />
                    </label>
                </>
            )}
            <div className="markdown-link-editor-actions">
                <button type="button" className="markdown-link-editor-save" onClick={submit}>
                    Save
                </button>
                <button type="button" className="markdown-link-editor-cancel" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}