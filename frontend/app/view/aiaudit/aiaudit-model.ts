// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Audit Block：查看每一次 AI 生成（标题 / note+tags / 批注时间线 / 批注字段）
// 的记录，支持筛选、分页、查看原文与失败重试。

import { globalStore } from "@/app/store/jotaiStore";
import { AISessionsServiceType } from "@/app/store/services";
import * as jotai from "jotai";
import { AiAuditView } from "./aiaudit-view";

export const AuditPageSize = 100;
const StatsThrottleMs = 10_000;

export type AuditLoadOptions = {
    /** append the next page instead of replacing the list */
    append?: boolean;
    /** background refresh: never show the spinner, never reset scroll */
    silent?: boolean;
};

export class AiAuditViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    service: AISessionsServiceType;

    viewIcon = jotai.atom<string>("clipboard-list");
    viewName = jotai.atom<string>("AI Audit");
    manageConnection = jotai.atom<boolean>(false);

    entriesAtom: jotai.PrimitiveAtom<AuditView[]>;
    totalAtom: jotai.PrimitiveAtom<number>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    loadingMoreAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    statsAtom: jotai.PrimitiveAtom<AuditStatsResult | null>;
    featureFilterAtom: jotai.PrimitiveAtom<string>;
    stateFilterAtom: jotai.PrimitiveAtom<string>;
    queryAtom: jotai.PrimitiveAtom<string>;
    detailAtom: jotai.PrimitiveAtom<AuditView | null>;
    detailLoadingAtom: jotai.PrimitiveAtom<boolean>;
    /** transient toolbar feedback, e.g. "Cleared 12 entries" */
    commentAtom: jotai.PrimitiveAtom<string>;
    /** first click arms the destructive Clear button */
    clearArmedAtom: jotai.PrimitiveAtom<boolean>;
    /** true when new rows likely arrived while the user was paging */
    pendingRefreshAtom: jotai.PrimitiveAtom<boolean>;

    disposed = false;
    lastStatsAt = 0;
    private clearTimer: number | undefined;

    constructor({ blockId }: ViewModelInitType) {
        this.viewType = "aiaudit";
        this.blockId = blockId;
        this.service = new AISessionsServiceType();

        this.entriesAtom = jotai.atom<AuditView[]>([]) as jotai.PrimitiveAtom<AuditView[]>;
        this.totalAtom = jotai.atom<number>(0) as jotai.PrimitiveAtom<number>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.loadingMoreAtom = jotai.atom<boolean>(false);
        this.errorAtom = jotai.atom<string>("");
        this.statsAtom = jotai.atom<AuditStatsResult | null>(null) as jotai.PrimitiveAtom<AuditStatsResult | null>;
        this.featureFilterAtom = jotai.atom<string>("");
        this.stateFilterAtom = jotai.atom<string>("");
        this.queryAtom = jotai.atom<string>("");
        this.detailAtom = jotai.atom<AuditView | null>(null) as jotai.PrimitiveAtom<AuditView | null>;
        this.detailLoadingAtom = jotai.atom<boolean>(false);
        this.commentAtom = jotai.atom<string>("");
        this.clearArmedAtom = jotai.atom<boolean>(false);
        this.pendingRefreshAtom = jotai.atom<boolean>(false);
    }

    private isPaged(): boolean {
        return globalStore.get(this.entriesAtom).length > AuditPageSize;
    }

    async load(opts: AuditLoadOptions = {}): Promise<void> {
        if (this.disposed) return;
        const { append = false, silent = false } = opts;
        const current = globalStore.get(this.entriesAtom);
        if (append && current.length === 0) return;

        // Background polling must not fight pagination: mark the list dirty instead.
        if (silent && !append && this.isPaged()) {
            globalStore.set(this.pendingRefreshAtom, true);
            return;
        }
        if (silent && typeof document !== "undefined" && document.hidden) return;

        const offset = append ? current.length : 0;
        if (append) {
            globalStore.set(this.loadingMoreAtom, true);
        } else if (!(silent && current.length > 0)) {
            globalStore.set(this.loadingAtom, true);
        }
        globalStore.set(this.errorAtom, "");

        try {
            const result = await this.service.AuditList({
                feature: globalStore.get(this.featureFilterAtom),
                state: globalStore.get(this.stateFilterAtom),
                query: globalStore.get(this.queryAtom),
                limit: AuditPageSize,
                offset,
            });
            if (this.disposed) return;
            const incoming = result.entries ?? [];
            if (append) {
                const seen = new Set(current.map((entry) => entry.id));
                const merged = current.concat(incoming.filter((entry) => !seen.has(entry.id)));
                globalStore.set(this.entriesAtom, merged);
            } else {
                globalStore.set(this.entriesAtom, incoming);
                globalStore.set(this.pendingRefreshAtom, false);
            }
            globalStore.set(this.totalAtom, result.total ?? 0);
            void this.loadStats(append === false);
        } catch (e) {
            if (this.disposed) return;
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            if (!this.disposed) {
                globalStore.set(this.loadingAtom, false);
                globalStore.set(this.loadingMoreAtom, false);
            }
        }
    }

    /** Stats refresh is throttled: the panel polls every 4s but the header does
     * not need to hit SQLite that often. */
    async loadStats(force: boolean = false): Promise<void> {
        if (this.disposed) return;
        const now = Date.now();
        if (!force && now - this.lastStatsAt < StatsThrottleMs) return;
        this.lastStatsAt = now;
        try {
            const stats = await this.service.AuditStats();
            if (!this.disposed) {
                globalStore.set(this.statsAtom, stats);
            }
        } catch {
            // stats are decorative; a failure must not blank the list
        }
    }

    async loadMore(): Promise<void> {
        await this.load({ append: true });
    }

    setFilter(atom: jotai.PrimitiveAtom<string>, value: string): void {
        globalStore.set(atom, value);
        void this.load();
    }

    async openDetail(id: number): Promise<void> {
        if (this.disposed) return;
        globalStore.set(this.detailLoadingAtom, true);
        try {
            const view = await this.service.AuditGet(id);
            if (!this.disposed) {
                globalStore.set(this.detailAtom, view);
            }
        } catch (e) {
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            if (!this.disposed) {
                globalStore.set(this.detailLoadingAtom, false);
            }
        }
    }

    closeDetail(): void {
        globalStore.set(this.detailAtom, null);
        globalStore.set(this.detailLoadingAtom, false);
    }

    /** Two-step destructive action: first call arms, second call executes. */
    async clear(days: number): Promise<void> {
        if (!globalStore.get(this.clearArmedAtom)) {
            globalStore.set(this.clearArmedAtom, true);
            window.clearTimeout(this.clearTimer);
            this.clearTimer = window.setTimeout(() => {
                if (!this.disposed) globalStore.set(this.clearArmedAtom, false);
            }, 4000);
            return;
        }
        window.clearTimeout(this.clearTimer);
        globalStore.set(this.clearArmedAtom, false);
        try {
            const removed = await this.service.AuditClear({ beforeDays: days });
            globalStore.set(
                this.commentAtom,
                `Cleared ${removed} entr${removed === 1 ? "y" : "ies"} older than ${days} days`
            );
            await this.load();
        } catch (e) {
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        }
    }

    async retry(id: number): Promise<void> {
        try {
            await this.service.AuditRetry({ id });
            globalStore.set(this.commentAtom, `Retry queued for entry #${id}`);
        } catch (e) {
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        }
        await this.load();
    }

    viewComponent = AiAuditView;

    dispose(): void {
        this.disposed = true;
        window.clearTimeout(this.clearTimer);
    }
}

export { AiAuditView };
