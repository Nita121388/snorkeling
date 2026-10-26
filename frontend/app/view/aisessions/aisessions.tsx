// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { restoreMinimizedBlockToLayout } from "@/app/block/block-minimize";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { RefreshStatus } from "@/app/element/refresh-status-icon";
import { RefreshStatusIcon, deriveRefreshStatus } from "@/app/element/refresh-status-icon";
import { AISessionsServiceType } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveEnv } from "@/app/waveenv/waveenv";
import { getLayoutModelForTabById } from "@/layout/index";
import { createBlock, createBlockSplitHorizontally, refocusNode, setActiveTab } from "@/store/global";
import { globalStore } from "@/store/jotaiStore";
import { isDragMovement, keysUnderRect, rectToCss, type Rect } from "@/util/selectionrect";
import { cn, fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSameSessionSummary } from "../../session-overview/session-overview-session-cache";
import "../../session-overview/session-overview.scss";
import { autoGenerate } from "./aisession-gen-store";
import {
    ExpandAllTagsButton,
    GroupModeSwitch,
    IconButton,
    SortButton,
    SubSessionsToggle,
    type ListGroupMode,
} from "./controls";
import { EmptyState } from "./empty-state";
import { FilterPanel } from "./filter-panel";
import { ScanProgressStrip, SkeletonSessionRows } from "./scan-progress";
import type { ScanStatus } from "./scan-status-logic";
import { SessionBatchBar } from "./session-batch-bar";
import { SessionDetailPane } from "./session-detail";
import { openAISessionDetailFromList, openAISessionNewChatFromList } from "./session-detail-block";
import {
    GroupedSessionList,
    readCollapsedGroups,
    readExpandedParents,
    writeCollapsedGroups,
    writeExpandedParents,
} from "./session-group";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "./session-note-events";
import { normalizeSessionTags } from "./session-tags";
import { mergeSessionTimeline } from "./session-timeline-sync";
import { collectParentKeys } from "./session-tree";
import { defaultChatSource } from "./sources";
import type { DateRangeFilter, MarkedFilter, PathFilter, SourceFilter, TagPresenceFilter } from "./types";
import {
    DefaultDateRange,
    DefaultExcludeTags,
    DefaultPathExcludes,
    DefaultPathFilter,
    DefaultPathSelections,
    DefaultTagPresence,
    NewSessionKey,
    dateRangeToSinceBefore,
} from "./types";
import { useScanStatus } from "./use-scan-status";
import { useSessionsRunning, type SessionRunningState } from "./use-sessions-running";
import type { BatchCopyKind } from "./utils";
import {
    applySelectionRange,
    buildBatchCopyText,
    copyText,
    emptySessionsText,
    extractPathChildren,
    extractPathRoots,
    formatDateTimeToSecond,
    formatRelativeRefreshTime,
    getErrorMessage,
    groupSessionsByProject,
    normalizePathPrefix,
    normalizePathSelections,
    pathAncestorSegments,
    pathFilterEqual,
    pathSelectionsEqual,
    pruneSelectionToVisible,
    readExpandAllTagsPreference,
    readGroupPreference,
    readSortPreference,
    reconcilePathSets,
    restoreMetaForSession,
    shouldStartEmptyChat,
    sortSessionsByTime,
    writeExpandAllTagsPreference,
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
    // 多选集合（批量操作的作用域），与 selectedKeyAtom 职责分开：
    // selectedKeyAtom = 当前行 / 详情面板绑定；selectedKeysAtom = 批量操作选区。
    // 选区始终是「当前可见会话」的子集（筛选/刷新后由 pruneSelectionToVisible 裁剪）。
    selectedKeysAtom = jotai.atom<string[]>([]);
    selectionAnchorAtom = jotai.atom<string>("");
    marqueeRectAtom = jotai.atom<{ left: number; top: number; width: number; height: number } | null>(
        null
    ) as jotai.PrimitiveAtom<{
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>;
    sourceAtom = jotai.atom<SourceFilter>("");
    queryAtom = jotai.atom<string>("");
    tagFiltersAtom = jotai.atom<string[]>([]);
    tagPresenceAtom = jotai.atom<TagPresenceFilter>(DefaultTagPresence);
    markedFilterAtom = jotai.atom<MarkedFilter>("all");
    dateRangeAtom = jotai.atom(DefaultDateRange) as jotai.PrimitiveAtom<DateRangeFilter>;
    pathFilterAtom = jotai.atom<PathFilter>(DefaultPathFilter) as jotai.PrimitiveAtom<PathFilter>;
    // 已选目录前缀集合（真正参与过滤）。与 pathFilterAtom（仅浏览位置：面包屑/
    // 子目录导航/计数）刻意分离：下钻看一眼子目录不应改掉筛选条件。
    pathSelectionsAtom = jotai.atom<string[]>(DefaultPathSelections);
    pathExcludesAtom = jotai.atom<string[]>(DefaultPathExcludes);
    excludeTagsAtom = jotai.atom<string[]>(DefaultExcludeTags);
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
    newSessionAtom: jotai.PrimitiveAtom<SessionSummary | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<SessionSummary | null>;
    // 每次 startNewSession 自增：详情面板按世代作废上一轮 New Chat 的绑定与残留
    newChatEpochAtom = jotai.atom(0);
    deletingAtom = jotai.atom<boolean>(false);
    lastSessionsRefreshAtAtom = jotai.atom<number>(0);
    scanStatusAtom = jotai.atom<ScanStatus>({ scanned: 0, total: 0, running: false, done: false, partial: false });
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
            const autoRefreshMs = normalizeAutoRefreshIntervalMs(blockData?.meta?.[AutoRefreshIntervalMetaKey]);
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
                    className: "aisessions-audit",
                    icon: "fa-clipboard-list",
                    title: "Open AI Audit",
                    zone: "pinned",
                    click: () => {
                        void createBlock({ meta: { view: "aiaudit" } }, false, true);
                    },
                },
                {
                    elemtype: "iconbutton",
                    className: "aisessions-auto-refresh",
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
        globalStore.set(this.newSessionAtom, {
            key: NewSessionKey,
            id: "",
            source: defaultChatSource().id,
            title: "New Chat",
        });
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

    async loadSessions(refresh = false, sortDescending = false, background = false): Promise<void> {
        const loadSeq = ++this.sessionsLoadSeq;
        const source = globalStore.get(this.sourceAtom);
        const query = globalStore.get(this.queryAtom);
        const tagFilters = globalStore.get(this.tagFiltersAtom);
        const tagPresence = globalStore.get(this.tagPresenceAtom);
        const marked = globalStore.get(this.markedFilterAtom);
        const dateRange = globalStore.get(this.dateRangeAtom);
        const pathFilter = globalStore.get(this.pathFilterAtom);
        const pathSelections = globalStore.get(this.pathSelectionsAtom);
        const pathExcludes = globalStore.get(this.pathExcludesAtom);
        const excludeTags = globalStore.get(this.excludeTagsAtom);
        const { since, before } = dateRangeToSinceBefore(dateRange, Date.now());
        // 后台自动同步不把整个面板打进 loading（避免黑屏）；只有用户/首载 refresh 才置 loading。
        if (!background) {
            globalStore.set(this.loadingAtom, true);
        }
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
                excludeTags,
                projects: pathSelections,
                excludeProjects: pathExcludes,
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
                    pathFilter,
                    pathSelections,
                    pathExcludes,
                    excludeTags
                )
            ) {
                return;
            }
            const sessions = response?.sessions ?? [];
            globalStore.set(this.projectPathsAtom, response?.projectPaths ?? []);
            // 后台扫描仍在补索引：记下进度，列表尾部用骨架行占位。
            globalStore.set(this.scanStatusAtom, {
                scanned: response?.scanned ?? 0,
                total: response?.total ?? 0,
                running: response?.scanning ?? false,
                done: false,
                partial: (response?.scanning ?? false) && (response?.total ?? 0) > 0,
            });
            // The Other bucket is a backend sentinel (PathFilterOtherRoot), so it
            // arrives inside `projects` like any other prefix — no local post-filter.
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
                // 后台同步时，当前会话可能只是短暂不在本次扫描结果里（索引刷新/文件 mtime 波动）。
                // 不要把当前会话切掉或清空 detail 去报 "session not found"：保留现状，等下次前台刷新。
                if (background) {
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
                    pathFilter,
                    pathSelections,
                    pathExcludes,
                    excludeTags
                )
            ) {
                globalStore.set(this.errorAtom, getErrorMessage(e));
            }
        } finally {
            if (
                !background &&
                this.isCurrentSessionsLoad(
                    loadSeq,
                    source,
                    query,
                    tagFilters,
                    tagPresence,
                    marked,
                    dateRange,
                    pathFilter,
                    pathSelections,
                    pathExcludes,
                    excludeTags
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
        pathFilter: PathFilter,
        pathSelections: string[],
        pathExcludes: string[],
        excludeTags: string[]
    ): boolean {
        const currentDateRange = globalStore.get(this.dateRangeAtom);
        return (
            loadSeq === this.sessionsLoadSeq &&
            globalStore.get(this.sourceAtom) === source &&
            globalStore.get(this.queryAtom) === query &&
            tagsEqual(globalStore.get(this.tagFiltersAtom), tagFilters) &&
            globalStore.get(this.tagPresenceAtom) === tagPresence &&
            globalStore.get(this.markedFilterAtom) === marked &&
            // pathFilter is the browse location: it no longer affects the request,
            // but a stale response for a previous browse state must still be dropped.
            pathFilterEqual(globalStore.get(this.pathFilterAtom), pathFilter) &&
            pathSelectionsEqual(globalStore.get(this.pathSelectionsAtom), pathSelections) &&
            pathSelectionsEqual(globalStore.get(this.pathExcludesAtom), pathExcludes) &&
            tagsEqual(globalStore.get(this.excludeTagsAtom), excludeTags) &&
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
                projects: globalStore.get(this.pathSelectionsAtom),
                excludeProjects: globalStore.get(this.pathExcludesAtom),
                excludeTags: globalStore.get(this.excludeTagsAtom),
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
        globalStore.set(this.excludeTagsAtom, DefaultExcludeTags);
        globalStore.set(this.pathFilterAtom, DefaultPathFilter);
        globalStore.set(this.pathSelectionsAtom, DefaultPathSelections);
        globalStore.set(this.pathExcludesAtom, DefaultPathExcludes);
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
        // Include and exclude are mutually exclusive: a tag can't be both.
        globalStore.set(
            this.excludeTagsAtom,
            globalStore.get(this.excludeTagsAtom).filter((tag) => !normalized.includes(tag))
        );
    }

    // 排除标签集合。与 tagFilters 互斥：同一标签加入排除时从包含侧移除。
    setExcludeTags(next: string[]): void {
        const normalized = normalizeSessionTags(next);
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.excludeTagsAtom, normalized);
        globalStore.set(
            this.tagFiltersAtom,
            globalStore.get(this.tagFiltersAtom).filter((tag) => !normalized.includes(tag))
        );
    }

    toggleExcludeTag(tag: string): void {
        const normalized = normalizeSessionTags([tag])[0];
        if (!normalized) return;
        const current = globalStore.get(this.excludeTagsAtom);
        this.setExcludeTags(
            current.includes(normalized) ? current.filter((item) => item !== normalized) : [...current, normalized]
        );
    }

    // 包含侧目录集合（多选）。与排除集合互斥：同一前缀加入包含时从排除侧移除。
    setPathSelections(next: string[]): void {
        const reconciled = reconcilePathSets(next, globalStore.get(this.pathExcludesAtom));
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.pathSelectionsAtom, reconciled.next);
        globalStore.set(this.pathExcludesAtom, reconciled.other);
    }

    togglePathSelection(prefix: string): void {
        const normalized = normalizePathPrefix(prefix);
        if (normalized === "") return;
        const current = globalStore.get(this.pathSelectionsAtom);
        this.setPathSelections(
            current.includes(normalized) ? current.filter((item) => item !== normalized) : [...current, normalized]
        );
    }

    // 排除侧目录集合。与包含集合互斥。
    setPathExcludes(next: string[]): void {
        const reconciled = reconcilePathSets(next, globalStore.get(this.pathSelectionsAtom));
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.pathExcludesAtom, reconciled.next);
        globalStore.set(this.pathSelectionsAtom, reconciled.other);
    }

    togglePathExclude(prefix: string): void {
        const normalized = normalizePathPrefix(prefix);
        if (normalized === "") return;
        const current = globalStore.get(this.pathExcludesAtom);
        this.setPathExcludes(
            current.includes(normalized) ? current.filter((item) => item !== normalized) : [...current, normalized]
        );
    }

    // ── 多选（batch actions）──────────────────────────────────────
    // selectedKeyAtom 仍是「当前行 / 详情绑定」；这里的集合只驱动批量栏。

    /** 单选：清空多选集合，只留这一行。 */
    setSelectedKey(key: string): void {
        globalStore.set(this.selectedKeyAtom, key);
        globalStore.set(this.selectedKeysAtom, [key]);
        globalStore.set(this.selectionAnchorAtom, key);
    }

    /** Ctrl/Cmd+点击：在集合里切换这一行；新加入的行成为当前行。 */
    toggleInSelection(key: string): void {
        const current = globalStore.get(this.selectedKeysAtom);
        const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
        globalStore.set(this.selectedKeysAtom, next);
        globalStore.set(this.selectionAnchorAtom, key);
        // 取消最后一行时不清空 selectedKey：详情面板仍应显示这一条。
        globalStore.set(this.selectedKeyAtom, key);
    }

    /** 清空多选集合（保留 selectedKeyAtom —— Esc 只是退出批量模式）。 */
    clearSelection(): void {
        globalStore.set(this.selectedKeysAtom, []);
        globalStore.set(this.selectionAnchorAtom, "");
    }

    /** Ctrl+A：全选当前可见会话（顺序 = 列表顺序，决定复制产物行序）。 */
    selectAllVisible(visibleKeys: string[]): void {
        globalStore.set(this.selectedKeysAtom, [...visibleKeys]);
    }

    /** 把选区裁剪到当前可见集合之外（筛选 / 刷新后调用）。 */
    pruneSelection(visibleKeys: string[]): void {
        const current = globalStore.get(this.selectedKeysAtom);
        const pruned = pruneSelectionToVisible(current, visibleKeys);
        if (pruned.length !== current.length) {
            globalStore.set(this.selectedKeysAtom, pruned);
        }
    }

    /** 复制产物文本（空串表示没有可复制的内容）。 */
    buildSelectionCopyText(kind: BatchCopyKind, sessions: SessionSummary[]): string {
        return buildBatchCopyText(sessions, kind);
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
            if (!this.commitDetail(detail)) return;
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

    // turn_end 后只刷新工具调用：保留已渲染的消息列表（delta 已增量合并），
    // 仅把 ToolCalls 更新为正式数据，避免整块 Detail 替换造成旧内容闪烁/丢失。
    async refreshToolCallsOnly(): Promise<boolean> {
        const currentDetail = globalStore.get(this.detailAtom);
        const currentSummary = currentDetail?.summary;
        if (!currentSummary?.key) {
            return false;
        }
        const loadSeq = ++this.detailToolsLoadSeq;
        globalStore.set(this.toolCallsLoadingAtom, true);
        try {
            const detail = await this.service.Detail({
                id: currentSummary.key,
                connection: this.getConnection(),
                refresh: false,
                includeTools: true,
            });
            const latest = globalStore.get(this.detailAtom);
            if (loadSeq !== this.detailToolsLoadSeq || latest?.summary?.key !== currentSummary.key) {
                return false;
            }
            // 只合并 toolCalls；messages/cursor/summary 保持现状。
            globalStore.set(this.detailAtom, { ...latest, toolCalls: detail.toolCalls ?? [] });
            return true;
        } catch (e) {
            // 静默失败：工具卡片缺失可由后续刷新补齐，不打断聊天主流程。
            return false;
        } finally {
            if (loadSeq === this.detailToolsLoadSeq) {
                globalStore.set(this.toolCallsLoadingAtom, false);
            }
        }
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
            if (!this.commitDetail(detail)) return false;
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

    // 提交一次全量 Detail，防旧响应覆盖新状态。对同一 session，新消息数不应少于
    // 当前已有（除用户切会话/rewind 外会话只会增长）；若更少则视为过期回退，拒绝覆盖
    // ——这正是"第二条消息后旧内容消失"的根因：全量刷新与增量 delta 竞态时用更短列表覆盖。
    commitDetail(detail: SessionDetail): boolean {
        const current = globalStore.get(this.detailAtom);
        const sameSession = current?.summary?.key != null && current.summary.key === detail.summary?.key;
        if (sameSession) {
            const currentCount = (current?.messages ?? []).length;
            const newCount = (detail.messages ?? []).length;
            if (newCount < currentCount) {
                console.debug(
                    `commitDetail: refused regression ${currentCount}->${newCount} for ${detail.summary?.key}`
                );
                // 保留现有数据（不允许用更短的列表覆盖已有对话）。
                return false;
            }
        }
        globalStore.set(this.detailAtom, detail);
        return true;
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
            if (!this.commitDetail(detail)) return false;
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
        let changed = false;
        const next = sessions.map((session) => {
            if (session.key === updated.key) {
                // 轮询/后台刷新命中时若实质无变化, 跳过写状态, 避免触发整面板重渲染.
                if (isSameSessionSummary(session, updated)) return session;
                changed = true;
                return { ...session, ...updated };
            }
            return session;
        });
        if (changed) {
            globalStore.set(this.sessionsAtom, next);
        }
        const detail = globalStore.get(this.detailAtom);
        if (detail?.summary?.key === updated.key && !isSameSessionSummary(detail.summary, updated)) {
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

/** 这个块是否绑定到某个具体会话（详情块）而不是列表块。 */
function readBlockSessionId(model: AiSessionsViewModel): string {
    const blockData = globalStore.get(model.blockAtom);
    const sessionId = blockData?.meta?.["aisessions:sessionid"];
    return typeof sessionId === "string" ? sessionId.trim() : "";
}

/** 是否是「自动开新会话」的详情块。 */
function readBlockNewChat(model: AiSessionsViewModel): boolean {
    const blockData = globalStore.get(model.blockAtom);
    return (blockData?.meta as Record<string, unknown> | undefined)?.["aisessions:newchat"] === true;
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
    const excludeTags = jotai.useAtomValue(model.excludeTagsAtom);
    const tagPresence = jotai.useAtomValue(model.tagPresenceAtom);
    const availableTags = jotai.useAtomValue(model.availableTagsAtom);
    const [markedFilter, setMarkedFilter] = jotai.useAtom(model.markedFilterAtom);
    const [dateRange, setDateRange] = jotai.useAtom(model.dateRangeAtom);
    const [pathFilter, setPathFilter] = jotai.useAtom(model.pathFilterAtom);
    const pathSelections = jotai.useAtomValue(model.pathSelectionsAtom);
    const pathExcludes = jotai.useAtomValue(model.pathExcludesAtom);
    const [filtersOpen, setFiltersOpen] = jotai.useAtom(model.filtersOpenAtom);
    const selectedKeys = jotai.useAtomValue(model.selectedKeysAtom);
    const autoGenService = useMemo(() => new AISessionsServiceType(), []);
    const marqueeRect = jotai.useAtomValue(model.marqueeRectAtom);
    const [copiedKind, setCopiedKind] = useState<BatchCopyKind | null>(null);
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
    // 方案 B：全局「展开全部标签」偏好，写入 localStorage 跨会话保持。
    const [expandAllTags, setExpandAllTags] = useState<boolean>(() => readExpandAllTagsPreference());
    useEffect(() => {
        writeExpandAllTagsPreference(expandAllTags);
    }, [expandAllTags]);
    const [groupMode, setGroupMode] = jotai.useAtom(model.groupModeAtom);
    const [sessionListCollapsed, setSessionListCollapsed] = useState(() => readDefaultSessionListCollapsed(model));
    // 列表 / 详情分离：纯列表块（没有绑定具体会话）不再内嵌详情面板，
    // 点会话时把详情拆到独立块；只有详情块才渲染详情面板。
    const blockSessionId = readBlockSessionId(model);
    const blockNewChat = readBlockNewChat(model);
    const showsDetailPane = sessionListCollapsed || blockSessionId !== "" || blockNewChat;
    const [groupCollapsed, setGroupCollapsed] = useState<string[]>(() => readCollapsedGroups());
    // 已展开的父会话（持久化到 localStorage，与 groupCollapsed 同套路）。
    const [expandedParents, setExpandedParents] = useState<string[]>(() => readExpandedParents());
    // 搜索命中子会话时自动展开的父会话：只在本会话内生效，不落盘（design §3.2）。
    // 落盘会把一次搜索的结果永久变成用户的选择，刷新后也回不到「默认全部收起」。
    const [autoExpandedParents, setAutoExpandedParents] = useState<string[]>([]);
    // 点过「显示全部」的父会话：只在本次会话内有效，不落盘（避免刷新后列表被 107 个子会话撑爆）。
    const [fullyExpandedParents, setFullyExpandedParents] = useState<Set<string>>(() => new Set());
    const [sessionListWidth, setSessionListWidth] = useState(readSessionListWidth);
    const [refreshTimeNow, setRefreshTimeNow] = useState(() => Date.now());
    const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
    const [backupCleanupError, setBackupCleanupError] = useState("");
    const [backupCleanupRunning, setBackupCleanupRunning] = useState(false);
    const [blockVisible, setBlockVisible] = useState(true);
    // 后台摘要扫描的进度：响应里的快照 + wps 事件推的实时进度，两者合并使用。
    const responseScanStatus = jotai.useAtomValue(model.scanStatusAtom);
    const scanDoneTimerRef = useRef<number | null>(null);
    const handleScanDone = useCallback(() => {
        // 扫描结束事件会成批到达（多 provider），防抖后再取一次列表。
        if (scanDoneTimerRef.current != null) {
            window.clearTimeout(scanDoneTimerRef.current);
        }
        scanDoneTimerRef.current = window.setTimeout(() => {
            scanDoneTimerRef.current = null;
            void model.loadSessions(false, sortDescending, true);
        }, 400);
    }, [model, sortDescending]);
    const liveScanStatus = useScanStatus({ enabled: blockVisible, onScanDone: handleScanDone });
    useEffect(() => {
        return () => {
            if (scanDoneTimerRef.current != null) {
                window.clearTimeout(scanDoneTimerRef.current);
                scanDoneTimerRef.current = null;
            }
        };
    }, []);
    const scanning = responseScanStatus.running || (liveScanStatus.running && !liveScanStatus.done);
    const scanProgress =
        liveScanStatus.total > 0
            ? { scanned: liveScanStatus.scanned, total: liveScanStatus.total }
            : { scanned: responseScanStatus.scanned, total: responseScanStatus.total };
    const [runningChatSessionIds, setRunningChatSessionIds] = useState<ReadonlySet<string>>(() => new Set());
    const sessionsRunning = useSessionsRunning(blockVisible);
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const visibleSessions = useMemo(() => {
        const base = sortSessionsByTime(sessions, sortDescending);
        return newSession != null ? [newSession, ...base] : base;
    }, [sessions, sortDescending, newSession]);
    // 多选集合始终是「当前可见会话」的子集：筛选 / 刷新后消失的会话不该继续
    // 留在选区内，否则批量栏的「复制 5 个 ID」实际只有 2 条在结果里。
    // New Chat 占位没有 id / filePath，进选区只会让复制产物出现空行，排除它。
    const selectableKeys = useMemo(
        () => visibleSessions.filter((session) => session.key !== NewSessionKey).map((session) => session.key),
        [visibleSessions]
    );
    useEffect(() => {
        model.pruneSelection(selectableKeys);
    }, [model, selectableKeys]);
    // 选区内会话（按用户点击顺序，不是列表顺序 —— 决定复制产物的行序）。
    const selectedSessions = useMemo(() => {
        if (selectedKeys.length === 0) return [];
        const byKey = new Map(visibleSessions.map((session) => [session.key, session]));
        return selectedKeys
            .map((key) => byKey.get(key))
            .filter((session): session is SessionSummary => session != null);
    }, [visibleSessions, selectedKeys]);
    const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
    const selectionAllStarred = selectedSessions.length > 0 && selectedSessions.every((session) => session.marked);
    /*
     * The 按项目 cut of the same pool. The New Chat placeholder is pinned above
     * every group (it has no folder yet), so it is set aside before grouping;
     * every real session ends up in exactly one bucket, empty buckets never render.
     */
    const groupedSessions = useMemo(() => {
        const base = newSession != null ? visibleSessions.slice(1) : visibleSessions;
        return groupSessionsByProject(base, sortDescending);
    }, [visibleSessions, newSession, sortDescending]);

    // 一键展开/全部收起的全局覆盖状态。纯内存态，不落盘：刷新后回到
    // expandedParents（默认空 = 全部折叠），所以一键展开不会变成新的默认行为。
    // 声明位置在 toggleExpandParent 之前：那个回调的 deps 会立即求值。
    type SubSessionsOverride = "expanded" | "collapsed" | null;
    const [subSessionsOverride, setSubSessionsOverride] = useState<SubSessionsOverride>(null);
    const allParentKeys = useMemo(() => [...collectParentKeys(sessions)], [sessions]);

    const toggleExpandParent = useCallback(
        (sessionKey: string, showAll = false) => {
            // 一键展开/全部收起是全局覆盖：此时点单个父行必须先把当前生效的集合
            // 物化进 expandedParents（否则一进手动模式列表会突然全收/全展），
            // 然后像平常一样增删这一行。
            const currentOverride = subSessionsOverride;
            const effective = currentOverride === "expanded" ? allParentKeys : [];
            const base = currentOverride == null ? expandedParents : effective;
            const autoBase = currentOverride == null ? autoExpandedParents : [];
            if (currentOverride != null) {
                setSubSessionsOverride(null);
                setExpandedParents([...base]);
                setAutoExpandedParents(autoBase);
            }
            const currentlyExpanded = base.includes(sessionKey) || autoBase.includes(sessionKey);
            // 自动展开不是用户选择：点一下箭头就应该能把它收起来，所以两处都清，
            // 并记进抑制集，避免命中集合变化时又被自动加回来。
            if (currentlyExpanded) {
                suppressedAutoExpandRef.current.add(sessionKey);
            } else {
                suppressedAutoExpandRef.current.delete(sessionKey);
            }
            setAutoExpandedParents((current) => current.filter((key) => key !== sessionKey));
            if (showAll) {
                setFullyExpandedParents((current) => {
                    const next = new Set(current);
                    next.add(sessionKey);
                    return next;
                });
                setExpandedParents((current) => (current.includes(sessionKey) ? current : [...current, sessionKey]));
                return;
            }
            setExpandedParents((current) =>
                currentlyExpanded ? current.filter((key) => key !== sessionKey) : [...current, sessionKey]
            );
            // 收起时顺手清掉「显示全部」，否则下次展开会一次性铺开上百行。
            setFullyExpandedParents((current) => {
                if (!current.has(sessionKey)) return current;
                const next = new Set(current);
                next.delete(sessionKey);
                return next;
            });
        },
        [expandedParents, autoExpandedParents, subSessionsOverride, allParentKeys]
    );
    const normalizedTagFilters = normalizeSessionTags(tagFilters);
    const normalizedExcludeTags = normalizeSessionTags(excludeTags);
    const normalizedPathSelections = useMemo(() => normalizePathSelections(pathSelections), [pathSelections]);
    const normalizedPathExcludes = useMemo(() => normalizePathSelections(pathExcludes), [pathExcludes]);
    const queryActive = query.trim().length > 0;
    const tagFilterActive = normalizedTagFilters.length > 0;
    const tagPresenceActive = tagPresence !== DefaultTagPresence;
    const markedActive = markedFilter !== "all";
    const dateActive = dateRange.preset !== "all";
    const pathActive = normalizedPathSelections.length > 0;
    const pathExcludeActive = normalizedPathExcludes.length > 0;
    const excludeTagsActive = normalizedExcludeTags.length > 0;
    const remoteFilterActive =
        queryActive ||
        source !== "" ||
        tagFilterActive ||
        tagPresenceActive ||
        markedActive ||
        dateActive ||
        pathActive ||
        pathExcludeActive ||
        excludeTagsActive;
    const filterActive = remoteFilterActive;
    const filterBusy = loading && remoteFilterActive;
    const activeFilterCount =
        (markedActive ? 1 : 0) +
        (dateActive ? 1 : 0) +
        normalizedTagFilters.length +
        normalizedPathSelections.length +
        normalizedPathExcludes.length +
        normalizedExcludeTags.length +
        (tagPresenceActive ? 1 : 0) +
        (source !== "" ? 1 : 0);
    // 搜索/筛选命中子会话时，自动展开它的父：结果集是后端过滤后的子集，
    // 「子行命中但父行没命中」在这个集合里只能靠 parentKey 关系反推。
    // 只加不减，避免每次筛选都覆盖用户手动展开/收起的选择。
    const matchedChildParentKeys = useMemo(() => {
        if (!filterActive) {
            return [] as string[];
        }
        const keys = new Set<string>();
        const known = new Set(visibleSessions.map((session) => session.key));
        for (const session of visibleSessions) {
            const parentKey = (session.parentKey ?? "").trim();
            if (parentKey !== "" && known.has(parentKey)) {
                keys.add(parentKey);
            }
        }
        return [...keys];
    }, [filterActive, visibleSessions]);

    // 用户在筛选期间手动收起的父：自动展开必须尊重它，否则列表 60s 自动刷新一次
    // 就会把刚收起的父行重新撑开。只在筛选条件本身变化时清空。
    const suppressedAutoExpandRef = useRef<Set<string>>(new Set());
    const filterSignature = [
        query,
        source,
        normalizedTagFilters.join(","),
        normalizedExcludeTags.join(","),
        tagPresence,
        markedFilter,
        dateRange.preset,
        normalizedPathSelections.join(","),
        normalizedPathExcludes.join(","),
    ].join("\u0000");

    useEffect(() => {
        suppressedAutoExpandRef.current.clear();
    }, [filterSignature]);

    const matchedChildParentKeySignature = matchedChildParentKeys.join("\u0000");
    useEffect(() => {
        if (matchedChildParentKeys.length === 0) {
            return;
        }
        setAutoExpandedParents((current) => {
            const missing = matchedChildParentKeys.filter(
                (key) => !current.includes(key) && !suppressedAutoExpandRef.current.has(key)
            );
            return missing.length === 0 ? current : [...current, ...missing];
        });
        // 依赖签名而不是数组：列表默认 60s 自动刷新会生成新数组，直接依赖数组会让
        // 用户刚收起的父行被下一次刷新又撑开。
    }, [matchedChildParentKeySignature]);

    // 清掉筛选后回到「默认全部收起」：自动展开是筛选的副产品，不是用户的选择。
    useEffect(() => {
        if (filterActive) {
            return;
        }
        setAutoExpandedParents((current) => (current.length === 0 ? current : []));
    }, [filterActive]);

    // 渲染用「用户展开 ∪ 搜索自动展开」；写入 localStorage 的只有前一部分。
    const renderedExpandedParents = useMemo(() => {
        if (subSessionsOverride === "expanded") return allParentKeys;
        if (subSessionsOverride === "collapsed") return [];
        return autoExpandedParents.length === 0
            ? expandedParents
            : [...new Set([...expandedParents, ...autoExpandedParents])];
    }, [subSessionsOverride, allParentKeys, autoExpandedParents, expandedParents]);
    const allSubSessionsExpanded =
        allParentKeys.length > 0 && allParentKeys.every((key) => renderedExpandedParents.includes(key));

    const toggleSubSessions = useCallback(() => {
        const expandedNow =
            allParentKeys.length > 0 && allParentKeys.every((key) => renderedExpandedParents.includes(key));
        if (expandedNow) {
            // 全部收起：物化成「空」并压制筛选自动展开，否则下一个筛选条件或 60s
            // 刷新又会把父行撑开，用户看不到收起效果。
            setSubSessionsOverride("collapsed");
            setExpandedParents([]);
            setFullyExpandedParents(new Set());
            setAutoExpandedParents([]);
            for (const key of allParentKeys) {
                suppressedAutoExpandRef.current.add(key);
            }
            return;
        }
        setSubSessionsOverride("expanded");
    }, [allParentKeys, renderedExpandedParents]);

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
            // 后台同步：不触发整面板 loading/黑屏，也不做破坏性的会话切换。
            void model.loadSessions(false, globalStore.get(model.sortDescendingAtom), true);
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
        writeExpandedParents(expandedParents);
    }, [expandedParents]);

    useEffect(() => {
        const handleNoteUpdated = (event: Event) => {
            if (isAISessionNoteUpdatedEvent(event)) {
                model.replaceSession(event.detail.summary);
            }
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, [model]);

    // 后台 AI 生成（标题 / note+tags）完成后后端广播 titleupdated；
    // 列表需要据此刷新行标题与 note/tags，否则只有已订阅的卡片会变。
    useEffect(() => {
        return waveEventSubscribeSingle<"aisessions:titleupdated">({
            eventType: "aisessions:titleupdated",
            handler: (event) => {
                const summary = event.data?.summary;
                if (summary != null) {
                    model.replaceSession(summary);
                }
            },
        });
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

    const toggleExcludeTag = useCallback(
        (tag: string) => {
            model.toggleExcludeTag(tag);
        },
        [model]
    );

    const togglePathSelection = useCallback(
        (prefix: string) => {
            model.togglePathSelection(prefix);
        },
        [model]
    );

    const togglePathExclude = useCallback(
        (prefix: string) => {
            model.togglePathExclude(prefix);
        },
        [model]
    );

    // ── 多选 / 框选 / 批量操作 ────────────────────────────────────
    // 框选与点击的仲裁：位移未达 DragThresholdPx 视为点击（走行自己的
    // onSelect），否则进入框选并抑制这一次点击。用 ref 而不是 state，
    // 因为 mouseup 与行 onClick 之间不能多一次渲染。
    const suppressRowClickRef = useRef(false);
    const marqueeStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);
    const marqueeContainerRef = useRef<HTMLDivElement | null>(null);
    const marqueeAdditiveRef = useRef(false);
    const marqueeBaseRef = useRef<string[]>([]);

    const clearSelection = useCallback(() => model.clearSelection(), [model]);

    const copySelection = useCallback(
        (kind: BatchCopyKind) => {
            const text = buildBatchCopyText(selectedSessions, kind);
            if (text === "") return;
            void copyText(text);
            setCopiedKind(kind);
        },
        [selectedSessions]
    );

    useEffect(() => {
        if (copiedKind == null) return;
        const handle = window.setTimeout(() => setCopiedKind(null), 700);
        return () => window.clearTimeout(handle);
    }, [copiedKind]);

    const setStarredForSelection = useCallback(
        (marked: boolean) => {
            for (const session of selectedSessions) {
                if (session.marked !== marked) {
                    model.toggleMark(session);
                }
            }
        },
        [model, selectedSessions]
    );

    // Ctrl+A / Esc：只在焦点不在输入框时生效，否则会抢掉搜索框的文本全选。
    const handleListKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement | null;
            if (target != null && typeof target.closest === "function") {
                if (target.closest("input, textarea, [contenteditable='true']") != null) {
                    return;
                }
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                model.selectAllVisible(selectableKeys);
                return;
            }
            if (event.key === "Escape") {
                model.clearSelection();
            }
        },
        [model, selectableKeys]
    );

    // 框选：mousedown 记录起点，mousemove 超阈值后才开始画矩形。
    // 坐标统一存「视口坐标 + 当时 scrollTop」，每帧按当前 scrollTop 重算，
    // 这样拖动过程中容器自动滚动时矩形不会和内容错位。
    const startMarquee = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
            const target = event.target as HTMLElement | null;
            if (target != null && typeof target.closest === "function") {
                // 行与行内按钮自己处理点击，不在它们身上起框选。
                if (target.closest("[data-row-action], [data-session-key]") != null) {
                    return;
                }
            }
            const container = marqueeContainerRef.current;
            if (container == null) return;
            marqueeStartRef.current = {
                x: event.clientX,
                y: event.clientY,
                scrollTop: container.scrollTop,
            };
            marqueeAdditiveRef.current = event.ctrlKey || event.metaKey;
            marqueeBaseRef.current = event.ctrlKey || event.metaKey ? selectedKeys : [];
        },
        [selectedKeys]
    );

    useEffect(() => {
        const handleMove = (event: MouseEvent) => {
            const start = marqueeStartRef.current;
            const container = marqueeContainerRef.current;
            if (start == null || container == null) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (!isDragMovement(dx, dy)) return;
            const rect: Rect = {
                left: Math.min(start.x, event.clientX),
                top: Math.min(start.y, event.clientY),
                right: Math.max(start.x, event.clientX),
                bottom: Math.max(start.y, event.clientY),
            };
            globalStore.set(model.marqueeRectAtom, rectToCss(rect));
            const rows = Array.from(container.querySelectorAll("[data-session-key]")).map((el) => ({
                key: (el as HTMLElement).dataset.sessionKey ?? "",
                el: el as HTMLElement,
            }));
            const hit = keysUnderRect(
                rect,
                rows.filter((row) => row.key !== "")
            );
            const base = marqueeAdditiveRef.current ? marqueeBaseRef.current : [];
            const merged = [...base];
            for (const key of hit) {
                if (!merged.includes(key)) merged.push(key);
            }
            globalStore.set(model.selectedKeysAtom, merged);
        };
        const handleUp = (event: MouseEvent) => {
            const start = marqueeStartRef.current;
            if (start == null) return;
            const dragged = isDragMovement(event.clientX - start.x, event.clientY - start.y);
            marqueeStartRef.current = null;
            globalStore.set(model.marqueeRectAtom, null);
            if (dragged) {
                // 拖拽结束后的那一次 click 不应再把选区改成单选。
                suppressRowClickRef.current = true;
                window.setTimeout(() => {
                    suppressRowClickRef.current = false;
                }, 0);
            }
        };
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleUp);
        return () => {
            document.removeEventListener("mousemove", handleMove);
            document.removeEventListener("mouseup", handleUp);
        };
    }, [model]);

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

    // 打开 Detail Block。双击行、Ctrl/Cmd+点击、会话菜单共用。
    // 纯列表块：新建独立 Detail Block（不抢占列表本身）；详情块：同样新开一个块，
    // 便于左右对比同一个会话。
    // 默认不强制单开：同一个会话已经开着时聚焦已有块，避免重复点击堆出一排相同详情块。
    // 只有 Ctrl/Cmd+点击（forceNew=true）才刻意再开一个用于左右对比。
    const openSessionDetail = useCallback(
        (session: SessionSummary, forceNew = false) => {
            if (!session.key) return;
            // cwd 只用于 tab 分层标题（项目文件夹 basename），不参与会话加载。
            fireAndForget(() =>
                openAISessionDetailFromList(session.key, model.blockId, {
                    forceNewBlock: forceNew,
                    cwd: session.projectPath,
                })
            );
        },
        [model.blockId]
    );

    const gridTemplateColumns = !showsDetailPane
        ? "minmax(0,1fr)"
        : sessionListCollapsed
          ? "minmax(0,1fr)"
          : `${sessionListWidth}px minmax(0,1fr)`;
    const lastRefreshLabel = lastSessionsRefreshAt
        ? formatRelativeRefreshTime(lastSessionsRefreshAt, refreshTimeNow)
        : "";
    const lastRefreshTitle = lastSessionsRefreshAt
        ? `Last refreshed ${formatDateTimeToSecond(lastSessionsRefreshAt)}`
        : "";

    return (
        <div ref={rootRef} className="flex h-full w-full min-h-0 flex-col bg-block-solid text-primary">
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
                                    <GroupModeSwitch mode={groupMode} onChange={(next) => setGroupMode(next)} />
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
                                    <SubSessionsToggle
                                        allExpanded={allSubSessionsExpanded}
                                        parentCount={allParentKeys.length}
                                        onToggle={toggleSubSessions}
                                    />
                                    <ExpandAllTagsButton
                                        expanded={expandAllTags}
                                        onToggle={() => setExpandAllTags((current) => !current)}
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
                                    excludeTags={normalizedExcludeTags}
                                    tagPresence={tagPresence}
                                    setTagPresence={(next) => model.setTagPresence(next)}
                                    toggleTagFilter={toggleTagFilter}
                                    toggleExcludeTag={toggleExcludeTag}
                                    onClearAll={() => model.clearAllFilters()}
                                    pathFilter={pathFilter}
                                    setPathFilter={setPathFilter}
                                    pathSelections={normalizedPathSelections}
                                    togglePathSelection={togglePathSelection}
                                    pathExcludes={normalizedPathExcludes}
                                    togglePathExclude={togglePathExclude}
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
                            {scanning ? (
                                <ScanProgressStrip scanned={scanProgress.scanned} total={scanProgress.total} />
                            ) : null}
                            <SessionBatchBar
                                selectedCount={selectedKeys.length}
                                selectedKeys={selectedKeys}
                                connection={model.getConnection()}
                                copiedKind={copiedKind}
                                starred={selectionAllStarred}
                                onCopy={copySelection}
                                onStar={() => setStarredForSelection(true)}
                                onUnstar={() => setStarredForSelection(false)}
                                onClear={clearSelection}
                                onAutoGenerate={(kind) => {
                                    const connection = model.getConnection();
                                    void autoGenerate(autoGenService, {
                                        ids: selectedKeys,
                                        connection,
                                        kind,
                                        source: "batch",
                                    }).then((result) => {
                                        if (!result.ok) {
                                            globalStore.set(model.errorAtom, result.error);
                                        }
                                    });
                                }}
                            />
                            <div
                                ref={marqueeContainerRef}
                                className="relative min-h-0 flex-1 overflow-auto"
                                tabIndex={-1}
                                onKeyDown={handleListKeyDown}
                                onMouseDown={startMarquee}
                            >
                                {marqueeRect != null ? (
                                    <div
                                        aria-hidden="true"
                                        className="pointer-events-none absolute z-20 border border-accent/60 bg-accent/10"
                                        style={{
                                            left: marqueeRect.left,
                                            top: marqueeRect.top,
                                            width: marqueeRect.width,
                                            height: marqueeRect.height,
                                        }}
                                    />
                                ) : null}
                                {loading && visibleSessions.length === 0 && !scanning ? (
                                    <EmptyState text="Loading sessions..." />
                                ) : visibleSessions.length === 0 && !scanning ? (
                                    <EmptyState text={emptySessionsText(markedFilter, remoteFilterActive)} />
                                ) : (
                                    <>
                                        {visibleSessions.length > 0 ? (
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
                                                expandedParents={renderedExpandedParents}
                                                onToggleExpandParent={toggleExpandParent}
                                                fullyExpandedParents={fullyExpandedParents}
                                                expandAllTags={expandAllTags}
                                                sortDescending={sortDescending}
                                                selectedKey={selectedKey}
                                                selectedKeys={selectedKeySet}
                                                onSelectNew={() => {
                                                    if (!showsDetailPane) {
                                                        // 列表/详情分离：新会话也开独立详情块。
                                                        fireAndForget(() =>
                                                            openAISessionNewChatFromList(model.blockId)
                                                        );
                                                        return;
                                                    }
                                                    globalStore.set(model.selectedKeyAtom, NewSessionKey);
                                                    globalStore.set(model.detailAtom, null);
                                                }}
                                                onSelectSession={(session, event) => {
                                                    // 框选刚结束的那一次 click：不再把选区改回单选。
                                                    if (suppressRowClickRef.current) {
                                                        suppressRowClickRef.current = false;
                                                        return;
                                                    }
                                                    // Ctrl/Cmd+点击 = 多选切换（批量操作）。强制新开
                                                    // Detail Block 的手势已移到 Ctrl+双击。
                                                    if (event.metaKey || event.ctrlKey) {
                                                        model.toggleInSelection(session.key);
                                                        return;
                                                    }
                                                    // Shift+点击 = 从锚点到当前行的范围选。
                                                    if (event.shiftKey) {
                                                        const anchor = globalStore.get(model.selectionAnchorAtom);
                                                        const range = applySelectionRange(
                                                            selectableKeys,
                                                            anchor,
                                                            session.key
                                                        );
                                                        globalStore.set(model.selectedKeysAtom, range);
                                                        globalStore.set(model.selectedKeyAtom, session.key);
                                                        return;
                                                    }
                                                    // 单击 = 单选：清空多选集合。
                                                    model.setSelectedKey(session.key);
                                                    if (!showsDetailPane) {
                                                        // 纯列表块：单击只选中，不再自动弹详情。
                                                        // 想看详情请双击该行（或 Ctrl/Cmd+双击）。
                                                        return;
                                                    }
                                                    // 详情块：单击切换右侧详情面板。
                                                    void model.loadDetail(session);
                                                }}
                                                onOpenSession={(session, event) =>
                                                    openSessionDetail(session, event.metaKey || event.ctrlKey)
                                                }
                                                onMark={(session, e) => {
                                                    e.stopPropagation();
                                                    model.toggleMark(session);
                                                }}
                                                onNoteSave={(session, note, tags) =>
                                                    model.updateNote(session, note, tags)
                                                }
                                                onResume={(session, e) => {
                                                    e.stopPropagation();
                                                    void model.restoreSession(session);
                                                }}
                                                resumeDisabled={restoring}
                                                runningStateOf={(session) =>
                                                    sessionsRunning.get(session.key) ??
                                                    sessionsRunning.get(session.id) ??
                                                    null
                                                }
                                                chatRunningOf={(session) =>
                                                    runningChatSessionIds.has(session.key) ||
                                                    runningChatSessionIds.has(session.id)
                                                }
                                                onJumpToBlock={jumpToRunningSessionBlock}
                                                connection={model.getConnection()}
                                            />
                                        ) : null}
                                        {scanning ? <SkeletonSessionRows /> : null}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                    {!sessionListCollapsed && showsDetailPane ? (
                        <div
                            role="separator"
                            aria-label="Resize sessions list"
                            aria-orientation="vertical"
                            className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-accent/20"
                            onMouseDown={startSessionListResize}
                        />
                    ) : null}
                </div>
                {showsDetailPane ? (
                    <SessionDetailPane
                        model={model}
                        detail={detail}
                        isNewChat={activeSession?.key === NewSessionKey}
                        newChatEpoch={newChatEpoch}
                        loading={
                            error === "" && detailLoading && detail == null && activeSession?.key !== NewSessionKey
                        }
                        deltaLoading={detailDeltaLoading}
                        toolCallsLoading={toolCallsLoading}
                        restoring={restoring}
                        deleting={deleting}
                        error={error}
                        historySyncError={historySyncError}
                        onBound={(sessionId) => model.bindNewSession(sessionId)}
                        onRunningSessionIdsChange={handleRunningChatSessionIdsChange}
                        onExpandSessionList={sessionListCollapsed ? () => setSessionListCollapsed(false) : undefined}
                    />
                ) : null}
            </div>
        </div>
    );
}
