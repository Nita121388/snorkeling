// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { atoms, globalStore, refocusNode, setActiveTab, WOS } from "@/app/store/global";
import {
    SnorkelingBlockKindMetaKey,
    SnorkelingBlockKindOverview,
    toggleCurrentTabBlockByKind,
} from "@/app/workspace/toggle-block";
import { getHiddenBlockIdsFromTab, getLayoutModelForStaticTab } from "@/layout/index";
import * as jotai from "jotai";

const SessionOverviewView = "sessionoverview";
const SessionOverviewTabKind = "overview";
const SessionOverviewTabKindMetaKey = "snorkeling:tab-kind";
const SessionOverviewTabName = "Overview";

export class SessionOverviewModel {
    private static instance: SessionOverviewModel | null = null;
    private openPromise: Promise<void> | null = null;

    isOpenAtom = jotai.atom((get) => {
        const tabId = get(atoms.staticTabId);
        if (!tabId) return false;
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        const hiddenBlockIds = new Set(getHiddenBlockIdsFromTab(tab));
        for (const blockId of tab?.blockids ?? []) {
            const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (
                block?.meta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindOverview &&
                !hiddenBlockIds.has(blockId)
            ) {
                return true;
            }
        }
        return false;
    });
    isFocusedAtom = jotai.atom((get) => {
        const tabId = get(atoms.staticTabId);
        if (!tabId) return false;
        const layoutModel = getLayoutModelForStaticTab();
        if (layoutModel?.focusedNode == null) return false;
        const focusedNode = get(layoutModel.focusedNode);
        const focusedBlockId = focusedNode?.data?.blockId;
        if (typeof focusedBlockId !== "string") return false;
        const focusedBlock = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId)));
        return focusedBlock?.meta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindOverview;
    });
    displayLimitAtom = jotai.atom(readDisplayLimit()) as jotai.PrimitiveAtom<number>;
    blockViewedAtAtom = jotai.atom(readViewedAt()) as jotai.PrimitiveAtom<Record<string, number>>;
    agentStatusAckedAtAtom = jotai.atom(readAgentStatusAckedAt()) as jotai.PrimitiveAtom<Record<string, number>>;
    hideUnopenedTabsAtom = jotai.atom(readBoolean(HideUnopenedTabsStorageKey)) as jotai.PrimitiveAtom<boolean>;
    agentsOnlyAtom = jotai.atom(readBoolean(AgentsOnlyStorageKey)) as jotai.PrimitiveAtom<boolean>;

    private constructor() {}

    static getInstance(): SessionOverviewModel {
        if (SessionOverviewModel.instance == null) {
            SessionOverviewModel.instance = new SessionOverviewModel();
        }
        return SessionOverviewModel.instance;
    }

    open(): Promise<void> {
        if (this.openPromise != null) {
            return this.openPromise;
        }
        this.openPromise = this.openInternal().finally(() => {
            this.openPromise = null;
        });
        return this.openPromise;
    }

    private async openInternal(): Promise<void> {
        await toggleCurrentTabBlockByKind({
            kind: SnorkelingBlockKindOverview,
            blockDef: {
                meta: {
                    view: SessionOverviewView,
                    "frame:title": SessionOverviewTabName,
                    icon: "list-tree",
                },
            },
            hideInsteadOfClose: true,
        });
    }

    setDisplayLimit(limit: number): void {
        const normalized = normalizeDisplayLimit(limit);
        globalStore.set(this.displayLimitAtom, normalized);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(DisplayLimitStorageKey, String(normalized));
        }
    }

    setHideUnopenedTabs(value: boolean): void {
        globalStore.set(this.hideUnopenedTabsAtom, value);
        writeBoolean(HideUnopenedTabsStorageKey, value);
    }

    setAgentsOnly(value: boolean): void {
        globalStore.set(this.agentsOnlyAtom, value);
        writeBoolean(AgentsOnlyStorageKey, value);
    }

    markBlockViewed(blockId: string, viewedAt = Date.now()): void {
        if (!blockId) return;
        const current = globalStore.get(this.blockViewedAtAtom) ?? {};
        const next = { ...current, [blockId]: viewedAt };
        globalStore.set(this.blockViewedAtAtom, next);
        writeViewedAt(next);
    }

    // Ack the current agent status of a block: dismisses the pulsing status chip ("I've seen this state")
    // until the agent's state changes again (status.updatedAt moves past ackedAt). Stored separately from
    // markBlockViewed because that one tracks session-message unread (summary.updatedAt), not agent-state unread.
    markAgentStatusAcked(blockId: string, ackedAt = Date.now()): void {
        if (!blockId) return;
        const current = globalStore.get(this.agentStatusAckedAtAtom) ?? {};
        const next = { ...current, [blockId]: ackedAt };
        globalStore.set(this.agentStatusAckedAtAtom, next);
        writeAgentStatusAckedAt(next);
    }

    jumpToBlock(tabId: string, blockId: string): void {
        if (tabId) {
            setActiveTab(tabId);
        }
        if (blockId) {
            this.markBlockViewed(blockId);
            BlockModel.getInstance().setBlockHighlight({ blockId, icon: "location-crosshairs" });
            window.setTimeout(() => refocusNode(blockId), 80);
            window.setTimeout(() => refocusNode(blockId), 220);
            window.setTimeout(() => BlockModel.getInstance().setBlockHighlight(null), 1200);
        }
    }
}

export function isSessionOverviewTab(tab: Tab | null): boolean {
    return tab?.meta?.[SessionOverviewTabKindMetaKey] === SessionOverviewTabKind;
}

export function filterSessionOverviewTabIds(tabIds: string[], getTab: (tabId: string) => Tab | null): string[] {
    return tabIds.filter((tabId) => !isSessionOverviewTab(getTab(tabId)));
}

export function mergeVisibleTabIdsWithSessionOverview(
    workspaceTabIds: string[],
    visibleTabIds: string[],
    getTab: (tabId: string) => Tab | null
): string[] {
    const overviewTabIds = workspaceTabIds.filter((tabId) => isSessionOverviewTab(getTab(tabId)));
    const visibleSet = new Set(visibleTabIds);
    const remainingHiddenTabIds = workspaceTabIds.filter(
        (tabId) => !overviewTabIds.includes(tabId) && !visibleSet.has(tabId)
    );
    return [...overviewTabIds, ...visibleTabIds, ...remainingHiddenTabIds];
}

const DisplayLimitStorageKey = "snorkeling:session-overview:display-limit";
const ViewedAtStorageKey = "snorkeling:session-overview:block-viewed-at";
const AgentStatusAckedAtStorageKey = "snorkeling:session-overview:agent-status-acked-at";
const HideUnopenedTabsStorageKey = "snorkeling:session-overview:hide-unopened-tabs";
const AgentsOnlyStorageKey = "snorkeling:session-overview:agents-only";
const DefaultDisplayLimit = 20;
const MinDisplayLimit = 5;
const MaxDisplayLimit = 100;

function normalizeDisplayLimit(limit: number): number {
    if (!Number.isFinite(limit)) return DefaultDisplayLimit;
    return Math.max(MinDisplayLimit, Math.min(MaxDisplayLimit, Math.round(limit)));
}

function readDisplayLimit(): number {
    if (typeof window === "undefined") return DefaultDisplayLimit;
    const raw = window.localStorage.getItem(DisplayLimitStorageKey);
    return normalizeDisplayLimit(Number(raw));
}

function readBoolean(key: string): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(key) === "true";
}

function writeBoolean(key: string, value: boolean): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
}

function readViewedAt(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(ViewedAtStorageKey) ?? "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const result: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof key === "string" && typeof value === "number" && Number.isFinite(value)) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function writeViewedAt(value: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ViewedAtStorageKey, JSON.stringify(value));
}

function readAgentStatusAckedAt(): Record<string, number> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(AgentStatusAckedAtStorageKey) ?? "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const result: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof key === "string" && typeof value === "number" && Number.isFinite(value)) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function writeAgentStatusAckedAt(value: Record<string, number>): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AgentStatusAckedAtStorageKey, JSON.stringify(value));
}
