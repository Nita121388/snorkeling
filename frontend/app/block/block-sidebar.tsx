// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForTabById } from "@/layout/index";
import { ObjectService } from "@/store/services";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { type Atom, useAtomValue } from "jotai";
import {
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { getMinimizedBlockIds, removeMinimizedBlockId, restoreMinimizedBlockToLayout } from "./block-minimize";

const SidebarStoragePrefix = "snorkeling:block-sidebar-";
const HoverDelay = 300;
const PreviewDelay = 600;
const AutoCollapseMs = 1200;

type MinimizedBlockItem = {
    blockId: string;
    title: string;
    subtitle: string;
    icon: string;
};

// ── localStorage persistence ──

function storageKey(tabId: string, key: string): string {
    return `${SidebarStoragePrefix}${tabId}:${key}`;
}

function loadPinned(tabId: string): boolean {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(storageKey(tabId, "pinned")) !== "false"; } catch { return true; }
}

function savePinned(tabId: string, v: boolean) {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(storageKey(tabId, "pinned"), String(v)); } catch { /* noop */ }
}

function loadHidden(tabId: string): boolean {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(storageKey(tabId, "hidden")) === "true"; } catch { return false; }
}

function saveHidden(tabId: string, v: boolean) {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(storageKey(tabId, "hidden"), String(v)); } catch { /* noop */ }
}

// ── block metadata helpers ──

function getBlockTitle(block: Block | null | undefined): string {
    const m = block?.meta ?? {};
    return m["frame:title"] || m["frame:text"] || m["display:name"] || m.file || m.url || m.cmd || m.view || block?.oid || "Block";
}

function getBlockSubtitle(block: Block | null | undefined): string {
    const m = block?.meta ?? {};
    const view = m.view || "block";
    const loc = m.file || m.url || m["cmd:cwd"] || m.connection;
    return loc ? `${view} · ${loc}` : view;
}

// ── single item ──

function SidebarItem({
    item,
    onPreview,
    onRestore,
    onDelete,
}: {
    item: MinimizedBlockItem;
    onPreview: (id: string) => void;
    onRestore: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const [showActions, setShowActions] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const hoverRef = useRef<number | null>(null);
    const previewRef = useRef<number | null>(null);
    const confirmRef = useRef<number | null>(null);

    const clear = useCallback(() => {
        if (hoverRef.current) { clearTimeout(hoverRef.current); hoverRef.current = null; }
        if (previewRef.current) { clearTimeout(previewRef.current); previewRef.current = null; }
        setShowActions(false);
        setShowPreview(false);
    }, []);

    const handleEnter = useCallback(() => {
        hoverRef.current = window.setTimeout(() => setShowActions(true), HoverDelay);
        previewRef.current = window.setTimeout(() => setShowPreview(true), PreviewDelay);
    }, []);

    const handleLeave = useCallback(() => {
        clear();
    }, [clear]);

    const handleDeleteClick = useCallback((e: ReactMouseEvent) => {
        e.stopPropagation();
        if (confirmDelete) {
            onDelete(item.blockId);
        } else {
            setConfirmDelete(true);
            confirmRef.current = window.setTimeout(() => setConfirmDelete(false), 2000);
        }
    }, [confirmDelete, item.blockId, onDelete]);

    useEffect(() => () => { if (confirmRef.current) clearTimeout(confirmRef.current); }, []);

    return (
        <div
            className={clsx("block-sidebar-item", confirmDelete && "confirm-delete")}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            onClick={() => !confirmDelete && onRestore(item.blockId)}
        >
            <i className={makeIconClass(item.icon, false, { defaultIcon: "cube" })} />

            {/* hover action bar — delayed 300ms */}
            {showActions && (
                <div className="block-sidebar-actions">
                    <button className="block-sidebar-action-btn" onClick={(e) => { e.stopPropagation(); onPreview(item.blockId); }} title="Preview">
                        <i className="fa-solid fa-eye" />
                    </button>
                    <button className="block-sidebar-action-btn" onClick={(e) => { e.stopPropagation(); onRestore(item.blockId); }} title="Restore">
                        <i className="fa-solid fa-arrow-up-right-from-square" />
                    </button>
                    <button className={clsx("block-sidebar-action-btn danger", confirmDelete && "confirm")} onClick={handleDeleteClick} title={confirmDelete ? "Confirm delete" : "Delete"}>
                        <i className={confirmDelete ? "fa-solid fa-check" : "fa-solid fa-xmark"} />
                    </button>
                </div>
            )}

            {/* preview float — delayed 600ms */}
            {showPreview && (
                <div className="block-sidebar-preview" onMouseEnter={() => { if (previewRef.current) { clearTimeout(previewRef.current); previewRef.current = null; } }} onMouseLeave={clear}>
                    <div className="block-sidebar-preview-header">
                        <i className={makeIconClass(item.icon, false, { defaultIcon: "cube" })} />
                        <span className="block-sidebar-preview-title">{item.title}</span>
                    </div>
                    <div className="block-sidebar-preview-path">{item.subtitle}</div>
                    <div className="block-sidebar-preview-body">Preview content…</div>
                </div>
            )}
        </div>
    );
}

// ── main sidebar component ──

function BlockSidebar({ tabId, tabAtom }: { tabId: string; tabAtom: Atom<Tab> }) {
    const tab = useAtomValue(tabAtom);
    const minimizedBlockIds = getMinimizedBlockIds(tab);
    const layoutModel = getLayoutModelForTabById(tabId);

    const [pinned, setPinned] = useState<boolean>(() => loadPinned(tabId));
    const [hidden, setHidden] = useState<boolean>(() => loadHidden(tabId));
    const [hovered, setHovered] = useState(false);
    const collapseRef = useRef<number | null>(null);

    const items = useMemo<MinimizedBlockItem[]>(() => {
        return minimizedBlockIds
            .map((blockId) => {
                const block = layoutModel?.getBlockById(blockId);
                if (!block) return null;
                return {
                    blockId,
                    title: getBlockTitle(block),
                    subtitle: getBlockSubtitle(block),
                    icon: block?.meta?.["frame:icon"] || block?.meta?.icon || block?.meta?.view || "cube",
                };
            })
            .filter(Boolean) as MinimizedBlockItem[];
    }, [layoutModel, minimizedBlockIds.join(":")]);

    // ── hover collapse timer ──
    const handleMouseEnter = useCallback(() => {
        if (collapseRef.current) { clearTimeout(collapseRef.current); collapseRef.current = null; }
        setHovered(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
        collapseRef.current = window.setTimeout(() => setHovered(false), AutoCollapseMs);
    }, []);

    useEffect(() => () => { if (collapseRef.current) clearTimeout(collapseRef.current); }, []);

    // ── edge hover trigger (unpinned mode) ──
    useEffect(() => {
        if (pinned || hidden) return;
        const onMove = (e: MouseEvent) => { if (e.clientX < 4) setHovered(true); };
        document.addEventListener("mousemove", onMove);
        return () => document.removeEventListener("mousemove", onMove);
    }, [pinned, hidden]);

    // ── actions ──
    const togglePinned = useCallback(() => {
        setPinned((prev) => { savePinned(tabId, !prev); return !prev; });
    }, [tabId]);

    const toggleHidden = useCallback(() => {
        setHidden((prev) => { saveHidden(tabId, !prev); return !prev; });
    }, [tabId]);

    const handlePreview = useCallback((blockId: string) => {
        layoutModel?.newEphemeralNode(blockId, { deleteOnClose: false });
    }, [layoutModel]);

    const handleRestore = useCallback((blockId: string) => {
        restoreMinimizedBlockToLayout(tabId, blockId);
    }, [tabId]);

    const handleDelete = useCallback((blockId: string) => {
        ObjectService.DeleteBlock(blockId)
            .then(() => { layoutModel?.closeEphemeralNodeForBlock(blockId); removeMinimizedBlockId(tabId, blockId); })
            .catch((e) => console.warn("Failed to delete minimized block:", e));
    }, [layoutModel, tabId]);

    // ── context menu ──
    const [ctx, setCtx] = useState<{ x: number; y: number; item: MinimizedBlockItem } | null>(null);
    const handleContextMenu = useCallback((e: ReactMouseEvent, item: MinimizedBlockItem) => {
        e.preventDefault();
        setCtx({ x: e.clientX, y: e.clientY, item });
    }, []);
    useEffect(() => {
        if (!ctx) return;
        const close = () => setCtx(null);
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [ctx]);

    // ── nothing to show ──
    if (hidden || items.length === 0) return null;

    const expanded = pinned || hovered;

    return (
        <>
            {/* outer container: w-12 when pinned (pushes layout), w-0 when unpinned (overlay) */}
            <div
                className={clsx("block-sidebar relative shrink-0 select-none", pinned ? "w-[42px]" : "w-0")}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {/* inner floating layer — absolute, slides in/out via transform */}
                <div
                    className={clsx(
                        "block-sidebar-content absolute left-0 top-0 z-50 h-full w-[42px]",
                        !expanded && "pointer-events-none"
                    )}
                    style={{
                        transform: expanded ? "translateX(0)" : "translateX(-100%)",
                        opacity: expanded ? 1 : 0,
                        transition: "transform 200ms ease-out, opacity 200ms ease-out",
                    }}
                >
                    <div className="flex flex-col h-full overflow-hidden">
                        {/* items */}
                        <div className="flex-1 flex flex-col items-center py-2 gap-0.5 overflow-y-auto">
                            {items.map((item) => (
                                <SidebarItem
                                    key={item.blockId}
                                    item={item}
                                    onPreview={handlePreview}
                                    onRestore={handleRestore}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>

                        {/* divider + bottom actions */}
                        <div className="w-6 h-px bg-border/60 mx-auto my-1" />
                        <div className="flex flex-col items-center py-2 gap-0.5">
                            <button
                                className={clsx("block-sidebar-bottom-btn", pinned && "active")}
                                onClick={togglePinned}
                                title={pinned ? "Unpin sidebar" : "Pin sidebar"}
                            >
                                <i className="fa-solid fa-thumbtack" />
                            </button>
                            <button
                                className="block-sidebar-bottom-btn"
                                onClick={toggleHidden}
                                title="Hide sidebar"
                            >
                                <i className="fa-solid fa-eye-slash" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* context menu */}
            {ctx && (
                <div className="block-sidebar-context-menu" style={{ left: ctx.x, top: ctx.y }}>
                    <div className="block-sidebar-ctx-item" onClick={() => { handleRestore(ctx.item.blockId); setCtx(null); }}>
                        <i className="fa-solid fa-arrow-up-right-from-square" /> Restore <span className="ml-auto text-[10px] text-muted">Enter</span>
                    </div>
                    <div className="block-sidebar-ctx-item" onClick={() => { handlePreview(ctx.item.blockId); setCtx(null); }}>
                        <i className="fa-solid fa-eye" /> Preview <span className="ml-auto text-[10px] text-muted">Space</span>
                    </div>
                    <div className="block-sidebar-ctx-divider" />
                    <div className="block-sidebar-ctx-item" onClick={() => { navigator.clipboard?.writeText(ctx.item.blockId); setCtx(null); }}>
                        <i className="fa-regular fa-copy" /> Copy Block ID
                    </div>
                    <div className="block-sidebar-ctx-divider" />
                    <div className="block-sidebar-ctx-item danger" onClick={() => { handleDelete(ctx.item.blockId); setCtx(null); }}>
                        <i className="fa-solid fa-trash" /> Delete <span className="ml-auto text-[10px] text-muted">Del</span>
                    </div>
                </div>
            )}
        </>
    );
}

export { BlockSidebar };
