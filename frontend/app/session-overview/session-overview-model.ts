// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { atoms, globalStore, refocusNode, setActiveTab, WOS } from "@/app/store/global";
import { ObjectService, WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
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
        return isSessionOverviewTab(tab);
    });
    displayLimitAtom = jotai.atom(readDisplayLimit()) as jotai.PrimitiveAtom<number>;
    blockViewedAtAtom = jotai.atom(readViewedAt()) as jotai.PrimitiveAtom<Record<string, number>>;
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
        const workspace = globalStore.get(atoms.workspace);
        if (!workspace?.oid) return;

        const overviewTabId = await ensureSessionOverviewTab(workspace);
        const overviewBlockId = await ensureSessionOverviewBlock(overviewTabId);
        const currentTabId = globalStore.get(atoms.staticTabId);
        setActiveTab(overviewTabId);
        if (currentTabId === overviewTabId) {
            window.setTimeout(() => refocusNode(overviewBlockId), 80);
            window.setTimeout(() => refocusNode(overviewBlockId), 220);
        }
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

async function findSessionOverviewTabId(workspace: Workspace): Promise<string> {
    for (const tabId of workspace?.tabids ?? []) {
        const tab = await WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", tabId));
        if (isSessionOverviewTab(tab)) {
            return tabId;
        }
    }
    return "";
}

async function ensureSessionOverviewTab(workspace: Workspace): Promise<string> {
    const existingTabId = await findSessionOverviewTabId(workspace);
    if (existingTabId) {
        await pinSessionOverviewTabFirst(workspace, existingTabId);
        return existingTabId;
    }
    const tabId = await WorkspaceService.CreateEmptyTab(workspace.oid, SessionOverviewTabName, false);
    await ObjectService.UpdateObjectMeta(WOS.makeORef("tab", tabId), {
        [SessionOverviewTabKindMetaKey]: SessionOverviewTabKind,
        icon: "list-tree",
    } as MetaType);
    await pinSessionOverviewTabFirst(workspace, tabId);
    return tabId;
}

async function pinSessionOverviewTabFirst(workspace: Workspace, tabId: string): Promise<void> {
    const currentTabIds = globalStore.get(atoms.workspace)?.tabids ?? workspace.tabids ?? [];
    const nextTabIds = [tabId, ...currentTabIds.filter((nextTabId) => nextTabId !== tabId)];
    if (nextTabIds.join("\0") === currentTabIds.join("\0")) {
        return;
    }
    await RpcApi.UpdateWorkspaceTabIdsCommand(TabRpcClient, workspace.oid, nextTabIds);
}

async function ensureSessionOverviewBlock(tabId: string): Promise<string> {
    const existingBlockId = await findSessionOverviewBlockIdInTab(tabId);
    if (existingBlockId) {
        return existingBlockId;
    }
    const blockRef = await RpcApi.CreateBlockCommand(TabRpcClient, {
        tabid: tabId,
        blockdef: {
            meta: {
                view: SessionOverviewView,
                "frame:title": SessionOverviewTabName,
                icon: "list-tree",
            },
        },
        focused: true,
    });
    return WOS.splitORef(blockRef)[1];
}

async function findSessionOverviewBlockIdInTab(tabId: string): Promise<string> {
    const tab = await WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", tabId));
    for (const blockId of tab?.blockids ?? []) {
        const block = await WOS.loadAndPinWaveObject<Block>(WOS.makeORef("block", blockId));
        if (block?.meta?.view === SessionOverviewView) {
            return blockId;
        }
    }
    return "";
}

const DisplayLimitStorageKey = "snorkeling:session-overview:display-limit";
const ViewedAtStorageKey = "snorkeling:session-overview:block-viewed-at";
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
