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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClaudeLogo, IconButton, OpenAILogo, SortButton, SourceButton } from "./controls";
import { EmptyState } from "./empty-state";
import { SessionDetailPane } from "./session-detail";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "./session-note-events";
import { SessionRow } from "./session-row";
import type { SourceFilter } from "./types";
import {
    dirname,
    emptySessionsText,
    getErrorMessage,
    readSortPreference,
    sortSessionsByTime,
    writeSortPreference,
} from "./utils";

export class AiSessionsViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveEnv;
    service: AISessionsServiceType;
    blockAtom: jotai.Atom<Block>;
    viewType = "aisessions";
    viewIcon = jotai.atom("comments");
    viewName = jotai.atom("AI Sessions");
    noPadding = jotai.atom(true);

    sortDescendingAtom = jotai.atom<boolean>(readSortPreference());
    sessionsAtom = jotai.atom<SessionSummary[]>([]);
    detailAtom: jotai.PrimitiveAtom<SessionDetail | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<SessionDetail | null>;
    selectedKeyAtom = jotai.atom<string>("");
    sourceAtom = jotai.atom<SourceFilter>("");
    queryAtom = jotai.atom<string>("");
    loadingAtom = jotai.atom<boolean>(true);
    detailLoadingAtom = jotai.atom<boolean>(false);
    toolCallsLoadingAtom = jotai.atom<boolean>(false);
    errorAtom = jotai.atom<string>("");
    restoringAtom = jotai.atom<boolean>(false);
    deletingAtom = jotai.atom<boolean>(false);
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    sessionsLoadSeq = 0;
    markRequestSeqByKey = new Map<string, number>();

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        this.service = new AISessionsServiceType(waveEnv);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.endIconButtons = jotai.atom((get) => {
            const loading = get(this.loadingAtom);
            return [
                {
                    elemtype: "iconbutton",
                    icon: loading ? "spinner" : "arrows-rotate",
                    iconSpin: loading,
                    title: "Refresh sessions",
                    disabled: loading,
                    click: () => {
                        void this.loadSessions(true, globalStore.get(this.sortDescendingAtom));
                    },
                },
            ];
        });
    }

    get viewComponent(): ViewComponent {
        return AiSessionsView;
    }

    async loadSessions(refresh = false, sortDescending = false): Promise<void> {
        const loadSeq = ++this.sessionsLoadSeq;
        const source = globalStore.get(this.sourceAtom);
        const query = globalStore.get(this.queryAtom);
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const response = await this.service.List({
                source,
                query,
                limit: 200,
                refresh,
            });
            if (!this.isCurrentSessionsLoad(loadSeq, source, query)) {
                return;
            }
            const sessions = response?.sessions ?? [];
            globalStore.set(this.sessionsAtom, sessions);
            const selectedKey = globalStore.get(this.selectedKeyAtom);
            const selectedStillExists = sessions.some((session) => session.key === selectedKey);
            if (!selectedStillExists) {
                const boundSessionId = selectedKey === "" ? this.getBoundSessionId() : "";
                const boundSession = findSessionById(sessions, boundSessionId);
                if (boundSession != null) {
                    globalStore.set(this.selectedKeyAtom, boundSession.key);
                    globalStore.set(this.detailAtom, null);
                } else if (boundSessionId !== "" && (await this.loadDetailById(boundSessionId, refresh))) {
                    return;
                } else {
                    const firstSession = sortSessionsByTime(sessions, sortDescending)[0];
                    globalStore.set(this.selectedKeyAtom, firstSession?.key ?? "");
                    globalStore.set(this.detailAtom, null);
                }
            }
        } catch (e) {
            if (this.isCurrentSessionsLoad(loadSeq, source, query)) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
        } finally {
            if (this.isCurrentSessionsLoad(loadSeq, source, query)) {
                globalStore.set(this.loadingAtom, false);
            }
        }
    }

    isCurrentSessionsLoad(loadSeq: number, source: SourceFilter, query: string): boolean {
        return (
            loadSeq === this.sessionsLoadSeq &&
            globalStore.get(this.sourceAtom) === source &&
            globalStore.get(this.queryAtom) === query
        );
    }

    getBoundSessionId(): string {
        const blockData = globalStore.get(this.blockAtom);
        const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
        const sessionId = meta["aisessions:sessionid"] ?? meta["agent:sessionid"];
        return typeof sessionId === "string" ? sessionId.trim() : "";
    }

    async loadDetail(session: SessionSummary, refresh = false): Promise<void> {
        if (!session?.key) {
            globalStore.set(this.detailAtom, null);
            return;
        }
        globalStore.set(this.selectedKeyAtom, session.key);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({ id: session.key, refresh });
            globalStore.set(this.detailAtom, detail);
            this.replaceSession(detail.summary);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.detailLoadingAtom, false);
        }
    }

    async loadDetailTools(refresh = false): Promise<void> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        if (!currentSummary?.key) {
            return;
        }
        globalStore.set(this.toolCallsLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({ id: currentSummary.key, refresh, includeTools: true });
            globalStore.set(this.detailAtom, detail);
            this.replaceSession(detail.summary);
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.toolCallsLoadingAtom, false);
        }
    }

    async loadDetailById(sessionId: string, refresh = false): Promise<boolean> {
        const trimmedSessionId = sessionId.trim();
        if (trimmedSessionId === "") return false;
        globalStore.set(this.selectedKeyAtom, trimmedSessionId);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({ id: trimmedSessionId, refresh });
            globalStore.set(this.selectedKeyAtom, detail.summary.key);
            globalStore.set(this.detailAtom, detail);
            this.replaceSession(detail.summary);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
        } finally {
            globalStore.set(this.detailLoadingAtom, false);
        }
    }

    async toggleMark(session: SessionSummary): Promise<void> {
        if (!session?.key) return;
        const currentSession = this.getCurrentSession(session.key) ?? session;
        const nextMarked = !currentSession.marked;
        const requestSeq = (this.markRequestSeqByKey.get(session.key) ?? 0) + 1;
        this.markRequestSeqByKey.set(session.key, requestSeq);
        globalStore.set(this.errorAtom, "");
        this.setSessionMarked(session.key, nextMarked);
        Promise.resolve()
            .then(() => this.service.Mark(session.key, nextMarked))
            .then((updated) => {
                if (this.markRequestSeqByKey.get(session.key) !== requestSeq) {
                    return;
                }
                this.markRequestSeqByKey.delete(session.key);
                this.replaceSession(updated);
            })
            .catch((e) => {
                if (this.markRequestSeqByKey.get(session.key) !== requestSeq) {
                    return;
                }
                this.markRequestSeqByKey.delete(session.key);
                this.setSessionMarked(session.key, !!currentSession.marked);
                globalStore.set(this.errorAtom, getErrorMessage(e));
            });
    }

    getCurrentSession(sessionKey: string): SessionSummary | null {
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key === sessionKey) {
            return detail.summary;
        }
        return globalStore.get(this.sessionsAtom).find((item) => item.key === sessionKey) ?? null;
    }

    setSessionMarked(sessionKey: string, marked: boolean): void {
        const sessions = globalStore.get(this.sessionsAtom);
        globalStore.set(
            this.sessionsAtom,
            sessions.map((item) => (item.key === sessionKey ? { ...item, marked } : item))
        );
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key === sessionKey) {
            globalStore.set(this.detailAtom, { ...detail, summary: { ...detail.summary, marked } });
        }
    }

    async updateNote(session: SessionSummary, note: string): Promise<boolean> {
        if (!session?.key) return false;
        try {
            const updated = await this.service.Note(session.key, note);
            this.replaceSession(updated);
            dispatchAISessionNoteUpdated(updated);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
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
            const meta: MetaType & Record<string, unknown> = {
                view: "term",
                controller: "cmd",
                cmd,
                "cmd:shell": false,
                "cmd:runonstart": true,
                "cmd:jwt": true,
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

    async openSessionFolder(summary: SessionSummary): Promise<void> {
        const folderPath = summary.projectPath || dirname(summary.filePath);
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

function findSessionById(sessions: SessionSummary[], sessionId: string): SessionSummary | null {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") return null;
    return sessions.find((session) => session.key === trimmedSessionId || session.id === trimmedSessionId) ?? null;
}

function AiSessionsView({ model }: ViewComponentProps<AiSessionsViewModel>) {
    const sessions = jotai.useAtomValue(model.sessionsAtom);
    const detail = jotai.useAtomValue(model.detailAtom);
    const selectedKey = jotai.useAtomValue(model.selectedKeyAtom);
    const source = jotai.useAtomValue(model.sourceAtom);
    const query = jotai.useAtomValue(model.queryAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);
    const toolCallsLoading = jotai.useAtomValue(model.toolCallsLoadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const restoring = jotai.useAtomValue(model.restoringAtom);
    const deleting = jotai.useAtomValue(model.deletingAtom);
    const [sortDescending, setSortDescending] = jotai.useAtom(model.sortDescendingAtom);
    const [sessionListCollapsed, setSessionListCollapsed] = useState(false);
    const [markedOnly, setMarkedOnly] = useState(false);
    const visibleSessions = useMemo(() => {
        const filteredSessions = markedOnly ? sessions.filter((session) => session.marked) : sessions;
        return sortSessionsByTime(filteredSessions, sortDescending);
    }, [markedOnly, sessions, sortDescending]);
    const queryActive = query.trim().length > 0;
    const remoteFilterActive = queryActive || source !== "";
    const filterActive = remoteFilterActive || markedOnly;
    const filterBusy = loading && remoteFilterActive;

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

    useEffect(() => {
        const handleNoteUpdated = (event: Event) => {
            if (isAISessionNoteUpdatedEvent(event)) {
                model.replaceSession(event.detail.summary);
            }
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, [model]);

    const selectedSession = visibleSessions.find((session) => session.key === selectedKey);
    const fallbackSession = selectedKey === "" ? visibleSessions[0] : null;
    const activeSession = selectedSession ?? fallbackSession;

    useEffect(() => {
        if (activeSession && detail?.summary?.key !== activeSession.key && !detailLoading) {
            model.loadDetail(activeSession);
        }
    }, [activeSession, detail?.summary?.key, detailLoading, model]);

    useEffect(() => {
        if (!loading && visibleSessions.length === 0 && detail != null) {
            globalStore.set(model.selectedKeyAtom, "");
            globalStore.set(model.detailAtom, null);
        }
    }, [detail, loading, model, visibleSessions.length]);

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
                                            icon={<OpenAILogo />}
                                            active={source === "codex"}
                                            busy={filterBusy && source === "codex"}
                                            onClick={() => setSource("codex")}
                                        />
                                        <SourceButton
                                            label="Claude Code"
                                            icon={<ClaudeLogo />}
                                            active={source === "claude"}
                                            busy={filterBusy && source === "claude"}
                                            onClick={() => setSource("claude")}
                                        />
                                        <SourceButton
                                            label="Marked"
                                            icon={<i className="fa-sharp fa-solid fa-star" />}
                                            active={markedOnly}
                                            onClick={() => setMarkedOnly((current) => !current)}
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
                                            <span>
                                                {visibleSessions.length} {markedOnly ? "marked " : ""}matching sessions
                                            </span>
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
                                    <EmptyState text={emptySessionsText(markedOnly, remoteFilterActive)} />
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
                                            onNoteSave={(note) => model.updateNote(session, note)}
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
                    toolCallsLoading={toolCallsLoading}
                    restoring={restoring}
                    deleting={deleting}
                />
            </div>
        </div>
    );
}
