// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    agentStatusPresentation,
    aggregateAgentStatuses,
    aggregateStatusLabel,
    formatAgentProvider,
    isInferredAgentStatus,
    presentAgentStatus,
} from "@/app/agent-status/agent-status-derive";
import { normalizeCanonicalAgentStatus } from "@/app/agent-status/agent-status-service";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { blockViewToIcon, blockViewToName } from "@/app/block/blockutil";
import { Tooltip } from "@/app/element/tooltip";
import { getBadgeAtom, getTabBadgeAtom } from "@/app/store/badge";
import { FocusManager } from "@/app/store/focusManager";
import { atoms, setActiveTab, WOS } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { uxCloseBlock } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType, BlockServiceType, ObjectService } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { AiSessionNoteUpdatedEvent, isAISessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import { getLayoutModelForTabById } from "@/layout/index";
import { cn, makeIconClass } from "@/util/util";
import debug from "debug";
import * as jotai from "jotai";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SessionOverviewModel } from "./session-overview-model";
import "./session-overview.scss";

const agentStatusLog = debug("wave:agentstatus");

type OverviewBlock = {
    tabId: string;
    tabName: string;
    blockId: string;
    block: Block;
    view: string;
    title: string;
    isAgentLike: boolean;
    agentProvider: string;
    sessionId: string;
};

type DetailState = {
    loading: boolean;
    detail: SessionDetail | null;
    error: string;
};

type SessionFileStat = {
    mtime: number;
    size: number;
    missing: boolean;
};

type SummaryState = {
    loading: boolean;
    summary: SessionSummary | null;
    error: string;
};

type SessionActionState = {
    deletingSessionId: string;
    error: string;
};

type TabGroup = {
    tabId: string;
    tabName: string;
    blocks: OverviewBlock[];
};

function commandPreview(command: string | null | undefined): string | null {
    const normalized = command?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) return null;
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 77)}...`;
}

function ageMs(timestamp: number, nowMs: number): number | null {
    if (!timestamp) return null;
    return Math.max(0, nowMs - timestamp);
}

function agentStatusDebugKey(status: AgentStatus): string {
    return [
        status.state,
        status.phase,
        status.source,
        status.confidence,
        status.reason ?? "",
        status.message ?? "",
        status.toolName ?? "",
        status.updatedAt,
    ].join("|");
}

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

function extractCommandBaseName(cmd: string): string {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) return "";
    const slashNormalized = trimmed.replace(/\\/g, "/");
    const parts = slashNormalized.split("/");
    const lastPart = parts[parts.length - 1] ?? "";
    return lastPart.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

function agentProviderFromMeta(meta: Record<string, unknown>, view: string): string {
    const provider = typeof meta["agent:provider"] === "string" ? meta["agent:provider"].trim() : "";
    if (provider) return provider;
    const cmdProvider = typeof meta.cmd === "string" ? extractCommandBaseName(meta.cmd) : "";
    if (cmdProvider) return cmdProvider;
    return view === "agent" ? "agent" : "";
}

function sessionMatchesSummary(sessionId: string, summary: SessionSummary): boolean {
    const trimmed = sessionId.trim();
    return trimmed !== "" && (summary.key === trimmed || summary.id === trimmed);
}

function openSessionNote(sessionId: string): void {
    if (!sessionId) return;
    modalsModel.pushModal("AISessionNoteModal", { sessionId });
}

function openSessionDetail(sessionId: string): void {
    if (!sessionId) return;
    modalsModel.pushModal("AISessionDetailModal", { sessionId });
}

async function deleteOverviewBlock(block: OverviewBlock): Promise<void> {
    const staticTabId = globalStore.get(atoms.staticTabId);
    if (block.tabId === staticTabId) {
        uxCloseBlock(block.blockId);
        return;
    }

    const layoutModel = getLayoutModelForTabById(block.tabId);
    const node = layoutModel?.getNodeByBlockId(block.blockId);
    const shouldDeleteDirectly = node == null || layoutModel?.onNodeDelete == null;
    if (node != null) {
        await layoutModel.closeNode(node.id);
    }
    if (shouldDeleteDirectly) {
        await ObjectService.DeleteBlock(block.blockId);
    }
}

function sessionStatKey(stat: SessionFileStat | AISessionsStatResponse | null | undefined): string {
    if (stat == null) return "";
    return `${stat.missing === true ? 1 : 0}:${stat.mtime ?? 0}:${stat.size ?? 0}`;
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
                            agentProvider: agentProviderFromMeta(meta, view),
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

function useBlockControllerStatuses(blocks: OverviewBlock[]): Record<string, BlockControllerRuntimeStatus | null> {
    const service = useMemo(() => new BlockServiceType(), []);
    const blockIds = useMemo(
        () => Array.from(new Set(blocks.filter((block) => block.isAgentLike).map((block) => block.blockId))).sort(),
        [blocks]
    );
    const blockIdsKey = blockIds.join("\n");
    const [statuses, setStatuses] = useState<Record<string, BlockControllerRuntimeStatus | null>>({});

    useEffect(() => {
        let cancelled = false;
        setStatuses((current) => {
            const next: Record<string, BlockControllerRuntimeStatus | null> = {};
            for (const blockId of blockIds) {
                next[blockId] = current[blockId] ?? null;
            }
            return next;
        });

        for (const blockId of blockIds) {
            service
                .GetControllerStatus(blockId)
                .then((status) => {
                    if (cancelled) return;
                    setStatuses((current) => ({ ...current, [blockId]: status }));
                })
                .catch(() => {
                    if (cancelled) return;
                    setStatuses((current) => ({ ...current, [blockId]: null }));
                });
        }

        const unsubscribers = blockIds.map((blockId) =>
            waveEventSubscribeSingle({
                eventType: "controllerstatus",
                scope: WOS.makeORef("block", blockId),
                handler: (event) => {
                    if (event.data == null) return;
                    setStatuses((current) => ({ ...current, [blockId]: event.data as BlockControllerRuntimeStatus }));
                },
            })
        );

        return () => {
            cancelled = true;
            for (const unsubscribe of unsubscribers) {
                unsubscribe();
            }
        };
    }, [service, blockIdsKey]);

    return statuses;
}

function useCanonicalAgentStatuses(blocks: OverviewBlock[]): Record<string, AgentStatus | null> {
    const service = useMemo(() => new BlockServiceType(), []);
    const blockIds = useMemo(
        () => Array.from(new Set(blocks.filter((block) => block.isAgentLike).map((block) => block.blockId))).sort(),
        [blocks]
    );
    const blockIdsKey = blockIds.join("\n");
    const [statuses, setStatuses] = useState<Record<string, AgentStatus | null>>({});

    useEffect(() => {
        let cancelled = false;
        setStatuses((current) => {
            const next: Record<string, AgentStatus | null> = {};
            for (const blockId of blockIds) {
                next[blockId] = current[blockId] ?? null;
            }
            return next;
        });

        if (blockIds.length === 0) {
            setStatuses({});
            return () => {
                cancelled = true;
            };
        }

        for (const blockId of blockIds) {
            service
                .GetAgentStatus(blockId)
                .then((status) => {
                    if (cancelled) return;
                    setStatuses((current) => ({ ...current, [blockId]: normalizeCanonicalAgentStatus(status) }));
                })
                .catch((error) => {
                    if (cancelled) return;
                    agentStatusLog("overview canonical status load error", {
                        blockId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    setStatuses((current) => ({ ...current, [blockId]: null }));
                });
        }

        const unsubscribers = blockIds.map((blockId) =>
            waveEventSubscribeSingle({
                eventType: "agentstatus",
                scope: WOS.makeORef("block", blockId),
                handler: (event) => {
                    setStatuses((current) => ({
                        ...current,
                        [blockId]: normalizeCanonicalAgentStatus(event.data),
                    }));
                },
            })
        );

        return () => {
            cancelled = true;
            for (const unsubscribe of unsubscribers) {
                unsubscribe();
            }
        };
    }, [service, blockIdsKey]);

    return statuses;
}

function useSessionDetails(blocks: OverviewBlock[], refreshSeq: number): Record<string, DetailState> {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const requestedRef = useRef(new Set<string>());
    const lastRefreshSeqRef = useRef(refreshSeq);
    const detailsRef = useRef<Record<string, DetailState>>({});
    const fileStatsRef = useRef<Record<string, SessionFileStat>>({});
    const quietPollCountRef = useRef(0);
    const mountedRef = useRef(true);
    const [details, setDetails] = useState<Record<string, DetailState>>({});

    const loadSessionDetail = React.useCallback(
        (sessionId: string, forceRefresh = false): void => {
            if (!forceRefresh && requestedRef.current.has(sessionId)) {
                return;
            }
            requestedRef.current.add(sessionId);
            setDetails((prev) => ({
                ...prev,
                [sessionId]: {
                    loading: true,
                    detail: forceRefresh ? (prev[sessionId]?.detail ?? null) : null,
                    error: "",
                },
            }));
            service
                .Detail({ id: sessionId, tail: 100, refresh: forceRefresh })
                .then((detail) => {
                    if (!mountedRef.current) return;
                    setDetails((prev) => ({ ...prev, [sessionId]: { loading: false, detail, error: "" } }));
                    const filePath = detail.summary.filePath?.trim();
                    if (filePath) {
                        service
                            .Stat({ id: sessionId, filePath })
                            .then((stat) => {
                                if (!mountedRef.current) return;
                                fileStatsRef.current[sessionId] = {
                                    mtime: stat.mtime ?? 0,
                                    size: stat.size ?? 0,
                                    missing: stat.missing === true,
                                };
                            })
                            .catch(() => {
                                // The next poll will surface stat errors without blocking the detail render.
                            });
                    }
                })
                .catch((error) => {
                    if (!mountedRef.current) return;
                    setDetails((prev) => ({
                        ...prev,
                        [sessionId]: {
                            loading: false,
                            detail: null,
                            error: error instanceof Error ? error.message : String(error),
                        },
                    }));
                });
        },
        [service]
    );

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        detailsRef.current = details;
    }, [details]);

    useEffect(() => {
        const forceRefresh = refreshSeq !== lastRefreshSeqRef.current;
        lastRefreshSeqRef.current = refreshSeq;
        setDetails((current) => {
            const next = { ...current };
            for (const sessionId of sessionIds) {
                next[sessionId] ??= { loading: true, detail: null, error: "" };
            }
            return next;
        });
        for (const sessionId of sessionIds) {
            loadSessionDetail(sessionId, forceRefresh);
        }
    }, [loadSessionDetail, sessionIds.join("\n"), refreshSeq]);

    useEffect(() => {
        if (sessionIds.length === 0) {
            return;
        }
        let cancelled = false;
        let timer: number | null = null;

        const schedule = (delayMs: number) => {
            if (cancelled) return;
            timer = window.setTimeout(() => void poll(), delayMs);
        };

        const poll = async () => {
            if (cancelled) return;
            if (document.visibilityState === "hidden") {
                schedule(30_000);
                return;
            }

            const currentDetails = detailsRef.current;
            let changed = false;
            await Promise.all(
                sessionIds.map(async (sessionId) => {
                    const state = currentDetails[sessionId];
                    if (state?.loading) return;
                    const filePath = state?.detail?.summary?.filePath?.trim();
                    if (!filePath) return;
                    try {
                        const stat = await service.Stat({ id: sessionId, filePath });
                        if (cancelled) return;
                        const prev = fileStatsRef.current[sessionId];
                        fileStatsRef.current[sessionId] = {
                            mtime: stat.mtime ?? 0,
                            size: stat.size ?? 0,
                            missing: stat.missing === true,
                        };
                        if (prev == null) {
                            return;
                        }
                        if (sessionStatKey(prev) === sessionStatKey(stat)) {
                            return;
                        }
                        changed = true;
                        if (stat.missing === true) {
                            setDetails((current) => ({
                                ...current,
                                [sessionId]: {
                                    loading: false,
                                    detail: current[sessionId]?.detail ?? null,
                                    error: "Session file is missing.",
                                },
                            }));
                            return;
                        }
                        loadSessionDetail(sessionId, true);
                    } catch (error) {
                        if (cancelled) return;
                        setDetails((current) => ({
                            ...current,
                            [sessionId]: {
                                loading: false,
                                detail: current[sessionId]?.detail ?? null,
                                error: error instanceof Error ? error.message : String(error),
                            },
                        }));
                    }
                })
            );
            quietPollCountRef.current = changed ? 0 : quietPollCountRef.current + 1;
            const nextDelay = quietPollCountRef.current < 6 ? 5_000 : quietPollCountRef.current < 20 ? 15_000 : 30_000;
            schedule(nextDelay);
        };

        schedule(5_000);
        return () => {
            cancelled = true;
            if (timer != null) {
                window.clearTimeout(timer);
            }
        };
    }, [loadSessionDetail, service, sessionIds.join("\n")]);

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

function statusDurationText(status: AgentStatus, now: number): string {
    if (status.state === "idle" || status.state === "unknown") return "";
    const start = status.activeSince ?? status.updatedAt;
    if (!start) return "";
    return formatUnreadDuration(start, now);
}

function AgentStatusChip({ status, now }: { status: AgentStatus; now: number }) {
    if (!shouldShowAgentStatusChip(status)) return null;
    const presentation = agentStatusPresentation(status);
    const duration = statusDurationText(status, now);
    const inferred = isInferredAgentStatus(status);
    return (
        <span
            className={cn(
                "session-overview-agent-status",
                `is-${status.state}`,
                status.phase !== "none" && `phase-${status.phase}`,
                inferred && "is-inferred"
            )}
            title={presentation.title}
        >
            <span className="session-overview-agent-status-dot" />
            <i className={makeIconClass(presentation.icon, false)} />
            <span className="session-overview-agent-status-label">{presentation.label}</span>
            {duration ? <span className="session-overview-agent-status-age">{duration}</span> : null}
        </span>
    );
}

function shouldShowAgentStatusChip(status: AgentStatus): boolean {
    return status.state !== "idle" && status.state !== "unknown";
}

function shouldShowAgentAggregate(statuses: AgentStatus[]): boolean {
    return statuses.some(shouldShowAgentStatusChip);
}

function AggregateStatusChip({ statuses }: { statuses: AgentStatus[] }) {
    if (!shouldShowAgentAggregate(statuses)) return null;
    const aggregate = aggregateAgentStatuses(statuses);
    return (
        <span className={cn("session-overview-agent-aggregate", `is-${aggregate.state}`)}>
            <span className="session-overview-agent-status-dot" />
            <span className="session-overview-agent-aggregate-label">{aggregateStatusLabel(aggregate)}</span>
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
            <Tooltip content="Open Overview" placement="right" hideOnClick divClassName="flex">
                <button
                    type="button"
                    className={cn(
                        "session-overview-vbutton",
                        open && "is-open",
                        unreadBlocks.length > 0 && "has-unread"
                    )}
                    onClick={() => void model.open()}
                    aria-label="Open Overview"
                >
                    {icon}
                    <span>Overview</span>
                    {badge}
                </button>
            </Tooltip>
        );
    }
    return (
        <Tooltip content="Open Overview" placement="bottom" hideOnClick divClassName="flex">
            <button
                type="button"
                className={cn("session-overview-tabbutton", open && "is-open", unreadBlocks.length > 0 && "has-unread")}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => void model.open()}
                aria-label="Open Overview"
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
    if (detailState?.error) {
        return <div className="session-overview-error">{detailState.error}</div>;
    }
    const messages = readableMessages(detailState?.detail);
    const visibleMessages = messages.slice(-limit);
    if (messages.length === 0 && !detailState?.loading) {
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
            {detailState?.loading ? (
                <i className={cn(makeIconClass("spinner", false), "session-overview-loading-icon")} />
            ) : null}
        </div>
    );
}

function BlockRow({
    block,
    detailState,
    displayLimit,
    viewedAt,
    currentBlockId,
    now,
    agentStatus,
    onSelectBlock,
    onJumpBlock,
    onOpenSessionDetail,
    onDeleteSession,
    onDeleteBlock,
    onOpenMessage,
}: {
    block: OverviewBlock;
    detailState: DetailState | undefined;
    displayLimit: number;
    viewedAt: number;
    currentBlockId: string | null;
    now: number;
    agentStatus: AgentStatus | null;
    onSelectBlock: (block: OverviewBlock) => void;
    onJumpBlock: (block: OverviewBlock) => void;
    onOpenSessionDetail: (block: OverviewBlock) => void;
    onDeleteSession: (block: OverviewBlock) => void;
    onDeleteBlock: (block: OverviewBlock) => void;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    const badge = jotai.useAtomValue(getBadgeAtom(WOS.makeORef("block", block.blockId)));
    const detail = detailState?.detail;
    const updatedAtMs = normalizeTimeMs(detail?.summary?.updatedAt);
    const unread = block.isAgentLike && updatedAtMs > 0 && updatedAtMs > viewedAt;
    const isCurrent = block.blockId === currentBlockId;
    const iconClass = makeIconClass(blockViewToIcon(block.view), false, { defaultIcon: "square" });

    return (
        <div
            className={cn(
                "session-overview-block-row",
                !block.isAgentLike && "is-plain-block",
                unread && "has-unread",
                isCurrent && "is-current"
            )}
            onClick={() => onSelectBlock(block)}
        >
            <div className="session-overview-block-main">
                <span className="session-overview-block-icon">
                    <i className={iconClass} />
                </span>
                <span className="session-overview-block-text">
                    <span className="session-overview-block-title">{block.title}</span>
                    <span className="session-overview-block-meta">
                        {block.isAgentLike ? "Agent" : blockViewToName(block.view)}
                        {block.isAgentLike && block.agentProvider
                            ? ` · ${formatAgentProvider(block.agentProvider)}`
                            : ""}
                        {block.sessionId ? ` · ${block.sessionId.slice(0, 8)}` : ""}
                        {agentStatus ? <AgentStatusChip status={agentStatus} now={now} /> : null}
                    </span>
                </span>
                <SessionOverviewBadgeIcon badge={badge} className="session-overview-block-badge" />
            </div>
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
                        {detail?.summary?.note ? (
                            <div className="session-overview-note-line">
                                <span>{detail.summary.note}</span>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </div>
            <div className="session-overview-block-actions">
                {block.isAgentLike && block.sessionId ? (
                    <Tooltip content="Edit session note" placement="top" hideOnClick divClassName="inline-flex">
                        <button
                            type="button"
                            className="session-overview-block-action-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                openSessionNote(block.sessionId);
                            }}
                            aria-label={`Edit session note for ${block.title}`}
                        >
                            <i className={makeIconClass("tag", false)} />
                        </button>
                    </Tooltip>
                ) : null}
                {block.isAgentLike && block.sessionId ? (
                    <Tooltip content="Open session details" placement="top" hideOnClick divClassName="inline-flex">
                        <button
                            type="button"
                            className="session-overview-block-action-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenSessionDetail(block);
                            }}
                            aria-label={`Open session details for ${block.title}`}
                        >
                            <i className={makeIconClass("list", false)} />
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip
                    content="Jump to block"
                    placement="top"
                    hideOnClick
                    divClassName="session-overview-block-jump-wrap"
                >
                    <button
                        type="button"
                        className="session-overview-block-action-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onJumpBlock(block);
                        }}
                        aria-label={`Jump to ${block.title}`}
                    >
                        <i className={makeIconClass("location-crosshairs", false)} />
                    </button>
                </Tooltip>
                {block.sessionId ? (
                    <Tooltip content="Delete session file" placement="top" hideOnClick divClassName="inline-flex">
                        <button
                            type="button"
                            className="session-overview-block-action-button danger"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDeleteSession(block);
                            }}
                            aria-label={`Delete session file for ${block.title}`}
                        >
                            <i className={makeIconClass("trash", false)} />
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip content="Delete block" placement="top" hideOnClick divClassName="inline-flex">
                    <button
                        type="button"
                        className="session-overview-block-action-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onDeleteBlock(block);
                        }}
                        aria-label={`Delete block ${block.title}`}
                    >
                        <i className={makeIconClass("xmark", false)} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

function TabGroupSection({
    group,
    details,
    displayLimit,
    viewedAt,
    currentBlockId,
    now,
    agentStatuses,
    onSelectBlock,
    onJumpBlock,
    onOpenSessionDetail,
    onDeleteSession,
    onDeleteBlock,
    onOpenMessage,
}: {
    group: TabGroup;
    details: Record<string, DetailState>;
    displayLimit: number;
    viewedAt: Record<string, number>;
    currentBlockId: string | null;
    now: number;
    agentStatuses: Record<string, AgentStatus>;
    onSelectBlock: (block: OverviewBlock) => void;
    onJumpBlock: (block: OverviewBlock) => void;
    onOpenSessionDetail: (block: OverviewBlock) => void;
    onDeleteSession: (block: OverviewBlock) => void;
    onDeleteBlock: (block: OverviewBlock) => void;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    const tabBadges = jotai.useAtomValue(getTabBadgeAtom(group.tabId));
    const groupAgentStatuses = group.blocks
        .map((block) => agentStatuses[block.blockId])
        .filter((status): status is AgentStatus => status != null);
    return (
        <section key={group.tabId} className="session-overview-tab-group">
            <button
                type="button"
                className="session-overview-tab-title"
                onClick={() => setActiveTabAndCloseMenus(group.tabId)}
            >
                <i className={makeIconClass("table-columns", false)} />
                <span className="session-overview-tab-name">{group.tabName}</span>
                <strong>{group.blocks.length}</strong>
                <AggregateStatusChip statuses={groupAgentStatuses} />
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
                            currentBlockId={currentBlockId}
                            now={now}
                            agentStatus={agentStatuses[block.blockId] ?? null}
                            onSelectBlock={onSelectBlock}
                            onJumpBlock={onJumpBlock}
                            onOpenSessionDetail={onOpenSessionDetail}
                            onDeleteSession={onDeleteSession}
                            onDeleteBlock={onDeleteBlock}
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

function SessionOverviewPanel({ model }: ViewComponentProps<SessionOverviewViewModel>) {
    const overviewModel = SessionOverviewModel.getInstance();
    const workspace = jotai.useAtomValue(atoms.workspace);
    const displayLimit = jotai.useAtomValue(overviewModel.displayLimitAtom);
    const viewedAt = jotai.useAtomValue(overviewModel.blockViewedAtAtom);
    const blocks = useOverviewBlocks(workspace);
    const refreshSeq = jotai.useAtomValue(model.refreshSeqAtom);
    const details = useSessionDetails(blocks, refreshSeq);
    const controllerStatuses = useBlockControllerStatuses(blocks);
    const canonicalAgentStatuses = useCanonicalAgentStatuses(blocks);
    const currentBlockId = jotai.useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const sessionService = useMemo(() => new AISessionsServiceType(), []);
    const now = useNow(true);
    const tabGroups = useTabGroups(workspace, blocks);
    const agentStatuses = useMemo(() => {
        const next: Record<string, AgentStatus> = {};
        for (const block of blocks) {
            if (!block.isAgentLike) continue;
            const sessionUpdatedAtMs = normalizeTimeMs(details[block.sessionId]?.detail?.summary?.updatedAt);
            next[block.blockId] = presentAgentStatus({
                blockId: block.blockId,
                provider: block.agentProvider,
                sessionId: block.sessionId,
                canonicalStatus: canonicalAgentStatuses[block.blockId],
                controllerStatus: controllerStatuses[block.blockId],
                sessionUpdatedAtMs,
                viewedAtMs: viewedAt[block.blockId] ?? 0,
                nowMs: now,
            });
        }
        return next;
    }, [blocks, canonicalAgentStatuses, controllerStatuses, details, viewedAt, now]);
    const workspaceAgentStatuses = useMemo(() => Object.values(agentStatuses), [agentStatuses]);
    const workspaceAgentAggregate = useMemo(
        () => aggregateAgentStatuses(workspaceAgentStatuses),
        [workspaceAgentStatuses]
    );
    const previousAgentStatusKeys = useRef<Record<string, string>>({});
    useEffect(() => {
        if (!agentStatusLog.enabled) {
            return;
        }
        const nextKeys: Record<string, string> = {};
        for (const block of blocks) {
            const status = agentStatuses[block.blockId];
            if (status == null) continue;
            const key = agentStatusDebugKey(status);
            nextKeys[block.blockId] = key;
            if (previousAgentStatusKeys.current[block.blockId] === key) {
                continue;
            }
            const sessionUpdatedAtMs = normalizeTimeMs(details[block.sessionId]?.detail?.summary?.updatedAt);
            const controllerStatus = controllerStatuses[block.blockId];
            const canonicalStatus = canonicalAgentStatuses[block.blockId];
            agentStatusLog("overview presented status", {
                blockId: block.blockId,
                title: block.title,
                provider: block.agentProvider || "agent",
                sessionId: block.sessionId || null,
                canonical:
                    canonicalStatus == null
                        ? null
                        : {
                              state: canonicalStatus.state,
                              phase: canonicalStatus.phase,
                              source: canonicalStatus.source,
                              confidence: canonicalStatus.confidence,
                              reason: canonicalStatus.reason ?? null,
                              message: commandPreview(canonicalStatus.message),
                              toolName: canonicalStatus.toolName ?? null,
                              updatedAgeMs: ageMs(canonicalStatus.updatedAt, now),
                              seq: canonicalStatus.seq ?? null,
                          },
                controllerStatus: controllerStatus?.shellprocstatus ?? null,
                controllerVersion: controllerStatus?.version ?? null,
                sessionUpdatedAgeMs: ageMs(sessionUpdatedAtMs, now),
                viewedAgeMs: ageMs(viewedAt[block.blockId] ?? 0, now),
                result: {
                    state: status.state,
                    phase: status.phase,
                    source: status.source,
                    confidence: status.confidence,
                    reason: status.reason ?? null,
                    message: commandPreview(status.message),
                    toolName: status.toolName ?? null,
                    updatedAgeMs: ageMs(status.updatedAt, now),
                },
            });
        }
        previousAgentStatusKeys.current = nextKeys;
    }, [agentStatuses, blocks, canonicalAgentStatuses, controllerStatuses, details, viewedAt, now]);
    const [selected, setSelected] = useState<{ block: OverviewBlock; message: Message } | null>(null);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [sessionAction, setSessionAction] = useState<SessionActionState>({ deletingSessionId: "", error: "" });
    const currentBlockInOverview = currentBlockId != null && blocks.some((block) => block.blockId === currentBlockId);
    const selectedBlockInOverview =
        selectedBlockId != null && blocks.some((block) => block.blockId === selectedBlockId);
    const highlightedBlockId = selectedBlockInOverview
        ? selectedBlockId
        : currentBlockInOverview
          ? currentBlockId
          : null;
    const focusedOverviewBlock = useMemo(
        () =>
            currentBlockId == null
                ? null
                : (blocks.find((block) => block.blockId === currentBlockId && block.isAgentLike && block.sessionId) ??
                  null),
        [blocks, currentBlockId]
    );
    const focusedOverviewBlockUpdatedAt =
        focusedOverviewBlock == null
            ? 0
            : normalizeTimeMs(details[focusedOverviewBlock.sessionId]?.detail?.summary?.updatedAt);

    useEffect(() => {
        if (focusedOverviewBlock == null) return;
        overviewModel.markBlockViewed(
            focusedOverviewBlock.blockId,
            Math.max(Date.now(), focusedOverviewBlockUpdatedAt)
        );
    }, [focusedOverviewBlock?.blockId, focusedOverviewBlockUpdatedAt, overviewModel]);

    const unreadCount = blocks.filter((block) => {
        const updatedAtMs = normalizeTimeMs(details[block.sessionId]?.detail?.summary?.updatedAt);
        return block.isAgentLike && updatedAtMs > 0 && updatedAtMs > (viewedAt[block.blockId] ?? 0);
    }).length;
    const agentSummary = !shouldShowAgentAggregate(workspaceAgentStatuses)
        ? ""
        : ` · ${aggregateStatusLabel(workspaceAgentAggregate)}`;

    return (
        <>
            <div className="session-overview-panel" aria-label="Overview">
                <div className="session-overview-header">
                    <div>
                        <div className="session-overview-title">Overview</div>
                        <div className="session-overview-subtitle">
                            {blocks.length} blocks · {unreadCount} unread{agentSummary}
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
                                onChange={(event) => overviewModel.setDisplayLimit(Number(event.target.value))}
                            />
                        </label>
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
                                currentBlockId={highlightedBlockId}
                                now={now}
                                agentStatuses={agentStatuses}
                                onSelectBlock={(nextBlock) => setSelectedBlockId(nextBlock.blockId)}
                                onJumpBlock={(nextBlock) => {
                                    setSelectedBlockId(nextBlock.blockId);
                                    overviewModel.jumpToBlock(nextBlock.tabId, nextBlock.blockId);
                                }}
                                onOpenSessionDetail={(nextBlock) => {
                                    if (!nextBlock.sessionId) return;
                                    setSelectedBlockId(nextBlock.blockId);
                                    overviewModel.markBlockViewed(nextBlock.blockId);
                                    openSessionDetail(nextBlock.sessionId);
                                }}
                                onDeleteSession={(nextBlock) => {
                                    if (!nextBlock.sessionId || sessionAction.deletingSessionId) return;
                                    const confirmed = window.confirm(
                                        `Delete session file for "${nextBlock.title}"?\n\nThe source file will be moved to deleted storage.`
                                    );
                                    if (!confirmed) return;
                                    setSelectedBlockId(nextBlock.blockId);
                                    setSessionAction({ deletingSessionId: nextBlock.sessionId, error: "" });
                                    sessionService
                                        .Delete(nextBlock.sessionId)
                                        .then(() => {
                                            setSelectedBlockId((current) =>
                                                current === nextBlock.blockId ? null : current
                                            );
                                            setSelected((current) =>
                                                current?.block.sessionId === nextBlock.sessionId ? null : current
                                            );
                                            uxCloseBlock(nextBlock.blockId);
                                            model.refresh();
                                        })
                                        .catch((error) => {
                                            setSessionAction({
                                                deletingSessionId: "",
                                                error: error instanceof Error ? error.message : String(error),
                                            });
                                        })
                                        .finally(() => {
                                            setSessionAction((current) =>
                                                current.deletingSessionId === nextBlock.sessionId
                                                    ? { deletingSessionId: "", error: current.error }
                                                    : current
                                            );
                                        });
                                }}
                                onDeleteBlock={(nextBlock) => {
                                    setSelectedBlockId(nextBlock.blockId);
                                    setSessionAction((current) => ({ ...current, error: "" }));
                                    deleteOverviewBlock(nextBlock)
                                        .then(() => {
                                            setSelectedBlockId((current) =>
                                                current === nextBlock.blockId ? null : current
                                            );
                                            setSelected((current) =>
                                                current?.block.blockId === nextBlock.blockId ? null : current
                                            );
                                            model.refresh();
                                        })
                                        .catch((error) => {
                                            setSessionAction((current) => ({
                                                ...current,
                                                error: error instanceof Error ? error.message : String(error),
                                            }));
                                        });
                                }}
                                onOpenMessage={(nextBlock, message) => {
                                    setSelectedBlockId(nextBlock.blockId);
                                    overviewModel.markBlockViewed(nextBlock.blockId);
                                    setSelected({ block: nextBlock, message });
                                }}
                            />
                        ))
                    )}
                    {sessionAction.error ? <div className="session-overview-error">{sessionAction.error}</div> : null}
                </div>
            </div>
            <MessageDialog
                message={selected?.message ?? null}
                block={selected?.block ?? null}
                onClose={() => setSelected(null)}
                onJump={() => {
                    if (selected != null) {
                        setSelectedBlockId(selected.block.blockId);
                        overviewModel.jumpToBlock(selected.block.tabId, selected.block.blockId);
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

export class SessionOverviewViewModel implements ViewModel {
    viewType = "sessionoverview";
    viewIcon = jotai.atom("list-tree");
    viewName = jotai.atom("Overview");
    noPadding = jotai.atom(true);
    refreshSeqAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    viewComponent = SessionOverviewPanel as ViewComponent;

    constructor(_: ViewModelInitType) {
        this.endIconButtons = jotai.atom(() => [
            {
                elemtype: "iconbutton",
                icon: "rotate-right",
                title: "Refresh overview",
                click: (e) => {
                    e.stopPropagation();
                    this.refresh();
                },
            },
        ]);
    }

    refresh(): void {
        globalStore.set(this.refreshSeqAtom, globalStore.get(this.refreshSeqAtom) + 1);
    }
}

export { SessionOverviewButtonBase as SessionOverviewButton, SessionOverviewPanel };
