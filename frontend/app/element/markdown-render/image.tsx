// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    editImageSyntaxInFullText,
    parseImageSizeSuffix,
    removeImageSizeInLine,
    removeImageSyntaxInLine,
    replaceImageSrcInLine,
    resolveRemoteFile,
    resolveSrcSet,
    updateImageAltInLine,
    updateImageSizeInLine,
} from "@/app/element/markdown-util";
import { ImageLightbox } from "@/app/element/image-lightbox";
import { ContextMenuModel } from "../../store/contextmenu";
import { cn } from "@/util/util";

// MarkdownResolveOpts is a global type (frontend/types/custom.d.ts).

export const MarkdownSource = ({
    props,
    resolveOpts,
}: {
    props: React.HTMLAttributes<HTMLSourceElement> & {
        srcSet?: string;
        media?: string;
    };
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
        const resolvePath = async () => {
            const resolved = await resolveSrcSet(props.srcSet, resolveOpts);
            setResolvedSrcSet(resolved);
            setResolving(false);
        };

        resolvePath();
    }, [props.srcSet]);

    if (resolving) {
        return null;
    }

    return <source srcSet={resolvedSrcSet} media={props.media} />;
};

export const MarkdownImg = ({
    props,
    resolveOpts,
    fullText,
    onInlineEditCommit,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
    // Source text + commit channel for edit operations ("edit path" / "delete image").
    // LivePreview omits onInlineEditCommit, so its images are view/copy only.
    fullText?: string;
    onInlineEditCommit?: (newFullText: string) => void;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);
    const [imageLoadError, setImageLoadError] = useState<string | null>(null);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [pathInputOpen, setPathInputOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedFull, setCopiedFull] = useState(false);
    const [inputPos, setInputPos] = useState<{ top: number; left: number } | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [newPath, setNewPath] = useState("");
    const [altEditing, setAltEditing] = useState(false);
    const [altDraft, setAltDraft] = useState("");

    // --- Image resize state ---
    const { src: rawImgSrc, width: initWidth, height: initHeight } = parseImageSizeSuffix(props.src);
    const [imgWidth, setImgWidth] = useState<number | null>(initWidth);
    const [imgHeight, setImgHeight] = useState<number | null>(initHeight);
    const [isResizing, setIsResizing] = useState(false);
    const [showResizeHandle, setShowResizeHandle] = useState(false);
    const resizeRef = useRef<{
        startX: number;
        startY: number;
        origW: number;
        origH: number;
        currentW: number;
        currentH: number;
    } | null>(null);
    const resizeTooltipRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setImageLoadError(null);
        if (rawImgSrc.startsWith("data:image/")) {
            setResolving(false);
            setResolvedSrc(rawImgSrc);
            setResolvedStr(null);
            return;
        }
        if (resolveOpts == null) {
            setResolving(false);
            setResolvedSrc(null);
            setResolvedStr(`[img:${rawImgSrc}]`);
            return;
        }

        const resolveFn = async () => {
            const [resolvedSrc, resolvedSrcSet] = await Promise.all([
                resolveRemoteFile(rawImgSrc, resolveOpts),
                resolveSrcSet(props.srcSet, resolveOpts),
            ]);

            setResolvedSrc(resolvedSrc);
            setResolvedSrcSet(resolvedSrcSet);
            setResolvedStr(null);
            setImageLoadError(resolvedSrc == null ? "Unable to resolve image path" : null);
            setResolving(false);
        };
        resolveFn();
    }, [rawImgSrc, props.srcSet]);

    // Sync size state when the source image path or size suffix changes (e.g., file reload,
    // undo, or another editor changing the size).
    useEffect(() => {
        const { width, height } = parseImageSizeSuffix(props.src);
        setImgWidth(width);
        setImgHeight(height);
    }, [props.src]);

    // Only real, loadable images participate in the lightbox / context menu. Placeholder
    // ([img:...]) and data-URI images are excluded from edit ops but data: URIs still zoom.
    const imageUsable = resolvedStr == null && resolvedSrc != null;
    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // rehype attaches the source position to the hast node; ImgHTMLAttributes doesn't
    // type it, so reach through a cast (mirrors getSourceLine's `props: any`).
    const nodePos = (props as any)?.node?.position;
    const sourceLine = nodePos?.start?.line;
    const sourceSrc = rawImgSrc;

    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // (data: URI images have no source line and are excluded from edit ops.)
    const canEdit = fullText != null && onInlineEditCommit != null && sourceLine != null;

    const openPathInput = () => {
        const rect = imgRef.current?.getBoundingClientRect();
        if (rect == null) {
            return;
        }
        setInputPos({ top: rect.bottom + 4, left: rect.left });
        setNewPath(sourceSrc);
        setPathInputOpen(true);
    };

    const commitPathEdit = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
            replaceImageSrcInLine(lineText, sourceSrc, newPath.trim())
        );
        if (newText != null) {
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const deleteImage = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) => {
            const removed = removeImageSyntaxInLine(lineText, sourceSrc);
            if (removed == null) {
                return null;
            }
            // The image syntax was the only content on its line: drop the whole line so
            // the surrounding text closes up. Otherwise keep the line minus the fragment.
            return removed.isEmpty ? "" : removed.text;
        });
        if (newText != null) {
            // No confirmation dialog: the edit lands in the shared draft (newFileContent)
            // and is Revert-able until Save, same safety net as paragraph inline editing.
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const commitAltEdit = () => {
        if (!canEdit || sourceLine == null) {
            setAltEditing(false);
            return;
        }
        const trimmed = altDraft.trim();
        // Only commit if the alt actually changed
        if (trimmed !== (props.alt ?? "")) {
            const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
                updateImageAltInLine(lineText, sourceSrc, trimmed)
            );
            if (newText != null) {
                onInlineEditCommit(newText);
            }
        }
        setAltEditing(false);
    };

    const copyImagePath = async () => {
        await navigator.clipboard.writeText(sourceSrc ?? "");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    const copyImageFullPath = async () => {
        let fullPath = sourceSrc ?? "";
        // Resolve relative paths to absolute using baseDir from resolveOpts.
        // Skip absolute paths (Unix / or Windows C:\\) and remote URLs (http/https).
        if (
            resolveOpts?.baseDir &&
            fullPath &&
            !fullPath.startsWith("/") &&
            !fullPath.match(/^[A-Z]:\\\\/i) &&
            !fullPath.startsWith("http://") &&
            !fullPath.startsWith("https://")
        ) {
            fullPath = `${resolveOpts.baseDir}/${fullPath}`;
        }
        await navigator.clipboard.writeText(fullPath);
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1200);
    };

    // --- Image resize handlers ---
    const commitImageSize = useCallback(
        (width: number, height: number) => {
            if (!canEdit || sourceLine == null) {
                return;
            }
            const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
                updateImageSizeInLine(lineText, sourceSrc, width, height)
            );
            if (newText != null) {
                onInlineEditCommit(newText);
            }
        },
        [canEdit, sourceLine, fullText, sourceSrc, onInlineEditCommit]
    );

    const clearImageSize = useCallback(() => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
            removeImageSizeInLine(lineText, sourceSrc)
        );
        if (newText != null) {
            onInlineEditCommit(newText);
        }
        setImgWidth(null);
        setImgHeight(null);
    }, [canEdit, sourceLine, fullText, sourceSrc, onInlineEditCommit]);

    const handleResizeMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (!canEdit || !imgRef.current) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const img = imgRef.current;
            const currentW = imgWidth ?? img.naturalWidth ?? img.offsetWidth;
            const currentH = imgHeight ?? img.naturalHeight ?? img.offsetHeight;
            resizeRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origW: currentW,
                origH: currentH,
                currentW,
                currentH,
            };
            setIsResizing(true);

            const onMouseMove = (ev: MouseEvent) => {
                const ref = resizeRef.current;
                if (ref == null) {
                    return;
                }
                const dx = ev.clientX - ref.startX;
                const dy = ev.clientY - ref.startY;
                // Always maintain aspect ratio: use the axis with larger absolute displacement
                let scale: number;
                if (ref.origW > 0 && ref.origH > 0) {
                    const scaleX = (ref.origW + dx) / ref.origW;
                    const scaleY = (ref.origH + dy) / ref.origH;
                    scale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
                } else {
                    scale = 1;
                }
                const newW = Math.max(20, Math.round(ref.origW * scale));
                const newH = Math.max(20, Math.round(ref.origH * scale));
                ref.currentW = newW;
                ref.currentH = newH;
                setImgWidth(newW);
                setImgHeight(newH);
            };

            const onMouseUp = () => {
                setIsResizing(false);
                const ref = resizeRef.current;
                resizeRef.current = null;
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
                // Commit the final size to the markdown source.
                if (ref != null && ref.currentW != null && ref.currentH != null) {
                    commitImageSize(ref.currentW, ref.currentH);
                }
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        },
        [canEdit, imgWidth, imgHeight, commitImageSize]
    );

    const handleImgClick = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        // An image wrapped in a link ([![alt](img)](url)) keeps the link's navigation;
        // the lightbox is reachable via the context menu in that case.
        if ((e.target as HTMLElement).closest("a") != null) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setLightboxOpen(true);
    };

    const handleImgContextMenu = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const menu: ContextMenuItem[] = [
            { label: "Zoom in", click: () => setLightboxOpen(true) },
            { label: "Copy image path", click: () => void copyImagePath() },
            { label: "Copy full image path", click: () => void copyImageFullPath() },
        ];
        if (canEdit) {
            menu.push({ type: "separator" });
            if (imgWidth != null) {
                menu.push({ label: "Reset image size", click: clearImageSize });
            }
            menu.push({ label: "Edit path", click: openPathInput });
            menu.push({ label: "Delete image", click: deleteImage });
        }
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (imageLoadError != null || resolvedSrc == null) {
        return (
            <span className="markdown-img-error" title={`${imageLoadError ?? "Unable to load image"}: ${rawImgSrc}`}>
                [Image unavailable: {rawImgSrc}]
            </span>
        );
    }
    if (resolvedSrc != null) {
        const imgStyle: React.CSSProperties = {};
        if (imgWidth != null) {
            imgStyle.width = imgWidth;
        }
        if (imgHeight != null) {
            imgStyle.height = imgHeight;
        }
        const hasResize = canEdit;
        return (
            <>
                <span
                    className={cn(
                        "markdown-img-wrapper",
                        hasResize && "markdown-img-resizable",
                        isResizing && "resizing"
                    )}
                    onMouseEnter={() => hasResize && !isResizing && setShowResizeHandle(true)}
                    onMouseLeave={() => !isResizing && setShowResizeHandle(false)}
                >
                    <img
                        ref={imgRef}
                        {...props}
                        src={resolvedSrc}
                        srcSet={resolvedSrcSet}
                        className={cn(props.className, "markdown-img-clickable")}
                        style={imgStyle}
                        onClick={handleImgClick}
                        onContextMenu={handleImgContextMenu}
                        onError={() => setImageLoadError("Unable to load image")}
                    />
                    {hasResize && (showResizeHandle || isResizing) && (
                        <div
                            className="markdown-img-resize-handle"
                            onMouseDown={handleResizeMouseDown}
                            title="Drag to resize"
                        />
                    )}
                    {hasResize && imgWidth != null && (
                        <div className="markdown-img-size-actions">
                            <span className="markdown-img-size-badge">
                                {imgWidth}×{imgHeight ?? "auto"}
                            </span>
                            <button
                                className="markdown-img-size-clear"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearImageSize();
                                }}
                                title="Reset to natural size"
                                type="button"
                            >
                                ×
                            </button>
                        </div>
                    )}
                </span>
                {canEdit && !altEditing && (
                    <div
                        className="markdown-img-alt-display"
                        onClick={(e) => {
                            e.stopPropagation();
                            setAltDraft(props.alt ?? "");
                            setAltEditing(true);
                        }}
                        title="Click to edit alt text"
                    >
                        {(props.alt ?? "") === "" ? "+ Add description" : props.alt}
                    </div>
                )}
                {canEdit && altEditing && (
                    <div className="markdown-img-alt-editor" onClick={(e) => e.stopPropagation()}>
                        <input
                            autoFocus
                            className="markdown-img-alt-input"
                            value={altDraft}
                            placeholder="Image description"
                            onChange={(e) => setAltDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitAltEdit();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    setAltEditing(false);
                                }
                            }}
                            onBlur={commitAltEdit}
                        />
                    </div>
                )}
                {copied && <span className="markdown-img-copied">Path copied</span>}
                {copiedFull && <span className="markdown-img-copied">Full path copied</span>}
                {lightboxOpen && (
                    <ImageLightbox src={resolvedSrc} alt={props.alt} onClose={() => setLightboxOpen(false)} />
                )}
                {pathInputOpen &&
                    inputPos != null &&
                    ReactDOM.createPortal(
                        <div className="markdown-img-path-input" style={{ top: inputPos.top, left: inputPos.left }}>
                            <input
                                ref={inputRef}
                                autoFocus
                                value={newPath}
                                spellCheck={false}
                                placeholder="Image path"
                                onChange={(e) => setNewPath(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        commitPathEdit();
                                    } else if (e.key === "Escape") {
                                        setPathInputOpen(false);
                                    }
                                }}
                                onBlur={() => setPathInputOpen(false)}
                            />
                        </div>,
                        document.body
                    )}
            </>
        );
    }
    return <span>[img]</span>;
};