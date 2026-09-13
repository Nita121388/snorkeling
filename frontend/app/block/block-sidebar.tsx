// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { InfoCardPortal, useInfoCardHover } from "@/app/element/info-card";
import { BlockInfoCard } from "@/app/block/block-info-card";
import { getLayoutModelForTabById } from "@/layout/index";
import { ObjectService } from "@/store/services";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { type Atom, useAtomValue } from "jotai";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    deleteMinimizedGroup,
    getMinimizedBlockIds,
    getMinimizedGroups,
    removeMinimizedBlockId,
    restoreMinimizedBlockToLayout,
    restoreMinimizedGroupToLayout,
} from "./block-minimize";
import { blockViewToIcon } from "./blockutil";

// ── constants ──

const SidebarStoragePrefix = "snorkeling:block-sidebar-";

// ── localStorage persistence (exported for tabbar) ──

function storageKey(tabId: string, key: string): string {
    return `${SidebarStoragePrefix}${tabId}:${key}`;
}

function loadPinned(tabId: string): boolean {
    if (typeof window === "undefined") return true;
    try {
        return localStorage.getItem(storageKey(tabId, "pinned")) !== "false";
    } catch {
        return true;
    }
}

function savePinned(tabId: string, v: boolean) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(storageKey(tabId, "pinned"), String(v));
    } catch {
        /* noop */
    }
}

// ── block metadata helpers ──

function getBlockTitle(block: Block | null | undefined): string {
    const m = block?.meta ?? {};
    return (
        m["frame:title"] ||
        m["frame:text"] ||
        m["display:name"] ||
        m.file ||
        m.url ||
        m.cmd ||
        m.view ||
        block?.oid ||
        "Block"
    );
}

// ── sanitize icon name for makeIconClass (only accepts [a-z0-9-]+) ──
function sanitizeIconName(raw: string | undefined | null): string {
    if (!raw) return "cube";
    // strip fa-solid / fa-regular / fa-brands / fa-sharp prefixes
    let name = raw.replace(/^fa-(solid|regular|brands|sharp)\s+/, "");
    // strip leading fa-
    name = name.replace(/^fa-/, "");
    // strip any remaining prefix like "solid@" / "regular@"
    name = name.replace(/^(solid|regular|brands|custom)@/, "");
    // lowercase + keep only [a-z0-9-]
    name = name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return name || "cube";
}

// ── view type → icon: canonical mapping from blockutil (same one block headers use);
// blockViewToIcon returns "square" as its own fallback, which we treat as "unmapped".

// TUI agent blocks are actually terminal blocks (view: "term") that auto-run an
// agent command — the agent identity is marked by the agent:autoresume meta flag,
// NOT by the view. Detect it so agent blocks don't render as a plain terminal.
const AgentAutoResumeMetaKey = "agent:autoresume";

function resolveViewIcon(view: string, meta?: Record<string, unknown>): string | null {
    if (meta?.[AgentAutoResumeMetaKey] === true) {
        return "robot";
    }
    if (!view) return null;
    const mapped = blockViewToIcon(view);
    if (mapped && mapped !== "square") return mapped;
    return null;
}

// ── file extension → FA icon ──
const FileExtIconMap: Record<string, string> = {
    md: "file-lines",
    markdown: "file-lines",
    txt: "file-lines",
    json: "file-code",
    js: "file-code",
    ts: "file-code",
    tsx: "file-code",
    jsx: "file-code",
    py: "file-code",
    go: "file-code",
    rs: "file-code",
    csv: "file-csv",
    xlsx: "file-excel",
    xls: "file-excel",
    pdf: "file-pdf",
    png: "file-image",
    jpg: "file-image",
    jpeg: "file-image",
    gif: "file-image",
    svg: "file-image",
    webp: "file-image",
    mp4: "file-video",
    mp3: "file-audio",
    zip: "file-zipper",
    tar: "file-zipper",
    gz: "file-zipper",
};

export function resolveBlockIcon(meta: Record<string, unknown> | undefined): string | null {
    if (!meta) return null;
    // 1. explicit icon fields take priority
    const raw = (meta["frame:icon"] || meta["icon"]) as string | undefined;
    if (raw) {
        const resolved = sanitizeIconName(raw);
        return resolved !== "cube" ? resolved : null;
    }
    // 2. directory (files preview) → folder icon. The files/folder Block is a
    //    "preview" view of a directory, which has no file extension to map —
    //    use the pathisdir meta flag set by the preview model.
    if (meta["preview:pathisdir"] === true) {
        return "folder";
    }
    // 3. file extension → icon (for file-based blocks like markdown)
    const filePath = (meta["file"] || meta["url"]) as string | undefined;
    if (filePath) {
        const ext = filePath.split(".").pop()?.toLowerCase();
        if (ext && FileExtIconMap[ext]) return FileExtIconMap[ext];
    }
    // 4. view type → canonical mapped icon (agent:autoresume flag wins over view)
    const view = (meta["view"] as string) || "";
    const mapped = resolveViewIcon(view, meta);
    if (mapped) return mapped;
    // 5. no valid icon → show nothing
    return null;
}

// ── context menu position clamp ──

function clampMenuPosition(x: number, y: number): { left: number; top: number } {
    const menuW = 180;
    const menuH = 140;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
        left: x + menuW > vw - margin ? Math.max(margin, vw - menuW - margin) : x,
        top: y + menuH > vh - margin ? Math.max(margin, vh - menuH - margin) : y,
    };
}

// ── sidebar entries ──

type SidebarBlockItem = {
    blockId: string;
    title: string;
    icon: string | null;
};

type SidebarGroupItem = {
    groupId: string;
    members: SidebarBlockItem[];
};

type SidebarEntry = { type: "block"; item: SidebarBlockItem } | { type: "group"; group: SidebarGroupItem };

/**
 * Build the ordered render list from flat blockIds + group map.
 * Groups are inserted at the position of their first member blockId, so the
 * whole group renders as ONE collapsed stack icon instead of scattering its
 * members across the bar. Subsequent member blockIds are skipped (they render
 * inside the group flyout when expanded).
 */
function buildRenderList(
    minimizedBlockIds: string[],
    groups: Record<string, string[]>,
    layoutModel: ReturnType<typeof getLayoutModelForTabById>
): SidebarEntry[] {
    const result: SidebarEntry[] = [];
    const renderedGroupIds = new Set<string>();

    for (const blockId of minimizedBlockIds) {
        let foundGroup = false;
        for (const [groupId, memberIds] of Object.entries(groups)) {
            const idx = memberIds.indexOf(blockId);
            if (idx === -1) continue;
            foundGroup = true;

            // Only render the group once, at the position of the first member.
            if (!renderedGroupIds.has(groupId)) {
                renderedGroupIds.add(groupId);
                const members = memberIds
                    .map((id) => {
                        const block = layoutModel?.getBlockById(id);
                        if (!block) return null;
                        return {
                            blockId: id,
                            title: getBlockTitle(block),
                            icon: resolveBlockIcon(block?.meta as Record<string, unknown> | undefined),
                        };
                    })
                    .filter((m): m is SidebarBlockItem => m != null);
                if (members.length > 0) {
                    result.push({ type: "group", group: { groupId, members } });
                }
            }
            break;
        }
        if (!foundGroup) {
            const block = layoutModel?.getBlockById(blockId);
            if (block) {
                result.push({
                    type: "block",
                    item: {
                        blockId,
                        title: getBlockTitle(block),
                        icon: resolveBlockIcon(block?.meta as Record<string, unknown> | undefined),
                    },
                });
            }
        }
    }
    return result;
}

// ── single icon item ──

function SidebarIconItem({
    item,
    onRestore,
    onContextMenu,
}: {
    item: SidebarBlockItem;
    onRestore: (id: string) => void;
    onContextMenu: (e: ReactMouseEvent, item: SidebarBlockItem) => void;
}) {
    const blockData = useAtomValue(useMemo(() => getWaveObjectAtom<Block>(makeORef("block", item.blockId)), [item.blockId]));
    const iconClass = item.icon ? makeIconClass(item.icon, false) : null;
    const hover = useInfoCardHover({ placement: "right" });
    // 除 Agent 外的其它 Block 也走同一套 InfoCard 分派：Note 有卡片，其余返回 null（fallback 原生 tooltip）。
    const cardContent = useMemo(
        () => BlockInfoCard({ blockId: item.blockId, blockData: blockData ?? null, onOpen: () => onRestore(item.blockId) }),
        [item.blockId, blockData, onRestore]
    );

    return (
        <>
            <div
                {...hover.targetProps}
                className="block-sidebar-item"
                title={item.title}
                onClick={() => onRestore(item.blockId)}
                onContextMenu={(e) => onContextMenu(e, item)}
            >
                {iconClass ? <i className={iconClass} /> : <span className="block-sidebar-item-fallback" />}
            </div>
            {cardContent != null && <InfoCardPortal hover={hover}>{cardContent}</InfoCardPortal>}
        </>
    );
}

// ── collapsible group item ──

function SidebarGroupIconItem({
    group,
    expanded,
    onToggleExpand,
    onRestoreMember,
    onRestoreGroup,
    onDeleteGroup,
    onContextMenu,
}: {
    group: SidebarGroupItem;
    expanded: boolean;
    onToggleExpand: () => void;
    onRestoreMember: (blockId: string) => void;
    onRestoreGroup: () => void;
    onDeleteGroup: () => void;
    onContextMenu: (e: ReactMouseEvent, group: SidebarGroupItem) => void;
}) {
    return (
        <div className={clsx("block-sidebar-group-item", expanded && "expanded")}>
            <div
                className="block-sidebar-item block-sidebar-group-btn"
                title={`Group (${group.members.length})`}
                aria-expanded={expanded}
                onClick={onToggleExpand}
                onContextMenu={(e) => onContextMenu(e, group)}
            >
                <i className={makeIconClass("layer-group", false, { defaultIcon: "cube" })} />
                <span className="block-sidebar-group-badge">{group.members.length}</span>
            </div>

            {expanded && (
                <div
                    className="block-sidebar-group-flyout"
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.stopPropagation()}
                >
                    <div className="block-sidebar-group-flyout-header">
                        <i className={makeIconClass("folder-open", false, { defaultIcon: "layer-group" })} />
                        <span className="block-sidebar-group-flyout-title">Group</span>
                        <span className="block-sidebar-group-flyout-count">{group.members.length}</span>
                    </div>
                    <div className="block-sidebar-group-flyout-members">
                        {group.members.map((member) => {
                            const iconClass = member.icon ? makeIconClass(member.icon, false) : null;
                            return (
                                <div
                                    key={member.blockId}
                                    className="block-sidebar-group-member"
                                    title={member.title}
                                    onClick={() => onRestoreMember(member.blockId)}
                                >
                                    {iconClass ? (
                                        <i className={iconClass} />
                                    ) : (
                                        <span className="block-sidebar-item-fallback" />
                                    )}
                                    <span className="block-sidebar-group-member-title">{member.title}</span>
                                    <i className="fa-solid fa-arrow-up-right-from-square block-sidebar-group-member-restore" />
                                </div>
                            );
                        })}
                    </div>
                    <div className="block-sidebar-group-flyout-footer">
                        <div
                            className="block-sidebar-group-flyout-action"
                            onClick={onRestoreGroup}
                            title="Restore Group"
                        >
                            <i className="fa-solid fa-arrow-up-right-from-square" /> Restore All
                        </div>
                        <div
                            className="block-sidebar-group-flyout-action danger"
                            onClick={onDeleteGroup}
                            title="Delete Group"
                        >
                            <i className="fa-solid fa-trash" /> Delete
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── main sidebar component ──

function BlockSidebar({ tabId, tabAtom }: { tabId: string; tabAtom: Atom<Tab> }) {
    const tab = useAtomValue(tabAtom);
    const minimizedBlockIds = getMinimizedBlockIds(tab);
    const minimizedGroups = getMinimizedGroups(tab);
    const layoutModel = getLayoutModelForTabById(tabId);

    const [pinned, setPinned] = useState<boolean>(() => loadPinned(tabId));
    // expanded group flyouts (in-memory: a flyout is transient UI, it should
    // not survive app restarts — reopening the bar starts collapsed)
    const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());

    const entries = useMemo(() => {
        return buildRenderList(minimizedBlockIds, minimizedGroups, layoutModel);
    }, [layoutModel, minimizedBlockIds.join(":"), minimizedGroups]);

    const totalItemCount = useMemo(() => {
        let count = 0;
        for (const entry of entries) {
            count += entry.type === "group" ? entry.group.members.length : 1;
        }
        return count;
    }, [entries]);

    // ── listen for expand/collapse events from tabbar ──
    useEffect(() => {
        const isForThisTab = (event: Event): boolean => {
            const detail = (event as CustomEvent<{ tabId?: string }>).detail;
            return detail?.tabId === tabId;
        };
        const onExpand = (event: Event) => {
            if (!isForThisTab(event)) return;
            setPinned(true);
            savePinned(tabId, true);
        };
        const onCollapse = (event: Event) => {
            if (!isForThisTab(event)) return;
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

    // ── prune expanded groups that no longer exist (restored / deleted) ──
    useEffect(() => {
        setExpandedGroupIds((prev) => {
            const valid = new Set(Object.keys(minimizedGroups));
            const next = new Set([...prev].filter((id) => valid.has(id)));
            if (next.size === prev.size) {
                return prev;
            }
            return next;
        });
    }, [minimizedGroups]);

    // ── outside click closes open flyouts ──
    const flyoutRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (expandedGroupIds.size === 0) return;
        const close = (e: MouseEvent) => {
            if (flyoutRef.current && e.target instanceof Node && flyoutRef.current.contains(e.target)) {
                return;
            }
            setExpandedGroupIds(new Set());
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [expandedGroupIds]);

    // ── restore / delete ──
    const handleRestore = useCallback(
        (blockId: string) => {
            restoreMinimizedBlockToLayout(tabId, blockId);
        },
        [tabId]
    );

    const handleDelete = useCallback(
        (blockId: string) => {
            ObjectService.DeleteBlock(blockId)
                .then(() => {
                    layoutModel?.closeEphemeralNodeForBlock(blockId);
                    removeMinimizedBlockId(tabId, blockId);
                })
                .catch((e) => console.warn("Failed to delete minimized block:", e));
        },
        [layoutModel, tabId]
    );

    const toggleGroupExpand = useCallback((groupId: string) => {
        setExpandedGroupIds((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                // only one flyout open at a time keeps the bar tidy
                next.clear();
                next.add(groupId);
            }
            return next;
        });
    }, []);

    const handleRestoreGroup = useCallback(
        (groupId: string) => {
            restoreMinimizedGroupToLayout(tabId, groupId);
            setExpandedGroupIds((prev) => {
                const next = new Set(prev);
                next.delete(groupId);
                return next;
            });
        },
        [tabId]
    );

    const handleDeleteGroup = useCallback(
        (groupId: string) => {
            deleteMinimizedGroup(tabId, groupId);
            setExpandedGroupIds((prev) => {
                const next = new Set(prev);
                next.delete(groupId);
                return next;
            });
        },
        [tabId]
    );

    // ── context menu ──
    const [ctx, setCtx] = useState<
        | { x: number; y: number; kind: "block"; blockId: string }
        | { x: number; y: number; kind: "group"; groupId: string }
        | null
    >(null);
    const handleItemContextMenu = useCallback((e: ReactMouseEvent, item: SidebarBlockItem) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = clampMenuPosition(e.clientX, e.clientY);
        setCtx({ x: pos.left, y: pos.top, kind: "block", blockId: item.blockId });
    }, []);
    const handleGroupContextMenu = useCallback((e: ReactMouseEvent, group: SidebarGroupItem) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = clampMenuPosition(e.clientX, e.clientY);
        setCtx({ x: pos.left, y: pos.top, kind: "group", groupId: group.groupId });
    }, []);
    useEffect(() => {
        if (!ctx) return;
        const close = () => setCtx(null);
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [ctx]);

    // ── when collapsed, render nothing ──
    if (!pinned || totalItemCount === 0) return null;

    return (
        <>
            <div
                className={clsx("block-sidebar block-sidebar-pinned", expandedGroupIds.size > 0 && "has-open-flyout")}
                ref={flyoutRef}
            >
                <div className="block-sidebar-icons">
                    {entries.map((entry) =>
                        entry.type === "group" ? (
                            <SidebarGroupIconItem
                                key={`group-${entry.group.groupId}`}
                                group={entry.group}
                                expanded={expandedGroupIds.has(entry.group.groupId)}
                                onToggleExpand={() => toggleGroupExpand(entry.group.groupId)}
                                onRestoreMember={handleRestore}
                                onRestoreGroup={() => handleRestoreGroup(entry.group.groupId)}
                                onDeleteGroup={() => handleDeleteGroup(entry.group.groupId)}
                                onContextMenu={handleGroupContextMenu}
                            />
                        ) : (
                            <SidebarIconItem
                                key={entry.item.blockId}
                                item={entry.item}
                                onRestore={handleRestore}
                                onContextMenu={handleItemContextMenu}
                            />
                        )
                    )}
                </div>
            </div>

            {ctx?.kind === "block" && (
                <div className="block-sidebar-context-menu" style={{ left: ctx.x, top: ctx.y }}>
                    <div
                        className="block-sidebar-ctx-item"
                        onClick={() => {
                            handleRestore(ctx.blockId);
                            setCtx(null);
                        }}
                    >
                        <i className="fa-solid fa-arrow-up-right-from-square" /> Restore
                    </div>
                    <div className="block-sidebar-ctx-divider" />
                    <div
                        className="block-sidebar-ctx-item danger"
                        onClick={() => {
                            handleDelete(ctx.blockId);
                            setCtx(null);
                        }}
                    >
                        <i className="fa-solid fa-trash" /> Delete
                    </div>
                </div>
            )}
            {ctx?.kind === "group" && (
                <div className="block-sidebar-context-menu" style={{ left: ctx.x, top: ctx.y }}>
                    <div
                        className="block-sidebar-ctx-item"
                        onClick={() => {
                            handleRestoreGroup(ctx.groupId);
                            setCtx(null);
                        }}
                    >
                        <i className="fa-solid fa-arrow-up-right-from-square" /> Restore Group
                    </div>
                    <div className="block-sidebar-ctx-divider" />
                    <div
                        className="block-sidebar-ctx-item danger"
                        onClick={() => {
                            handleDeleteGroup(ctx.groupId);
                            setCtx(null);
                        }}
                    >
                        <i className="fa-solid fa-trash" /> Delete Group
                    </div>
                </div>
            )}
        </>
    );
}

export { BlockSidebar };
