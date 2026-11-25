// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { ackAgentStatus as ackAgentStatusUnified } from "@/app/agent-status/agent-status-ack";
import {
    aggregateAgentStatuses,
    aggregateStatusLabel,
    formatAgentProvider,
} from "@/app/agent-status/agent-status-derive";
import { agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import { isAgentDoneUnread } from "@/app/agent-status/agent-status-done-unread";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread } from "@/app/agent-status/agent-status-unread";
import { blockViewToIcon, blockViewToName } from "@/app/block/blockutil";
import { AppSelect } from "@/app/element/select";
import { Tooltip } from "@/app/element/tooltip";
import { getBadgeAtom, getTabBadgeAtom } from "@/app/store/badge";
import { FocusManager } from "@/app/store/focusManager";
import { atoms, setActiveTab, WOS } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { uxCloseBlock } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType, BlockServiceType, ClientService, ObjectService, WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { primeSessionNote } from "@/app/store/session-note-cache";
import { openedThisLaunchTabIdsAtom } from "@/app/tab/tab-open-state";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "@/app/view/aisessions/session-note-events";
import { OriginMetaKey, parseOriginMeta } from "@/app/view/aisessions/origin-state";
import { extractSessionTagsFromNote, mergeSessionTags, sessionTagsEqual } from "@/app/view/aisessions/session-tags";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import {
    collectAgentLaunchTargetsInTab,
    createAgentBlockDefForProfile,
    resolveAgentBlockCommandForLaunch,
    resolveWorkspaceAgentContextMeta,
} from "@/app/workspace/agent-launch";
import { i18n } from "@/i18n/config";
import { localeTextAtom, useActiveLocale } from "@/i18n/i18nmodel";
import { getHiddenBlockIdsFromTab, getLayoutModelForTabById } from "@/layout/index";
import { basename, cn, fireAndForget, formatCompactDuration, makeIconClass, stringToBase64 } from "@/util/util";
import debug from "debug";
import * as jotai from "jotai";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AgentStatusChip, shouldShowAgentStatusChip } from "./agent-status-chip";
import { planBlockRemoval } from "./block-removal";
import { buildAddAgentLaunchContext } from "./overview-add-agent";
import { OverviewAddAgentModal, type AddAgentSubmitRequest } from "./overview-add-agent-modal";
import { OverviewNewTabModal, type NewTabSubmitRequest } from "./overview-new-tab-modal";
import { OverviewBoard } from "./overview-board";
import { OverviewScheduledTasksSection } from "./overview-scheduled-tasks-panel";
import {
    normalizeBoardTags,
    OVERVIEW_BOARD_ENABLED,
    overviewBoardGroupAtom,
    overviewViewModeAtom,
    OverviewViewModesImplemented,
    projectNameFromPath,
    providerDisplayLabel,
    resolveBoardCardTitle,
    resolveBoardPropRows,
    resolveBoardTagChips,
    truncateBoardPreview,
    type BoardPropRow,
    type OverviewBoardAvatar,
    type OverviewBoardCard,
    type OverviewBoardGroup,
    type OverviewViewMode,
    type OverviewViewModeImplemented,
} from "./overview-board-model";
import { CardSendContext, CardSendPanel, useCardSendState } from "./overview-card-send-panel";
import { SendStatusChip } from "./send-status-chip";
import {
    buildRecentMessageSquares,
    messagePreview,
    readableMessages,
} from "./session-message-items";
import { SessionMessageSquares } from "./session-message-squares";
import { normalizeTimeMs } from "./session-time";
import { OverviewTimeline } from "./overview-timeline";
import { buildTabGroups, type OverviewTabGroup } from "./overview-tab-groups";
import {
    buildTimelineRows,
    buildTimelineSegments,
    formatTimelineRangeLabel,
    overviewTimelineRangeAtom,
    OverviewTimelineRangeDefault,
    OverviewTimelineRanges,
    timelineRangeToMs,
    type OverviewTimelineRange,
    type OverviewTimelineSegment,
} from "./overview-timeline-model";
import { SessionMetrics } from "./session-metrics";
import {
    agentStatusHookProvidersForInstall,
    agentStatusHookStatusesNeedingInstall,
} from "./session-overview-agent-status";
import { SessionOverviewModel, type OverviewBlock } from "./session-overview-model";
import {
    getCachedSessionDetail,
    getCachedSessionSummary,
    getSessionOverviewCacheRevision,
    getSessionOverviewCacheSnapshot,
    loadCachedSessionDetail,
    loadCachedSessionSummary,
    patchCachedSessionSummary,
    subscribeSessionOverviewCacheChannel,
    type SessionOverviewCacheChannel,
} from "./session-overview-session-cache";
import "./session-overview.scss";

const agentStatusLog = debug("wave:agentstatus");
const overviewLog = debug("wave:sessionoverview");

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

type SessionActionState = {
    deletingSessionId: string;
    error: string;
};

type OverviewSessionNoteEditorHandle = {
    saveBeforeSwitch: () => Promise<boolean>;
};

type OverviewSessionNoteEditorProps = {
    block: OverviewBlock;
    initialSummary: SessionSummary | null | undefined;
    onClose: () => void;
};

type HookInstallState = {
    loading: boolean;
    installing: boolean;
    statuses: HookStatus[];
    status: HookStatus | null;
    error: string;
};

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

const SessionOverviewNoteAutoSaveDelayMs = 3000;

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

function formatUnreadDuration(startMs: number, nowMs: number): string {
    return formatCompactDuration(startMs, nowMs);
}

function blockTitle(block: Block, view: string): string {
    const meta = block?.meta ?? {};
    // cwd basename 兜底：agent/term 块通常没有 frame:title，直接回退 blockViewToName 会让
    // Overview 卡片显示成裸 "Terminal"（用户 2026-11-05 反馈）。有 cwd 时用目录名更可辨识。
    const cwd = typeof meta["cmd:cwd"] === "string" ? basename(meta["cmd:cwd"] as string) : "";
    return meta["frame:title"] || meta["display:name"] || meta.file || meta.url || cwd || blockViewToName(view);
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

function openSessionDetail(sessionId: string, connection?: string): void {
    if (!sessionId) return;
    const trimmed = connection?.trim() ?? "";
    // connection 必须传：远端块的会话 id 是裸 id，不传 connection 时后端会落到本机 manager。
    modalsModel.pushModal("AISessionDetailModal", {
        sessionId,
        connection: trimmed !== "" ? trimmed : undefined,
    });
}

export { planBlockRemoval };

async function closeOverviewBlock(block: OverviewBlock): Promise<void> {
    const staticTabId = globalStore.get(atoms.staticTabId);
    const layoutModel = block.tabId ? getLayoutModelForTabById(block.tabId) : null;
    const node = layoutModel?.getNodeByBlockId(block.blockId) ?? null;
    const plan = planBlockRemoval({
        tabId: block.tabId,
        blockId: block.blockId,
        staticTabId,
        hasNode: node != null,
        hasOnNodeDelete: layoutModel?.onNodeDelete != null,
    });
    if (plan.kind === "ux-close-block") {
        await uxCloseBlock(plan.blockId);
        return;
    }
    if (plan.kind === "layout-close-block") {
        const tabLayoutModel = getLayoutModelForTabById(plan.tabId);
        if (tabLayoutModel?.getNodeByBlockId(plan.blockId) != null) {
            await tabLayoutModel.closeBlock(plan.blockId);
            return;
        }
        await ObjectService.DeleteBlock(plan.blockId);
        return;
    }
    await ObjectService.DeleteBlock(plan.blockId);
}

function shouldShowFullOverviewBlock(block: OverviewBlock): boolean {
    return block.isAgentLike || block.view === "term";
}

/**
 * Board card identity: persona chain (session → provider → brand logo) for agents,
 * plain view icon for other blocks. Single source — same `getAgentIcon` as the list row
 * and the term block header, so a persona change updates every surface.
 */
function resolveBoardAvatar(
    block: OverviewBlock,
    personas: Record<string, string>,
    sessionEmojis: Record<string, string>
): OverviewBoardAvatar {
    if (!block.isAgentLike) {
        return {
            kind: "icon",
            iconClass: makeIconClass(blockViewToIcon(block.view), false, { defaultIcon: "square" }),
        };
    }
    const icon = getAgentIcon(block.agentProvider ?? "", {
        meta: block.block?.meta,
        sessionId: block.sessionId,
        personas,
        sessionEmojis,
    });
    if (icon?.kind === "emoji") {
        return { kind: "emoji", emoji: icon.emoji };
    }
    if (icon?.kind === "logo") {
        return { kind: "logo", icon: icon.icon, color: icon.iconColor };
    }
    return { kind: "icon", iconClass: makeIconClass("robot", false) };
}

function useOverviewBlocks(workspace: Workspace | null): OverviewBlock[] {
    // Locale dep: `blockTitle()` falls back to the localized view name, so the
    // derived atom must be rebuilt when `ui:locale` changes.
    const activeLocale = useActiveLocale();
    const tabIds = workspace?.tabids ?? [];
    const tabIdsKey = tabIds.join("\n");
    // 两阶段批量 prime（读路径旁路，2026-11-22）：先把 tab 一次拉齐（1 次 GetObjects），
    // 再把这些 tab 的 block 一次拉齐（1 次 GetObjects，>400 分批）。此前每块单发
    // GetObject（19 Tab ≈ 190 次），首帧全 null → 组被「空组过滤」删掉。
    // 已解析 oref 幂等跳过；单件懒加载（getWaveObjectAtom）保留作为兜底。
    useEffect(() => {
        if (tabIds.length === 0) {
            return;
        }
        let cancelled = false;
        const primeTabsAndBlocks = async (): Promise<void> => {
            await WOS.primeWaveObjects(tabIds.map((tabId) => WOS.makeORef("tab", tabId)));
            if (cancelled) {
                return;
            }
            const blockOrefs: string[] = [];
            for (const tabId of tabIds) {
                const tab = WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabId));
                for (const blockId of tab?.blockids ?? []) {
                    const oref = WOS.makeORef("block", blockId);
                    if (oref != null) {
                        blockOrefs.push(oref);
                    }
                }
            }
            if (cancelled || blockOrefs.length === 0) {
                return;
            }
            await WOS.primeWaveObjects(blockOrefs);
        };
        fireAndForget(primeTabsAndBlocks);
        return () => {
            cancelled = true;
        };
    }, [workspace?.oid, tabIdsKey]);
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
                            tabName: tab.name ?? i18n.t("session-overview:dialog.untitled"),
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
        // locale in deps: blockTitle() falls back to the localized view name.
        [workspace?.oid, tabIdsKey, activeLocale]
    );
    return jotai.useAtomValue(overviewAtom);
}

/**
 * Tab 分组需要的静态索引：解析后的 Tab 对象 + 哪些 block id 是 Overview 块。
 *
 * 单独成 hook（而不是揉进 `useOverviewBlocks`）是因为那边输出 shape 被看板/时间线共用，
 * 不能变；这里只供列表分组用，`overviewBlockIds` 用来判定 `empty`（只含 Overview 块的 Tab）。
 */
function useOverviewTabIndex(workspace: Workspace | null): {
    tabById: Map<string, Tab | null>;
    overviewBlockIds: Set<string>;
} {
    const tabIds = workspace?.tabids ?? [];
    const tabIdsKey = tabIds.join("\n");
    const indexAtom = useMemo(
        () =>
            jotai.atom((get) => {
                const tabById = new Map<string, Tab | null>();
                const overviewBlockIds = new Set<string>();
                for (const tabId of tabIds) {
                    const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
                    tabById.set(tabId, tab ?? null);
                    for (const blockId of tab?.blockids ?? []) {
                        const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
                        const meta = (block?.meta ?? {}) as Record<string, unknown>;
                        if (meta.view === "sessionoverview") {
                            overviewBlockIds.add(blockId);
                        }
                    }
                }
                return { tabById, overviewBlockIds };
            }),
        [workspace?.oid, tabIdsKey]
    );
    return jotai.useAtomValue(indexAtom);
}

/**
 * Session Overview 唯一的状态来源: 直接读 AgentStatusStore 的统一 presented atom.
 *
 * 历史上这里自建 GetAgentStatus 拉取 + agentstatus 订阅, 并额外用 presentAgentStatus
 * 做 "canonical idle + 未读 session 更新 -> done" 派生. 那条派生路径与 agent Block 头部
 * (只 applyStaleness) 产出的 state/source 不同 -> 同一个 block 两处文案与 ack 指纹全部不一致
 * (Overview "Done" vs 头部 "Idle 10m"; 一侧 ack 另一侧复活).
 *
 * 现在 done 派生统一收敛到 presentCanonicalAgentStatus (store 内), 这里只负责 acquire 订阅
 * 并按 blockId 读取, 保证与头部 / inline tab / Tab 圆点读到的是同一个对象、同一个 fingerprint.
 */
function useOverviewPresentedStatuses(blockIds: string[], active: boolean): Record<string, AgentStatus | null> {
    const store = AgentStatusStore.getInstance();
    const blockIdsKey = blockIds.join("\n");
    const [atoms, setAtoms] = useState<Record<string, jotai.Atom<AgentStatus | null>>>({});
    useEffect(() => {
        if (!active) {
            setAtoms({});
            return;
        }
        for (const blockId of blockIds) {
            store.acquire(blockId);
        }
        const next: Record<string, jotai.Atom<AgentStatus | null>> = {};
        for (const blockId of blockIds) {
            const presented = store.peekPresentedStatusAtom(blockId);
            if (presented != null) {
                next[blockId] = presented;
            }
        }
        setAtoms(next);
        return () => {
            for (const blockId of blockIds) {
                store.release(blockId);
            }
        };
    }, [store, active, blockIds, blockIdsKey]);
    const recordAtom = useMemo(
        () =>
            jotai.atom((get) => {
                const out: Record<string, AgentStatus | null> = {};
                for (const [blockId, statusAtom] of Object.entries(atoms)) {
                    out[blockId] = get(statusAtom);
                }
                return out;
            }),
        [atoms]
    );
    return jotai.useAtomValue(recordAtom);
}

function normalizeAgentProviderName(provider: string): string {
    return provider.trim().toLowerCase();
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const SESSION_HISTORY_PENDING_MESSAGE = "Session history is not available yet.";
const SESSION_HISTORY_PENDING_RETRY_MS = 5_000;
const SESSION_DETAIL_TRANSIENT_RETRY_MS = 30_000;
const SESSION_SUMMARY_POLL_MS = 15_000;
const SESSION_TRANSIENT_FETCH_PENDING_MESSAGE = "Session connection is retrying.";

function isSessionNotFoundMessage(message: string, sessionId: string): boolean {
    const normalized = message.trim().toLowerCase();
    const normalizedSessionId = sessionId.trim().toLowerCase();
    if (!normalized.includes("session not found:")) return false;
    return normalizedSessionId === "" || normalized.includes(`session not found: ${normalizedSessionId}`);
}

function isSessionHistoryPendingMessage(message: string | undefined): boolean {
    return message === SESSION_HISTORY_PENDING_MESSAGE;
}

function isSessionTransientFetchPendingMessage(message: string | undefined): boolean {
    return message === SESSION_TRANSIENT_FETCH_PENDING_MESSAGE;
}

function isTransientFetchErrorMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return (
        normalized.includes("failed to fetch") ||
        normalized.includes("err_empty_response") ||
        normalized.includes("networkerror") ||
        normalized.includes("load failed")
    );
}

function useAgentStatusHookInstallState(providers: string[], active: boolean) {
    const service = useMemo(() => new BlockServiceType(), []);
    const providersKey = providers.join("\n");
    const providersForHook = useMemo(() => providersKey.split("\n").filter(Boolean), [providersKey]);
    const [state, setState] = useState<HookInstallState>({
        loading: false,
        installing: false,
        statuses: [],
        status: null,
        error: "",
    });
    const refresh = React.useCallback(() => {
        if (!active || providersForHook.length === 0) {
            setState({ loading: false, installing: false, statuses: [], status: null, error: "" });
            return;
        }
        setState((current) => ({ ...current, loading: true, error: "" }));
        service
            .CheckAgentStatusHooks("all")
            .then((result) => {
                const statuses = agentStatusHookStatusesNeedingInstall(providersForHook, result.statuses ?? []);
                setState((current) => ({
                    ...current,
                    loading: false,
                    statuses,
                    status: statuses[0] ?? null,
                    error: "",
                }));
            })
            .catch((error) => {
                setState((current) => ({
                    ...current,
                    loading: false,
                    statuses: [],
                    status: null,
                    error: error instanceof Error ? error.message : String(error),
                }));
            });
    }, [active, providersForHook, service]);
    useEffect(() => {
        refresh();
    }, [refresh]);
    const install = React.useCallback(() => {
        const providers = state.statuses.map((status) => normalizeAgentProviderName(status.provider)).filter(Boolean);
        if (providers.length === 0) {
            return;
        }
        setState((current) => ({ ...current, installing: true, error: "" }));
        Promise.all(providers.map((provider) => service.InstallAgentStatusHooks(provider)))
            .then((resultsByProvider) => {
                const results = resultsByProvider.flat();
                setState((current) => ({ ...current, installing: false }));
                const installResult = results.find((entry) =>
                    providers.includes(normalizeAgentProviderName(entry.Provider))
                );
                const updatedPath =
                    installResult?.HooksPath ||
                    installResult?.SettingsPath ||
                    installResult?.ConfigPath ||
                    installResult?.HookPath;
                modalsModel.pushModal("MessageModal", {
                    children: (
                        <div>
                            <div>
                                {i18n.t("session-overview:panel.hooksEnabledFor", {
                                    providers: providers
                                        .map(formatAgentProvider)
                                        .join(i18n.t("session-overview:panel.providerJoin")),
                                })}
                            </div>
                            {updatedPath ? (
                                <div>{i18n.t("session-overview:panel.hooksUpdated", { path: updatedPath })}</div>
                            ) : null}
                        </div>
                    ),
                });
                refresh();
            })
            .catch((error) => {
                const errorMessage = getErrorMessage(error);
                setState((current) => ({
                    ...current,
                    installing: false,
                    error: errorMessage,
                }));
                modalsModel.pushModal("MessageModal", {
                    children: (
                        <div>
                            <div>{i18n.t("session-overview:panel.hooksFailed")}</div>
                            <div>{errorMessage}</div>
                        </div>
                    ),
                });
            });
    }, [refresh, service, state.statuses]);
    return { ...state, install };
}

// 频道 revision hook (基于 useSyncExternalStore): 供三个 React 消费者订阅.
// 旧实现是本地 useState + passive effect subscribe, render 读取与订阅之间存在窗口, 且
// 隐藏时仍订阅缓存通知会无谓触发 React 更新. 新实现:
//   - 用 useSyncExternalStore 保证 render 与订阅一致性 (subscribed 快照 ≡ cache revision).
//   - active=false 时返回固定 0 且不订阅 (隐藏期间不参与 cache 通知), 再次激活时直接读到最新 revision.
//   - 写入路径同步 bump revision, 即便 cache 通知尚未 flush, 组件也已能读到最新 revision.
function subscribeChannel(channel: SessionOverviewCacheChannel): (cb: () => void) => () => void {
    return (cb: () => void) => subscribeSessionOverviewCacheChannel(channel, cb);
}
// 各频道 subscribe 函数引用稳定 (模块级常量), 不触发 useSyncExternalStore 重订阅.
const SUBSCRIBE_SUMMARY = subscribeChannel("summary");
const SUBSCRIBE_DETAIL = subscribeChannel("detail");
const NOOP_SUBSCRIBE = () => () => {};
const CONSTANT_ZERO = () => 0;
const GET_REVISION_SUMMARY = () => getSessionOverviewCacheRevision("summary");
const GET_REVISION_DETAIL = () => getSessionOverviewCacheRevision("detail");

function useSessionOverviewCacheRevision(channel: SessionOverviewCacheChannel, active = true): number {
    // active=false 时 useSyncExternalStore 用 NOOP_SUBSCRIBE + CONSTANT_ZERO, 不订阅外部 store.
    // active 切回 true 后切回真实 subscribe + getSnapshot, React 会重新订阅并读取最新 revision.
    if (channel === "summary") {
        return useSyncExternalStore(
            active ? SUBSCRIBE_SUMMARY : NOOP_SUBSCRIBE,
            active ? GET_REVISION_SUMMARY : CONSTANT_ZERO,
            CONSTANT_ZERO
        );
    }
    return useSyncExternalStore(
        active ? SUBSCRIBE_DETAIL : NOOP_SUBSCRIBE,
        active ? GET_REVISION_DETAIL : CONSTANT_ZERO,
        CONSTANT_ZERO
    );
}

function useSessionDetails(blocks: OverviewBlock[], refreshSeq: number, active: boolean): Record<string, DetailState> {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const sessionIdsKey = sessionIds.join("\n");
    // detail 消费者订阅 "detail" 频道; 隐藏 (active=false) 时退订, 节省 React 更新.
    const cacheRevision = useSessionOverviewCacheRevision("detail", active);
    const cacheSnapshot = useMemo(() => getSessionOverviewCacheSnapshot(sessionIds), [cacheRevision, sessionIdsKey]);
    const requestedRef = useRef(new Set<string>());
    const retryTimersRef = useRef(new Map<string, number>());
    const refreshSeqRef = useRef(refreshSeq);
    const [details, setDetails] = useState<Record<string, DetailState>>(() => {
        const next: Record<string, DetailState> = {};
        for (const sessionId of sessionIds) {
            const cachedDetail = getCachedSessionDetail(sessionId);
            if (cachedDetail != null) {
                next[sessionId] = { loading: false, detail: cachedDetail, error: "" };
            }
        }
        return next;
    });

    useEffect(() => {
        if (!active) {
            return;
        }
        let cancelled = false;
        const activeSessionIds = new Set(sessionIds);
        const retryTimers = retryTimersRef.current;
        const clearRetry = (sessionId: string) => {
            const timer = retryTimers.get(sessionId);
            if (timer == null) return;
            window.clearTimeout(timer);
            retryTimers.delete(sessionId);
        };
        const clearStaleRetries = () => {
            for (const [sessionId, timer] of retryTimers.entries()) {
                if (activeSessionIds.has(sessionId)) continue;
                window.clearTimeout(timer);
                retryTimers.delete(sessionId);
            }
        };
        const loadDetail = (sessionId: string, forceRefresh = false) => {
            if (requestedRef.current.has(sessionId)) {
                overviewLog("detail skip already requested", { sessionId });
                return;
            }
            requestedRef.current.add(sessionId);
            clearRetry(sessionId);
            const cachedDetail = getCachedSessionDetail(sessionId);
            overviewLog("detail load begin", {
                sessionId,
                forceRefresh,
                hasCached: cachedDetail != null,
                cachedMessages: cachedDetail?.messages?.length ?? 0,
            });
            setDetails((prev) => {
                const detail = prev[sessionId]?.detail ?? cachedDetail;
                return {
                    ...prev,
                    [sessionId]: {
                        loading: detail == null,
                        detail,
                        error: "",
                    },
                };
            });
            loadCachedSessionDetail(service, sessionId, { tail: 100, forceRefresh })
                .then((detail) => {
                    requestedRef.current.delete(sessionId);
                    if (cancelled) return;
                    overviewLog("detail load success", {
                        sessionId,
                        messageCount: detail.messages?.length ?? 0,
                        summaryMessageCount: detail.summary.messageCount,
                    });
                    setDetails((prev) => ({ ...prev, [sessionId]: { loading: false, detail, error: "" } }));
                })
                .catch((error) => {
                    requestedRef.current.delete(sessionId);
                    if (cancelled) return;
                    const errorMessage = getErrorMessage(error);
                    const historyPending = isSessionNotFoundMessage(errorMessage, sessionId);
                    const transientFetch = isTransientFetchErrorMessage(errorMessage);
                    overviewLog("detail load error", {
                        sessionId,
                        historyPending,
                        transientFetch,
                        error: errorMessage,
                    });
                    setDetails((prev) => {
                        const detail = prev[sessionId]?.detail ?? getCachedSessionDetail(sessionId);
                        return {
                            ...prev,
                            [sessionId]: {
                                loading: false,
                                detail,
                                error:
                                    detail != null && transientFetch
                                        ? ""
                                        : historyPending
                                          ? SESSION_HISTORY_PENDING_MESSAGE
                                          : transientFetch
                                            ? SESSION_TRANSIENT_FETCH_PENDING_MESSAGE
                                            : errorMessage,
                            },
                        };
                    });
                    if (!activeSessionIds.has(sessionId) || retryTimers.has(sessionId)) {
                        return;
                    }
                    if (!historyPending && !transientFetch) {
                        return;
                    }
                    const retryMs = historyPending
                        ? SESSION_HISTORY_PENDING_RETRY_MS
                        : SESSION_DETAIL_TRANSIENT_RETRY_MS;
                    const timer = window.setTimeout(() => {
                        retryTimers.delete(sessionId);
                        if (cancelled) return;
                        loadDetail(sessionId);
                    }, retryMs);
                    retryTimers.set(sessionId, timer);
                });
        };

        clearStaleRetries();
        const forceRefresh = refreshSeq !== refreshSeqRef.current;
        refreshSeqRef.current = refreshSeq;
        overviewLog("detail effect", {
            active,
            sessionCount: sessionIds.length,
            forceRefresh,
            sessionIds,
        });
        setDetails((current) => {
            const next: Record<string, DetailState> = {};
            for (const sessionId of sessionIds) {
                const cachedDetail = getCachedSessionDetail(sessionId);
                const detail = current[sessionId]?.detail ?? cachedDetail;
                if (detail != null) {
                    next[sessionId] = {
                        loading: false,
                        detail,
                        error: "",
                    };
                }
            }
            for (const sessionId of Object.keys(current)) {
                if (!activeSessionIds.has(sessionId)) {
                    continue;
                }
                if (next[sessionId] != null) {
                    continue;
                }
                const error = current[sessionId]?.error;
                if (error) {
                    next[sessionId] = { loading: false, detail: null, error };
                }
            }
            return next;
        });
        for (const sessionId of sessionIds) {
            loadDetail(sessionId, forceRefresh);
        }
        return () => {
            cancelled = true;
            requestedRef.current.clear();
            for (const timer of retryTimers.values()) {
                window.clearTimeout(timer);
            }
            retryTimers.clear();
        };
    }, [active, refreshSeq, service, sessionIdsKey]);

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
                    patchCachedSessionSummary(sessionId, updated);
                }
                return changed ? next : current;
            });
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, []);

    return useMemo(() => {
        const next: Record<string, DetailState> = {};
        for (const sessionId of sessionIds) {
            const cachedDetail = cacheSnapshot.details[sessionId];
            const current = details[sessionId];
            if (cachedDetail != null) {
                next[sessionId] = {
                    loading: false,
                    detail: cachedDetail,
                    error: current?.error ?? "",
                };
            } else if (current != null) {
                next[sessionId] = current;
            }
        }
        return next;
    }, [cacheSnapshot, details, sessionIdsKey]);
}

function useSessionSummaries(blocks: OverviewBlock[], active = true): Record<string, SummaryState> {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const sessionIdsKey = sessionIds.join("\n");
    // summary 消费者订阅 "summary" 频道; 隐藏 (active=false) 时退订, 节省 React 更新.
    const cacheRevision = useSessionOverviewCacheRevision("summary", active);
    const cacheSnapshot = useMemo(() => getSessionOverviewCacheSnapshot(sessionIds), [cacheRevision, sessionIdsKey]);
    const requestedRef = useRef(new Set<string>());
    const retryTimersRef = useRef(new Map<string, number>());
    const [summaries, setSummaries] = useState<Record<string, SummaryState>>(() => {
        const next: Record<string, SummaryState> = {};
        for (const sessionId of sessionIds) {
            const cachedSummary = getCachedSessionSummary(sessionId);
            if (cachedSummary != null) {
                next[sessionId] = { loading: false, summary: cachedSummary, error: "" };
            }
        }
        return next;
    });

    useEffect(() => {
        if (!active) {
            return;
        }
        let cancelled = false;
        const retryTimers = retryTimersRef.current;
        const clearRetry = (sessionId: string) => {
            const timer = retryTimers.get(sessionId);
            if (timer == null) return;
            window.clearTimeout(timer);
            retryTimers.delete(sessionId);
        };
        const clearStaleRetries = () => {
            const activeSessionIds = new Set(sessionIds);
            for (const [sessionId, timer] of retryTimers.entries()) {
                if (activeSessionIds.has(sessionId)) continue;
                window.clearTimeout(timer);
                retryTimers.delete(sessionId);
            }
        };
        const loadSummary = (sessionId: string, forceRefresh = false) => {
            if (requestedRef.current.has(sessionId)) {
                return;
            }
            requestedRef.current.add(sessionId);
            clearRetry(sessionId);
            const cachedSummary = getCachedSessionSummary(sessionId);
            setSummaries((prev) => ({
                ...prev,
                [sessionId]: { loading: cachedSummary == null, summary: cachedSummary, error: "" },
            }));
            loadCachedSessionSummary(service, sessionId, { forceRefresh })
                .then((summary) => {
                    if (cancelled) return;
                    requestedRef.current.delete(sessionId);
                    setSummaries((prev) => ({ ...prev, [sessionId]: { loading: false, summary, error: "" } }));
                })
                .catch((error) => {
                    if (cancelled) return;
                    const errorMessage = getErrorMessage(error);
                    const historyPending = isSessionNotFoundMessage(errorMessage, sessionId);
                    if (historyPending) {
                        requestedRef.current.delete(sessionId);
                    }
                    setSummaries((prev) => ({
                        ...prev,
                        [sessionId]: {
                            loading: false,
                            summary: null,
                            error: historyPending ? SESSION_HISTORY_PENDING_MESSAGE : errorMessage,
                        },
                    }));
                    if (historyPending && !retryTimers.has(sessionId)) {
                        const timer = window.setTimeout(() => {
                            retryTimers.delete(sessionId);
                            if (cancelled) return;
                            loadSummary(sessionId);
                        }, SESSION_HISTORY_PENDING_RETRY_MS);
                        retryTimers.set(sessionId, timer);
                    }
                });
        };

        clearStaleRetries();
        setSummaries((current) => {
            const next = { ...current };
            for (const sessionId of sessionIds) {
                next[sessionId] ??= {
                    loading: true,
                    summary: getCachedSessionSummary(sessionId),
                    error: "",
                };
            }
            return next;
        });
        for (const sessionId of sessionIds) {
            loadSummary(sessionId);
        }
        const pollTimer = window.setInterval(() => {
            if (document.visibilityState === "hidden") {
                return;
            }
            for (const sessionId of sessionIds) {
                loadSummary(sessionId, true);
            }
        }, SESSION_SUMMARY_POLL_MS);
        return () => {
            cancelled = true;
            requestedRef.current.clear();
            window.clearInterval(pollTimer);
            for (const timer of retryTimers.values()) {
                window.clearTimeout(timer);
            }
            retryTimers.clear();
        };
    }, [active, service, sessionIdsKey]);

    useEffect(() => {
        const handleNoteUpdated = (event: Event) => {
            if (!isAISessionNoteUpdatedEvent(event)) return;
            const updated = event.detail.summary;
            setSummaries((current) => {
                let changed = false;
                const next = { ...current };
                for (const [sessionId, state] of Object.entries(current)) {
                    if (state.summary == null || !sessionMatchesSummary(sessionId, updated)) {
                        continue;
                    }
                    changed = true;
                    next[sessionId] = {
                        ...state,
                        summary: { ...state.summary, ...updated },
                    };
                    patchCachedSessionSummary(sessionId, updated);
                }
                return changed ? next : current;
            });
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, []);

    return useMemo(() => {
        const next: Record<string, SummaryState> = {};
        for (const sessionId of sessionIds) {
            const cachedSummary = cacheSnapshot.summaries[sessionId];
            const current = summaries[sessionId];
            if (cachedSummary != null) {
                next[sessionId] = {
                    loading: false,
                    summary: cachedSummary,
                    error: current?.error ?? "",
                };
            } else if (current != null) {
                next[sessionId] = current;
            }
        }
        return next;
    }, [cacheSnapshot, sessionIdsKey, summaries]);
}

function SessionOverviewBadgeIcon({ badge, className }: { badge: Badge | null; className?: string }) {
    const { t } = useTranslation("session-overview");
    if (badge == null) return null;
    return (
        <span
            className={cn("session-overview-badge-icon", className)}
            style={{ color: badge.color || "#fbbf24" }}
            title={t("session-overview:dialog.badgeNotification")}
        >
            <i className={makeIconClass(badge.icon, true, { defaultIcon: "circle-small" })} />
        </span>
    );
}

function shouldShowAgentAggregate(statuses: AgentStatus[]): boolean {
    return statuses.some(shouldShowAgentStatusChip);
}

// Tab 聚合 chip 现在就是共享 AgentStatusChip 的 aggregate 变体 ——
// 聚合词、tooltip、ack 语义都在 agent-status-chip-view.ts 里，此处不再自己拼。
function AggregateStatusChip({
    statuses,
    unread,
    onAck,
}: {
    statuses: AgentStatus[];
    unread: boolean;
    onAck: () => void;
}) {
    if (!shouldShowAgentAggregate(statuses)) return null;
    return (
        <AgentStatusChip
            variant="aggregate"
            aggregate={aggregateAgentStatuses(statuses)}
            now={0}
            unread={unread}
            onAckAggregate={onAck}
        />
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

function useCurrentOverviewBlockVisible(blockId: string | null | undefined): boolean {
    const tabId = jotai.useAtomValue(atoms.staticTabId);
    const tab = jotai.useAtomValue(
        useMemo(
            () => (tabId ? WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)) : jotai.atom<Tab | null>(null)),
            [tabId]
        )
    );
    if (!blockId || !tab) {
        return true;
    }
    return !getHiddenBlockIdsFromTab(tab).includes(blockId);
}

function SessionOverviewButtonBase({ vertical = false }: { vertical?: boolean }) {
    const { t } = useTranslation("session-overview");
    const model = SessionOverviewModel.getInstance();
    const workspace = jotai.useAtomValue(atoms.workspace);
    const focused = jotai.useAtomValue(model.isFocusedAtom);
    const blocks = useOverviewBlocks(workspace);
    const viewedAt = jotai.useAtomValue(model.blockViewedAtAtom);
    const now = useNow(true);
    const sessionIds = useMemo(
        () => Array.from(new Set(blocks.map((block) => block.sessionId).filter(Boolean))).sort(),
        [blocks]
    );
    const sessionIdsKey = sessionIds.join("\n");
    // 按钮 badge 只依赖 summary 频道; 按钮永远在 tab strip 中可见, 保持订阅 active=true.
    const cacheRevision = useSessionOverviewCacheRevision("summary", true);
    const cachedSummaries = useMemo(
        () => getSessionOverviewCacheSnapshot(sessionIds).summaries,
        [cacheRevision, sessionIdsKey]
    );
    const unreadBlocks = blocks.filter((block) => {
        if (!block.isAgentLike || !block.sessionId) return false;
        const summary = cachedSummaries[block.sessionId];
        const updatedAtMs = normalizeTimeMs(summary?.updatedAt);
        return updatedAtMs > 0 && updatedAtMs > (viewedAt[block.blockId] ?? 0);
    });
    const newestUnreadMs = Math.max(
        0,
        ...unreadBlocks.map((block) => normalizeTimeMs(cachedSummaries[block.sessionId]?.updatedAt))
    );
    const icon = <i className={makeIconClass("list-tree", false)} />;
    const badge =
        unreadBlocks.length > 0 ? (
            <span className="session-overview-entry-badge">
                {newestUnreadMs > 0 ? formatUnreadDuration(newestUnreadMs, now) : unreadBlocks.length}
            </span>
        ) : null;

    if (vertical) {
        return (
            <Tooltip
                content={t("session-overview:dialog.openOverview")}
                placement="right"
                hideOnClick
                divClassName="flex"
            >
                <button
                    type="button"
                    className={cn("session-overview-vbutton", focused && "is-open")}
                    onClick={() => void model.open()}
                    aria-label={t("session-overview:dialog.openOverview")}
                >
                    {icon}
                    <span>{t("session-overview:dialog.overviewLabel")}</span>
                    {badge}
                </button>
            </Tooltip>
        );
    }
    return (
        <Tooltip content={t("session-overview:dialog.openOverview")} placement="bottom" hideOnClick divClassName="flex">
            <button
                type="button"
                className={cn("session-overview-tabbutton", focused && "is-open")}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => void model.open()}
                aria-label={t("session-overview:dialog.openOverview")}
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
    onEditSessionNote,
}: {
    message: Message | null;
    block: OverviewBlock | null;
    onClose: () => void;
    onJump: () => void;
    onEditSessionNote: (block: OverviewBlock) => void;
}) {
    const { t } = useTranslation("session-overview");
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
                    <button
                        type="button"
                        className="session-overview-icon-button"
                        onClick={onClose}
                        aria-label={t("session-overview:dialog.close")}
                    >
                        <i className={makeIconClass("xmark", false)} />
                    </button>
                </div>
                <div className="session-overview-message-body">{message.text}</div>
                <div className="session-overview-message-note">
                    <i className={makeIconClass("tag", false)} />
                    <span>{t("session-overview:dialog.messageNote")}</span>
                    {block.sessionId ? (
                        <button
                            type="button"
                            onClick={() => onEditSessionNote(block)}
                            aria-label={t("session-overview:dialog.editSessionNote")}
                            title={t("session-overview:dialog.editSessionNote")}
                        >
                            <i className={makeIconClass("tag", false)} />
                        </button>
                    ) : null}
                </div>
                <div className="session-overview-message-actions">
                    <button type="button" onClick={onJump}>
                        <i className={makeIconClass("location-crosshairs", false)} />
                        <span>{t("session-overview:dialog.jumpToBlockButton")}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// 列表行方块条（11-24 R1）：薄封装 —— 只负责 loading / error / noSessionId 三个文本态，
// 结构渲染交给共用组件 `SessionMessageSquares`（看板卡消费同一份实现，视觉零漂移）。
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
    const { t } = useTranslation("session-overview");
    if (!block.sessionId) {
        return <div className="session-overview-muted">{t("session-overview:dialog.noSessionId")}</div>;
    }
    if (detailState == null) {
        return (
            <div className="session-overview-message-strip">
                <span className="session-overview-muted">{t("session-overview:dialog.loadingSession")}</span>
                <i className={cn(makeIconClass("spinner", false), "session-overview-loading-icon")} />
            </div>
        );
    }
    if (detailState?.error) {
        if (isSessionHistoryPendingMessage(detailState.error)) {
            return <div className="session-overview-muted">{detailState.error}</div>;
        }
        if (isSessionTransientFetchPendingMessage(detailState.error)) {
            return <div className="session-overview-muted">{t("session-overview:dialog.loadingSession")}</div>;
        }
        return <div className="session-overview-error">{detailState.error}</div>;
    }
    const messages = readableMessages(detailState?.detail);
    const visibleMessages = messages.slice(-limit);
    return (
        <SessionMessageSquares
            surface="row"
            items={visibleMessages.map((message) => ({
                seq: message.seq,
                role: message.role,
                preview: messagePreview(message),
                label: i18n.t("session-overview:dialog.messageSeq", { role: message.role, seq: message.seq }),
            }))}
            overflow={messages.length - visibleMessages.length}
            unreadText={unreadText}
            loading={detailState?.loading === true}
            emptyText={unreadText || t("session-overview:dialog.noPreview")}
            onOpen={(seq) => {
                const message = messages.find((item) => item.seq === seq);
                if (message != null) onOpenMessage(block, message);
            }}
        />
    );
}

const OverviewSessionNoteEditor = React.forwardRef<OverviewSessionNoteEditorHandle, OverviewSessionNoteEditorProps>(
    function OverviewSessionNoteEditor({ block, initialSummary, onClose }, ref) {
        const { t } = useTranslation("session-overview");
        const service = useMemo(() => new AISessionsServiceType(), []);
        const hydratedSummary =
            initialSummary != null && sessionMatchesSummary(block.sessionId, initialSummary) ? initialSummary : null;
        const initialNote = hydratedSummary?.note ?? "";
        const [summary, setSummary] = useState<SessionSummary | null>(hydratedSummary);
        const [noteDraft, setNoteDraft] = useState(initialNote);
        const [loading, setLoading] = useState(hydratedSummary == null);
        const [error, setError] = useState("");
        const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("idle");
        const inputRef = useRef<HTMLTextAreaElement | null>(null);
        const focusedRef = useRef(false);
        const latestDraftRef = useRef(initialNote);
        const summaryRef = useRef<SessionSummary | null>(hydratedSummary);
        const pendingSaveRef = useRef<Promise<boolean> | null>(null);
        const saveSeqRef = useRef(0);

        const applySummary = React.useCallback((nextSummary: SessionSummary) => {
            const currentSummary = summaryRef.current;
            const currentNote = currentSummary?.note ?? "";
            const shouldUpdateDraft = currentSummary == null || latestDraftRef.current.trim() === currentNote;
            summaryRef.current = nextSummary;
            setSummary(nextSummary);
            setLoading(false);
            if (shouldUpdateDraft) {
                const nextNote = nextSummary.note ?? "";
                latestDraftRef.current = nextNote;
                setNoteDraft(nextNote);
            }
        }, []);

        useEffect(() => {
            summaryRef.current = hydratedSummary;
            setSummary(hydratedSummary);
            const nextNote = hydratedSummary?.note ?? "";
            latestDraftRef.current = nextNote;
            setNoteDraft(nextNote);
            setLoading(hydratedSummary == null);
            setError("");
            setSaveStatus("idle");
            focusedRef.current = false;
        }, [block.sessionId]);

        useEffect(() => {
            if (hydratedSummary == null) return;
            applySummary(hydratedSummary);
        }, [
            applySummary,
            hydratedSummary?.key,
            hydratedSummary?.id,
            hydratedSummary?.note,
            hydratedSummary?.updatedAt,
        ]);

        useEffect(() => {
            if (!block.sessionId || hydratedSummary != null) return;
            let cancelled = false;
            setLoading(true);
            setError("");
            service
                .Summary({ id: block.sessionId })
                .then((nextSummary) => {
                    if (cancelled) return;
                    applySummary(nextSummary);
                })
                .catch((nextError) => {
                    if (cancelled) return;
                    setLoading(false);
                    setError(getErrorMessage(nextError));
                });
            return () => {
                cancelled = true;
            };
        }, [applySummary, block.sessionId, hydratedSummary != null, service]);

        useEffect(() => {
            if (saveStatus !== "saved" && saveStatus !== "error") return;
            const handle = window.setTimeout(() => setSaveStatus("idle"), saveStatus === "saved" ? 1200 : 1800);
            return () => window.clearTimeout(handle);
        }, [saveStatus]);

        useEffect(() => {
            return () => {
                saveSeqRef.current++;
            };
        }, []);

        useEffect(() => {
            if (!block.sessionId) return;
            const handleNoteUpdated = (event: Event) => {
                if (!isAISessionNoteUpdatedEvent(event)) return;
                if (!sessionMatchesSummary(block.sessionId, event.detail.summary)) return;
                applySummary(event.detail.summary);
            };
            window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
            return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        }, [applySummary, block.sessionId]);

        const saveNote = React.useCallback(
            async (nextNote: string): Promise<boolean> => {
                const currentSummary = summaryRef.current;
                if (currentSummary == null) return false;
                const parsed = extractSessionTagsFromNote(nextNote);
                const tags = mergeSessionTags(currentSummary.tags ?? [], parsed.tags);
                if (parsed.note === (currentSummary.note ?? "") && sessionTagsEqual(tags, currentSummary.tags)) {
                    setError("");
                    return true;
                }
                saveSeqRef.current++;
                const saveSeq = saveSeqRef.current;
                setSaveStatus("saving");
                setError("");
                const savePromise = service
                    .NoteAndTags({ id: currentSummary.key, note: parsed.note, tags })
                    .then((updated) => {
                        if (saveSeq !== saveSeqRef.current) return false;
                        summaryRef.current = updated;
                        setSummary(updated);
                        const currentDraftSaved =
                            extractSessionTagsFromNote(latestDraftRef.current).note === parsed.note;
                        if (currentDraftSaved) {
                            const savedNote = updated.note ?? "";
                            latestDraftRef.current = savedNote;
                            setNoteDraft(savedNote);
                        }
                        setSaveStatus(currentDraftSaved ? "saved" : "idle");
                        dispatchAISessionNoteUpdated(updated);
                        return currentDraftSaved;
                    })
                    .catch((nextError) => {
                        if (saveSeq === saveSeqRef.current) {
                            setSaveStatus("error");
                            setError(getErrorMessage(nextError));
                        }
                        return false;
                    })
                    .finally(() => {
                        if (saveSeq === saveSeqRef.current) {
                            pendingSaveRef.current = null;
                        }
                    });
                pendingSaveRef.current = savePromise;
                return savePromise;
            },
            [service]
        );

        const saveBeforeSwitch = React.useCallback((): Promise<boolean> => {
            const pendingSave = pendingSaveRef.current;
            if (pendingSave != null) {
                return pendingSave;
            }
            const currentSummary = summaryRef.current;
            if (currentSummary == null) {
                return Promise.resolve(true);
            }
            const latestDraft = latestDraftRef.current;
            const parsed = extractSessionTagsFromNote(latestDraft);
            const tags = mergeSessionTags(currentSummary.tags ?? [], parsed.tags);
            if (parsed.note === (currentSummary.note ?? "") && sessionTagsEqual(tags, currentSummary.tags)) {
                setError("");
                return Promise.resolve(true);
            }
            return saveNote(latestDraft);
        }, [saveNote]);

        React.useImperativeHandle(
            ref,
            () => ({
                saveBeforeSwitch,
            }),
            [saveBeforeSwitch]
        );

        const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
        const noteUnchanged =
            summary == null ||
            (parsedNoteDraft.note === (summary.note ?? "") &&
                sessionTagsEqual(mergeSessionTags(summary.tags ?? [], parsedNoteDraft.tags), summary.tags));
        const saving = saveStatus === "saving";

        useEffect(() => {
            if (summary == null || noteUnchanged || saving) return;
            const handle = window.setTimeout(() => void saveNote(noteDraft), SessionOverviewNoteAutoSaveDelayMs);
            return () => window.clearTimeout(handle);
        }, [noteDraft, noteUnchanged, saveNote, saving, summary]);

        useEffect(() => {
            if (loading || summary == null || focusedRef.current) return;
            focusedRef.current = true;
            window.setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.setSelectionRange(noteDraft.length, noteDraft.length);
            }, 0);
        }, [loading, noteDraft.length, summary]);

        const closeEditor = React.useCallback(() => {
            if (saving) return;
            if (!noteUnchanged) {
                void saveNote(noteDraft).then((saved) => {
                    if (saved) onClose();
                });
                return;
            }
            onClose();
        }, [noteDraft, noteUnchanged, onClose, saveNote, saving]);

        const title = summary?.title || summary?.id || block.title;
        const statusText =
            saveStatus === "saving"
                ? t("session-overview:note.saving")
                : saveStatus === "saved"
                  ? t("session-overview:note.saved")
                  : saveStatus === "error"
                    ? t("session-overview:note.saveFailed")
                    : !noteUnchanged
                      ? t("session-overview:note.unsavedChanges")
                      : "";

        return (
            <div className="session-overview-note-editor" onClick={(event) => event.stopPropagation()}>
                <div className="session-overview-note-editor-head">
                    <div className="session-overview-note-editor-title">
                        <i className={makeIconClass("tag", false)} />
                        <span>{title}</span>
                    </div>
                </div>
                {loading && summary == null ? (
                    <div className="session-overview-note-editor-loading">
                        <i className={makeIconClass("spinner", false)} />
                        <span>{t("session-overview:note.loading")}</span>
                    </div>
                ) : summary == null ? (
                    <div className="session-overview-note-editor-error">
                        {error || t("session-overview:note.notFound")}
                    </div>
                ) : (
                    <>
                        {error ? <div className="session-overview-note-editor-error">{error}</div> : null}
                        <textarea
                            ref={inputRef}
                            className="session-overview-note-editor-input"
                            placeholder={t("session-overview:note.placeholder")}
                            value={noteDraft}
                            spellCheck={false}
                            onChange={(event) => {
                                latestDraftRef.current = event.target.value;
                                setNoteDraft(event.target.value);
                                setError("");
                                if (saveStatus !== "saving") {
                                    setSaveStatus("idle");
                                }
                            }}
                            onBlur={() => {
                                if (!noteUnchanged && !saving) {
                                    void saveNote(noteDraft);
                                }
                            }}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Escape") {
                                    closeEditor();
                                }
                            }}
                        />
                        <div className="session-overview-note-editor-footer">
                            <span
                                className={cn(
                                    "session-overview-note-editor-status",
                                    saveStatus === "saved" && "is-saved",
                                    saveStatus === "error" && "is-error"
                                )}
                                aria-live="polite"
                            >
                                {statusText}
                            </span>
                        </div>
                    </>
                )}
            </div>
        );
    }
);

OverviewSessionNoteEditor.displayName = "OverviewSessionNoteEditor";

function CompactBlockIcon({
    block,
    currentBlockId,
    onSelectBlock,
    onJumpBlock,
    onDeleteSession,
    onDeleteBlock,
}: {
    block: OverviewBlock;
    currentBlockId: string | null;
    onSelectBlock: (block: OverviewBlock) => void;
    onJumpBlock: (block: OverviewBlock) => void;
    onDeleteSession: (block: OverviewBlock) => void;
    onDeleteBlock: (block: OverviewBlock) => void;
}) {
    const { t } = useTranslation("session-overview");
    const badge = jotai.useAtomValue(getBadgeAtom(WOS.makeORef("block", block.blockId)));
    const isCurrent = block.blockId === currentBlockId;
    const viewName = blockViewToName(block.view);
    const iconClass = makeIconClass(blockViewToIcon(block.view), false, { defaultIcon: "square" });

    return (
        <div className={cn("session-overview-compact-block", isCurrent && "is-current")}>
            <button
                type="button"
                className="session-overview-compact-button"
                onClick={() => onSelectBlock(block)}
                aria-label={i18n.t("session-overview:dialog.viewTitle", { view: viewName, title: block.title })}
                title={i18n.t("session-overview:dialog.viewTitle", { view: viewName, title: block.title })}
            >
                <i className={iconClass} />
                <SessionOverviewBadgeIcon badge={badge} className="session-overview-compact-badge" />
            </button>
            <div
                className="session-overview-compact-popover"
                role="group"
                aria-label={i18n.t("session-overview:dialog.actions", { title: block.title })}
            >
                <div className="session-overview-compact-popover-head">
                    <span className="session-overview-compact-popover-icon">
                        <i className={iconClass} />
                    </span>
                    <span className="session-overview-compact-popover-text">
                        <span className="session-overview-compact-title">{block.title}</span>
                        <span className="session-overview-compact-meta">{viewName}</span>
                    </span>
                    <SessionOverviewBadgeIcon badge={badge} className="session-overview-compact-popover-badge" />
                </div>
                <div className="session-overview-compact-actions">
                    <Tooltip
                        content={t("session-overview:dialog.jumpToBlockTooltip")}
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
                            aria-label={i18n.t("session-overview:dialog.jumpTo", { title: block.title })}
                        >
                            <i className={makeIconClass("location-crosshairs", false)} />
                        </button>
                    </Tooltip>
                    {block.sessionId ? (
                        <Tooltip
                            content={t("session-overview:dialog.deleteSessionFile")}
                            placement="top"
                            hideOnClick
                            divClassName="inline-flex"
                        >
                            <button
                                type="button"
                                className="session-overview-block-action-button danger"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteSession(block);
                                }}
                                aria-label={i18n.t("session-overview:dialog.deleteSessionFileFor", {
                                    title: block.title,
                                })}
                            >
                                <i className={makeIconClass("trash", false)} />
                            </button>
                        </Tooltip>
                    ) : null}
                    <Tooltip
                        content={t("session-overview:dialog.deleteBlock")}
                        placement="top"
                        hideOnClick
                        divClassName="inline-flex"
                    >
                        <button
                            type="button"
                            className="session-overview-block-x-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDeleteBlock(block);
                            }}
                            aria-label={i18n.t("session-overview:dialog.deleteBlockAria", { title: block.title })}
                        >
                            <i className={makeIconClass("xmark", false)} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

/**
 * 列表行三件套：tags chips + 自定义属性（与看板卡同解析函数同口径）。
 *
 * 紧凑展示：tags ≤3 + 属性 ≤2，超出计数。空行不渲染节点。纯展示（点击行为在行上）。
 */
function RowMetaChips({ summary }: { summary: SessionSummary | null }) {
    const tagChips = useMemo(() => resolveBoardTagChips(normalizeBoardTags(summary?.tags), 3), [summary?.tags]);
    const propRows = useMemo(() => resolveBoardPropRows(summary?.props ?? null, undefined, 2), [summary?.props]);
    if (tagChips.visible.length === 0 && propRows.visible.length === 0) {
        return null;
    }
    const propValue = (row: BoardPropRow): string =>
        row.single?.value ?? row.multi?.join(", ") ?? (row.checked === true ? "✓" : "") ?? row.text ?? "";
    return (
        <div
            className="session-overview-block-row-meta"
            data-overview-row-meta={tagChips.visible.length + propRows.visible.length > 0 ? "true" : undefined}
        >
            {tagChips.visible.map((tag) => (
                <span
                    key={`tag-${tag}`}
                    className="session-overview-board-chip is-tag"
                    data-overview-row-tag={tag}
                    title={`#${tag}`}
                >
                    #{tag}
                </span>
            ))}
            {propRows.visible.map((row) => (
                <span
                    key={`prop-${row.key}`}
                    className="session-overview-board-chip is-prop"
                    data-overview-row-prop={row.key}
                    title={`${row.name}: ${propValue(row)}`}
                >
                    {/* 自解释值（色胶囊 / 多值）省名字，名字留在 title（与看板卡同一 hideName 口径） */}
                    {row.hideName ? null : <span className="session-overview-row-prop-name">{row.name}</span>}
                    {row.single ? (
                        <span className={cn("property-chip", `property-chip--${row.single.color}`)}>
                            {row.single.value}
                        </span>
                    ) : (
                        <span className="session-overview-row-prop-value">{propValue(row)}</span>
                    )}
                </span>
            ))}
            {tagChips.hiddenCount + propRows.hiddenCount > 0 ? (
                <span
                    className="session-overview-board-chip is-more"
                    title={i18n.t("session-overview:board.moreProps", {
                        count: tagChips.hiddenCount + propRows.hiddenCount,
                    })}
                >
                    +{tagChips.hiddenCount + propRows.hiddenCount}
                </span>
            ) : null}
        </div>
    );
}

// ───────────────────────── 卡片展开 + composer 发送（11-22-overview-card-send / 11-23 抽到共享面板） ─────────────────────────
//
// composer 的状态机与发送链路已搬到 `overview-card-send-panel.tsx`（`CardSendContext` /
// `useCardSendState` / `<CardSendPanel>`）：列表行与看板浮层共用同一份草稿、行程与
// 「发送后等回复」勾选，这里只消费。热区纪律不变：行内既有热区（跳转/备注/关闭/消息方块/
// 输入框）全部 stopPropagation，展开只认「行主体空白区」的点击。

function truncateCardSendText(text: string, maxChars: number): string {
    const normalized = text.replace(/\s+$/g, "");
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}…`;
}

function CardSendAttrRow(props: { label: string; value: string; title?: string }) {
    return (
        <span className="session-overview-card-expand-attr" title={props.title ?? props.value}>
            <span className="session-overview-card-expand-attr-name">{props.label}</span>
            <span className="session-overview-card-expand-attr-value">{props.value}</span>
        </span>
    );
}

/** 卡片展开体：属性行 / 最近回复 / composer（11-22 PRD R2-R4）。 */
function CardSendExpander({
    block,
    summary,
    detail,
    onOpenMessage,
}: {
    block: OverviewBlock;
    summary: SessionSummary | null;
    detail: SessionDetail | null;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
}) {
    const { t } = useTranslation("session-overview");
    const cardSend = React.useContext(CardSendContext);
    const blockId = block.blockId;
    const entry = cardSend?.sendByBlock[blockId];
    const result = entry != null && entry !== "sending" ? entry : null;
    const lastReply = useMemo(() => {
        const messages = readableMessages(detail);
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant") return messages[i];
        }
        return messages.length > 0 ? messages[messages.length - 1] : null;
    }, [detail]);

    const meta = (block.block?.meta ?? {}) as Record<string, unknown>;
    const modelLabel =
        typeof meta["agent:requestedmodel"] === "string" ? (meta["agent:requestedmodel"] as string).trim() : "";
    const projectPath = (
        summary?.projectPath ?? (typeof meta["cmd:cwd"] === "string" ? (meta["cmd:cwd"] as string) : "")
    ).trim();
    const sessionKey = (summary?.key ?? block.sessionId ?? "").trim();
    const tags = normalizeBoardTags(summary?.tags);

    return (
        <div
            className="session-overview-card-expand"
            data-overview-card-send-body={blockId}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    // Esc 收起只作用在这张卡，不冒泡给全局 keymodel（那层会去关 modal/做别的）。
                    event.stopPropagation();
                    cardSend?.collapse();
                }
            }}
        >
            {/* R2.1 属性行：会话 key / model / 项目 / Tab / tags（只读，编辑走 AgentCardModal） */}
            <div className="session-overview-card-expand-attrs">
                {sessionKey !== "" ? (
                    <CardSendAttrRow label={t("session-overview:panel.cardSendSessionKey")} value={sessionKey} />
                ) : null}
                {modelLabel !== "" ? (
                    <CardSendAttrRow label={t("session-overview:panel.cardSendModel")} value={modelLabel} />
                ) : null}
                {projectPath !== "" ? (
                    <CardSendAttrRow
                        label={t("session-overview:panel.cardSendProject")}
                        value={projectPath}
                        title={projectPath}
                    />
                ) : null}
                <CardSendAttrRow label={t("session-overview:panel.cardSendTab")} value={block.tabName} />
                {tags.length > 0
                    ? tags.map((tag) => (
                          <span key={`tag-${tag}`} className="session-overview-board-chip is-tag" title={`#${tag}`}>
                              #{tag}
                          </span>
                      ))
                    : null}
            </div>
            {/* R2.2 最近回复：行内摘要同源（detail messages），[看全文] 跳既有弹窗 */}
            <div className="session-overview-card-expand-reply">
                <span className="session-overview-card-expand-label">
                    {t("session-overview:panel.cardSendLastReply")}
                </span>
                {lastReply != null ? (
                    <>
                        <span className="session-overview-card-expand-reply-text">{messagePreview(lastReply)}</span>
                        <button
                            type="button"
                            className="session-overview-card-expand-link"
                            onClick={() => onOpenMessage(block, lastReply)}
                        >
                            <i className={makeIconClass("arrow-up-right-from-square", false)} />
                            <span>{t("session-overview:panel.cardSendOpenFull")}</span>
                        </button>
                    </>
                ) : (
                    <span className="session-overview-card-expand-reply-text is-muted">
                        {t("session-overview:panel.cardSendNoReply")}
                    </span>
                )}
            </div>
            {/* R4.1 新回复块：发送拿到回复后原地显示（截断 + [看全文]） */}
            {result?.replyText ? (
                <div className="session-overview-card-expand-newreply" data-overview-card-send-reply={result.turn}>
                    <span className="session-overview-card-expand-label">
                        {t("session-overview:panel.cardSendNewReply")}
                    </span>
                    <span className="session-overview-card-expand-reply-text">
                        {truncateCardSendText(result.replyText, 600)}
                        {result.truncated ? t("session-overview:panel.cardSendReplyTruncated") : ""}
                    </span>
                </div>
            ) : null}
            {/* composer（共享面板，11-23 抽出）：Enter 发送 / Shift+Enter 换行 / Esc 收起；
                发送/重试/改为不等待/继续等全在 overview-card-send-panel.tsx，列表行为零变化。 */}
            <CardSendPanel
                variant="inline"
                autoFocus
                blockId={blockId}
                sessionId={block.sessionId}
                // 11-24 R9：远端块禁用图片粘贴（落盘路径在 agent 侧不存在）。
                connection={typeof block.block?.meta?.connection === "string" ? block.block.meta.connection : ""}
            />
        </div>
    );
}

function BlockRow({
    block,
    detailState,
    noteSummary,
    noteEditorOpen,
    noteEditorRef,
    displayLimit,
    viewedAt,
    currentBlockId,
    now,
    agentStatus,
    agentStatusAckedFp,
    agentStatusDoneAckedAt,
    onSelectBlock,
    onJumpBlock,
    onToggleSessionNote,
    onCloseSessionNote,
    onOpenSessionDetail,
    onDeleteSession,
    onDeleteBlock,
    onOpenMessage,
    onAckAgentStatus,
}: {
    block: OverviewBlock;
    detailState: DetailState | undefined;
    noteSummary: SessionSummary | null | undefined;
    noteEditorOpen: boolean;
    noteEditorRef: React.Ref<OverviewSessionNoteEditorHandle>;
    displayLimit: number;
    viewedAt: number;
    currentBlockId: string | null;
    now: number;
    agentStatus: AgentStatus | null;
    agentStatusAckedFp: string | null;
    agentStatusDoneAckedAt: number;
    onSelectBlock: (block: OverviewBlock) => void;
    onJumpBlock: (block: OverviewBlock) => void;
    onToggleSessionNote: (block: OverviewBlock) => void;
    onCloseSessionNote: () => void;
    onOpenSessionDetail: (block: OverviewBlock) => void;
    onDeleteSession: (block: OverviewBlock) => void;
    onDeleteBlock: (block: OverviewBlock) => void;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
    onAckAgentStatus: (blockId: string, status: AgentStatus) => void;
}) {
    const { t } = useTranslation("session-overview");
    const badge = jotai.useAtomValue(getBadgeAtom(WOS.makeORef("block", block.blockId)));
    const detail = detailState?.detail;
    const summary = noteSummary ?? detail?.summary ?? null;
    const updatedAtMs = normalizeTimeMs(summary?.updatedAt);
    const unread = block.isAgentLike && updatedAtMs > 0 && updatedAtMs > viewedAt;
    const isCurrent = block.blockId === currentBlockId;
    const iconClass = makeIconClass(blockViewToIcon(block.view), false, { defaultIcon: "square" });
    // Agent-like row collapses to "agent brand icon + status chip" only.
    // Reuses getAgentIcon so the icon stays consistent with the term block header (term-model.viewIcon);
    // honors the provider persona (L1) and block meta persona (L2), then falls back to the
    // project's shared "robot" generic-agent icon when provider is unknown.
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const agentIcon = block.isAgentLike
        ? getAgentIcon(block.agentProvider ?? "", { meta: block.block?.meta, personas, sessionEmojis })
        : null;
    const agentStatusUnread =
        agentStatus != null &&
        (isAgentStatusUnread(agentStatus, agentStatusAckedFp) ||
            isAgentDoneUnread(agentStatus, agentStatusDoneAckedAt));
    // 展开互斥状态、草稿、行程统统在面板级（design §4），行只消费。
    const cardSend = React.useContext(CardSendContext);
    const canExpandCard = cardSend != null && block.isAgentLike && block.sessionId !== "";
    const cardExpanded = canExpandCard && cardSend.expandedBlockId === block.blockId;

    return (
        <div
            className={cn(
                "session-overview-block-row",
                !block.isAgentLike && "is-plain-block",
                unread && "has-unread",
                isCurrent && "is-current",
                noteEditorOpen && "is-note-editing",
                cardExpanded && "is-card-expanded"
            )}
            data-overview-card-expandable={canExpandCard ? "true" : undefined}
            data-overview-card-expanded={cardExpanded ? "true" : undefined}
            onClick={() => {
                // 主点击 = 展开详情 + composer（PRD A）；跳转仍是右侧 [↪] 热区。
                onSelectBlock(block);
                if (canExpandCard) {
                    cardSend.toggleExpanded(block.blockId);
                }
            }}
        >
            <div className="session-overview-block-main">
                <span className={cn("session-overview-block-icon", block.isAgentLike && "is-agent-brand")}>
                    {block.isAgentLike ? (
                        <span
                            className="session-overview-block-agent-logo"
                            style={
                                agentIcon?.kind === "logo" && agentIcon.iconColor
                                    ? { color: agentIcon.iconColor }
                                    : undefined
                            }
                        >
                            {agentIcon?.kind === "emoji" ? (
                                <span className="agent-emoji-icon">{agentIcon.emoji}</span>
                            ) : agentIcon?.kind === "logo" ? (
                                agentIcon.icon
                            ) : (
                                <i className={makeIconClass("robot", false)} />
                            )}
                        </span>
                    ) : (
                        <i className={iconClass} />
                    )}
                </span>
                <span className="session-overview-block-text">
                    {block.isAgentLike ? (
                        <>
                            {agentStatus ? (
                                <AgentStatusChip
                                    variant="list"
                                    status={agentStatus}
                                    now={now}
                                    blockId={block.blockId}
                                    unread={agentStatusUnread}
                                    onAck={onAckAgentStatus}
                                />
                            ) : null}
                            {/* 常驻发送状态（11-24 R6）：无行程不占位；点击展开该卡 composer */}
                            <SendStatusChip blockId={block.blockId} surface="row" />
                        </>
                    ) : (
                        <>
                            <span className="session-overview-block-title">{block.title}</span>
                            <span className="session-overview-block-meta">{blockViewToName(block.view)}</span>
                        </>
                    )}
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
                        {/* 度量轨：与看板卡共用 <SessionMetrics>（唯一渲染入口），这里只是 surface="row"。 */}
                        <SessionMetrics
                            surface="row"
                            messageCount={summary?.messageCount}
                            size={summary?.size}
                            createdAt={normalizeTimeMs(summary?.createdAt)}
                            updatedAt={updatedAtMs}
                            live={summary?.live === true}
                            now={now}
                        />
                        {/* 列表行三件套：tags chips + 自定义属性（与看板卡同解析函数同口径）。 */}
                        <RowMetaChips summary={summary} />
                        {summary?.note ? (
                            <div className="session-overview-note-line">
                                <span>{summary.note}</span>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </div>
            <div className="session-overview-block-main-x">
                <Tooltip
                    content={t("session-overview:dialog.deleteBlock")}
                    placement="top"
                    hideOnClick
                    divClassName="inline-flex"
                >
                    <button
                        type="button"
                        className="session-overview-block-x-button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onDeleteBlock(block);
                        }}
                        aria-label={i18n.t("session-overview:dialog.deleteBlockAria", { title: block.title })}
                    >
                        <i className={makeIconClass("xmark", false)} />
                    </button>
                </Tooltip>
            </div>
            <div className="session-overview-block-actions">
                {block.isAgentLike && block.sessionId ? (
                    <Tooltip
                        content={t("session-overview:dialog.editSessionNote")}
                        placement="top"
                        hideOnClick
                        divClassName="inline-flex"
                    >
                        <button
                            type="button"
                            className={cn(
                                "session-overview-block-action-button",
                                (noteEditorOpen || noteSummary?.note) && "is-active"
                            )}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleSessionNote(block);
                            }}
                            aria-expanded={noteEditorOpen}
                            aria-label={i18n.t("session-overview:dialog.editSessionNoteFor", {
                                title: block.title,
                            })}
                        >
                            <i className={makeIconClass("tag", false)} />
                        </button>
                    </Tooltip>
                ) : null}
                {block.isAgentLike && block.sessionId ? (
                    <Tooltip
                        content={t("session-overview:dialog.openSessionDetails")}
                        placement="top"
                        hideOnClick
                        divClassName="inline-flex"
                    >
                        <button
                            type="button"
                            className="session-overview-block-action-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenSessionDetail(block);
                            }}
                            aria-label={i18n.t("session-overview:dialog.openSessionDetailsFor", {
                                title: block.title,
                            })}
                        >
                            <i className={makeIconClass("list", false)} />
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip
                    content={t("session-overview:dialog.jumpToBlockTooltip")}
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
                        aria-label={i18n.t("session-overview:dialog.jumpTo", { title: block.title })}
                    >
                        <i className={makeIconClass("location-crosshairs", false)} />
                    </button>
                </Tooltip>
                {block.sessionId ? (
                    <Tooltip
                        content={t("session-overview:dialog.deleteSessionFile")}
                        placement="top"
                        hideOnClick
                        divClassName="inline-flex"
                    >
                        <button
                            type="button"
                            className="session-overview-block-action-button danger"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDeleteSession(block);
                            }}
                            aria-label={i18n.t("session-overview:dialog.deleteSessionFileFor", {
                                title: block.title,
                            })}
                        >
                            <i className={makeIconClass("trash", false)} />
                        </button>
                    </Tooltip>
                ) : null}
            </div>
            <div className="session-overview-block-note">
                {block.isAgentLike && summary?.note ? (
                    <div className="session-overview-note-line">
                        <span>{summary.note}</span>
                    </div>
                ) : null}
            </div>
            {noteEditorOpen ? (
                <OverviewSessionNoteEditor
                    ref={noteEditorRef}
                    block={block}
                    initialSummary={noteSummary}
                    onClose={onCloseSessionNote}
                />
            ) : null}
            {cardExpanded ? (
                <CardSendExpander
                    block={block}
                    summary={summary}
                    detail={detail ?? null}
                    onOpenMessage={onOpenMessage}
                />
            ) : null}
        </div>
    );
}

function TabGroupSection({
    group,
    collapsed,
    details,
    summaries,
    openNoteBlockId,
    noteEditorRef,
    displayLimit,
    viewedAt,
    currentBlockId,
    now,
    agentStatuses,
    agentStatusAckedFp,
    agentStatusDoneAckedAt,
    onSelectBlock,
    onJumpBlock,
    onToggleSessionNote,
    onCloseSessionNote,
    onToggleCollapsed,
    onOpenSessionDetail,
    onDeleteSession,
    onDeleteBlock,
    onOpenMessage,
    onAckAgentStatus,
    onAckTabAgentStatuses,
    onAddAgent,
    agentsOnly,
}: {
    group: OverviewTabGroup;
    collapsed: boolean;
    details: Record<string, DetailState>;
    summaries: Record<string, SummaryState>;
    openNoteBlockId: string | null;
    noteEditorRef: React.Ref<OverviewSessionNoteEditorHandle>;
    displayLimit: number;
    viewedAt: Record<string, number>;
    currentBlockId: string | null;
    now: number;
    agentStatuses: Record<string, AgentStatus | null>;
    agentStatusAckedFp: Record<string, string>;
    agentStatusDoneAckedAt: Record<string, number>;
    /** agentsOnly 开启时组头补一枚 `0 agents` 徽章（行全被滤空时）。 */
    agentsOnly: boolean;
    onSelectBlock: (block: OverviewBlock) => void;
    onJumpBlock: (block: OverviewBlock) => void;
    onToggleSessionNote: (block: OverviewBlock) => void;
    onCloseSessionNote: () => void;
    onToggleCollapsed: () => void;
    onOpenSessionDetail: (block: OverviewBlock) => void;
    onDeleteSession: (block: OverviewBlock) => void;
    onDeleteBlock: (block: OverviewBlock) => void;
    onOpenMessage: (block: OverviewBlock, message: Message) => void;
    onAckAgentStatus: (blockId: string, status: AgentStatus) => void;
    onAckTabAgentStatuses: () => void;
    onAddAgent: (tabId: string, tabName: string) => void;
}) {
    const { t } = useTranslation("session-overview");
    const tabBadges = jotai.useAtomValue(getTabBadgeAtom(group.tabId));
    const groupAgentStatuses = group.blocks
        .map((block) => agentStatuses[block.blockId])
        .filter((status): status is AgentStatus => status != null);
    const tabAgentStatusUnread = group.blocks.some((block) => {
        const status = agentStatuses[block.blockId];
        if (status == null) return false;
        return (
            isAgentStatusUnread(status, agentStatusAckedFp[block.blockId] ?? null) ||
            isAgentDoneUnread(status, agentStatusDoneAckedAt[block.blockId] ?? 0)
        );
    });
    return (
        <section
            key={group.tabId}
            data-overview-tab-group={group.tabId}
            data-overview-tab-status={group.status}
            className={cn(
                "session-overview-tab-group",
                collapsed && "is-collapsed",
                group.status === "unopened" && "is-unopened",
                group.status === "loading" && "is-loading"
            )}
        >
            <div className="session-overview-tab-title">
                <button
                    type="button"
                    className="session-overview-tab-toggle"
                    onClick={onToggleCollapsed}
                    aria-expanded={!collapsed}
                    aria-label={i18n.t(
                        collapsed
                            ? "session-overview:dialog.tabToggleExpand"
                            : "session-overview:dialog.tabToggleCollapse",
                        { name: group.tabName }
                    )}
                >
                    <i
                        className={cn(
                            makeIconClass(collapsed ? "chevron-right" : "chevron-down", false),
                            "session-overview-tab-chevron"
                        )}
                    />
                    <i className={makeIconClass("table-columns", false)} />
                    <span className="session-overview-tab-name">{group.tabName}</span>
                    <strong>{group.blockCount}</strong>
                    {group.status === "unopened" ? (
                        <span className="session-overview-tab-status-badge">
                            {t("session-overview:panel.tabUnopened")}
                            {" · "}
                            {i18n.t("session-overview:panel.tabBlockCount", { n: group.blockCount })}
                        </span>
                    ) : null}
                    {agentsOnly && group.agentCount === 0 && group.blockCount > 0 && group.status !== "loading" ? (
                        <span className="session-overview-tab-status-badge is-agents">
                            {i18n.t("session-overview:panel.tabAgentsCount", { n: 0 })}
                        </span>
                    ) : null}
                    {group.status === "loading" ? (
                        <span className="session-overview-tab-status-badge is-loading">
                            {t("session-overview:panel.tabLoading")}
                        </span>
                    ) : null}
                    <AggregateStatusChip
                        statuses={groupAgentStatuses}
                        unread={tabAgentStatusUnread}
                        onAck={onAckTabAgentStatuses}
                    />
                    <SessionOverviewBadgeIcon badge={tabBadges?.[0] ?? null} />
                </button>
                <button
                    type="button"
                    className="session-overview-tab-jump-button"
                    onClick={() => setActiveTabAndCloseMenus(group.tabId)}
                    aria-label={i18n.t("session-overview:dialog.openTab", { name: group.tabName })}
                >
                    <i className={makeIconClass("arrow-up-right-from-square", false)} />
                </button>
            </div>
            {group.status === "loading" ? (
                <div
                    className="session-overview-tab-skeleton"
                    role="status"
                    aria-label={t("session-overview:panel.tabLoading")}
                >
                    <div className="session-overview-tab-skeleton-row" />
                    <div className="session-overview-tab-skeleton-row" />
                    <div className="session-overview-tab-skeleton-row" />
                </div>
            ) : null}
            {!collapsed && group.status !== "loading" ? (
                <div className="session-overview-block-list">
                    {group.blocks.length === 0 ? (
                        <div className="session-overview-muted">{t("session-overview:dialog.noBlocks")}</div>
                    ) : (
                        group.blocks.map((block) =>
                            shouldShowFullOverviewBlock(block) ? (
                                <BlockRow
                                    key={block.blockId}
                                    block={block}
                                    detailState={details[block.sessionId]}
                                    noteSummary={
                                        summaries[block.sessionId]?.summary ??
                                        details[block.sessionId]?.detail?.summary ??
                                        null
                                    }
                                    noteEditorOpen={openNoteBlockId === block.blockId}
                                    noteEditorRef={noteEditorRef}
                                    displayLimit={displayLimit}
                                    viewedAt={viewedAt[block.blockId] ?? 0}
                                    currentBlockId={currentBlockId}
                                    now={now}
                                    agentStatus={agentStatuses[block.blockId] ?? null}
                                    agentStatusAckedFp={agentStatusAckedFp[block.blockId] ?? null}
                                    agentStatusDoneAckedAt={agentStatusDoneAckedAt[block.blockId] ?? 0}
                                    onSelectBlock={onSelectBlock}
                                    onJumpBlock={onJumpBlock}
                                    onToggleSessionNote={onToggleSessionNote}
                                    onCloseSessionNote={onCloseSessionNote}
                                    onOpenSessionDetail={onOpenSessionDetail}
                                    onDeleteSession={onDeleteSession}
                                    onDeleteBlock={onDeleteBlock}
                                    onOpenMessage={onOpenMessage}
                                    onAckAgentStatus={onAckAgentStatus}
                                />
                            ) : (
                                <CompactBlockIcon
                                    key={block.blockId}
                                    block={block}
                                    currentBlockId={currentBlockId}
                                    onSelectBlock={onSelectBlock}
                                    onJumpBlock={onJumpBlock}
                                    onDeleteSession={onDeleteSession}
                                    onDeleteBlock={onDeleteBlock}
                                />
                            )
                        )
                    )}
                    {/* ＋ 新建：Tab 组末尾（与看板 ＋ 占位卡同一入口） */}
                    <button
                        type="button"
                        className="session-overview-tab-add"
                        data-add-agent-tab={group.tabId}
                        onClick={() => onAddAgent(group.tabId, group.tabName)}
                        aria-label={i18n.t("session-overview:dialog.addAgentInTab", { name: group.tabName })}
                    >
                        <i className={makeIconClass("plus", false)} />
                        <span>{t("session-overview:dialog.addAgentInTabShort")}</span>
                    </button>
                </div>
            ) : null}
        </section>
    );
}

/** 视图按钮的图标/文案。新增视图时只改这里 + 渲染分支（顺序即按钮顺序）。 */
const OverviewViewModeMeta = {
    list: {
        icon: "table-list",
        labelKey: "session-overview:panel.viewList",
        titleKey: "session-overview:panel.viewListTitle",
    },
    board: {
        icon: "table-cells-large",
        labelKey: "session-overview:panel.viewBoard",
        titleKey: "session-overview:panel.viewBoardTitle",
    },
    timeline: {
        icon: "chart-gantt",
        labelKey: "session-overview:panel.viewTimeline",
        titleKey: "session-overview:panel.viewTimelineTitle",
    },
} as const satisfies Record<OverviewViewModeImplemented, { icon: string; labelKey: string; titleKey: string }>;

function SessionOverviewPanel({ blockId, model }: ViewComponentProps<SessionOverviewViewModel>) {
    const { t } = useTranslation("session-overview");
    // 视图显示名回退（blockViewToName）随 locale 变，memo 依赖里需要它。
    const activeLocale = useActiveLocale();
    const overviewModel = SessionOverviewModel.getInstance();
    const workspace = jotai.useAtomValue(atoms.workspace);
    const activeTabId = jotai.useAtomValue(atoms.staticTabId);
    const displayLimit = jotai.useAtomValue(overviewModel.displayLimitAtom);
    const viewedAt = jotai.useAtomValue(overviewModel.blockViewedAtAtom);
    const agentStatusAckedFp = jotai.useAtomValue(overviewModel.agentStatusAckedFpAtom);
    const hideUnopenedTabs = jotai.useAtomValue(overviewModel.hideUnopenedTabsAtom);
    const agentsOnly = jotai.useAtomValue(overviewModel.agentsOnlyAtom);
    const viewMode = jotai.useAtomValue(overviewViewModeAtom);
    const boardGroup = jotai.useAtomValue(overviewBoardGroupAtom);
    const timelineRange = jotai.useAtomValue(overviewTimelineRangeAtom) ?? OverviewTimelineRangeDefault;
    const openedThisLaunchTabIds = jotai.useAtomValue(openedThisLaunchTabIdsAtom);
    const blocks = useOverviewBlocks(workspace);
    const overviewVisible = useCurrentOverviewBlockVisible(blockId);
    const refreshSeq = jotai.useAtomValue(model.refreshSeqAtom);
    const summaries = useSessionSummaries(blocks, overviewVisible);
    // Persona chain (session emoji → provider emoji → brand logo) for board card avatars.
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const currentBlockId = jotai.useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const sessionService = useMemo(() => new AISessionsServiceType(), []);
    const now = useNow(overviewVisible);
    const tabIndex = useOverviewTabIndex(workspace);
    const workspaceTabIds = workspace?.tabids ?? [];
    const tabIdsKey = workspaceTabIds.join("\n");
    // tab-first 分组（2026-11-22）：组头常驻，只要 Tab 在 workspace.tabids 里就画。
    // 删组权力只给 hideUnopenedTabs（且只删 unopened 组）；agentsOnly 只过滤组内行。
    // 旧实现末尾的 `blocks.length > 0` 过滤就是"没打开过的 Tab 不显示"的根因之一。
    const displayedTabGroups = useMemo(
        () =>
            buildTabGroups({
                tabIds: workspaceTabIds,
                tabById: tabIndex.tabById,
                blocks,
                overviewBlockIds: tabIndex.overviewBlockIds,
                openedThisLaunch: openedThisLaunchTabIds,
                activeTabId: activeTabId ?? null,
                hideUnopenedTabs,
                agentsOnly,
            }),
        [
            workspaceTabIds,
            tabIndex,
            blocks,
            openedThisLaunchTabIds,
            activeTabId,
            hideUnopenedTabs,
            agentsOnly,
        ]
    );
    const [collapsedTabIds, setCollapsedTabIds] = useState<Record<string, boolean>>({});
    // 折叠态默认值：显式记忆优先；否则 empty / unopened 组默认折叠（live 默认展开）。
    const isGroupCollapsed = React.useCallback(
        (tabId: string, status: OverviewTabGroup["status"]): boolean => {
            const explicit = collapsedTabIds[tabId];
            if (explicit !== undefined) {
                return explicit;
            }
            return status === "empty" || status === "unopened";
        },
        [collapsedTabIds]
    );
    const detailBlocks = useMemo(
        () =>
            displayedTabGroups.flatMap((group) =>
                isGroupCollapsed(group.tabId, group.status)
                    ? []
                    : group.blocks.filter(
                          (block) => block.isAgentLike && block.sessionId && shouldShowFullOverviewBlock(block)
                      )
            ),
        [displayedTabGroups, isGroupCollapsed]
    );
    useEffect(() => {
        overviewLog("visible detail blocks", {
            overviewBlockId: blockId,
            visible: overviewVisible,
            displayedTabs: displayedTabGroups.length,
            detailBlockCount: detailBlocks.length,
            sessionIds: detailBlocks.map((block) => block.sessionId),
        });
    }, [blockId, detailBlocks, displayedTabGroups.length, overviewVisible]);
    const details = useSessionDetails(detailBlocks, refreshSeq, overviewVisible);
    const agentStatusHookProviders = useMemo(() => agentStatusHookProvidersForInstall(), []);
    const agentStatusHookInstall = useAgentStatusHookInstallState(agentStatusHookProviders, overviewVisible);
    const agentStatusHookProviderLabel = agentStatusHookInstall.statuses
        .map((status) => formatAgentProvider(status.provider))
        .join(" and ");
    const showEnableAgentStatus =
        !agentStatusHookInstall.loading &&
        agentStatusHookInstall.status?.supported === true &&
        agentStatusHookInstall.status?.needsInstall === true;
    // 唯一状态来源: AgentStatusStore 的统一 presented atom (与 agent Block 头部 / inline tab 同一份对象).
    const agentStatusBlockIds = useMemo(
        () => blocks.filter((block) => block.isAgentLike).map((block) => block.blockId),
        [blocks]
    );
    const agentStatuses = useOverviewPresentedStatuses(agentStatusBlockIds, overviewVisible);
    const agentStatusDoneAckedAt = jotai.useAtomValue(agentStatusDoneAckStore.doneAckedAtAtom);
    const workspaceAgentStatuses = useMemo(
        () => Object.values(agentStatuses).filter((status): status is AgentStatus => status != null),
        [agentStatuses]
    );
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
            agentStatusLog("overview presented status", {
                blockId: block.blockId,
                title: block.title,
                provider: block.agentProvider || "agent",
                sessionId: block.sessionId || null,
                presented: {
                    state: status.state,
                    phase: status.phase,
                    source: status.source,
                    confidence: status.confidence,
                    reason: status.reason ?? null,
                    prevState: status.prevState ?? null,
                    message: commandPreview(status.message),
                    toolName: status.toolName ?? null,
                    updatedAgeMs: ageMs(status.updatedAt, now),
                    completedAgeMs: ageMs(status.completedAt ?? 0, now),
                },
                viewedAgeMs: ageMs(viewedAt[block.blockId] ?? 0, now),
            });
        }
        previousAgentStatusKeys.current = nextKeys;
    }, [agentStatuses, blocks, now, viewedAt]);
    const [selected, setSelected] = useState<{ block: OverviewBlock; message: Message } | null>(null);
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [openNoteBlockId, setOpenNoteBlockId] = useState<string | null>(null);
    const noteEditorRef = useRef<OverviewSessionNoteEditorHandle | null>(null);
    const noteSwitchSeqRef = useRef(0);
    const [sessionAction, setSessionAction] = useState<SessionActionState>({ deletingSessionId: "", error: "" });
    const tabGroupsKey = tabIdsKey;
    // ack 必须同时写 R (fingerprint) 与 D (doneAckedAt), 否则另一面会因为只认自己的那份判定而"复活".
    // 收口到 ackAgentStatusUnified: 本文件不再直接碰两个 store.
    const ackAgentStatus = React.useCallback((blockId: string, status: AgentStatus) => {
        ackAgentStatusUnified(blockId, status, "overview-chip");
    }, []);
    const ackTabAgentStatuses = React.useCallback(
        (blocks: OverviewBlock[]) => {
            for (const block of blocks) {
                const status = agentStatuses[block.blockId];
                if (status != null) {
                    ackAgentStatusUnified(block.blockId, status, "overview-aggregate");
                }
            }
        },
        [agentStatuses]
    );
    useEffect(() => {
        setCollapsedTabIds((current) => {
            const tabIds = new Set(tabGroupsKey ? tabGroupsKey.split("\n") : []);
            let changed = false;
            const next: Record<string, boolean> = {};
            for (const [tabId, collapsed] of Object.entries(current)) {
                if (!tabIds.has(tabId)) {
                    changed = true;
                    continue;
                }
                next[tabId] = collapsed;
            }
            return changed ? next : current;
        });
    }, [tabGroupsKey]);
    const toggleTabCollapsed = React.useCallback(
        (tabId: string, status: OverviewTabGroup["status"]) => {
            setCollapsedTabIds((current) => {
                // 翻转必须相对「当前生效值」（显式记忆 ?? 默认值），不是相对显式记忆本身——
                // 否则 empty/unopened 默认折叠组永远翻不开（点一次写 true，点两次删回 undefined，
                // 两种状态都是折叠）。真机抓过：组头 toggle 成死按钮。
                const cur = current[tabId] ?? (status === "empty" || status === "unopened");
                return { ...current, [tabId]: !cur };
            });
        },
        []
    );
    const currentBlockInOverview = currentBlockId != null && blocks.some((block) => block.blockId === currentBlockId);
    const selectedBlockInOverview =
        selectedBlockId != null && blocks.some((block) => block.blockId === selectedBlockId);
    useEffect(() => {
        if (openNoteBlockId == null) return;
        if (blocks.some((block) => block.blockId === openNoteBlockId)) return;
        setOpenNoteBlockId(null);
    }, [blocks, openNoteBlockId]);
    const changeOpenSessionNote = React.useCallback((nextBlockId: string | null) => {
        const switchSeq = ++noteSwitchSeqRef.current;
        const currentEditor = noteEditorRef.current;
        if (currentEditor == null) {
            setOpenNoteBlockId(nextBlockId);
            return;
        }
        void currentEditor.saveBeforeSwitch().then((saved) => {
            if (!saved || switchSeq !== noteSwitchSeqRef.current) return;
            setOpenNoteBlockId(nextBlockId);
        });
    }, []);
    const closeSessionNoteInline = React.useCallback(() => {
        changeOpenSessionNote(null);
    }, [changeOpenSessionNote]);
    const openSessionNoteInline = React.useCallback(
        (nextBlock: OverviewBlock) => {
            if (!nextBlock.sessionId) return;
            setSelectedBlockId(nextBlock.blockId);
            changeOpenSessionNote(nextBlock.blockId);
        },
        [changeOpenSessionNote]
    );
    const toggleSessionNoteInline = React.useCallback(
        (nextBlock: OverviewBlock) => {
            if (!nextBlock.sessionId) return;
            setSelectedBlockId(nextBlock.blockId);
            if (openNoteBlockId === nextBlock.blockId) {
                closeSessionNoteInline();
                return;
            }
            changeOpenSessionNote(nextBlock.blockId);
        },
        [changeOpenSessionNote, closeSessionNoteInline, openNoteBlockId]
    );
    /*
     * 看板 4 个动作回调必须引用稳定（useCallback）：BoardCard 已套 React.memo，
     * 内联箭头函数每渲染换引用会让 memo 形同虚设 —— 点击开弹窗时整板全量重渲，
     * 首帧被 long task 压住，弹窗入场兹画就掉帧。见 11-10-overview-board-click-perf。
     * 下文 OverviewBoard 只能传这四个引用，不要再写内联箭头函数。
     */
    const blockConnectionOf = React.useCallback(
        (blockId: string): string => {
            const found = blocks.find((b) => b.blockId === blockId);
            const value = found?.block?.meta?.connection;
            return typeof value === "string" ? value.trim() : "";
        },
        [blocks]
    );
    const handleOpenBoardCard = React.useCallback(
        (card: OverviewBoardCard) => {
            // agent 卡片开弹窗这条路径不写 selectedBlockId：它只被列表视图的
            // highlightedBlockId 消费，看板分支写它等于让整个面板陷弹窗挂载再重渲一帧。
            overviewModel.markBlockViewed(card.blockId);
            const block = blocks.find((b) => b.blockId === card.blockId) ?? null;
            if (card.isAgentLike && block != null) {
                // 看板手上已有同一份 SessionSummary，直接预置进 note-cache：
                // 否则弹窗会先渲染空壳，等一次 Summary RPC 回来后内容才弹入
                // （实测 200~400ms 空白期，远端连接更久）。
                const blockConnection =
                    typeof block.block?.meta?.connection === "string"
                        ? (block.block.meta.connection as string).trim()
                        : "";
                const blockOrigin = parseOriginMeta(block.block?.meta?.[OriginMetaKey]) ?? "";
                primeSessionNote(
                    card.sessionId,
                    summaries[card.sessionId]?.summary ?? details[card.sessionId]?.detail?.summary ?? null,
                    blockConnection,
                    blockOrigin
                );
                modalsModel.pushModal("AgentCardModal", {
                    blockId: card.blockId,
                    blockData: block.block,
                    tabId: card.tabId,
                });
                return;
            }
            if (block != null) {
                setSelectedBlockId(card.blockId);
                overviewModel.jumpToBlock(block.tabId, block.blockId);
            }
        },
        [blocks, details, overviewModel, summaries]
    );
    const handleJumpBoardCard = React.useCallback(
        (card: OverviewBoardCard) => {
            setSelectedBlockId(card.blockId);
            overviewModel.markBlockViewed(card.blockId);
            if (card.tabId !== "") {
                overviewModel.jumpToBlock(card.tabId, card.blockId);
            }
        },
        [overviewModel]
    );
    const handleCloseBoardCard = React.useCallback(
        (card: OverviewBoardCard) => {
            const block = blocks.find((b) => b.blockId === card.blockId) ?? null;
            if (block == null) return;
            setSessionAction((current) => ({ ...current, error: "" }));
            closeOverviewBlock(block)
                .catch((error) => {
                    setSessionAction((current) => ({
                        ...current,
                        error: error instanceof Error ? error.message : String(error),
                    }));
                })
                .finally(() => model.refresh());
        },
        [blocks, model]
    );
    const handleDeleteBoardSession = React.useCallback(
        (card: OverviewBoardCard) => {
            const block = blocks.find((b) => b.blockId === card.blockId) ?? null;
            if (block == null || !block.sessionId || sessionAction.deletingSessionId) return;
            modalsModel.pushModal("ConfirmModal", {
                title: i18n.t("session-overview:dialog.deleteSessionTitle"),
                message: i18n.t("session-overview:dialog.deleteSessionMessage", { title: block.title }),
                cancelLabel: i18n.t("session-overview:dialog.cancel"),
                actions: [
                    { label: i18n.t("session-overview:dialog.moveToTrash"), value: "recycle", tone: "secondary" },
                    {
                        label: i18n.t("session-overview:dialog.deletePermanently"),
                        value: "delete-permanently",
                        tone: "destructive",
                    },
                ],
                onAction: (action: string) => {
                    if (action !== "recycle" && action !== "delete-permanently") return;
                    setSelectedBlockId(block.blockId);
                    setSessionAction({ deletingSessionId: block.sessionId, error: "" });
                    const request =
                        action === "delete-permanently"
                            ? sessionService.DeletePermanently(block.sessionId, "")
                            : sessionService.Delete(block.sessionId, "");
                    request
                        .then(() => fireAndForget(() => closeOverviewBlock(block)))
                        .catch((error) => {
                            setSessionAction({
                                deletingSessionId: "",
                                error: error instanceof Error ? error.message : String(error),
                            });
                        })
                        .finally(() => {
                            setSessionAction((current) =>
                                current.deletingSessionId === block.sessionId
                                    ? { deletingSessionId: "", error: current.error }
                                    : current
                            );
                            model.refresh();
                        });
                },
            });
        },
        [blocks, model, sessionAction.deletingSessionId, sessionService]
    );
    // 看板方块条点击 → 复用列表的消息弹窗链路（setSelected）：11-24 R1 卡列融合。
    // 恢复入口已移除（R2，决策 D6：只删看板卡入口，AgentResumeCommand 与 AISessions 恢复保留）。
    const handleOpenBoardMessage = React.useCallback(
        (card: OverviewBoardCard, seq: number) => {
            const block = blocks.find((item) => item.blockId === card.blockId);
            if (block == null) return;
            const message = readableMessages(details[block.sessionId]?.detail ?? null).find((item) => item.seq === seq);
            if (message == null) return;
            setSelectedBlockId(block.blockId);
            overviewModel.markBlockViewed(block.blockId);
            setSelected({ block, message });
        },
        [blocks, details]
    );
    // 跨 Tab 拖拽（11-23）：落点执行 = 既有 ObjectService.MoveBlockToTab（与块菜单「移动到 Tab」同一条后端路径）。
    const handleMoveBoardCard = React.useCallback(
        (blockId: string, toTabId: string) => {
            ObjectService.MoveBlockToTab(blockId, toTabId, false).catch((error: unknown) => {
                console.warn("[overview-drag] 移动块到 Tab 失败", { blockId, toTabId, error });
            });
        },
        []
    );
    // 拖拽态空 Tab 落点用的全量 Tab（含 0 卡 Tab；displayedTabGroups 已含全部 Tab 的组头口径）。
    const boardTabTargets = React.useMemo(
        () => displayedTabGroups.map((group) => ({ tabId: group.tabId, tabName: group.tabName })),
        [displayedTabGroups]
    );
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
            : normalizeTimeMs(
                  summaries[focusedOverviewBlock.sessionId]?.summary?.updatedAt ??
                      details[focusedOverviewBlock.sessionId]?.detail?.summary?.updatedAt
              );

    useEffect(() => {
        if (focusedOverviewBlock == null) return;
        overviewModel.markBlockViewed(
            focusedOverviewBlock.blockId,
            Math.max(Date.now(), focusedOverviewBlockUpdatedAt)
        );
    }, [focusedOverviewBlock?.blockId, focusedOverviewBlockUpdatedAt, overviewModel]);

    const displayedBlockCount = useMemo(
        () => displayedTabGroups.reduce((count, group) => count + group.blocks.length, 0),
        [displayedTabGroups]
    );
    // 汇总行 K：只算当前渲染出来的组（hideUnopenedTabs / agentsOnly 已作用在 blocks 上）。
    const totalAgentCount = useMemo(
        () => displayedTabGroups.reduce((count, group) => count + group.agentCount, 0),
        [displayedTabGroups]
    );
    const unreadCount = blocks.filter((block) => {
        const updatedAtMs = normalizeTimeMs(
            summaries[block.sessionId]?.summary?.updatedAt ?? details[block.sessionId]?.detail?.summary?.updatedAt
        );
        return block.isAgentLike && updatedAtMs > 0 && updatedAtMs > (viewedAt[block.blockId] ?? 0);
    }).length;
    const emptyMessage = agentsOnly
        ? t("session-overview:panel.emptyAgentsOnly")
        : t("session-overview:panel.emptyTabs");
    const agentSummary = !shouldShowAgentAggregate(workspaceAgentStatuses)
        ? ""
        : ` · ${aggregateStatusLabel(workspaceAgentAggregate)}`;
    // Board view consumes the same pre-collapse filtered groups as list view, so
    // agentsOnly / hideUnopenedTabs keep their exact meaning (collapse is list-only)。
    // 但只保留"列表里会显示成完整行"的 block（agent 会话 / terminal）：其他 block 在
    // 列表里只是一枚 compact 图标，搬到看板会变成没有 sessionId、点不动的空卡片，
    // 把「空闲」列塞满（真机验证实测 1 行 vs 5 卡）。
    const boardBlocks = useMemo(
        () =>
            displayedTabGroups
                .flatMap((group) => group.blocks)
                .filter((nextBlock) => shouldShowFullOverviewBlock(nextBlock)),
        [displayedTabGroups]
    );
    const boardCards = useMemo<OverviewBoardCard[]>(
        () =>
            boardBlocks.map((nextBlock) => {
                const summary = summaries[nextBlock.sessionId]?.summary ?? null;
                const detailSummary = details[nextBlock.sessionId]?.detail?.summary ?? null;
                const meta = (nextBlock.block?.meta ?? {}) as Record<string, unknown>;
                const providerLabel = nextBlock.isAgentLike ? providerDisplayLabel(nextBlock.agentProvider) : "";
                const projectName = nextBlock.isAgentLike
                    ? projectNameFromPath(summary?.projectPath) ||
                      projectNameFromPath(typeof meta["cmd:cwd"] === "string" ? (meta["cmd:cwd"] as string) : "")
                    : "";
                const note = (summary?.note ?? detailSummary?.note ?? "").trim();
                const messages = readableMessages(details[nextBlock.sessionId]?.detail ?? null);
                const preview = truncateBoardPreview(
                    messages.length > 0 ? messagePreview(messages[messages.length - 1]) : "",
                    160
                );
                // 方块条数据（11-24 R1，11-25 R3 收口到共享管线）：与列表行/整卡放大弹窗
                // 同一份 readableMessages / messagePreview 实现，只裁到上限；点击回传 seq
                // 由面板层复用消息弹窗链路打开。
                const recentSquares = buildRecentMessageSquares(details[nextBlock.sessionId]?.detail ?? null);
                const recentMessages = recentSquares.items;
                const sessionTitle = (summary?.title ?? detailSummary?.title ?? "").trim();
                return {
                    blockId: nextBlock.blockId,
                    tabId: nextBlock.tabId,
                    sessionId: nextBlock.sessionId,
                    tabName: nextBlock.tabName,
                    isAgentLike: nextBlock.isAgentLike,
                    title: resolveBoardCardTitle({
                        isAgentLike: nextBlock.isAgentLike,
                        sessionTitle,
                        note,
                        projectName,
                        tabName: nextBlock.tabName,
                        providerLabel,
                        blockTitle: nextBlock.title,
                    }),
                    avatar: resolveBoardAvatar(nextBlock, personas, sessionEmojis),
                    providerLabel,
                    // raw provider key（不是显示名）：看板 emoji 头像热区要用它开 picker。
                    // 非 agent 卡没有 persona，给 "" —— 卡片侧据此保留纯展示头像。
                    provider: nextBlock.isAgentLike ? (nextBlock.agentProvider ?? "") : "",
                    projectName,
                    // tags 去 `#` 前缀并去重：卡片 chip / 标签分组 / 属性面板共用同一份口径。
                    tags: normalizeBoardTags(summary?.tags ?? detailSummary?.tags),
                    // 自定义属性（有值才显示）：status/select 着色胶囊。归一纯函数在
                    // overview-board-model，不反向依赖 aisessions view 层。
                    propRows: resolveBoardPropRows(summary?.props ?? detailSummary?.props ?? null),
                    kindLabel: nextBlock.isAgentLike ? "" : blockViewToName(nextBlock.view),
                    preview,
                    recentMessages,
                    messagesOverflow: Math.max(0, recentSquares.overflow),
                    note,
                    updatedAt: normalizeTimeMs(summary?.updatedAt ?? detailSummary?.updatedAt),
                    // 度量轨（session-metrics）：全部来自已存在的 SessionSummary，不新增 RPC。
                    // createdAt 必须先归一化（summary 里可能是秒），度量轨不做秒/毫秒猜测。
                    createdAt: normalizeTimeMs(summary?.createdAt ?? detailSummary?.createdAt),
                    messageCount: summary?.messageCount ?? detailSummary?.messageCount ?? 0,
                    size: summary?.size ?? detailSummary?.size ?? 0,
                    live: summary?.live === true,
                } satisfies OverviewBoardCard;
            }),
        // `kindLabel` / `title` fall back to localized view names (blockViewToName).
        [boardBlocks, details, personas, sessionEmojis, summaries, activeLocale]
    );
    // 时间线行：身份复用看板卡片，时间字段来自 SessionSummary，状态色来自 AgentStatusStore。
    const timelineRows = useMemo(
        () =>
            buildTimelineRows(boardCards, {
                nowMs: now,
                windowMs: timelineRangeToMs(timelineRange),
                sessions: Object.fromEntries(
                    boardCards
                        .filter((card) => card.sessionId !== "")
                        .map((card) => {
                            const summary = summaries[card.sessionId]?.summary ?? null;
                            return [
                                card.sessionId,
                                {
                                    createdAt: summary?.createdAt ?? 0,
                                    updatedAt: summary?.updatedAt ?? card.updatedAt,
                                    messageCount: summary?.messageCount ?? 0,
                                    live: summary?.live === true,
                                },
                            ];
                        })
                ),
                states: Object.fromEntries(
                    boardCards.map((card) => [card.blockId, agentStatuses[card.blockId]?.state ?? null])
                ),
                activeSince: Object.fromEntries(
                    boardCards.map((card) => [card.blockId, agentStatuses[card.blockId]?.activeSince ?? null])
                ),
                completedAt: Object.fromEntries(
                    boardCards.map((card) => [card.blockId, agentStatuses[card.blockId]?.completedAt ?? null])
                ),
            }),
        [agentStatuses, boardCards, now, summaries, timelineRange]
    );
    /**
     * 卡片底部迷你时间线：复用同一份 timelineRows（排序/窗口/分段规则完全相同），
     * 只把每行的 segments 按 blockId 发下去 —— 看板卡片自己不做时间推导。
     *
     * 每行最多 8 段（卡片只有 ~180px 宽，更多段在像素上已经分不开）。
     */
    const miniTimelines = React.useMemo(() => {
        const result: Record<string, readonly OverviewTimelineSegment[]> = {};
        const windowMs = timelineRangeToMs(timelineRange);
        for (const row of timelineRows) {
            const segments = buildTimelineSegments(row, { nowMs: now, windowMs });
            result[row.blockId] = segments.length > 8 ? segments.slice(segments.length - 8) : segments;
        }
        return result;
    }, [timelineRows, now, timelineRange]);
    const setViewMode = React.useCallback((mode: OverviewViewMode) => {
        globalStore.set(overviewViewModeAtom, mode);
    }, []);

    // ── 「＋ 新建 Agent」：仅 Tab 分组可用（入口看板/列表两处）──
    // 弹窗数据按需现算：Tab object → 该 Tab 的 context（不取焦点块）+ 路径候选。
    const [addAgentTab, setAddAgentTab] = useState<{ tabId: string; tabName: string } | null>(null);
    const openAddAgent = React.useCallback((tabId: string, tabName: string) => {
        setAddAgentTab({ tabId, tabName });
    }, []);
    const addAgentData = React.useMemo(() => {
        if (addAgentTab == null) return null;
        const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", addAgentTab.tabId)));
        if (tab == null) return null;
        const getBlockById = (blockId: string) =>
            globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        // focusedBlock 不传：这里要的是「这个 Tab 自己的上下文」，不是当前焦点块的上下文。
        const contextMeta = resolveWorkspaceAgentContextMeta({ tab, getBlockById });
        const tabCwd = typeof contextMeta["cmd:cwd"] === "string" ? contextMeta["cmd:cwd"].trim() : "";
        const tabConnection = typeof contextMeta.connection === "string" ? contextMeta.connection : null;
        return {
            targets: collectAgentLaunchTargetsInTab(tab, getBlockById, null, {}),
            defaultPath: tabCwd === "" ? null : tabCwd,
            // 远端 Tab 的默认行要带上 connection，不能当本地行（否则建块会落到本机）
            defaultConnection: tabConnection,
        };
    }, [addAgentTab]);
    // 卡片展开 + composer 发送的共享状态（面板级，不持久化；切换视图/重开即收起）
    const reloadOverview = React.useCallback(() => model.refresh(), [model]);
    const cardSend = useCardSendState(reloadOverview);

    const submitAddAgent = React.useCallback(async (request: AddAgentSubmitRequest): Promise<void> => {
        const settings = globalStore.get(atoms.settingsAtom);
        const rawBlockDef = createAgentBlockDefForProfile(
            request.profileName,
            settings,
            buildAddAgentLaunchContext({ connection: request.connection, cwd: request.cwd }),
            undefined,
            undefined,
            undefined,
            request.modelOverride ?? undefined
        );
        // 本机建块也必须解析成绝对路径：GUI 启动的 app 进程 PATH 是 launchd 裸 PATH，裸命令名
        // （如 opencode 装在 ~/.opencode/bin）会让 zsh 报 command not found。与弹窗探测同源。
        const blockDef = await resolveAgentBlockCommandForLaunch(rawBlockDef, (command, connection, cwd) =>
            ClientService.FindCommandForConnection(command, connection, cwd)
        );
        const runtimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
        // activateTargetTab=false：建块后不抢焦点，用户留在 Overview 看到新卡入列。
        // 抛出异常 = 建块失败（可重试）；建块成功就关弹窗，绝不把用户卡在「创建中」。
        const blockId = await ObjectService.CreateBlockInTab(request.tabId, blockDef, runtimeOpts, false, false);
        setAddAgentTab(null);
        // 首发消息走后台投递（派发不等待）：agent 启动可能几十秒到几分钟（pi 会跑 npm 查扩展更新），
        // 就绪门 + 提交确认都在 agentsend 后端做。这里只记日志，失败不阻塞、不回滚块。
        const text = request.message;
        if (text != null && text !== "") {
            // R7（11-24-agentsend-status）：建块后**立刻**建立本地「正在派发」行程 ——
            // 卡片当场出现发送状态，投递不再隐形（「292/aaaa」事故的根因）。
            cardSend.markDispatching(blockId);
            fireAndForget(async () => {
                try {
                    const sendResult = await RpcApi.AgentSendCommand(TabRpcClient, {
                        blockid: blockId,
                        text64: stringToBase64(text),
                        submit: true,
                        // 派发队列：服务端持有投递状态，桌面只提交 + 记回执（手机端/CLI 同一契约）
                        async: true,
                        requester: "desktop",
                    });
                    if (sendResult?.queued && sendResult.dispatchid != null && sendResult.dispatchid !== "") {
                        cardSend.markDispatchReceipt(blockId, {
                            dispatchId: sendResult.dispatchid,
                            state: "pending",
                        });
                    }
                    if (sendResult?.submitconfirmed === false) {
                        console.warn("[overview-add-agent] 消息已放入输入框但未确认提交", { blockId });
                    }
                } catch (error) {
                    console.warn("[overview-add-agent] 首发消息投递失败", { blockId, error });
                    cardSend.applyDispatchReceipt(blockId, {
                        state: "failed",
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        }
    }, [cardSend]);

    // ── 「＋ 新建 Tab」（F-1122-overview-new-tab）：工具栏 + 组列表尾部两处入口同一弹窗 ──
    const [newTabOpen, setNewTabOpen] = useState(false);
    const submitNewTab = React.useCallback(
        async (request: NewTabSubmitRequest): Promise<void> => {
            const workspaceId = globalStore.get(atoms.workspace)?.oid;
            if (workspaceId == null || workspaceId === "") {
                throw new Error("E_NO_WORKSPACE workspace not ready");
            }
            // activateTab=false：建完不切过去，用户留在 Overview（PRD R1.1/R3 不抢焦点）。
            // 抛出异常 = 创建失败（弹窗保留可重试）；成功由这里收尾（关弹窗 + 刷新组）。
            const tabId = await WorkspaceService.CreateTab(workspaceId, request.name, false);
            if (request.addAgent && request.profileName != null) {
                const settings = globalStore.get(atoms.settingsAtom);
                const rawBlockDef = createAgentBlockDefForProfile(
                    request.profileName,
                    settings,
                    // 新 Tab 没有自己的 context：显式不继承焦点块 context（与 add-agent 同一兑底）。
                    buildAddAgentLaunchContext({ connection: null, cwd: null })
                );
                // 同 submitAddAgent：本机建块也解析绝对路径，避免 GUI 裸 PATH 下找不到命令。
                const blockDef = await resolveAgentBlockCommandForLaunch(rawBlockDef, (command, connection, cwd) =>
                    ClientService.FindCommandForConnection(command, connection, cwd)
                );
                const runtimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
                // activateTargetTab=false：建 agent 块同样不抢焦点。
                await ObjectService.CreateBlockInTab(tabId, blockDef, runtimeOpts, false, false);
            }
            setNewTabOpen(false);
            // 组行随 workspace.tabids 的 update events 自动出现；refresh 让明细/摘要缓存重取，
            // 也保证接下来 1s 内组头与块列表是同一份数据（不额外造本地假组）。
            model.refresh();
        },
        [model]
    );

    return (
        <CardSendContext.Provider value={cardSend}>
            <div className="session-overview-panel" aria-label={t("session-overview:panel.label")}>
                <div className="session-overview-header">
                    <div>
                        <div className="session-overview-subtitle">
                            {i18n.t("session-overview:panel.subtitle", {
                                shown: displayedBlockCount,
                                total: blocks.length,
                                unread: unreadCount,
                            })}
                            {agentSummary}
                            {agentStatusHookInstall.error ? (
                                <span className="session-overview-hook-error"> · {agentStatusHookInstall.error}</span>
                            ) : null}
                        </div>
                    </div>
                    <div className="session-overview-header-actions">
                        {showEnableAgentStatus ? (
                            <button
                                type="button"
                                className="session-overview-enable-agent-status"
                                onClick={agentStatusHookInstall.install}
                                disabled={agentStatusHookInstall.installing}
                                title={
                                    agentStatusHookInstall.status?.reason
                                        ? i18n.t("session-overview:panel.installHooksReason", {
                                              provider: agentStatusHookProviderLabel,
                                              reason: agentStatusHookInstall.status.reason,
                                          })
                                        : i18n.t("session-overview:panel.installHooks", {
                                              provider: agentStatusHookProviderLabel,
                                          })
                                }
                            >
                                <i
                                    className={makeIconClass(
                                        agentStatusHookInstall.installing ? "spinner" : "plug-circle-bolt",
                                        false
                                    )}
                                />
                                <span>
                                    {agentStatusHookInstall.installing
                                        ? t("session-overview:panel.installing")
                                        : i18n.t("session-overview:panel.enableProvider", {
                                              provider: agentStatusHookProviderLabel,
                                          })}
                                </span>
                            </button>
                        ) : null}
                        {OVERVIEW_BOARD_ENABLED && viewMode === "timeline" ? (
                            <div
                                className="session-overview-group-picker"
                                title={t("session-overview:panel.timelineWindow")}
                            >
                                <i className={makeIconClass("clock", false)} />
                                <AppSelect
                                    className="session-overview-group-select"
                                    data-overview-range=""
                                    variant="bare"
                                    size="sm"
                                    value={String(timelineRange)}
                                    ariaLabel={t("session-overview:panel.timelineRange")}
                                    options={OverviewTimelineRanges.map((range) => ({
                                        value: String(range),
                                        label: formatTimelineRangeLabel(range),
                                    }))}
                                    onChange={(next) =>
                                        globalStore.set(
                                            overviewTimelineRangeAtom,
                                            Number(next) as OverviewTimelineRange
                                        )
                                    }
                                />
                            </div>
                        ) : null}
                        {OVERVIEW_BOARD_ENABLED ? (
                            <div
                                className="session-overview-view-switch"
                                role="group"
                                aria-label={t("session-overview:panel.overviewView")}
                            >
                                {OverviewViewModesImplemented.map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={cn(
                                            "session-overview-view-switch-button",
                                            // 旧验证脚本/用户习惯用 .session-overview-view-toggle 指"看板"这枚，
                                            // 保留这个类名做兼容。
                                            mode === "board" && "session-overview-view-toggle",
                                            viewMode === mode && "is-active"
                                        )}
                                        data-overview-view={mode}
                                        onClick={() => setViewMode(mode)}
                                        aria-pressed={viewMode === mode}
                                        aria-label={t(OverviewViewModeMeta[mode].titleKey)}
                                        title={t(OverviewViewModeMeta[mode].titleKey)}
                                    >
                                        <i className={makeIconClass(OverviewViewModeMeta[mode].icon, false)} />
                                        <span>{t(OverviewViewModeMeta[mode].labelKey)}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {OVERVIEW_BOARD_ENABLED && viewMode === "board" ? (
                            <div
                                className="session-overview-group-picker"
                                title={t("session-overview:panel.boardGrouping")}
                            >
                                <i className={makeIconClass("layer-group", false)} />
                                <AppSelect
                                    className="session-overview-group-select"
                                    data-overview-group=""
                                    variant="bare"
                                    size="sm"
                                    value={boardGroup}
                                    ariaLabel={t("session-overview:panel.boardGrouping")}
                                    options={[
                                        { value: "status", label: t("session-overview:panel.groupStatus") },
                                        { value: "tab", label: t("session-overview:panel.groupTab") },
                                        { value: "provider", label: t("session-overview:panel.groupProvider") },
                                        { value: "project", label: t("session-overview:panel.groupProject") },
                                        { value: "tags", label: t("session-overview:panel.groupTags") },
                                    ]}
                                    onChange={(next) =>
                                        globalStore.set(overviewBoardGroupAtom, next as OverviewBoardGroup)
                                    }
                                />
                            </div>
                        ) : null}
                        <div className="session-overview-filter-group" aria-label={t("session-overview:panel.filters")}>
                            <button
                                type="button"
                                className={cn("session-overview-filter-button", hideUnopenedTabs && "is-active")}
                                onClick={() => overviewModel.setHideUnopenedTabs(!hideUnopenedTabs)}
                                aria-pressed={hideUnopenedTabs}
                                title={t("session-overview:panel.hideUnopened")}
                            >
                                <i className={makeIconClass("eye-slash", false)} />
                                <span>{t("session-overview:panel.openedTabs")}</span>
                            </button>
                            <button
                                type="button"
                                className={cn("session-overview-filter-button", agentsOnly && "is-active")}
                                onClick={() => overviewModel.setAgentsOnly(!agentsOnly)}
                                aria-pressed={agentsOnly}
                                title={t("session-overview:panel.agentsOnlyTitle")}
                            >
                                <i className={makeIconClass("robot", false)} />
                                <span>{t("session-overview:panel.agents")}</span>
                            </button>
                        </div>
                        {/* ＋ 新建 Tab：工具栏入口（全局建，建完不自动切过去） */}
                        <button
                            type="button"
                            className="session-overview-new-tab-button"
                            data-overview-new-tab="toolbar"
                            onClick={() => setNewTabOpen(true)}
                            title={t("session-overview:newTab.title")}
                        >
                            <i className={makeIconClass("plus", false)} />
                            <span>{t("session-overview:panel.newTab")}</span>
                        </button>
                        <label className="session-overview-limit">
                            <span>{t("session-overview:panel.messages")}</span>
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
                {/* 独立「定时任务」区（N-1123-hero-sched-ui）：视图切换之下、列表/看板之上；
                    无任务时组件自身返回 null，0 视觉变化。 */}
                <OverviewScheduledTasksSection />
                <div className="session-overview-body">
                    {OVERVIEW_BOARD_ENABLED && viewMode === "timeline" ? (
                        <OverviewTimeline
                            rows={timelineRows}
                            range={timelineRange}
                            now={now}
                            onOpenSession={(row) => {
                                setSelectedBlockId(row.blockId);
                                overviewModel.markBlockViewed(row.blockId);
                                if (row.sessionId) {
                                    openSessionDetail(row.sessionId, blockConnectionOf(row.blockId));
                                }
                            }}
                        />
                    ) : OVERVIEW_BOARD_ENABLED && viewMode === "board" ? (
                        displayedTabGroups.length === 0 ? (
                            <div className="session-overview-empty">
                                {workspaceTabIds.length === 0
                                    ? t("session-overview:panel.noTabs")
                                    : emptyMessage}
                            </div>
                        ) : (
                            <OverviewBoard
                                cards={boardCards}
                                presentedStatuses={agentStatuses}
                                agentStatuses={agentStatuses}
                                group={boardGroup}
                                miniTimelines={miniTimelines}
                                now={now}
                                onAckStatus={ackAgentStatus}
                                onOpenCard={handleOpenBoardCard}
                                onJumpCard={handleJumpBoardCard}
                                onCloseCard={handleCloseBoardCard}
                                onDeleteSession={handleDeleteBoardSession}
                                onOpenMessage={handleOpenBoardMessage}
                                deletingSessionId={sessionAction.deletingSessionId}
                                onAddAgent={openAddAgent}
                                onMoveCard={handleMoveBoardCard}
                                tabTargets={boardTabTargets}
                            />
                        )
                    ) : displayedTabGroups.length === 0 ? (
                        <div className="session-overview-empty">
                            {workspaceTabIds.length === 0
                                ? t("session-overview:panel.noTabs")
                                : emptyMessage}
                        </div>
                    ) : (
                        displayedTabGroups.map((group) => (
                            <TabGroupSection
                                key={group.tabId}
                                group={group}
                                collapsed={isGroupCollapsed(group.tabId, group.status)}
                                details={details}
                                summaries={summaries}
                                openNoteBlockId={openNoteBlockId}
                                noteEditorRef={noteEditorRef}
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
                                onToggleSessionNote={toggleSessionNoteInline}
                                onCloseSessionNote={closeSessionNoteInline}
                                onToggleCollapsed={() => toggleTabCollapsed(group.tabId, group.status)}
                                onOpenSessionDetail={(nextBlock) => {
                                    if (!nextBlock.sessionId) return;
                                    setSelectedBlockId(nextBlock.blockId);
                                    overviewModel.markBlockViewed(nextBlock.blockId);
                                    openSessionDetail(nextBlock.sessionId, blockConnectionOf(nextBlock.blockId));
                                }}
                                onDeleteSession={(nextBlock) => {
                                    if (!nextBlock.sessionId || sessionAction.deletingSessionId) return;
                                    modalsModel.pushModal("ConfirmModal", {
                                        title: i18n.t("session-overview:dialog.deleteSessionTitle"),
                                        message: i18n.t("session-overview:dialog.deleteSessionMessage", {
                                            title: nextBlock.title,
                                        }),
                                        cancelLabel: i18n.t("session-overview:dialog.cancel"),
                                        actions: [
                                            {
                                                label: i18n.t("session-overview:dialog.moveToTrash"),
                                                value: "recycle",
                                                tone: "secondary",
                                            },
                                            {
                                                label: i18n.t("session-overview:dialog.deletePermanently"),
                                                value: "delete-permanently",
                                                tone: "destructive",
                                            },
                                        ],
                                        onAction: (action: string) => {
                                            if (action !== "recycle" && action !== "delete-permanently") return;
                                            setSelectedBlockId(nextBlock.blockId);
                                            setSessionAction({ deletingSessionId: nextBlock.sessionId, error: "" });
                                            const request =
                                                action === "delete-permanently"
                                                    ? sessionService.DeletePermanently(nextBlock.sessionId, "")
                                                    : sessionService.Delete(nextBlock.sessionId, "");
                                            request
                                                .then(() => {
                                                    setSelectedBlockId((current) =>
                                                        current === nextBlock.blockId ? null : current
                                                    );
                                                    setSelected((current) =>
                                                        current?.block.sessionId === nextBlock.sessionId
                                                            ? null
                                                            : current
                                                    );
                                                    fireAndForget(() => closeOverviewBlock(nextBlock));
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
                                        },
                                    });
                                }}
                                onDeleteBlock={(nextBlock) => {
                                    setSelectedBlockId(nextBlock.blockId);
                                    setSessionAction((current) => ({ ...current, error: "" }));
                                    closeOverviewBlock(nextBlock)
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
                                agentStatusAckedFp={agentStatusAckedFp}
                                agentStatusDoneAckedAt={agentStatusDoneAckedAt}
                                agentsOnly={agentsOnly}
                                onAckAgentStatus={ackAgentStatus}
                                onAckTabAgentStatuses={() => ackTabAgentStatuses(group.blocks)}
                                onAddAgent={openAddAgent}
                            />
                        ))
                    )}
                    {/* ＋ 新建 Tab：组列表尾部入口（就近建，新组插在末尾）——只在列表视图渲染 */}
                    {(!OVERVIEW_BOARD_ENABLED || viewMode === "list") && displayedTabGroups.length > 0 ? (
                        <button
                            type="button"
                            className="session-overview-tab-new"
                            data-overview-new-tab="tail"
                            onClick={() => setNewTabOpen(true)}
                            title={t("session-overview:newTab.title")}
                        >
                            <i className={makeIconClass("plus", false)} />
                            <span>{t("session-overview:panel.newTab")}</span>
                        </button>
                    ) : null}
                    {/* 汇总行（R1.5）：N = workspace tabids 数，M = 渲染组数，K = agent 合计 */}
                    {!OVERVIEW_BOARD_ENABLED || viewMode === "list" ? (
                        <div className="session-overview-tab-summary" data-overview-tab-summary="">
                            {i18n.t("session-overview:panel.tabSummary", {
                                tabs: workspaceTabIds.length,
                                shown: displayedTabGroups.length,
                                agents: totalAgentCount,
                            })}
                        </div>
                    ) : null}
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
                onEditSessionNote={(nextBlock) => {
                    openSessionNoteInline(nextBlock);
                    setSelected(null);
                }}
            />
            {addAgentTab != null && addAgentData != null ? (
                <OverviewAddAgentModal
                    tabId={addAgentTab.tabId}
                    tabName={addAgentTab.tabName}
                    targets={addAgentData.targets}
                    defaultPath={addAgentData.defaultPath}
                    defaultConnection={addAgentData.defaultConnection}
                    onClose={() => setAddAgentTab(null)}
                    onSubmit={submitAddAgent}
                />
            ) : null}
            {newTabOpen ? <OverviewNewTabModal onClose={() => setNewTabOpen(false)} onSubmit={submitNewTab} /> : null}
        </CardSendContext.Provider>
    );
}

function setActiveTabAndCloseMenus(tabId: string): void {
    setActiveTab(tabId);
}

export class SessionOverviewViewModel implements ViewModel {
    viewType = "sessionoverview";
    viewIcon = jotai.atom("list-tree");
    viewName = localeTextAtom(() => i18n.t("block:viewName.sessionoverview"));
    noPadding = jotai.atom(true);
    refreshSeqAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    lastRefreshAtAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    viewComponent = SessionOverviewPanel as ViewComponent;

    constructor(_: ViewModelInitType) {
        this.endIconButtons = jotai.atom((get) => {
            const seq = get(this.refreshSeqAtom);
            const lastAt = get(this.lastRefreshAtAtom);
            const elapsed = lastAt > 0 ? Date.now() - lastAt : 0;
            const syncing = seq > 0 && elapsed < 3_000; // within 3s of last manual refresh
            const icon = syncing ? "arrows-rotate" : "rotate-right";
            return [
                {
                    elemtype: "iconbutton",
                    icon,
                    iconSpin: syncing,
                    title: syncing ? "Refreshing overview…" : "Refresh overview",
                    zone: "pinned",
                    click: (e) => {
                        e.stopPropagation();
                        this.refresh();
                    },
                },
            ];
        });
    }

    refresh(): void {
        globalStore.set(this.refreshSeqAtom, globalStore.get(this.refreshSeqAtom) + 1);
        globalStore.set(this.lastRefreshAtAtom, Date.now());
    }
}

export { SessionOverviewButtonBase as SessionOverviewButton, SessionOverviewPanel };
