// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { restoreMinimizedBlockToLayout } from "@/app/block/block-minimize";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { AISessionsServiceType } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { getLayoutModelForTabById } from "@/layout/index";
import { createBlock, createBlockSplitHorizontally, refocusNode, setActiveTab } from "@/store/global";
import { globalStore } from "@/store/jotaiStore";
import { RefreshStatusIcon, deriveRefreshStatus } from "@/app/element/refresh-status-icon";
import type { RefreshStatus } from "@/app/element/refresh-status-icon";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../session-overview/session-overview.scss";
import { IconButton, SortButton, GroupModeSwitch, type ListGroupMode } from "./controls";
import { defaultChatSource } from "./sources";
import { EmptyState } from "./empty-state";
import { FilterPanel } from "./filter-panel";
import { SessionDetailPane } from "./session-detail";
import { mergeSessionTimeline } from "./session-timeline-sync";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "./session-note-events";
import { SessionRow } from "./session-row";
import { GroupedSessionList, SessionGroup, readCollapsedGroups, writeCollapsedGroups } from "./session-group";
import { normalizeSessionTags } from "./session-tags";
import type { DateRangeFilter, MarkedFilter, PathFilter, SourceFilter, TagPresenceFilter } from "./types";
import {
    DefaultDateRange,
    DefaultPathFilter,
    DefaultTagPresence,
    NewSessionKey,
    PathFilterOtherRoot,
    dateRangeToSinceBefore,
} from "./types";
import { useSessionsRunning, type SessionRunningState } from "./use-sessions-running";
import {
    emptySessionsText,
    extractPathChildren,
    extractPathRoots,
    formatDateTimeToSecond,
    formatRelativeRefreshTime,
    getErrorMessage,
    groupSessionsByProject,
    otherRootMatcher,
    pathAncestorSegments,
    pathFilterEqual,
    pathFilterToPrefix,
    readGroupPreference,
    readSortPreference,
    restoreMetaForSession,
    shouldStartEmptyChat,
    sortSessionsByTime,
    writeGroupPreference,
    writeSortPreference,
} from "./utils";

function jumpToRunningSessionBlock(runningState: SessionRunningState): void {
    const { blockId, tabId } = runningState;
    if (blockId === "" || tabId === "") return;

    const layoutModel = getLayoutModelForTabById(tabId);
    if (layoutModel == null) return;
    if (layoutModel.getNodeByBlockId(blockId) == null) {
        restoreMinimizedBlockToLayout(tabId, blockId);
    }
    if (layoutModel.isBlockHidden(blockId)) {
        layoutModel.showBlock(blockId);
    }

    setActiveTab(tabId);
    window.setTimeout(() => refocusNode(blockId), 80);
    window.setTimeout(() => refocusNode(blockId), 220);
}

export class AiSessionsViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveEnv;
    service: AISessionsServiceType;
    blockAtom: jotai.Atom<Block>;
    viewType = "aisessions";
    viewIcon = jotai.atom("comments");
    // 头栏不再显示视图名文字（AI Chat / AI Sessions），仅保留图标
    viewName = jotai.atom("");
    hideViewName = jotai.atom(true);
    noPadding = jotai.atom(true);

    sortDescendingAtom = jotai.atom<boolean>(readSortPreference());
    groupModeAtom = jotai.atom<ListGroupMode>(readGroupPreference());
    sessionsAtom = jotai.atom<SessionSummary[]>([]);
    detailAtom: jotai.PrimitiveAtom<SessionDetail | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<SessionDetail | null>;
    selectedKeyAtom = jotai.atom<string>("");
    sourceAtom = jotai.atom<SourceFilter>("");
    queryAtom = jotai.atom<string>("");
    tagFiltersAtom = jotai.atom<string[]>([]);
    tagPresenceAtom = jotai.atom<TagPresenceFilter>(DefaultTagPresence);
    markedFilterAtom = jotai.atom<MarkedFilter>("all");
    dateRangeAtom = jotai.atom(DefaultDateRange) as jotai.PrimitiveAtom<DateRangeFilter>;
    pathFilterAtom = jotai.atom<PathFilter>(DefaultPathFilter) as jotai.PrimitiveAtom<PathFilter>;
    filtersOpenAtom = jotai.atom<boolean>(false);
    availableTagsAtom = jotai.atom<SessionTagSummary[]>([]);
    projectPathsAtom = jotai.atom<ProjectPathSummary[]>([]);
    loadingAtom = jotai.atom<boolean>(true);
    detailLoadingAtom = jotai.atom<boolean>(false);
    detailDeltaLoadingAtom = jotai.atom<boolean>(false);
    toolCallsLoadingAtom = jotai.atom<boolean>(false);
    errorAtom = jotai.atom<string>("");
    historySyncErrorAtom = jotai.atom<string>("");
    restoringAtom = jotai.atom<boolean>(false);
    newSessionAtom: jotai.PrimitiveAtom<SessionSummary | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        SessionSummary | null
    >;
    // 每次 startNewSession 自增：详情面板按世代作废上一轮 New Chat 的绑定与残留
    newChatEpochAtom = jotai.atom(0);
    deletingAtom = jotai.atom<boolean>(false);
    lastSessionsRefreshAtAtom = jotai.atom<number>(0);
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    sessionsLoadSeq = 0;
    detailLoadSeq = 0;
    detailToolsLoadSeq = 0;
    markRequestSeqByKey = new Map<string, number>();

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        this.service = new AISessionsServiceType(waveEnv);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.endIconButtons = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const loading = get(this.loadingAtom);
            const autoRefreshMs = normalizeAutoRefreshIntervalMs(
                blockData?.meta?.[AutoRefreshIntervalMetaKey]
            );
            const autoRefreshEnabled = this.getConnection() === "";
            const refreshStatus: RefreshStatus = deriveRefreshStatus({
                loading,
                autoRefreshEnabled,
                autoRefreshIntervalMs: autoRefreshMs,
                lastRefreshAt: get(this.lastSessionsRefreshAtAtom),
                error: get(this.errorAtom),
                now: Date.now(),
            });
            return [
                {
                    elemtype: "iconbutton",
                    icon: (
                        <RefreshStatusIcon
                            status={refreshStatus}
                            lastRefreshAt={get(this.lastSessionsRefreshAtAtom)}
                            autoRefreshIntervalMs={autoRefreshEnabled ? autoRefreshMs : 0}
                        />
                    ),
                    iconSpin: loading,
                    title: loading ? "Refreshing sessions…" : "Refresh sessions",
                    disabled: loading,
                    zone: "pinned",
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

    getAutoRefreshIntervalMs(): number {
        const blockData = globalStore.get(this.blockAtom);
        return normalizeAutoRefreshIntervalMs(blockData?.meta?.[AutoRefreshIntervalMetaKey]);
    }

    setAutoRefreshIntervalMs(intervalMs: number): void {
        const normalized = normalizeAutoRefreshIntervalMs(intervalMs);
        const metaUpdate = {
            [AutoRefreshIntervalMetaKey]: normalized === DefaultAutoRefreshIntervalMs ? null : normalized,
        } as MetaType;
        void RpcApi.SetMetaCommand(TabRpcClient, {
            oref: `block:${this.blockId}`,
            meta: metaUpdate,
        });
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const currentInterval = this.getAutoRefreshIntervalMs();
        return [
            {
                label: "Auto Refresh",
                type: "submenu",
                submenu: [
                    ...AutoRefreshIntervalOptions.map((option) => ({
                        label: option.label,
                        type: "radio" as const,
                        checked: currentInterval === option.value,
                        click: () => this.setAutoRefreshIntervalMs(option.value),
                    })),
                    ...customAutoRefreshMenuItems(currentInterval, this),
                ],
            },
        ];
    }

    // Start a transient "new chat" placeholder. The real session id is only
    // assigned by pi after the first message; bindNewSession promotes it then.
    startNewSession(): void {
        const existing = globalStore.get(this.newSessionAtom);
        // 无论是否已有占位，每次点击都视为新一轮：epoch 自增触发面板重置
        globalStore.set(this.newChatEpochAtom, globalStore.get(this.newChatEpochAtom) + 1);
        if (existing != null) {
            globalStore.set(this.selectedKeyAtom, NewSessionKey);
            globalStore.set(this.detailAtom, null);
            return;
        }
        globalStore.set(this.newSessionAtom, { key: NewSessionKey, id: "", source: defaultChatSource().id, title: "New Chat" });
        globalStore.set(this.selectedKeyAtom, NewSessionKey);
        globalStore.set(this.detailAtom, null);
    }

    // Called when the chat stream reports a freshly assigned session id.
    bindNewSession(sessionId: string): void {
        const placeholder = globalStore.get(this.newSessionAtom);
        if (placeholder == null || placeholder.id !== "" || sessionId === "") return;
        globalStore.set(this.newSessionAtom, { ...placeholder, id: sessionId });
        void RpcApi.SetMetaCommand(TabRpcClient, {
            oref: `block:${this.blockId}`,
            meta: {
                "aisessions:sessionid": sessionId,
                "aisessions:newchat": null,
            } as MetaType,
        }).catch(() => undefined);
        // Session promotion is deliberately fire-and-forget: the live turn remains
        // the primary UI while summary/history and the left list catch up.
        void this.promoteNewSession(sessionId);
    }

    async promoteNewSession(sessionId: string, attempt = 0): Promise<void> {
        try {
            const summary = await this.service.Summary({
                id: sessionId,
                connection: this.getConnection(),
                refresh: true,
            });
            const placeholder = globalStore.get(this.newSessionAtom);
            if (placeholder == null || placeholder.id !== sessionId) return;
            const sessions = globalStore.get(this.sessionsAtom);
            globalStore.set(this.sessionsAtom, [
                summary,
                ...sessions.filter((session) => session.key !== summary.key && session.id !== summary.id),
            ]);
            globalStore.set(this.newSessionAtom, null);
            globalStore.set(this.selectedKeyAtom, summary.key);
            globalStore.set(this.detailAtom, null);
            void this.loadDetail(summary, true);
            void this.loadSessions(true, globalStore.get(this.sortDescendingAtom));
        } catch (error) {
            const placeholder = globalStore.get(this.newSessionAtom);
            if (placeholder == null || placeholder.id !== sessionId) return;
            globalStore.set(this.historySyncErrorAtom, getErrorMessage(error));
            if (attempt >= 5) return;
            const delayMs = Math.min(500 * 2 ** attempt, 8000);
            window.setTimeout(() => {
                void this.promoteNewSession(sessionId, attempt + 1);
            }, delayMs);
            void this.loadSessions(false, globalStore.get(this.sortDescendingAtom));
        }
    }

    async loadSessions(refresh = false, sortDescending = false): Promise<void> {
        const loadSeq = ++this.sessionsLoadSeq;
        const source = globalStore.get(this.sourceAtom);
        const query = globalStore.get(this.queryAtom);
        const tagFilters = globalStore.get(this.tagFiltersAtom);
        const tagPresence = globalStore.get(this.tagPresenceAtom);
        const marked = globalStore.get(this.markedFilterAtom);
        const dateRange = globalStore.get(this.dateRangeAtom);
        const pathFilter = globalStore.get(this.pathFilterAtom);
        const projectPrefix = pathFilterToPrefix(pathFilter);
        const { since, before } = dateRangeToSinceBefore(dateRange, Date.now());
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const response = await this.service.List({
                source,
                query,
                connection: this.getConnection(),
                limit: 200,
                refresh,
                marked,
                since,
                before,
                tagFilters,
                tagPresence,
                project: projectPrefix,
                includeProjectPaths: true,
            });
            if (
                !this.isCurrentSessionsLoad(
                    loadSeq,
                    source,
                    query,
                    tagFilters,
                    tagPresence,
                    marked,
                    dateRange,
                    pathFilter
                )
            ) {
                return;
            }
            let sessions = response?.sessions ?? [];
            globalStore.set(this.projectPathsAtom, response?.projectPaths ?? []);
            // Other bucket can't be expressed server-side (project="" matches all),
            // so filter locally after the response arrives.
            if (pathFilter.root === PathFilterOtherRoot) {
                sessions = otherRootMatcher(sessions) as SessionSummary[];
            }
            globalStore.set(this.sessionsAtom, sessions);
            globalStore.set(this.lastSessionsRefreshAtAtom, Date.now());
            // Promote the pending new-chat placeholder once its real session
            // shows up in the list (pi wrote the session file after turn 1).
            const newPlaceholder = globalStore.get(this.newSessionAtom);
            if (newPlaceholder != null && newPlaceholder.id !== "") {
                const promoted = sessions.find((session) => session.id === newPlaceholder.id);
                if (promoted != null) {
                    globalStore.set(this.newSessionAtom, null);
                    // 回写真实 sessionid 并清除 newchat 标志，block 从此永久绑定该会话
                    void RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: `block:${this.blockId}`,
                        meta: {
                            "aisessions:sessionid": promoted.id,
                            "aisessions:newchat": null,
                        } as MetaType,
                    }).catch(() => {
                        // best-effort；列表内已提升，不影响使用
                    });
                    if (globalStore.get(this.selectedKeyAtom) === NewSessionKey) {
                        globalStore.set(this.selectedKeyAtom, promoted.key);
                        globalStore.set(this.detailAtom, null);
                        void this.loadDetail(promoted, refresh);
                    }
                }
            }
            void this.loadTags(refresh);
            const selectedKey = globalStore.get(this.selectedKeyAtom);
            const selectedStillExists =
                sessions.some((session) => session.key === selectedKey) || selectedKey === NewSessionKey;
            if (!selectedStillExists) {
                const detail = globalStore.get(this.detailAtom);
                if (selectedKey !== "" && detail?.summary?.key === selectedKey) {
                    return;
                }
                const boundSessionId = selectedKey === "" ? this.getBoundSessionId() : "";
                const boundSession = findSessionById(sessions, boundSessionId);
                if (boundSession != null) {
                    globalStore.set(this.selectedKeyAtom, boundSession.key);
                    globalStore.set(this.detailAtom, null);
                } else if (boundSessionId !== "" && (await this.loadDetailById(boundSessionId, refresh))) {
                    return;
                } else if (this.shouldAutoStartNewChat()) {
                    this.startNewSession();
                } else {
                    const firstSession = sortSessionsByTime(sessions, sortDescending)[0];
                    globalStore.set(this.selectedKeyAtom, firstSession?.key ?? "");
                    globalStore.set(this.detailAtom, null);
                }
            }
        } catch (e) {
            if (
                this.isCurrentSessionsLoad(
                    loadSeq,
                    source,
                    query,
                    tagFilters,
                    tagPresence,
                    marked,
                    dateRange,
                    pathFilter
                )
            ) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
        } finally {
            if (
                this.isCurrentSessionsLoad(
                    loadSeq,
                    source,
                    query,
                    tagFilters,
                    tagPresence,
                    marked,
                    dateRange,
                    pathFilter
                )
            ) {
                globalStore.set(this.loadingAtom, false);
            }
        }
    }

    isCurrentSessionsLoad(
        loadSeq: number,
        source: SourceFilter,
        query: string,
        tagFilters: string[],
        tagPresence: TagPresenceFilter,
        marked: MarkedFilter,
        dateRange: DateRangeFilter,
        pathFilter: PathFilter
    ): boolean {
        const currentDateRange = globalStore.get(this.dateRangeAtom);
        return (
            loadSeq === this.sessionsLoadSeq &&
            globalStore.get(this.sourceAtom) === source &&
            globalStore.get(this.queryAtom) === query &&
            tagsEqual(globalStore.get(this.tagFiltersAtom), tagFilters) &&
            globalStore.get(this.tagPresenceAtom) === tagPresence &&
            globalStore.get(this.markedFilterAtom) === marked &&
            pathFilterEqual(globalStore.get(this.pathFilterAtom), pathFilter) &&
            currentDateRange.preset === dateRange.preset &&
            (currentDateRange.from ?? 0) === (dateRange.from ?? 0) &&
            (currentDateRange.to ?? 0) === (dateRange.to ?? 0)
        );
    }

    async loadTags(refresh = false): Promise<void> {
        try {
            const dateRange = globalStore.get(this.dateRangeAtom);
            const { since, before } = dateRangeToSinceBefore(dateRange, Date.now());
            const response = await this.service.Tags({
                source: globalStore.get(this.sourceAtom),
                connection: this.getConnection(),
                marked: globalStore.get(this.markedFilterAtom),
                since,
                before,
                tagFilters: globalStore.get(this.tagFiltersAtom),
                tagPresence: globalStore.get(this.tagPresenceAtom),
                refresh,
            });
            globalStore.set(this.availableTagsAtom, response.tags ?? []);
        } catch (e) {
            globalStore.set(this.availableTagsAtom, []);
        }
    }

    clearAllFilters(): void {
        globalStore.set(this.markedFilterAtom, "all");
        globalStore.set(this.sourceAtom, "");
        globalStore.set(this.dateRangeAtom, DefaultDateRange);
        globalStore.set(this.tagFiltersAtom, []);
        globalStore.set(this.tagPresenceAtom, DefaultTagPresence);
        globalStore.set(this.pathFilterAtom, DefaultPathFilter);
    }

    // Tag-presence setter. Centralizes the mutual-exclusion rule:
    // "untagged AND specific tag chips" is logically empty (an untagged
    // session has no tags, so it cannot satisfy a tag-include filter),
    // so activating Untagged must reset tagFilters atomically.
    // Resetting to Any leaves any prior tagFilters alone (they may have
    // been picked intentionally after the user already cleared Untagged).
    setTagPresence(next: TagPresenceFilter): void {
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.tagPresenceAtom, next);
        if (next !== DefaultTagPresence) {
            globalStore.set(this.tagFiltersAtom, []);
        }
    }

    // Tag-include setter. Centralizes the opposite direction of the same
    // mutual-exclusion rule: any non-empty tagFilters list turns TagPresence
    // back to Any so the active filter set stays internally consistent.
    // Empty tagFilters (cleared from Untagged side or all chips toggled off)
    // intentionally leaves TagPresence alone.
    setTagFilters(next: string[]): void {
        const normalized = normalizeSessionTags(next);
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.tagFiltersAtom, normalized);
        if (normalized.length > 0) {
            globalStore.set(this.tagPresenceAtom, DefaultTagPresence);
        }
    }

    getBoundSessionId(): string {
        const blockData = globalStore.get(this.blockAtom);
        const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
        const sessionId = meta["aisessions:sessionid"] ?? meta["agent:sessionid"];
        return typeof sessionId === "string" ? sessionId.trim() : "";
    }

    // New Agent GUI 模式的 block 带 newchat 标志：无绑定会话时自动开新会话。
    shouldAutoStartNewChat(): boolean {
        const blockData = globalStore.get(this.blockAtom);
        return (blockData?.meta as Record<string, unknown> | undefined)?.["aisessions:newchat"] === true;
    }

    getConnection(): string {
        const blockData = globalStore.get(this.blockAtom);
        const connection = blockData?.meta?.connection;
        return typeof connection === "string" ? connection.trim() : "";
    }

    async loadDetail(session: SessionSummary, refresh = false): Promise<void> {
        if (!session?.key) {
            globalStore.set(this.detailAtom, null);
            return;
        }
        const loadSeq = ++this.detailLoadSeq;
        globalStore.set(this.selectedKeyAtom, session.key);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: session.key,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
            if (loadSeq !== this.detailLoadSeq || globalStore.get(this.selectedKeyAtom) !== session.key) {
                return;
            }
            globalStore.set(this.detailAtom, detail);
            globalStore.set(this.historySyncErrorAtom, "");
            this.replaceSession(detail.summary);
        } catch (e) {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.historySyncErrorAtom, getErrorMessage(e));
            }
        } finally {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.detailLoadingAtom, false);
            }
        }
    }

    async loadDetailDelta(reason: "manual" | "bottom" = "manual"): Promise<boolean> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        const cursor = currentDetail?.cursor;
        if (!currentSummary?.key || cursor == null) {
            if (currentSummary != null) {
                await this.loadDetail(currentSummary, true);
                return true;
            }
            return false;
        }
        if (globalStore.get(this.detailDeltaLoadingAtom) || globalStore.get(this.detailLoadingAtom)) {
            return false;
        }
        const loadSeq = this.detailLoadSeq;
        globalStore.set(this.detailDeltaLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        globalStore.set(this.historySyncErrorAtom, "");
        try {
            const delta = await this.service.DetailDelta({
                id: currentSummary.key,
                connection: this.getConnection(),
                source: currentSummary.source,
                filePath: currentSummary.filePath,
                cursor,
                messageCount: currentSummary.messageCount,
            });
            if (loadSeq !== this.detailLoadSeq || globalStore.get(this.selectedKeyAtom) !== currentSummary.key) {
                return false;
            }
            if (delta.resetRequired) {
                await this.loadDetail(currentSummary, true);
                return true;
            }
            const deltaMessages = delta.messages ?? [];
            const cursorAdvanced = (delta.cursor?.byteOffset ?? cursor.byteOffset ?? 0) > (cursor.byteOffset ?? 0);
            this.applyDetailDelta(currentSummary.key, delta);
            if (delta.hasMore && reason === "bottom" && (cursorAdvanced || deltaMessages.length > 0)) {
                window.setTimeout(() => {
                    void this.loadDetailDelta("bottom");
                }, 0);
            }
            return true;
        } catch (e) {
            if (loadSeq === this.detailLoadSeq) {
                globalStore.set(this.historySyncErrorAtom, getErrorMessage(e));
            }
            return false;
        } finally {
            globalStore.set(this.detailDeltaLoadingAtom, false);
        }
    }

    applyDetailDelta(sessionKey: string, delta: MessageDelta): void {
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key !== sessionKey) {
            return;
        }
        const merged = mergeSessionTimeline(detail.messages ?? [], detail.cursor, delta.messages ?? [], delta.cursor);
        if (merged.resetRequired) {
            void this.loadDetail(detail.summary, true);
            return;
        }
        const nextSummary = mergeDeltaSummary(detail.summary, delta.summary);
        const nextDetail: SessionDetail = {
            ...detail,
            summary: nextSummary,
            messages: merged.messages,
            cursor: merged.cursor,
        };
        globalStore.set(this.detailAtom, nextDetail);
        this.replaceSession(nextSummary);
    }

    async loadDetailTools(refresh = false): Promise<boolean> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        if (!currentSummary?.key) {
            return false;
        }
        const loadSeq = ++this.detailToolsLoadSeq;
        const selectedKey = globalStore.get(this.selectedKeyAtom);
        globalStore.set(this.toolCallsLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: currentSummary.key,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
            const latest = globalStore.get(this.detailAtom);
            if (
                loadSeq !== this.detailToolsLoadSeq ||
                globalStore.get(this.selectedKeyAtom) !== selectedKey ||
                latest?.summary?.key !== currentSummary.key
            ) {
                return false;
            }
            globalStore.set(this.detailAtom, detail);
            this.replaceSession(detail.summary);
            return true;
        } catch (e) {
            if (loadSeq === this.detailToolsLoadSeq && globalStore.get(this.selectedKeyAtom) === selectedKey) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
            return false;
        } finally {
            if (loadSeq === this.detailToolsLoadSeq) {
                globalStore.set(this.toolCallsLoadingAtom, false);
            }
        }
    }

    async refreshBoundSessionSummary(): Promise<void> {
        const boundSessionId = this.getBoundSessionId();
        if (boundSessionId === "") return;
        try {
            const summary = await this.service.Summary({
                id: boundSessionId,
                connection: this.getConnection(),
                refresh: false,
            });
            this.replaceSession(summary);
        } catch {
            return;
        }
    }

    async loadDetailById(sessionId: string, refresh = false): Promise<boolean> {
        const trimmedSessionId = sessionId.trim();
        if (trimmedSessionId === "") return false;
        globalStore.set(this.selectedKeyAtom, trimmedSessionId);
        globalStore.set(this.detailLoadingAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            const detail = await this.service.Detail({
                id: trimmedSessionId,
                connection: this.getConnection(),
                refresh,
                includeTools: true,
            });
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

    async updateNote(session: SessionSummary, note: string, tags?: string[]): Promise<boolean> {
        if (!session?.key) return false;
        try {
            const updated =
                tags == null
                    ? await this.service.Note(session.key, note)
                    : await this.service.NoteAndTags({ id: session.key, note, tags });
            this.replaceSession(updated);
            dispatchAISessionNoteUpdated(updated);
            void this.loadTags(false);
            return true;
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
            return false;
        }
    }

    async updateTitle(session: SessionSummary, title: string): Promise<boolean> {
        if (!session?.key) return false;
        try {
            const updated = await this.service.Title(session.key, title);
            this.replaceSession(updated);
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
            const context = await this.service.RestoreContext({
                id: session.key || session.id,
                connection: this.getConnection(),
            });
            await createBlock({
                meta: restoreMetaForSession(context),
            });
        } catch (e) {
            globalStore.set(this.errorAtom, getErrorMessage(e));
        } finally {
            globalStore.set(this.restoringAtom, false);
        }
    }

    async openProjectDirectory(summary: SessionSummary): Promise<void> {
        const projectDirectory = summary.projectPath?.trim() ?? "";
        if (!projectDirectory) return;
        const blockDef: BlockDef = {
            meta: {
                view: "preview",
                file: projectDirectory,
            },
        };
        const connection = this.getConnection();
        if (connection !== "") {
            blockDef.meta.connection = connection;
        }
        try {
            await createBlockSplitHorizontally(blockDef, this.blockId, "after");
        } catch (e) {
            await createBlock(blockDef);
        }
    }

    async openSessionFile(summary: SessionSummary): Promise<void> {
        const sessionFilePath = summary.filePath?.trim() ?? "";
        if (!sessionFilePath) return;
        this.env.electron.openNativePath(sessionFilePath);
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

function tagsEqual(left: string[], right: string[]): boolean {
    const leftTags = normalizeSessionTags(left);
    const rightTags = normalizeSessionTags(right);
    if (leftTags.length !== rightTags.length) return false;
    return leftTags.every((tag, index) => tag === rightTags[index]);
}

function mergeDeltaSummary(current: SessionSummary, deltaSummary?: SessionSummary): SessionSummary {
    if (deltaSummary == null) {
        return current;
    }
    return {
        ...current,
        source: deltaSummary.source || current.source,
        filePath: deltaSummary.filePath || current.filePath,
        messageCount: typeof deltaSummary.messageCount === "number" ? deltaSummary.messageCount : current.messageCount,
    };
}

function findSessionById(sessions: SessionSummary[], sessionId: string): SessionSummary | null {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId === "") return null;
    return sessions.find((session) => session.key === trimmedSessionId || session.id === trimmedSessionId) ?? null;
}

const SessionListWidthStorageKey = "aisessions.sessionListWidth";
const AutoRefreshIntervalMetaKey = "aisessions:autorefreshintervalms";
const DefaultAutoRefreshIntervalMs = 60_000;
const MinAutoRefreshIntervalMs = 10_000;
const MaxAutoRefreshIntervalMs = 60 * 60_000;
const AutoRefreshIntervalOptions = [
    { label: "Off", value: 0 },
    { label: "30 seconds", value: 30_000 },
    { label: "1 minute", value: DefaultAutoRefreshIntervalMs },
    { label: "2 minutes", value: 120_000 },
    { label: "5 minutes", value: 300_000 },
] as const;
const DefaultSessionListWidth = 320;
const MinSessionListWidth = 240;
const MaxSessionListWidth = 520;
const BackupKeepRecent = 3;
const BackupMaxAgeDays = 7;

function clampSessionListWidth(width: number): number {
    if (!Number.isFinite(width)) return DefaultSessionListWidth;
    return Math.max(MinSessionListWidth, Math.min(MaxSessionListWidth, Math.round(width)));
}

function normalizeAutoRefreshIntervalMs(value: unknown): number {
    const parsed =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : DefaultAutoRefreshIntervalMs;
    if (!Number.isFinite(parsed)) return DefaultAutoRefreshIntervalMs;
    if (parsed <= 0) return 0;
    return Math.max(MinAutoRefreshIntervalMs, Math.min(MaxAutoRefreshIntervalMs, Math.round(parsed)));
}

function formatAutoRefreshInterval(intervalMs: number): string {
    if (intervalMs <= 0) return "Off";
    if (intervalMs % 60_000 === 0) {
        const minutes = intervalMs / 60_000;
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    const seconds = Math.round(intervalMs / 1000);
    return `${seconds} seconds`;
}

function readSessionListWidth(): number {
    if (typeof window === "undefined") return DefaultSessionListWidth;
    const storedWidth = window.localStorage.getItem(SessionListWidthStorageKey);
    if (storedWidth == null) return DefaultSessionListWidth;
    return clampSessionListWidth(Number(storedWidth));
}

function writeSessionListWidth(width: number): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SessionListWidthStorageKey, String(clampSessionListWidth(width)));
}

function readDefaultSessionListCollapsed(model: AiSessionsViewModel): boolean {
    const blockData = globalStore.get(model.blockAtom);
    return blockData?.meta?.["aisessions:sessionlistcollapsed"] === true;
}

function customAutoRefreshMenuItems(currentInterval: number, model: AiSessionsViewModel): ContextMenuItem[] {
    const isPreset = AutoRefreshIntervalOptions.some((option) => option.value === currentInterval);
    return [
        ...(isPreset
            ? []
            : [
                  {
                      label: `Custom (${formatAutoRefreshInterval(currentInterval)})`,
                      type: "radio" as const,
                      checked: true,
                  },
              ]),
        { type: "separator" as const },
        {
            label: "Custom...",
            click: () => {
                const currentSeconds = currentInterval > 0 ? String(Math.round(currentInterval / 1000)) : "0";
                const raw = window.prompt("Auto refresh interval in seconds. Use 0 to turn off.", currentSeconds);
                if (raw == null) return;
                const seconds = Number(raw.trim());
                if (!Number.isFinite(seconds)) return;
                model.setAutoRefreshIntervalMs(seconds <= 0 ? 0 : seconds * 1000);
            },
        },
    ];
}

function formatBackupSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) return "0 B";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AiSessionsView({ model }: ViewComponentProps<AiSessionsViewModel>) {
    const blockData = jotai.useAtomValue(model.blockAtom);
    const sessions = jotai.useAtomValue(model.sessionsAtom);
    const detail = jotai.useAtomValue(model.detailAtom);
    const newChatEpoch = jotai.useAtomValue(model.newChatEpochAtom);
    const newSession = jotai.useAtomValue(model.newSessionAtom);
    const projectPaths = jotai.useAtomValue(model.projectPathsAtom);
    const selectedKey = jotai.useAtomValue(model.selectedKeyAtom);
    const source = jotai.useAtomValue(model.sourceAtom);
    const query = jotai.useAtomValue(model.queryAtom);
    const tagFilters = jotai.useAtomValue(model.tagFiltersAtom);
    const tagPresence = jotai.useAtomValue(model.tagPresenceAtom);
    const availableTags = jotai.useAtomValue(model.availableTagsAtom);
    const [markedFilter, setMarkedFilter] = jotai.useAtom(model.markedFilterAtom);
    const [dateRange, setDateRange] = jotai.useAtom(model.dateRangeAtom);
    const [pathFilter, setPathFilter] = jotai.useAtom(model.pathFilterAtom);
    const [filtersOpen, setFiltersOpen] = jotai.useAtom(model.filtersOpenAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);
    const detailDeltaLoading = jotai.useAtomValue(model.detailDeltaLoadingAtom);
    const toolCallsLoading = jotai.useAtomValue(model.toolCallsLoadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const historySyncError = jotai.useAtomValue(model.historySyncErrorAtom);
    const restoring = jotai.useAtomValue(model.restoringAtom);
    const deleting = jotai.useAtomValue(model.deletingAtom);
    const lastSessionsRefreshAt = jotai.useAtomValue(model.lastSessionsRefreshAtAtom);
    const [sortDescending, setSortDescending] = jotai.useAtom(model.sortDescendingAtom);
    const [groupMode, setGroupMode] = jotai.useAtom(model.groupModeAtom);
    const [sessionListCollapsed, setSessionListCollapsed] = useState(() => readDefaultSessionListCollapsed(model));
    const [groupCollapsed, setGroupCollapsed] = useState<string[]>(() => readCollapsedGroups());
    const [sessionListWidth, setSessionListWidth] = useState(readSessionListWidth);
    const [refreshTimeNow, setRefreshTimeNow] = useState(() => Date.now());
    const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
    const [backupCleanupError, setBackupCleanupError] = useState("");
    const [backupCleanupRunning, setBackupCleanupRunning] = useState(false);
    const [blockVisible, setBlockVisible] = useState(true);
    const [runningChatSessionIds, setRunningChatSessionIds] = useState<ReadonlySet<string>>(() => new Set());
    const sessionsRunning = useSessionsRunning(blockVisible);
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const visibleSessions = useMemo(() => {
        const base = sortSessionsByTime(sessions, sortDescending);
        return newSession != null ? [newSession, ...base] : base;
    }, [sessions, sortDescending, newSession]);
    /*
     * The 按项目 cut of the same pool. The New Chat placeholder is pinned above
     * every group (it has no folder yet), so it is set aside before grouping;
     * every real session ends up in exactly one bucket, empty buckets never render.
     */
    const groupedSessions = useMemo(() => {
        const base = newSession != null ? visibleSessions.slice(1) : visibleSessions;
        return groupSessionsByProject(base);
    }, [visibleSessions, newSession]);
    const normalizedTagFilters = normalizeSessionTags(tagFilters);
    const queryActive = query.trim().length > 0;
    const tagFilterActive = normalizedTagFilters.length > 0;
    const tagPresenceActive = tagPresence !== DefaultTagPresence;
    const markedActive = markedFilter !== "all";
    const dateActive = dateRange.preset !== "all";
    const pathActive = pathFilter.root !== "";
    const remoteFilterActive =
        queryActive ||
        source !== "" ||
        tagFilterActive ||
        tagPresenceActive ||
        markedActive ||
        dateActive ||
        pathActive;
    const filterActive = remoteFilterActive;
    const filterBusy = loading && remoteFilterActive;
    const activeFilterCount =
        (markedActive ? 1 : 0) +
        (dateActive ? 1 : 0) +
        normalizedTagFilters.length +
        (pathActive ? 1 : 0) +
        (tagPresenceActive ? 1 : 0) +
        (source !== "" ? 1 : 0);
    const availablePathRoots = useMemo(() => extractPathRoots(projectPaths), [projectPaths]);
    const pathChildren = useMemo(() => extractPathChildren(pathFilter, projectPaths), [pathFilter, projectPaths]);
    const pathAncestors = useMemo(() => pathAncestorSegments(pathFilter), [pathFilter]);
    const autoRefreshIntervalMs = normalizeAutoRefreshIntervalMs(blockData?.meta?.[AutoRefreshIntervalMetaKey]);
    const autoRefreshEnabled = model.getConnection() === "";

    useEffect(() => {
        model.loadSessions(false, sortDescending);
    }, [model]);

    const loadBackupStats = useCallback(() => {
        void model.service
            .BackupStats({
                connection: model.getConnection(),
                keepRecent: BackupKeepRecent,
                maxAgeDays: BackupMaxAgeDays,
            })
            .then((stats) => {
                setBackupStats(stats);
                setBackupCleanupError("");
            })
            .catch(() => {
                setBackupStats(null);
            });
    }, [model]);

    useEffect(() => {
        if (loading) return;
        loadBackupStats();
    }, [loadBackupStats, loading]);

    useEffect(() => {
        if (!lastSessionsRefreshAt) return;
        setRefreshTimeNow(Date.now());
        const handle = window.setInterval(() => setRefreshTimeNow(Date.now()), 30_000);
        return () => window.clearInterval(handle);
    }, [lastSessionsRefreshAt]);

    useEffect(() => {
        const node = rootRef.current;
        if (node == null || typeof IntersectionObserver === "undefined") {
            setBlockVisible(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            setBlockVisible(entries[0]?.isIntersecting ?? true);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!autoRefreshEnabled || autoRefreshIntervalMs <= 0 || !blockVisible) return;
        const handle = window.setInterval(() => {
            if (document.visibilityState === "hidden") return;
            if (globalStore.get(model.loadingAtom)) return;
            void model.loadSessions(false, globalStore.get(model.sortDescendingAtom));
            void model.refreshBoundSessionSummary();
            if (globalStore.get(model.detailAtom)?.summary?.key) {
                void model.loadDetailDelta("manual");
            }
        }, autoRefreshIntervalMs);
        return () => window.clearInterval(handle);
    }, [autoRefreshEnabled, autoRefreshIntervalMs, blockVisible, model]);

    useEffect(() => {
        const handle = window.setTimeout(() => model.loadSessions(false, sortDescending), 200);
        return () => window.clearTimeout(handle);
    }, [model, query, source, tagFilters, tagPresence, markedFilter, dateRange, pathFilter, sortDescending]);

    useEffect(() => {
        writeSortPreference(sortDescending);
    }, [sortDescending]);

    useEffect(() => {
        writeGroupPreference(groupMode);
    }, [groupMode]);

    useEffect(() => {
        writeCollapsedGroups(groupCollapsed);
    }, [groupCollapsed]);

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
        if (activeSession?.key === NewSessionKey) return; // placeholder has no server detail yet
        if (activeSession && detail?.summary?.key !== activeSession.key && !detailLoading) {
            model.loadDetail(activeSession);
        }
    }, [activeSession, detail?.summary?.key, detailLoading, model]);

    useEffect(() => {
        if (shouldStartEmptyChat(loading, visibleSessions.length, detail != null, filterActive, error)) {
            model.startNewSession();
            return;
        }
        if (loading || visibleSessions.length > 0 || detail != null) return;
        globalStore.set(model.selectedKeyAtom, "");
    }, [detail, error, filterActive, loading, model, visibleSessions.length]);

    const setSource = useCallback(
        (next: SourceFilter) => {
            globalStore.set(model.loadingAtom, true);
            globalStore.set(model.sourceAtom, next);
        },
        [model]
    );

    const handleRunningChatSessionIdsChange = useCallback((sessionIds: ReadonlySet<string>) => {
        setRunningChatSessionIds(new Set(sessionIds));
    }, []);

    const setQuery = useCallback(
        (next: string) => {
            globalStore.set(model.loadingAtom, true);
            globalStore.set(model.queryAtom, next);
        },
        [model]
    );

    const toggleTagFilter = useCallback(
        (tag: string) => {
            const normalizedTag = normalizeSessionTags([tag])[0];
            if (!normalizedTag) return;
            const currentTags = normalizeSessionTags(globalStore.get(model.tagFiltersAtom));
            const nextTags = currentTags.includes(normalizedTag)
                ? currentTags.filter((item) => item !== normalizedTag)
                : [...currentTags, normalizedTag];
            model.setTagFilters(nextTags);
        },
        [model]
    );

    const cleanupBackups = useCallback(() => {
        if (backupStats == null || backupStats.cleanupCount <= 0 || backupCleanupRunning) return;
        const confirmed = window.confirm(
            `Delete ${backupStats.cleanupCount} old AI session backup file(s), freeing ${formatBackupSize(backupStats.cleanupSize)}?`
        );
        if (!confirmed) return;
        setBackupCleanupRunning(true);
        setBackupCleanupError("");
        void model.service
            .CleanupBackups({
                connection: model.getConnection(),
                keepRecent: BackupKeepRecent,
                maxAgeDays: BackupMaxAgeDays,
            })
            .then((result) => {
                setBackupStats(result.stats);
            })
            .catch((e) => {
                setBackupCleanupError(getErrorMessage(e));
            })
            .finally(() => {
                setBackupCleanupRunning(false);
            });
    }, [backupCleanupRunning, backupStats, model]);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
        };
    }, []);

    const startSessionListResize = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            resizeCleanupRef.current?.();
            const startX = event.clientX;
            const startWidth = sessionListWidth;
            const originalCursor = document.body.style.cursor;
            const originalUserSelect = document.body.style.userSelect;
            const handleMouseMove = (moveEvent: MouseEvent) => {
                const nextWidth = clampSessionListWidth(startWidth + moveEvent.clientX - startX);
                setSessionListWidth(nextWidth);
            };
            const handleMouseUp = (upEvent: MouseEvent) => {
                const nextWidth = clampSessionListWidth(startWidth + upEvent.clientX - startX);
                setSessionListWidth(nextWidth);
                writeSessionListWidth(nextWidth);
                resizeCleanupRef.current?.();
            };
            const cleanup = () => {
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
                document.body.style.cursor = originalCursor;
                document.body.style.userSelect = originalUserSelect;
                resizeCleanupRef.current = null;
            };
            resizeCleanupRef.current = cleanup;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        },
        [sessionListWidth]
    );

    const gridTemplateColumns = sessionListCollapsed ? "minmax(0,1fr)" : `${sessionListWidth}px minmax(0,1fr)`;
    const lastRefreshLabel = lastSessionsRefreshAt
        ? formatRelativeRefreshTime(lastSessionsRefreshAt, refreshTimeNow)
        : "";
    const lastRefreshTitle = lastSessionsRefreshAt
        ? `Last refreshed ${formatDateTimeToSecond(lastSessionsRefreshAt)}`
        : "";

    return (
        <div ref={rootRef} className="flex h-full w-full min-h-0 flex-col bg-block text-primary">
            {error && detail == null && activeSession?.key !== NewSessionKey ? (
                <div className="shrink-0 border-b border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                    {error}
                </div>
            ) : null}
            <div className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns }}>
                <div
                    className={cn(
                        "relative flex min-h-0 flex-col border-r border-border",
                        sessionListCollapsed && "contents"
                    )}
                >
                    {sessionListCollapsed ? null : (
                        <>
                            <div className="space-y-2 border-b border-border p-3">
                                <div className="flex items-center gap-2">
                                    <div
                                        className={cn(
                                            "relative min-w-0 flex-1 rounded-lg",
                                            queryActive || filterBusy
                                                ? "bg-accent/5 ring-1 ring-accent/40"
                                                : "bg-surface"
                                        )}
                                    >
                                        <i className="fa-sharp fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-secondary" />
                                        <input
                                            className="h-8 w-full bg-transparent pl-7 pr-7 text-sm outline-none"
                                            placeholder="Search title, note, path, tag"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    void model.loadSessions(false, sortDescending);
                                                }
                                            }}
                                        />
                                        {filterBusy && queryActive ? (
                                            <i className="fa-sharp fa-solid fa-spinner absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[11px] text-accent" />
                                        ) : null}
                                    </div>
                                    <IconButton
                                        icon="fa-chevron-left"
                                        label="Collapse sessions list"
                                        onClick={() => setSessionListCollapsed(true)}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <GroupModeSwitch
                                        mode={groupMode}
                                        onChange={(next) => setGroupMode(next)}
                                    />
                                    <div className="flex-1" />
                                    <button
                                        type="button"
                                        title="Filters"
                                        aria-label="Filters"
                                        onClick={() => setFiltersOpen((current) => !current)}
                                        className={cn(
                                            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors cursor-pointer",
                                            filtersOpen
                                                ? "border border-border/70 bg-background text-primary shadow-sm ring-1 ring-accent/40"
                                                : "border border-border/70 bg-surface text-secondary hover:bg-hover hover:text-primary"
                                        )}
                                    >
                                        <i className="fa-sharp fa-solid fa-sliders text-[11px]" />
                                        {activeFilterCount > 0 ? (
                                            <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-black">
                                                {activeFilterCount}
                                            </span>
                                        ) : (
                                            <span>Filters</span>
                                        )}
                                    </button>
                                    <SortButton
                                        descending={sortDescending}
                                        onToggle={() => setSortDescending((current) => !current)}
                                    />
                                </div>
                                {backupStats != null && backupStats.cleanupCount > 0 ? (
                                    <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-secondary">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="min-w-0">
                                                {backupStats.cleanupCount} old backup files use{" "}
                                                {formatBackupSize(backupStats.cleanupSize)}.
                                            </span>
                                            <button
                                                type="button"
                                                className="shrink-0 text-[11px] text-primary hover:text-accent cursor-pointer"
                                                disabled={backupCleanupRunning}
                                                onClick={cleanupBackups}
                                            >
                                                {backupCleanupRunning ? "Cleaning..." : "Clean up"}
                                            </button>
                                        </div>
                                        {backupCleanupError !== "" ? (
                                            <div className="mt-1 text-error">{backupCleanupError}</div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                            {filtersOpen ? (
                                <FilterPanel
                                    markedFilter={markedFilter}
                                    setMarkedFilter={setMarkedFilter}
                                    dateRange={dateRange}
                                    setDateRange={setDateRange}
                                    source={source}
                                    setSource={setSource}
                                    availableTags={availableTags}
                                    tagFilters={normalizedTagFilters}
                                    tagPresence={tagPresence}
                                    setTagPresence={(next) => model.setTagPresence(next)}
                                    toggleTagFilter={toggleTagFilter}
                                    onClearAll={() => model.clearAllFilters()}
                                    pathFilter={pathFilter}
                                    setPathFilter={setPathFilter}
                                    availablePathRoots={availablePathRoots}
                                    pathChildren={pathChildren}
                                    pathAncestors={pathAncestors}
                                />
                            ) : null}
                            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-secondary">
                                <span className="min-w-0 truncate">{visibleSessions.length} sessions</span>
                                {loading && !filterActive ? (
                                    <span className="flex shrink-0 items-center gap-1">
                                        <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                                        Refreshing
                                    </span>
                                ) : lastRefreshLabel !== "" ? (
                                    <span className="shrink-0" title={lastRefreshTitle}>
                                        {lastRefreshLabel}
                                    </span>
                                ) : null}
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                {loading && visibleSessions.length === 0 ? (
                                    <EmptyState text="Loading sessions..." />
                                ) : visibleSessions.length === 0 ? (
                                    <EmptyState text={emptySessionsText(markedFilter, remoteFilterActive)} />
                                ) : (
                                    <GroupedSessionList
                                        groupMode={groupMode}
                                        sessions={visibleSessions}
                                        grouped={groupedSessions}
                                        groupCollapsed={groupCollapsed}
                                        onToggleGroup={(key) =>
                                            setGroupCollapsed((current) =>
                                                current.includes(key)
                                                    ? current.filter((k) => k !== key)
                                                    : [...current, key]
                                            )
                                        }
                                        selectedKey={selectedKey}
                                        onSelectNew={() => {
                                            globalStore.set(model.selectedKeyAtom, NewSessionKey);
                                            globalStore.set(model.detailAtom, null);
                                        }}
                                        onSelectSession={(session) => model.loadDetail(session)}
                                        onMark={(session, e) => {
                                            e.stopPropagation();
                                            model.toggleMark(session);
                                        }}
                                        onNoteSave={(session, note, tags) => model.updateNote(session, note, tags)}
                                        onResume={(session, e) => {
                                            e.stopPropagation();
                                            void model.restoreSession(session);
                                        }}
                                        resumeDisabled={restoring}
                                        runningStateOf={(session) =>
                                            sessionsRunning.get(session.key) ?? sessionsRunning.get(session.id) ?? null
                                        }
                                        chatRunningOf={(session) =>
                                            runningChatSessionIds.has(session.key) || runningChatSessionIds.has(session.id)
                                        }
                                        onJumpToBlock={jumpToRunningSessionBlock}
                                    />
                                )}
                            </div>
                        </>
                    )}
                    {!sessionListCollapsed ? (
                        <div
                            role="separator"
                            aria-label="Resize sessions list"
                            aria-orientation="vertical"
                            className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-accent/20"
                            onMouseDown={startSessionListResize}
                        />
                    ) : null}
                </div>
                <SessionDetailPane
                    model={model}
                    detail={detail}
                    isNewChat={activeSession?.key === NewSessionKey}
                    newChatEpoch={newChatEpoch}
                    loading={
                        error === "" &&
                        detailLoading &&
                        detail == null &&
                        activeSession?.key !== NewSessionKey
                    }
                    deltaLoading={detailDeltaLoading}
                    toolCallsLoading={toolCallsLoading}
                    restoring={restoring}
                    deleting={deleting}
                    error={error}
                    historySyncError={historySyncError}
                    onBound={(sessionId) => model.bindNewSession(sessionId)}
                    onRunningSessionIdsChange={handleRunningChatSessionIdsChange}
                    onExpandSessionList={
                        sessionListCollapsed ? () => setSessionListCollapsed(false) : undefined
                    }
                />
            </div>
        </div>
    );
}
