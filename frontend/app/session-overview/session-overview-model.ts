// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { ackBumpAtom } from "@/app/agent-status/agent-status-done-ack-store";
import { atoms, globalStore, refocusNode, setActiveTab, WOS } from "@/app/store/global";
import { pslogEvent, makeAgentTraceId } from "@/app/store/pslog-trace";
import {
	SnorkelingBlockKindMetaKey,
	SnorkelingBlockKindOverview,
	toggleCurrentTabBlockByKind,
} from "@/app/workspace/toggle-block";
import { getHiddenBlockIdsFromTab, getLayoutModelForStaticTab } from "@/layout/index";
import * as jotai from "jotai";
import { atomWithStorage } from "jotai/vanilla/utils";
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";

const SessionOverviewView = "sessionoverview";
const SessionOverviewTabKind = "overview";
const SessionOverviewTabKindMetaKey = "snorkeling:tab-kind";
const SessionOverviewTabName = "Overview";

// localStorage key for the fingerprint-based ack (R class). Parallel to the old
// timestamp-based key; on first read, if old data contains numbers (timestamp format),
// those keys will be migrated to fingerprint format when markAgentStatusAcked is called again.
const AgentStatusAckedAtStorageKey = "snorkeling:session-overview:agent-status-acked-at";
const AgentStatusAckedFpStorageKey = "snorkeling:agent-status:acked-fp";

const AgentStatusAckedAtStorage: SyncStorage<Record<string, number>> = {
	getItem: () => readAgentStatusAckedAt(),
	setItem: (_key, value) => writeAgentStatusAckedAt(value),
	removeItem: () => {
		if (typeof window === "undefined") return;
		window.localStorage.removeItem(AgentStatusAckedAtStorageKey);
	},
	subscribe: (_key, callback) => {
		if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== AgentStatusAckedAtStorageKey) return;
			if (event.storageArea != null && event.storageArea !== window.localStorage) return;
			callback(readAgentStatusAckedAt());
		};
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	},
};

const AgentStatusAckedFpStorage: SyncStorage<Record<string, string>> = {
	getItem: () => readAgentStatusAckedFp(),
	setItem: (_key, value) => writeAgentStatusAckedFp(value),
	removeItem: () => {
		if (typeof window === "undefined") return;
		window.localStorage.removeItem(AgentStatusAckedFpStorageKey);
	},
	subscribe: (_key, callback) => {
		if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== AgentStatusAckedFpStorageKey) return;
			if (event.storageArea != null && event.storageArea !== window.localStorage) return;
			callback(readAgentStatusAckedFp());
		};
		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	},
};

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
	agentStatusAckedAtAtom = atomWithStorage<Record<string, number>>(
		AgentStatusAckedAtStorageKey,
		{},
		AgentStatusAckedAtStorage,
		{ getOnInit: true },
	) as jotai.PrimitiveAtom<Record<string, number>>;
	agentStatusAckedFpAtom = atomWithStorage<Record<string, string>>(
		AgentStatusAckedFpStorageKey,
		{},
		AgentStatusAckedFpStorage,
		{ getOnInit: true },
	) as jotai.PrimitiveAtom<Record<string, string>>;
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
	// until the agent's state changes again (state fingerprint changes). Stored separately from
	// markBlockViewed because that one tracks session-message unread (summary.updatedAt), not agent-state unread.
	markAgentStatusAcked(blockId: string, ackedAt = Date.now(), status?: AgentStatus | null): void {
		if (!blockId) return;
		// ponytail: 先读取最新持久值以覆盖延迟事件竞态; 两个 renderer 真正同时写入仍是
		// last-writer-wins. 若该边界变成可见问题, 再把 ack 所有权移到主进程 IPC.
		const current = readAgentStatusAckedAt();
		const next = { ...current, [blockId]: ackedAt };
		globalStore.set(this.agentStatusAckedAtAtom, next);
		// Also store the state fingerprint for fingerprint-based unread comparison
		if (status != null) {
			const fp = status.state + "|" + status.phase + "|" + status.source;
			const fpMap = readAgentStatusAckedFp();
			const nextFp = { ...fpMap, [blockId]: fp };
			globalStore.set(this.agentStatusAckedFpAtom, nextFp);
		}
		// Bump ackBumpAtom so derived atoms that subscribed to it (e.g. tab-aggregate's
		// getTabAgentStatusDotsAtom) are invalidated on this R-class ack too. Without
		// the bump, R-class writes would only invalidate atoms that read agentStatusAckedFpAtom
		// directly — but the tab-aggregate also reads it via a `get()` and the jotai snapshot
		// race on tab switch-back (VTabWrapper unmount→remount) can still return stale R values.
		// Sharing the bump signal with D-class keeps both ack families invalidated by the same
		// mechanism. Safe under strict-null because ackBumpAtom is a module-level singleton.
		globalStore.set(ackBumpAtom, globalStore.get(ackBumpAtom) + 1);
		// F5 R-ack-write: paired with markDoneAcked (F4). Reason="R" separates
		// the two ack families on the same timeline; durationms carries
		// ackedAt so the "R → 0 unread" recompute can be matched to the exact
		// click instant even on systems without monotonic FE-side perf clocks.
		pslogEvent({
			event: "agent.status",
			stage: "ack-write",
			blockid: blockId,
			traceid: makeAgentTraceId(blockId, ""),
			reason: "R",
			durationms: ackedAt,
		});
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
	getTab: (tabId: string) => Tab | null,
): string[] {
	const overviewTabIds = workspaceTabIds.filter((tabId) => isSessionOverviewTab(getTab(tabId)));
	const visibleSet = new Set(visibleTabIds);
	const remainingHiddenTabIds = workspaceTabIds.filter(
		(tabId) => !overviewTabIds.includes(tabId) && !visibleSet.has(tabId),
	);
	return [...overviewTabIds, ...visibleTabIds, ...remainingHiddenTabIds];
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

function readAgentStatusAckedFp(): Record<string, string> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(AgentStatusAckedFpStorageKey);
		const parsed = JSON.parse(raw ?? "{}");
		if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		// Migration: if old-format values are numbers (timestamps), that means the
		// fingerprint store is still in the old format and needs a fresh start.
		// Clear it and start fresh — callers will repopulate with fingerprints.
		const hasOldFormat = Object.values(parsed).some(
			(v) => typeof v === "number",
		);
		if (hasOldFormat) {
			const currentRaw = window.localStorage.getItem(AgentStatusAckedFpStorageKey);
			if (currentRaw === raw) {
				window.localStorage.removeItem(AgentStatusAckedFpStorageKey);
			} else {
				return readAgentStatusAckedFp();
			}
			return {};
		}
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof key === "string" && typeof value === "string") {
				result[key] = value;
			}
		}
		return result;
	} catch {
		return {};
	}
}

function writeAgentStatusAckedFp(value: Record<string, string>): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(AgentStatusAckedFpStorageKey, JSON.stringify(value));
}
