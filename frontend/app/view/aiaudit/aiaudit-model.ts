// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Audit Block：查看每一次 AI 生成（标题 / note+tags / 批注时间线 / 批注字段）
// 的记录，支持筛选、查看原文与失败重试。

import { globalStore } from "@/app/store/jotaiStore";
import { AISessionsServiceType } from "@/app/store/services";
import * as jotai from "jotai";
import { AiAuditView } from "./aiaudit-view";

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
    errorAtom: jotai.PrimitiveAtom<string>;
    statsAtom: jotai.PrimitiveAtom<AuditStatsResult | null>;
    featureFilterAtom: jotai.PrimitiveAtom<string>;
    stateFilterAtom: jotai.PrimitiveAtom<string>;
    queryAtom: jotai.PrimitiveAtom<string>;
    detailAtom: jotai.PrimitiveAtom<AuditView | null>;
    detailLoadingAtom: jotai.PrimitiveAtom<boolean>;

    disposed = false;

    constructor({ blockId }: ViewModelInitType) {
        this.viewType = "aiaudit";
        this.blockId = blockId;
        this.service = new AISessionsServiceType();

        this.entriesAtom = jotai.atom<AuditView[]>([]) as jotai.PrimitiveAtom<AuditView[]>;
        this.totalAtom = jotai.atom<number>(0) as jotai.PrimitiveAtom<number>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>("");
        this.statsAtom = jotai.atom<AuditStatsResult | null>(null) as jotai.PrimitiveAtom<AuditStatsResult | null>;
        this.featureFilterAtom = jotai.atom<string>("");
        this.stateFilterAtom = jotai.atom<string>("");
        this.queryAtom = jotai.atom<string>("");
        this.detailAtom = jotai.atom<AuditView | null>(null) as jotai.PrimitiveAtom<AuditView | null>;
        this.detailLoadingAtom = jotai.atom<boolean>(false);
    }

    async load(refresh: boolean = true): Promise<void> {
        if (this.disposed) return;
        // 后台轮询不点亮“Refreshing…”，否则每 4 秒闪一次。
        const hasEntries = globalStore.get(this.entriesAtom).length > 0;
        const silent = !refresh && hasEntries;
        if (!silent) {
            globalStore.set(this.loadingAtom, true);
        }
        globalStore.set(this.errorAtom, "");
        try {
            const [entries, stats] = await Promise.all([
                this.service.AuditList({
                    feature: globalStore.get(this.featureFilterAtom),
                    state: globalStore.get(this.stateFilterAtom),
                    query: globalStore.get(this.queryAtom),
                    limit: 100,
                }),
                refresh ? this.service.AuditStats() : Promise.resolve(null),
            ]);
            if (this.disposed) return;
            globalStore.set(this.entriesAtom, entries.entries ?? []);
            globalStore.set(this.totalAtom, entries.total ?? 0);
            if (stats != null) {
                globalStore.set(this.statsAtom, stats);
            }
        } catch (e) {
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            if (!this.disposed && !silent) {
                globalStore.set(this.loadingAtom, false);
            }
        }
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
    }

    async clear(days: number): Promise<void> {
        await this.service.AuditClear({ beforeDays: days });
        await this.load();
    }

    async retry(id: number): Promise<void> {
        await this.service.AuditRetry({ id });
        await this.load();
    }

    viewComponent = AiAuditView;

    dispose(): void {
        this.disposed = true;
    }
}

export { AiAuditView };
