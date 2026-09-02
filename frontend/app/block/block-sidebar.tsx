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

// ── constants ──

const SidebarStoragePrefix = "snorkeling:block-sidebar-";
const AutoCollapseMs = 1200;

// ── localStorage persistence (exported for tabbar) ──

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

// ── block metadata helpers ──

function getBlockTitle(block: Block | null | undefined): string {
    const m = block?.meta ?? {};
    return m["frame:title"] || m["frame:text"] || m["display:name"] || m.file || m.url || m.cmd || m.view || block?.oid || "Block";
}

// ── context menu position clamp ──

function clampMenuPosition(x: number, y: number): { left: number; top: number } {
    const menuW = 160;
    const menuH = 120;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
        left: x + menuW > vw - margin ? Math.max(margin, vw - menuW - margin) : x,
        top: y + menuH > vh - margin ? Math.max(margin, vh - menuH - margin) : y,
    };
}

// ── single icon item ──

function SidebarIconItem({
    item,
    onRestore,
    onContextMenu,
}: {
    item: { blockId: string; title: string; icon: string };
    onRestore: (id: string) => void;
    onContextMenu: (e: ReactMouseEvent, item: { blockId: string; title: string; icon: string }) => void;
}) {
    return (
        <div
            className="block-sidebar-item"
            title={item.title}
            onClick={() => onRestore(item.blockId)}
            onContextMenu={(e) => onContextMenu(e, item)}
        >
            <i className={makeIconClass(item.icon, false, { defaultIcon: "cube" })} />
        </div>
    );
}

// ── main sidebar component ──

function BlockSidebar({ tabId, tabAtom }: { tabId: string; tabAtom: Atom<Tab> }) {
    const tab = useAtomValue(tabAtom);
    const minimizedBlockIds = getMinimizedBlockIds(tab);
    const layoutModel = getLayoutModelForTabById(tabId);

    const [pinned, setPinned] = useState<boolean>(() => loadPinned(tabId));

    const items = useMemo(() => {
        return minimizedBlockIds
            .map((blockId) => {
                const block = layoutModel?.getBlockById(blockId);
                if (!block) return null;
                return {
                    blockId,
                    title: getBlockTitle(block),
                    icon: block?.meta?.["frame:icon"] || block?.meta?.icon || block?.meta?.view || "cube",
                };
            })
            .filter(Boolean) as { blockId: string; title: string; icon: string }[];
    }, [layoutModel, minimizedBlockIds.join(":")]);

    // ── listen for expand/collapse events from tabbar ──
    useEffect(() => {
        const onExpand = () => {
            setPinned(true);
            savePinned(tabId, true);
        };
        const onCollapse = () => {
            setPinned(false);
            savePinned(tabId, false);
        };
        window.addEventListener("block-sidebar:expand", onExpand);
        window.addEventListener("block-sidebar:collapse", onCollapse);
        return () => {
            window.removeEventListener("block-sidebar:expand", onExpand);
            window.removeEventListener("block-sidebar:collapse", onCollapse);
        };
    }, [tabId]);

    // ── collapse / expand ──
    // ── restore / delete ──
    const handleRestore = useCallback((blockId: string) => {
        restoreMinimizedBlockToLayout(tabId, blockId);
    }, [tabId]);

    const handleDelete = useCallback((blockId: string) => {
        ObjectService.DeleteBlock(blockId)
            .then(() => { layoutModel?.closeEphemeralNodeForBlock(blockId); removeMinimizedBlockId(tabId, blockId); })
            .catch((e) => console.warn("Failed to delete minimized block:", e));
    }, [layoutModel, tabId]);

    // ── context menu ──
    const [ctx, setCtx] = useState<{ x: number; y: number; blockId: string } | null>(null);
    const handleItemContextMenu = useCallback((e: ReactMouseEvent, item: { blockId: string }) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = clampMenuPosition(e.clientX, e.clientY);
        setCtx({ x: pos.left, y: pos.top, blockId: item.blockId });
    }, []);
    useEffect(() => {
        if (!ctx) return;
        const close = () => setCtx(null);
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [ctx]);

    // ── when collapsed, render nothing ──
    if (!pinned || items.length === 0) return null;

    return (
        <>
            <div className="block-sidebar block-sidebar-pinned">
                <div className="block-sidebar-icons">
                    {items.map((item) => (
                        <SidebarIconItem
                            key={item.blockId}
                            item={item}
                            onRestore={handleRestore}
                            onContextMenu={handleItemContextMenu}
                        />
                    ))}
                </div>
            </div>

            {ctx && (
                <div className="block-sidebar-context-menu" style={{ left: ctx.x, top: ctx.y }}>
                    <div
                        className="block-sidebar-ctx-item"
                        onClick={() => { handleRestore(ctx.blockId); setCtx(null); }}
                    >
                        <i className="fa-solid fa-arrow-up-right-from-square" /> Restore
                    </div>
                    <div className="block-sidebar-ctx-divider" />
                    <div
                        className="block-sidebar-ctx-item danger"
                        onClick={() => { handleDelete(ctx.blockId); setCtx(null); }}
                    >
                        <i className="fa-solid fa-trash" /> Delete
                    </div>
                </div>
            )}
        </>
    );
}

export { BlockSidebar };
