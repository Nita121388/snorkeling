// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { globalStore, refocusNode, setActiveTab } from "@/app/store/global";
import * as jotai from "jotai";

export class SessionOverviewModel {
    private static instance: SessionOverviewModel | null = null;

    isOpenAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    displayLimitAtom = jotai.atom(readDisplayLimit()) as jotai.PrimitiveAtom<number>;
    blockViewedAtAtom = jotai.atom(readViewedAt()) as jotai.PrimitiveAtom<Record<string, number>>;

    private constructor() {}

    static getInstance(): SessionOverviewModel {
        if (SessionOverviewModel.instance == null) {
            SessionOverviewModel.instance = new SessionOverviewModel();
        }
        return SessionOverviewModel.instance;
    }

    open(): void {
        globalStore.set(this.isOpenAtom, true);
    }

    close(): void {
        globalStore.set(this.isOpenAtom, false);
    }

    toggle(): void {
        globalStore.set(this.isOpenAtom, !globalStore.get(this.isOpenAtom));
    }

    setDisplayLimit(limit: number): void {
        const normalized = normalizeDisplayLimit(limit);
        globalStore.set(this.displayLimitAtom, normalized);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(DisplayLimitStorageKey, String(normalized));
        }
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

const DisplayLimitStorageKey = "snorkeling:session-overview:display-limit";
const ViewedAtStorageKey = "snorkeling:session-overview:block-viewed-at";
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
