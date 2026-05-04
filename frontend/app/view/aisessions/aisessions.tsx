// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { AISessionsServiceType } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { createBlock, createBlockSplitHorizontally } from "@/store/global";
import { globalStore } from "@/store/jotaiStore";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SourceFilter = "" | "codex" | "claude";
const sortPreferenceStorageKey = "aisessions.sortDescending";
const defaultVisibleMessageCount = 30;
const visibleMessageCountStep = 30;
const collapsibleMessageCharCount = 1200;
const collapsibleMessageLineCount = 18;
const collapsedMessagePreviewLength = 420;

export class AiSessionsViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveEnv;
    service: AISessionsServiceType;
    viewType = "aisessions";
    viewIcon = jotai.atom("messages-square");
    viewName = jotai.atom("AI Sessions");
    noPadding = jotai.atom(true);

    sessionsAtom = jotai.atom<SessionSummary[]>([]);
    detailAtom = jotai.atom<SessionDetail | null>(null);
    selectedKeyAtom = jotai.atom<string>("");
    sourceAtom = jotai.atom<SourceFilter>("");
    queryAtom = jotai.atom<string>("");
    loadingAtom = jotai.atom<boolean>(true);
    detailLoadingAtom = jotai.atom<boolean>(false);
    errorAtom = jotai.atom<string>("");
    restoringAtom = jotai.atom<boolean>(false);
    deletingAtom = jotai.atom<boolean>(false);

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        this.service = new AISessionsServiceType(waveEnv);
    }

    get viewComponent(): ViewComponent {
        return AiSessionsView;
    }

    async loadSessions(refresh = false, sortDescending = false): Promise<void> {
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const response = await this.service.List({
                source: globalStore.get(this.sourceAtom),
                query: globalStore.get(this.queryAtom),
                limit: 200,
                refresh,
            });
            const sessions = response?.sessions ?? [];
            globalStore.set(this.sessionsAtom, sessions);
            const selectedKey = globalStore.get(this.selectedKeyAtom);
            const selectedStillExists = sessions.some((session) => session.key === selectedKey);
            if (!selectedStillExists) {
                const firstSession = sortSessionsByTime(sessions, sortDescending)[0];
                globalStore.set(this.selectedKeyAtom, firstSession?.key ?? "");
                globalStore.set(this.detailAtom, null);
            }
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    async loadDetail(session: SessionSummary): Promise<void> {
        if (!session?.key) {
            globalStore.set(this.detailAtom, null);
            return;
        }
        globalStore.set(this.selectedKeyAtom, session.key);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({ id: session.key });
            globalStore.set(this.detailAtom, detail);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.detailLoadingAtom, false);
        }
    }

    async toggleMark(session: SessionSummary): Promise<void> {
        if (!session?.key) return;
        try {
            const updated = await this.service.Mark(session.key, !session.marked);
            this.replaceSession(updated);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        }
    }

    async updateNote(session: SessionSummary, note: string): Promise<void> {
        if (!session?.key) return;
        try {
            const updated = await this.service.Note(session.key, note);
            this.replaceSession(updated);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        }
    }

    async deleteSession(session: SessionSummary): Promise<void> {
        if (!session?.key) return;
        globalStore.set(this.deletingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            await this.service.Delete(session.key);
            const sessions = globalStore.get(this.sessionsAtom).filter((item) => item.key !== session.key);
            globalStore.set(this.sessionsAtom, sessions);
            globalStore.set(this.detailAtom, null);
            globalStore.set(this.selectedKeyAtom, sessions[0]?.key ?? "");
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.deletingAtom, false);
        }
    }

    async restoreSession(session: SessionSummary): Promise<void> {
        if (!session?.id || !session?.source) return;
        globalStore.set(this.restoringAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const cmd = session.source === "claude" ? "claude" : "codex";
            const meta: MetaType = {
                view: "term",
                controller: "cmd",
                cmd,
                "cmd:shell": false,
                "cmd:runonstart": true,
                "agent:autoresume": true,
                "agent:provider": session.source,
                "agent:sessionid": session.id,
            };
            if (session.projectPath) {
                meta["cmd:cwd"] = session.projectPath;
            }
            await createBlock({
                meta,
            });
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.restoringAtom, false);
        }
    }

    async openSessionFolder(filePath: string): Promise<void> {
        const folderPath = dirname(filePath);
        if (!folderPath) return;
        const blockDef: BlockDef = {
            meta: {
                view: "preview",
                file: folderPath,
            },
        };
        try {
            await createBlockSplitHorizontally(blockDef, this.blockId, "after");
        } catch (e) {
            await createBlock(blockDef);
        }
    }

    replaceSession(updated: SessionSummary): void {
        const sessions = globalStore.get(this.sessionsAtom);
        globalStore.set(
            this.sessionsAtom,
            sessions.map((session) => (session.key === updated.key ? { ...session, ...updated } : session))
        );
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key === updated.key) {
            globalStore.set(this.detailAtom, { ...detail, summary: { ...detail.summary, ...updated } });
        }
    }
}

function AiSessionsView({ model }: ViewComponentProps<AiSessionsViewModel>) {
    const sessions = jotai.useAtomValue(model.sessionsAtom);
    const detail = jotai.useAtomValue(model.detailAtom);
    const selectedKey = jotai.useAtomValue(model.selectedKeyAtom);
    const source = jotai.useAtomValue(model.sourceAtom);
    const query = jotai.useAtomValue(model.queryAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const restoring = jotai.useAtomValue(model.restoringAtom);
    const deleting = jotai.useAtomValue(model.deletingAtom);
    const [sortDescending, setSortDescending] = useState(() => readSortPreference());
    const [sessionListCollapsed, setSessionListCollapsed] = useState(false);
    const visibleSessions = useMemo(() => sortSessionsByTime(sessions, sortDescending), [sessions, sortDescending]);
    const queryActive = query.trim().length > 0;
    const filterActive = queryActive || source !== "";
    const filterBusy = loading && filterActive;

    useEffect(() => {
        model.loadSessions(false, sortDescending);
    }, [model]);

    useEffect(() => {
        const handle = window.setTimeout(() => model.loadSessions(false, sortDescending), 200);
        return () => window.clearTimeout(handle);
    }, [model, query, source]);

    useEffect(() => {
        writeSortPreference(sortDescending);
    }, [sortDescending]);

    const selectedSession = visibleSessions.find((session) => session.key === selectedKey) ?? visibleSessions[0];

    useEffect(() => {
        if (selectedSession && detail?.summary?.key !== selectedSession.key && !detailLoading) {
            model.loadDetail(selectedSession);
        }
    }, [detail?.summary?.key, detailLoading, model, selectedSession]);

    const setSource = useCallback(
        (next: SourceFilter) => {
            globalStore.set(model.loadingAtom, true);
            globalStore.set(model.sourceAtom, next);
        },
        [model]
    );

    const setQuery = useCallback(
        (next: string) => {
            globalStore.set(model.loadingAtom, true);
            globalStore.set(model.queryAtom, next);
        },
        [model]
    );

    return (
        <div className="flex h-full w-full min-h-0 flex-col bg-panel text-primary">
            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/15 text-accent">
                        <i className="fa-sharp fa-solid fa-messages" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-medium leading-4">AI Sessions</div>
                        <div className="truncate text-xxs text-secondary">Codex and Claude Code local history</div>
                    </div>
                </div>
                <IconButton
                    icon={loading ? "fa-spinner animate-spin" : "fa-rotate"}
                    label="Refresh sessions"
                    onClick={() => model.loadSessions(true, sortDescending)}
                />
            </div>
            {error ? (
                <div className="shrink-0 border-b border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                    {error}
                </div>
            ) : null}
            <div
                className={cn(
                    "grid min-h-0 flex-1",
                    sessionListCollapsed ? "grid-cols-[44px_minmax(0,1fr)]" : "grid-cols-[320px_minmax(0,1fr)]"
                )}
            >
                <div className="flex min-h-0 flex-col border-r border-border">
                    {sessionListCollapsed ? (
                        <div className="flex h-full min-h-0 flex-col items-center gap-2 py-3">
                            <IconButton
                                icon="fa-chevron-right"
                                label="Expand sessions list"
                                onClick={() => setSessionListCollapsed(false)}
                            />
                            <div className="rotate-180 text-[10px] uppercase tracking-normal text-secondary [writing-mode:vertical-rl]">
                                Sessions
                            </div>
                            <div className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-secondary">
                                {visibleSessions.length}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2 border-b border-border p-3">
                                <div className="flex items-center gap-2">
                                    <div
                                        className={cn(
                                            "relative min-w-0 flex-1 rounded border",
                                            queryActive || filterBusy ? "border-accent bg-accent/5" : "border-border"
                                        )}
                                    >
                                        <i className="fa-sharp fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-secondary" />
                                        <input
                                            className="h-8 w-full bg-transparent pl-7 pr-7 text-sm outline-none"
                                            placeholder="Search title, note, path"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    void model.loadSessions(false, sortDescending);
                                                }
                                            }}
                                        />
                                        {filterBusy && queryActive ? (
                                            <i className="fa-sharp fa-solid fa-spinner absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-[11px] text-accent" />
                                        ) : null}
                                    </div>
                                    <IconButton
                                        icon="fa-chevron-left"
                                        label="Collapse sessions list"
                                        onClick={() => setSessionListCollapsed(true)}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex gap-1">
                                        <SourceButton
                                            label="All"
                                            active={source === ""}
                                            busy={filterBusy && source === ""}
                                            onClick={() => setSource("")}
                                        />
                                        <SourceButton
                                            label="Codex"
                                            active={source === "codex"}
                                            busy={filterBusy && source === "codex"}
                                            onClick={() => setSource("codex")}
                                        />
                                        <SourceButton
                                            label="Claude Code"
                                            active={source === "claude"}
                                            busy={filterBusy && source === "claude"}
                                            onClick={() => setSource("claude")}
                                        />
                                    </div>
                                    <SortButton
                                        descending={sortDescending}
                                        onToggle={() => setSortDescending((current) => !current)}
                                    />
                                </div>
                                <div className="flex h-5 items-center gap-2 text-[11px] text-secondary">
                                    {filterBusy ? (
                                        <>
                                            <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                                            <span>Filtering notes, titles, and paths...</span>
                                        </>
                                    ) : filterActive ? (
                                        <>
                                            <i className="fa-sharp fa-solid fa-filter text-accent" />
                                            <span>{visibleSessions.length} matching sessions</span>
                                        </>
                                    ) : (
                                        <span>Search includes notes.</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex h-5 items-center justify-between gap-2 text-[11px] text-secondary">
                                <span>{visibleSessions.length} sessions</span>
                                {loading && !filterActive ? (
                                    <span className="flex items-center gap-1">
                                        <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                                        Refreshing
                                    </span>
                                ) : null}
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                {loading && visibleSessions.length === 0 ? (
                                    <EmptyState text="Loading sessions..." />
                                ) : visibleSessions.length === 0 ? (
                                    <EmptyState text="No sessions found." />
                                ) : (
                                    visibleSessions.map((session) => (
                                        <SessionRow
                                            key={session.key}
                                            session={session}
                                            selected={session.key === selectedKey}
                                            onSelect={() => model.loadDetail(session)}
                                            onMark={(e) => {
                                                e.stopPropagation();
                                                model.toggleMark(session);
                                            }}
                                        />
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </div>
                <SessionDetailPane
                    model={model}
                    detail={detail}
                    loading={detailLoading}
                    restoring={restoring}
                    deleting={deleting}
                />
            </div>
        </div>
    );
}

function SourceButton({
    label,
    active,
    busy,
    onClick,
}: {
    label: string;
    active: boolean;
    busy?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={cn(
                "flex h-7 items-center gap-1 rounded border px-2 text-xs transition-colors",
                active
                    ? "border-accent bg-accent/10 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "border-border text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onClick}
        >
            {busy ? <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px] text-accent" /> : null}
            {label}
        </button>
    );
}

function SortButton({
    descending,
    onToggle,
}: {
    descending: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            className={cn(
                "h-7 shrink-0 rounded border px-2 text-xs",
                descending
                    ? "border-accent bg-accent/10 text-primary"
                    : "border-border text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onToggle}
            title={descending ? "Newest first" : "Oldest first"}
        >
            <i className={cn("fa-sharp fa-solid mr-1", descending ? "fa-arrow-down" : "fa-arrow-up")} />
            {descending ? "Newest" : "Oldest"}
        </button>
    );
}

function IconButton({
    icon,
    label,
    onClick,
    className,
    size = "sm",
    disabled = false,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    className?: string;
    size?: "xs" | "sm";
    disabled?: boolean;
}) {
    return (
        <button
            className={cn(
                "shrink-0 rounded border border-border text-secondary hover:bg-hover hover:text-primary",
                size === "xs" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs",
                disabled && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-secondary",
                className
            )}
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
        >
            <i className={cn("fa-sharp fa-solid", icon)} />
        </button>
    );
}

function CopyIconButton({
    text,
    label,
    className,
    size = "sm",
}: {
    text: string;
    label: string;
    className?: string;
    size?: "xs" | "sm";
}) {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

    useEffect(() => {
        if (status === "idle") return;
        const handle = window.setTimeout(() => setStatus("idle"), status === "copied" ? 1200 : 1600);
        return () => window.clearTimeout(handle);
    }, [status]);

    const statusLabel = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
    return (
        <IconButton
            icon={status === "copied" ? "fa-check" : status === "failed" ? "fa-triangle-exclamation" : "fa-copy"}
            label={statusLabel}
            size={size}
            className={cn(
                status === "copied" && "border-accent bg-accent/10 text-accent",
                status === "failed" && "border-error bg-error/10 text-error",
                className
            )}
            onClick={() => {
                void copyText(text)
                    .then(() => setStatus("copied"))
                    .catch(() => setStatus("failed"));
            }}
        />
    );
}

function SessionRow({
    session,
    selected,
    onSelect,
    onMark,
}: {
    session: SessionSummary;
    selected: boolean;
    onSelect: () => void;
    onMark: React.MouseEventHandler<HTMLButtonElement>;
}) {
    return (
        <div
            className={cn(
                "group cursor-pointer border-b border-border px-3 py-2 text-sm hover:bg-hover",
                selected && "bg-accent/10"
            )}
            onClick={onSelect}
        >
            <div className="flex min-w-0 items-start gap-2">
                <button className="mt-0.5 shrink-0 text-secondary hover:text-accent" title="Mark session" onClick={onMark}>
                    <i
                        className={cn(
                            "fa-sharp",
                            session.marked ? "fa-solid fa-star text-accent" : "fa-regular fa-star"
                        )}
                    />
                </button>
                <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</div>
                        {session.note ? (
                            <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                                Note
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xxs text-secondary">
                        <span className="uppercase">{session.source}</span>
                        <span>{formatDateTimeToSecond(session.updatedAt || session.createdAt || 0)}</span>
                        <span>{session.messageCount ?? 0} msgs</span>
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-secondary">{session.snippet}</div>
                    ) : null}
                    {session.note ? (
                        <div className="mt-1 line-clamp-1 border-l-2 border-accent/50 pl-2 text-xs text-primary">
                            {session.note}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function SessionDetailPane({
    model,
    detail,
    loading,
    restoring,
    deleting,
}: {
    model: AiSessionsViewModel;
    detail: SessionDetail | null;
    loading: boolean;
    restoring: boolean;
    deleting: boolean;
}) {
    const [noteDraft, setNoteDraft] = useState("");
    const [noteCollapsed, setNoteCollapsed] = useState(true);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [visibleMessageCount, setVisibleMessageCount] = useState(defaultVisibleMessageCount);
    const [collapsedMessages, setCollapsedMessages] = useState<Record<number, boolean>>({});
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingJumpSeqRef = useRef<number | null>(null);

    useEffect(() => {
        setNoteDraft(detail?.summary?.note ?? "");
    }, [detail?.summary?.key, detail?.summary?.note]);

    useEffect(() => {
        messageRefs.current = {};
        pendingJumpSeqRef.current = null;
        setDeleteConfirmOpen(false);
        setNoteCollapsed(true);
        setCollapsedMessages({});
        setVisibleMessageCount(defaultVisibleMessageCount);
    }, [detail?.summary?.key]);

    const readableMessages = useMemo(
        () => (detail?.messages ?? []).filter((message) => isReadableMessage(message)),
        [detail?.messages]
    );
    const detailMessages = useMemo(
        () => readableMessages.slice(-visibleMessageCount),
        [readableMessages, visibleMessageCount]
    );
    const outlineMessages = useMemo(
        () => readableMessages.filter((message) => message.role === "user"),
        [readableMessages]
    );
    const hasPreviousMessages = visibleMessageCount < readableMessages.length;
    const firstVisibleMessage = detailMessages[0];
    const lastVisibleMessage = detailMessages[detailMessages.length - 1];

    const scrollToVisibleMessage = useCallback((seq: number) => {
        const node = messageRefs.current[seq];
        const container = detailScrollRef.current;
        if (node && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            const top = nodeRect.top - containerRect.top + container.scrollTop - 12;
            container.scrollTo({ top, behavior: "smooth" });
            return;
        }
        node?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []);

    const loadPreviousMessages = useCallback(() => {
        setVisibleMessageCount((current) => Math.min(current + visibleMessageCountStep, readableMessages.length));
    }, [readableMessages.length]);

    const toggleMessageCollapsed = useCallback((seq: number) => {
        setCollapsedMessages((current) => ({ ...current, [seq]: !current[seq] }));
    }, []);

    const jumpToMessage = useCallback(
        (seq: number) => {
            if (messageRefs.current[seq]) {
                scrollToVisibleMessage(seq);
                return;
            }
            const targetIndex = readableMessages.findIndex((message) => message.seq === seq);
            if (targetIndex < 0) return;
            pendingJumpSeqRef.current = seq;
            setVisibleMessageCount((current) => Math.max(current, readableMessages.length - targetIndex));
        },
        [readableMessages, scrollToVisibleMessage]
    );

    useEffect(() => {
        const pendingSeq = pendingJumpSeqRef.current;
        if (pendingSeq == null || !messageRefs.current[pendingSeq]) return;
        pendingJumpSeqRef.current = null;
        window.requestAnimationFrame(() => scrollToVisibleMessage(pendingSeq));
    }, [detailMessages, scrollToVisibleMessage]);

    if (loading && detail == null) {
        return <EmptyState text="Loading detail..." />;
    }
    if (detail == null) {
        return <EmptyState text="Select a session to view details." />;
    }
    const summary = detail.summary;
    return (
        <div className="relative flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{summary.title || summary.id}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-3 text-xxs text-secondary">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <i
                                    className={cn(
                                        "fa-sharp fa-solid shrink-0",
                                        summary.projectPath ? "fa-folder" : "fa-file-lines"
                                    )}
                                />
                                <span className="min-w-0 truncate">{summary.projectPath || summary.filePath}</span>
                                <CopyIconButton
                                    text={summary.filePath}
                                    label="Copy session file path"
                                    size="xs"
                                />
                                <IconButton
                                    icon="fa-folder-open"
                                    label="Open session folder in files"
                                    size="xs"
                                    onClick={() => void model.openSessionFolder(summary.filePath)}
                                />
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <i className="fa-sharp fa-solid fa-fingerprint shrink-0" />
                                <span className="shrink-0">ID: {shortSessionId(summary.id)}</span>
                                <CopyIconButton
                                    text={summary.id}
                                    label="Copy session ID"
                                    size="xs"
                                />
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs">
                            <button
                                className="flex h-7 items-center gap-2 rounded border border-accent bg-accent px-2 text-white hover:bg-accent/90 disabled:opacity-60"
                                disabled={restoring}
                                onClick={() => void model.restoreSession(summary)}
                            >
                                <i className="fa-sharp fa-solid fa-rotate-left" />
                                <span>{restoring ? "Resuming..." : "Resume session"}</span>
                            </button>
                            <CopyIconButton
                                text={restoreCommandForSession(summary)}
                                label="Copy resume command"
                            />
                            <CopyIconButton
                                text={renderConversationText(detail, detailMessages)}
                                label="Copy shown messages"
                            />
                            <IconButton
                                icon="fa-trash"
                                label="Delete session"
                                className={deleteConfirmOpen ? "border-error text-error" : ""}
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(true)}
                            />
                        </div>
                        {deleteConfirmOpen ? (
                            <div className="mt-2 flex items-center justify-between gap-3 rounded border border-error/40 bg-error/10 px-2 py-2 text-xs">
                                <div className="min-w-0 text-error">
                                    Delete this session? The source file will be moved to deleted storage.
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        className="h-7 rounded border border-border px-2 text-secondary hover:bg-hover hover:text-primary"
                                        disabled={deleting}
                                        onClick={() => setDeleteConfirmOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="flex h-7 items-center gap-2 rounded border border-error bg-error px-2 text-white disabled:opacity-60"
                                        disabled={deleting}
                                        onClick={() => void model.deleteSession(summary)}
                                    >
                                        <i className={cn("fa-sharp fa-solid", deleting ? "fa-spinner animate-spin" : "fa-trash")} />
                                        <span>{deleting ? "Deleting..." : "Delete"}</span>
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                        <button
                            className={cn(
                                "h-7 w-7 shrink-0 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary",
                                summary.marked && "border-accent bg-accent/10 text-accent"
                            )}
                            title={summary.marked ? "Unmark session" : "Mark session"}
                            aria-label={summary.marked ? "Unmark session" : "Mark session"}
                            onClick={() => void model.toggleMark(summary)}
                        >
                            <i className={cn("fa-sharp", summary.marked ? "fa-solid fa-star" : "fa-regular fa-star")} />
                        </button>
                        <div className="text-xxs uppercase text-secondary">{summary.source}</div>
                    </div>
                </div>
                <div className="mt-2">
                    <div className="flex h-8 items-center justify-between gap-2 px-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="text-xxs uppercase text-secondary">Note:</div>
                            {summary.note ? (
                                <div className="min-w-0 truncate text-xs text-secondary">{summary.note}</div>
                            ) : null}
                        </div>
                        <IconButton
                            icon={noteCollapsed ? "fa-chevron-down" : "fa-chevron-up"}
                            label={noteCollapsed ? "Expand note" : "Collapse note"}
                            size="xs"
                            onClick={() => setNoteCollapsed((current) => !current)}
                        />
                    </div>
                    {!noteCollapsed ? (
                        <div className="space-y-2 px-2 pb-2">
                            <textarea
                                className="min-h-[72px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
                                placeholder="Add a note"
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                            />
                            <div className="flex items-center gap-2">
                                <IconButton
                                    icon="fa-floppy-disk"
                                    label="Save note"
                                    onClick={() => void model.updateNote(summary, noteDraft.trim())}
                                />
                                <IconButton
                                    icon="fa-eraser"
                                    label="Clear note"
                                    onClick={() => {
                                        setNoteDraft("");
                                        void model.updateNote(summary, "");
                                    }}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="relative min-h-0 flex-1">
                <div className={cn("flex h-full min-h-0", outlineOpen && "pr-0")}>
                    <div ref={detailScrollRef} className="min-h-0 flex-1 overflow-auto p-3">
                        {detailMessages.length === 0 ? (
                            <EmptyState text="No readable messages." />
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2 text-xs text-secondary">
                                    <div>
                                        Showing #{firstVisibleMessage?.seq ?? 0}-#{lastVisibleMessage?.seq ?? 0} of{" "}
                                        {readableMessages.length}
                                    </div>
                                    {hasPreviousMessages ? (
                                        <button
                                            className="h-7 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                            onClick={loadPreviousMessages}
                                        >
                                            Load previous messages
                                        </button>
                                    ) : (
                                        <div className="text-xxs uppercase text-secondary">Start reached</div>
                                    )}
                                </div>
                                {detailMessages.map((message) => (
                                    <MessageCard
                                        key={message.seq}
                                        message={message}
                                        collapsed={Boolean(collapsedMessages[message.seq])}
                                        onToggleCollapsed={() => toggleMessageCollapsed(message.seq)}
                                        registerRef={(node) => {
                                            messageRefs.current[message.seq] = node;
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    {outlineOpen ? (
                        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-panel">
                            <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
                                <div className="text-xxs uppercase text-secondary">Outline</div>
                                <IconButton
                                    icon="fa-chevron-right"
                                    label="Collapse outline"
                                    onClick={() => setOutlineOpen(false)}
                                />
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto p-2">
                                {outlineMessages.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-secondary">No readable messages.</div>
                                ) : (
                                    <div className="space-y-1">
                                        {outlineMessages.map((message, index) => (
                                            <button
                                                key={message.seq}
                                                className={cn(
                                                    "flex w-full items-start gap-2 rounded border px-2 py-2 text-left text-xs hover:bg-hover",
                                                    outlineRoleClass(message)
                                                )}
                                                onClick={() => jumpToMessage(message.seq)}
                                            >
                                                <span className="mt-0.5 shrink-0 text-[10px] uppercase text-secondary">
                                                    {index + 1}
                                                </span>
                                                <span className="min-w-0 flex-1 break-words text-primary">
                                                    {outlinePreview(message)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </aside>
                    ) : (
                        <button
                            className="absolute right-3 top-3 z-10 flex h-10 items-center gap-2 rounded-full border border-border bg-panel px-3 text-xs text-primary shadow-lg hover:bg-hover"
                            title="Outline"
                            aria-label="Outline"
                            onClick={() => setOutlineOpen(true)}
                        >
                            <i className="fa-sharp fa-solid fa-list" />
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                                {outlineMessages.length}
                            </span>
                        </button>
                    )}
                </div>
            </div>
            {loading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/70 backdrop-blur-[1px]">
                    <div className="rounded border border-border bg-bg px-3 py-2 text-xs text-secondary shadow-lg">
                        Loading session detail...
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MessageCard({
    message,
    collapsed,
    onToggleCollapsed,
    registerRef,
}: {
    message: Message;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    registerRef: (node: HTMLDivElement | null) => void;
}) {
    const isUser = message.role === "user";
    const collapsible = isCollapsibleMessage(message.text);
    const shownText = collapsed && collapsible ? collapsedMessagePreview(message.text) : trimMessageText(message.text);
    return (
        <div
            ref={registerRef}
            id={`aisession-message-${message.seq}`}
            className={cn(
                "max-w-[92%] scroll-mt-3 rounded border p-3",
                collapsible && "cursor-pointer",
                isUser ? "ml-auto border-accent/35 bg-accent/10" : "mr-auto border-border bg-bg"
            )}
            title={collapsible ? (collapsed ? "Double-click to expand" : "Double-click to collapse") : undefined}
            onDoubleClick={collapsible ? onToggleCollapsed : undefined}
        >
            <div className={cn("mb-2 flex items-center gap-2 text-xxs text-secondary", isUser && "justify-end")}>
                <span className={cn("font-medium uppercase", isUser && "text-accent")}>{message.role}</span>
                <span>#{message.seq}</span>
                {message.timestamp ? <span>{formatDateTimeToSecond(message.timestamp)}</span> : null}
                {collapsible ? (
                    <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary">
                        <i className={cn("fa-sharp fa-solid", collapsed ? "fa-chevron-down" : "fa-chevron-up")} />
                        {collapsed ? "Collapsed" : "Double-click"}
                    </span>
                ) : null}
                <CopyIconButton
                    text={message.text}
                    label="Copy message"
                    className="ml-auto"
                    size="xs"
                />
            </div>
            <div className={cn("whitespace-pre-wrap break-words text-xs leading-5", isUser && "text-primary")}>
                {shownText}
            </div>
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-secondary">
            {text}
        </div>
    );
}

function trimMessageText(text: string): string {
    if (!text) return "";
    if (text.length <= 2400) return text;
    return text.slice(0, 2400) + "\n...";
}

function isCollapsibleMessage(text: string): boolean {
    if (!text) return false;
    if (text.length >= collapsibleMessageCharCount) return true;
    return text.split(/\r\n|\r|\n/).length >= collapsibleMessageLineCount;
}

function collapsedMessagePreview(text: string): string {
    const normalized = text.trim();
    if (normalized.length <= collapsedMessagePreviewLength) return normalized;
    return normalized.slice(0, collapsedMessagePreviewLength).trimEnd() + "\n...";
}

function isReadableMessage(message: Message): boolean {
    const text = message.text.trim();
    if (!text) return false;
    if (message.role === "tool") return false;
    if (/^\[Tool:\s*[^\]]+\]$/.test(text)) return false;
    return true;
}

function outlinePreview(message: Message): string {
    const text = trimMessageText(message.text).replace(/\s+/g, " ").trim();
    if (!text) return "(empty)";
    if (text.length <= 96) return text;
    return text.slice(0, 96) + "...";
}

function outlineRoleClass(message: Message): string {
    switch (message.role) {
        case "user":
            return "border-l-2 border-accent/30 bg-accent/10 pl-2";
        case "assistant":
            return "border-l-2 border-border bg-bg pl-3";
        case "system":
            return "border-l-2 border-border/70 bg-bg/60 pl-4 text-secondary";
        default:
            return "border-l-2 border-border bg-bg pl-3";
    }
}

function sortSessionsByTime(sessions: SessionSummary[], descending: boolean): SessionSummary[] {
    return [...sessions].sort((left, right) => {
        const leftTime = sessionSortTime(left);
        const rightTime = sessionSortTime(right);
        if (leftTime === rightTime) {
            return left.key.localeCompare(right.key);
        }
        return descending ? rightTime - leftTime : leftTime - rightTime;
    });
}

function sessionSortTime(session: SessionSummary): number {
    return session.updatedAt || session.createdAt || 0;
}

function readSortPreference(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(sortPreferenceStorageKey) === "1";
}

function writeSortPreference(descending: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sortPreferenceStorageKey, descending ? "1" : "0");
}

async function copyText(text: string): Promise<void> {
    if (!text) return;
    if (navigator?.clipboard?.writeText != null) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

function dirname(path: string): string {
    const normalized = path.trim();
    if (!normalized) return "";
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    if (idx <= 0) return normalized;
    return normalized.slice(0, idx);
}

function renderConversationText(detail: SessionDetail, messages: Message[]): string {
    const header = [
        `Title: ${detail.summary.title || detail.summary.id}`,
        `Session ID: ${detail.summary.id}`,
        `Source: ${detail.summary.source}`,
        detail.summary.projectPath ? `Project: ${detail.summary.projectPath}` : "",
        detail.summary.filePath ? `Path: ${detail.summary.filePath}` : "",
    ].filter(Boolean);
    const body = messages
        .map((message) => {
            const timestamp = message.timestamp ? ` ${formatDateTimeToSecond(message.timestamp)}` : "";
            return `[${message.role} #${message.seq}${timestamp}]\n${message.text}`;
        })
        .join("\n\n");
    return `${header.join("\n")}\n\n${body}`.trim();
}

function restoreCommandForSession(summary: SessionSummary): string {
    if (summary.source === "claude") {
        return `claude --resume ${summary.id}`;
    }
    return `codex resume ${summary.id}`;
}

function shortSessionId(id: string): string {
    if (!id) return "";
    if (id.length <= 14) return id;
    return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function formatDateTimeToSecond(timestamp: number): string {
    if (!timestamp) return "never";
    const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "invalid time";
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hour = pad2(date.getHours());
    const minute = pad2(date.getMinutes());
    const second = pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}
