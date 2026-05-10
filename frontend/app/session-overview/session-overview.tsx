// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { blockViewToIcon, blockViewToName } from "@/app/block/blockutil";
import { Tooltip } from "@/app/element/tooltip";
import { getBadgeAtom, getTabBadgeAtom } from "@/app/store/badge";
import { atoms, setActiveTab, WOS } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { AiSessionNoteUpdatedEvent, isAISessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import { cn, makeIconClass } from "@/util/util";
import * as jotai from "jotai";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SessionOverviewModel } from "./session-overview-model";
import "./session-overview.scss";

type OverviewBlock = {
    tabId: string;
    tabName: string;
    blockId: string;
    block: Block;
    view: string;
    title: string;
    isAgentLike: boolean;
    sessionId: string;
};

type DetailState = {
    loading: boolean;
    detail: SessionDetail | null;
    error: string;
};

type SummaryState = {
    loading: boolean;
    summary: SessionSummary | null;
    error: string;
};

type TabGroup = {
    tabId: string;
    tabName: string;
    blocks: OverviewBlock[];
};

function normalizeTimeMs(timestamp: number | null | undefined): number {
    if (!timestamp) return 0;
    return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatUnreadDuration(startMs: number, nowMs: number): string {
    const diffMs = Math.max(0, nowMs - startMs);
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function messagePreview(message: Message | null): string {
    const text = message?.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) return "(empty)";
    if (text.length <= 140) return text;
    return `${text.slice(0, 140)}...`;
}

function readableMessages(detail: SessionDetail | null): Message[] {
    return (detail?.messages ?? []).filter((message) => {
        const text = message.text?.trim() ?? "";
        return text !== "" && message.role !== "tool" && !/^\[Tool:\s*[^\]]+\]$/.test(text);
    });
}

function blockTitle(block: Block, view: string): string {
    const meta = block?.meta ?? {};
    return meta["frame:title"] || meta["display:name"] || meta.file || meta.url || blockViewToName(view);
}

function isAgentMeta(meta: Record<string, unknown>, view: string): boolean {
    if (view === "agent") return true;
    if (typeof meta["agent:sessionid"] === "string" && meta["agent:sessionid"].trim() !== "") return true;
    if (typeof meta["agent:provider"] === "string" && meta["agent:provider"].trim() !== "") return true;
    if (meta["agent:autoresume"] === true) return true;
    return resolveAgentSessionIdFromMeta(meta).trim() !== "";
}

function sessionMatchesSummary(sessionId: string, summary: SessionSummary): boolean {
    const trimmed = sessionId.trim();
    return trimmed !== "" && (summary.key === trimmed || summary.id === trimmed);
}

function openSessionNote(sessionId: string): void {
    if (!sessionId) return;
    modalsModel.pushModal("AISessionNoteModal", { sessionId });
}

function useOverviewBlocks(workspace: Workspace | null): OverviewBlock[] {
    const tabIds = workspace?.tabids ?? [];
    const tabIdsKey = tabIds.join("\n");
    const overviewAtom = useMemo(
        () =>
            jotai.atom((get) => {
                const result: OverviewBlock[] = [];
                for (const tabId of tabIds) {
                    const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
                    if (tab == null) continue;
                    for (const blockId of tab.blockids ?? []) {
                        const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
                        if (block == null) continue;
                        const meta = (block.meta ?? {}) as Record<string, unknown>;
                        const view = typeof meta.view === "string" ? meta.view : "";
                        if (view === "sessionoverview") continue;
                        const isAgentLike = isAgentMeta(meta, view);
                        const sessionId = resolveAgentSessionIdFromMeta(meta).trim();
                        result.push({
                            tabId,
                            tabName: tab.name ?? "Untitled",
                            blockId,
                            block,
                            view,
                            title: blockTitle(block, view),
                            isAgentLike,
                            sessionId,
                        });
                    }
                }
                return result;
            }),
        [workspace?.oid, tabIdsKey]
    );
    return jotai.useAtomValue(overviewAtom);
}

function useSessionDetails(blocks: OverviewBlock[]): Record<string, DetailState> {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const requestedRef = useRef(new Set<string>());
    const [details, setDetails] = useState<Record<string, DetailState>>({});

    useEffect(() => {
        setDetails((current) => {
            const next = { ...current };
            for (const sessionId of sessionIds) {
                next[sessionId] ??= { loading: true, detail: null, error: "" };
            }
            return next;
        });
        let cancelled = false;
        for (const sessionId of sessionIds) {
            if (requestedRef.current.has(sessionId)) {
                continue;
            }
            requestedRef.current.add(sessionId);
            setDetails((prev) => ({ ...prev, [sessionId]: { loading: true, detail: null, error: "" } }));
            service
                .Detail({ id: sessionId, tail: 100 })
                .then((detail) => {
                    if (cancelled) return;
                    setDetails((prev) => ({ ...prev, [sessionId]: { loading: false, detail, error: "" } }));
                })
                .catch((error) => {
                    if (cancelled) return;
                    setDetails((prev) => ({
                        ...prev,
                        [sessionId]: {
                            loading: false,
                            detail: null,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    }));
                });
        }
        return () => {
            cancelled = true;
        };
    }, [service, sessionIds.join("\n")]);

    useEffect(() => {
        const handleNoteUpdated = (event: Event) => {
            if (!isAISessionNoteUpdatedEvent(event)) return;
            const updated = event.detail.summary;
            setDetails((current) => {
                let changed = false;
                const next = { ...current };
                for (const [sessionId, state] of Object.entries(current)) {
                    if (state.detail?.summary == null || !sessionMatchesSummary(sessionId, updated)) {
                        continue;
                    }
                    changed = true;
                    next[sessionId] = {
                        ...state,
                        detail: {
                            ...state.detail,
                            summary: { ...state.detail.summary, ...updated },
                        },
                    };
                }
                return changed ? next : current;
            });
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, []);

    return details;
}

function useSessionSummaries(blocks: OverviewBlock[]): Record<string, SummaryState> {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const requestedRef = useRef(new Set<string>());
    const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});

    useEffect(() => {
        setSummaries((current) => {
            const next = { ...current };
            for (const sessionId of sessionIds) {
                next[sessionId] ??= { loading: true, summary: null, error: "" };
            }
            return next;
        });
        let cancelled = false;
        for (const sessionId of sessionIds) {
            if (requestedRef.current.has(sessionId)) {
                continue;
            }
            requestedRef.current.add(sessionId);
            setSummaries((prev) => ({ ...prev, [sessionId]: { loading: true, summary: null, error: "" } }));
            service
                .Summary({ id: sessionId })
                .then((summary) => {
                    if (cancelled) return;
                    setSummaries((prev) => ({ ...prev, [sessionId]: { loading: false, summary, error: "" } }));
                })
                .catch((error) => {
                    if (cancelled) return;
                    setSummaries((prev) => ({
                        ...prev,
                        [sessionId]: {
                            loading: false,
                            summary: null,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    }));
                });
        }
        return () => {
            cancelled = true;
        };
    }, [service, sessionIds.join("\n")]);

    return summaries;
}

function SessionOverviewBadgeIcon({ badge, className }: { badge: Badge | null; className?: string }) {
    if (badge == null) return null;
    return (
        <span
            className={cn("session-overview-badge-icon", className)}
            style={{ color: badge.color || "#fbbf24" }}
            title="Notification"
        >
            <i className={makeIconClass(badge.icon, true, { defaultIcon: "circle-small" })} />
        </span>
    );
}

function useNow(open: boolean): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!open) return;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, [open]);
    return now;
}

function SessionOverviewButtonBase({ vertical = false }: { vertical?: boolean }) {
    const model = SessionOverviewModel.getInstance();
    const workspace = jotai.useAtomValue(atoms.workspace);
    const open = jotai.useAtomValue(model.isOpenAtom);
    const blocks = useOverviewBlocks(workspace);
    const summaries = useSessionSummaries(blocks);
    const viewedAt = jotai.useAtomValue(model.blockViewedAtAtom);
    const now = useNow(true);
    const unreadBlocks = blocks.filter((block) => {
        if (!block.isAgentLike || !block.sessionId) return false;
        const summary = summaries[block.sessionId]?.summary;
        const updatedAtMs = normalizeTimeMs(summary?.updatedAt);
        return updatedAtMs > 0 && updatedAtMs > (viewedAt[block.blockId] ?? 0);
    });
    const newestUnreadMs = Math.max(
        0,
        ...unreadBlocks.map((block) => normalizeTimeMs(summaries[block.sessionId]?.summary?.updatedAt))
    );
    const icon = <i className={cn(makeIconClass("list-tree", false), unreadBlocks.length > 0 && "text-accent")} />;
    const badge =
        unreadBlocks.length > 0 ? (
            <span className="session-overview-entry-badge">
                {newestUnreadMs > 0 ? formatUnreadDuration(newestUnreadMs, now) : unreadBlocks.length}
            </span>
        ) : null;

    if (vertical) {
        return (
            <Tooltip content="Open Session Overview" placement="right" hideOnClick divClassName="flex">
                <button
                    type="button"
                    className={cn(
                        "session-overview-vbutton",
                        open && "is-open",
                        unreadBlocks.length > 0 && "has-unread"
                    )}
                    onClick={() => model.toggle()}
                    aria-label="Open Session Overview"
                >
                    {icon}
                    <span>Overview</span>
                    {badge}
                </button>
            </Tooltip>
        );
    }
    return (
        <Tooltip content="Open Session Overview" placement="bottom" hideOnClick divClassName="flex">
            <button
                type="button"
                className={cn("session-overview-tabbutton", open && "is-open", unreadBlocks.length > 0 && "has-unread")}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => model.toggle()}
                aria-label="Open Session Overview"
            >
                {icon}
                {badge}
            </button>
        </Tooltip>
    );
}

function MessageDialog({
    message,
    block,
    onClose,
    onJump,
}: {
    message: Message | null;
    block: OverviewBlock | null;
    onClose: () => void;
    onJump: () => void;
}) {
    if (message == null || block == null) return null;
    return (
        <div className="session-overview-message-backdrop" onClick={onClose}>
            <div className="session-overview-message-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="session-overview-message-header">
                    <div className="min-w-0">
                        <div className="session-overview-message-title">
                            {message.role === "assistant" ? "AI" : message.role}
                        </div>
                        <div className="session-overview-message-subtitle">
                            {block.title} · #{message.seq}
                        </div>
                    </div>
                    <button type="button" className="session-overview-icon-button" onClick={onClose} aria-label="Close">
                        <i className={makeIconClass("xmark", false)} />
                    </button>
                </div>
                <div className="session-overview-message-body">{message.text}</div>
                <div className="session-overview-message-note">
                    <i className={makeIconClass("tag", false)} />
                    <span>Message note is not stored yet. Use the session note for this version.</span>
                    {block.sessionId ? (
                        <button
                            type="button"
                            onClick={() => openSessionNote(block.sessionId)}
                            aria-label="Edit session note"
                            title="Edit session note"
                        >
                            <i className={makeIconClass("tag", false)} />
                        </button>
                    ) : null}
                </div>
                <div className="session-overview-message-actions">
                    <button type="button" onClick={onJump}>
                        <i className={makeIconClass("location-crosshairs", false)} />
                        <span>Jump to Block</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

function MessageSquares({
    block,
    detailState,
    limit,
    unreadText,
    onOpenMessage,
}: {
    block: OverviewBlock;
    detailState: DetailState | undefined;
    limit: number;
    unreadText: string;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    if (!block.sessionId) {
        return <div className="session-overview-muted">No session id</div>;
    }
    if (detailState?.loading) {
        return <div className="session-overview-muted">Loading messages...</div>;
    }
    if (detailState?.error) {
        return <div className="session-overview-error">{detailState.error}</div>;
    }
    const messages = readableMessages(detailState?.detail);
    const visibleMessages = messages.slice(-limit);
    if (messages.length === 0) {
        return <div className="session-overview-muted">No readable messages</div>;
    }
    return (
        <div className="session-overview-message-strip">
            {messages.length > visibleMessages.length ? (
                <span className="session-overview-more">+{messages.length - visibleMessages.length}</span>
            ) : null}
            {visibleMessages.map((message) => (
                <button
                    key={message.seq}
                    type="button"
                    className={cn("session-overview-message-square", message.role === "user" ? "is-user" : "is-ai")}
                    title={messagePreview(message)}
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpenMessage(block, message);
                    }}
                    aria-label={`${message.role} message ${message.seq}`}
                />
            ))}
            {unreadText ? <span className="session-overview-unread-time">{unreadText}</span> : null}
        </div>
    );
}

function BlockRow({
    block,
    detailState,
    displayLimit,
    viewedAt,
    now,
    onOpenMessage,
}: {
    block: OverviewBlock;
    detailState: DetailState | undefined;
    displayLimit: number;
    viewedAt: number;
    now: number;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    const model = SessionOverviewModel.getInstance();
    const badge = jotai.useAtomValue(getBadgeAtom(WOS.makeORef("block", block.blockId)));
    const detail = detailState?.detail;
    const updatedAtMs = normalizeTimeMs(detail?.summary?.updatedAt);
    const unread = block.isAgentLike && updatedAtMs > 0 && updatedAtMs > viewedAt;
    const iconClass = makeIconClass(blockViewToIcon(block.view), false, { defaultIcon: "square" });

    return (
        <div className={cn("session-overview-block-row", unread && "has-unread")}>
            <button
                type="button"
                className="session-overview-block-main"
                onClick={() => model.jumpToBlock(block.tabId, block.blockId)}
            >
                <span className="session-overview-block-icon">
                    <i className={iconClass} />
                </span>
                <span className="session-overview-block-text">
                    <span className="session-overview-block-title">{block.title}</span>
                    <span className="session-overview-block-meta">
                        {block.isAgentLike ? "Agent" : blockViewToName(block.view)}
                        {block.sessionId ? ` · ${block.sessionId.slice(0, 8)}` : ""}
                    </span>
                </span>
                <SessionOverviewBadgeIcon badge={badge} className="session-overview-block-badge" />
            </button>
            <div className="session-overview-block-side">
                {block.isAgentLike ? (
                    <>
                        <MessageSquares
                            block={block}
                            detailState={detailState}
                            limit={displayLimit}
                            unreadText={unread ? formatUnreadDuration(updatedAtMs, now) : ""}
                            onOpenMessage={onOpenMessage}
                        />
                        <div className="session-overview-note-line">
                            <button
                                type="button"
                                onClick={() => openSessionNote(block.sessionId)}
                                disabled={!block.sessionId}
                                aria-label="Edit session note"
                                title="Edit session note"
                            >
                                <i className={makeIconClass("tag", false)} />
                            </button>
                            {detail?.summary?.note ? <span>{detail.summary.note}</span> : null}
                        </div>
                    </>
                ) : (
                    <div className="session-overview-muted">Click block name to jump</div>
                )}
            </div>
        </div>
    );
}

function TabGroupSection({
    group,
    details,
    displayLimit,
    viewedAt,
    now,
    onOpenMessage,
}: {
    group: TabGroup;
    details: Record<string, DetailState>;
    displayLimit: number;
    viewedAt: Record<string, number>;
    now: number;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    const tabBadges = jotai.useAtomValue(getTabBadgeAtom(group.tabId));
    return (
        <section key={group.tabId} className="session-overview-tab-group">
            <button
                type="button"
                className="session-overview-tab-title"
                onClick={() => setActiveTabAndCloseMenus(group.tabId)}
            >
                <i className={makeIconClass("table-columns", false)} />
                <span>{group.tabName}</span>
                <strong>{group.blocks.length}</strong>
                <SessionOverviewBadgeIcon badge={tabBadges?.[0] ?? null} />
            </button>
            <div className="session-overview-block-list">
                {group.blocks.length === 0 ? (
                    <div className="session-overview-muted">No blocks</div>
                ) : (
                    group.blocks.map((block) => (
                        <BlockRow
                            key={block.blockId}
                            block={block}
                            detailState={details[block.sessionId]}
                            displayLimit={displayLimit}
                            viewedAt={viewedAt[block.blockId] ?? 0}
                            now={now}
                            onOpenMessage={onOpenMessage}
                        />
                    ))
                )}
            </div>
        </section>
    );
}

function useTabGroups(workspace: Workspace | null, blocks: OverviewBlock[]): TabGroup[] {
    const tabIds = workspace?.tabids ?? [];
    const tabIdsKey = tabIds.join("\n");
    const tabGroupsAtom = useMemo(
        () =>
            jotai.atom((get) =>
                tabIds.map((tabId) => {
                    const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
                    return {
                        tabId,
                        tabName: tab?.name ?? "Untitled",
                        blocks: blocks.filter((block) => block.tabId === tabId),
                    };
                })
            ),
        [tabIdsKey, blocks]
    );
    return jotai.useAtomValue(tabGroupsAtom);
}

function SessionOverviewPanel() {
    const model = SessionOverviewModel.getInstance();
    const open = jotai.useAtomValue(model.isOpenAtom);
    const workspace = jotai.useAtomValue(atoms.workspace);
    const displayLimit = jotai.useAtomValue(model.displayLimitAtom);
    const viewedAt = jotai.useAtomValue(model.blockViewedAtAtom);
    const blocks = useOverviewBlocks(workspace);
    const details = useSessionDetails(blocks);
    const now = useNow(open);
    const tabGroups = useTabGroups(workspace, blocks);
    const [selected, setSelected] = useState<{ block: OverviewBlock; message: Message } | null>(null);

    useEffect(() => {
        if (!open) {
            setSelected(null);
        }
    }, [open]);

    if (!open) return null;

    const unreadCount = blocks.filter((block) => {
        const updatedAtMs = normalizeTimeMs(details[block.sessionId]?.detail?.summary?.updatedAt);
        return block.isAgentLike && updatedAtMs > 0 && updatedAtMs > (viewedAt[block.blockId] ?? 0);
    }).length;

    return (
        <>
            <aside className="session-overview-panel" aria-label="Session Overview">
                <div className="session-overview-header">
                    <div>
                        <div className="session-overview-title">Session Overview</div>
                        <div className="session-overview-subtitle">
                            {blocks.length} blocks · {unreadCount} unread
                        </div>
                    </div>
                    <div className="session-overview-header-actions">
                        <label className="session-overview-limit">
                            <span>Messages</span>
                            <input
                                type="number"
                                min={5}
                                max={100}
                                value={displayLimit}
                                onChange={(event) => model.setDisplayLimit(Number(event.target.value))}
                            />
                        </label>
                        <button type="button" className="session-overview-icon-button" onClick={() => model.close()}>
                            <i className={makeIconClass("xmark", false)} />
                        </button>
                    </div>
                </div>
                <div className="session-overview-body">
                    {tabGroups.length === 0 ? (
                        <div className="session-overview-empty">No tabs in this workspace.</div>
                    ) : (
                        tabGroups.map((group) => (
                            <TabGroupSection
                                key={group.tabId}
                                group={group}
                                details={details}
                                displayLimit={displayLimit}
                                viewedAt={viewedAt}
                                now={now}
                                onOpenMessage={(nextBlock, message) => {
                                    model.markBlockViewed(nextBlock.blockId);
                                    setSelected({ block: nextBlock, message });
                                }}
                            />
                        ))
                    )}
                </div>
            </aside>
            <MessageDialog
                message={selected?.message ?? null}
                block={selected?.block ?? null}
                onClose={() => setSelected(null)}
                onJump={() => {
                    if (selected != null) {
                        model.jumpToBlock(selected.block.tabId, selected.block.blockId);
                        setSelected(null);
                    }
                }}
            />
        </>
    );
}

function setActiveTabAndCloseMenus(tabId: string): void {
    setActiveTab(tabId);
}

export { SessionOverviewButtonBase as SessionOverviewButton, SessionOverviewPanel };
