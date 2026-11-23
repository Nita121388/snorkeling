// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero 名册的前端加载器（N-1123-hero-sched-ui）。
//
// 名册来自 aisessions service 的 `HeroRoster` RPC（root + heroes，见
// frontend/app/workspace/hero-launch.ts 的 HeroRoster 类型定义）。两个消费面：
//   · 定时任务编辑弹窗 → hero 下拉；
//   · Overview 独立「定时任务」区 → hero emoji / 名称。
// 两边都要一次名册，所以这里做和 agent-catalog.ts 一样的模块级缓存（TTL 内复用、并发去重）；
// RPC 失败解析成空名册，让编辑弹窗保留「不绑定 hero」这条退路，而不是整块不可用。

import type { HeroRoster } from "@/app/workspace/hero-launch";
import { AISessionsServiceType } from "./services";

const CACHE_TTL_MS = 60 * 1000;

const EmptyRoster: HeroRoster = { root: "", heroes: [] };

let cached: { promise: Promise<HeroRoster>; fetchedAt: number } | undefined;

/** 加载 hero 名册。TTL 内复用；force=true 强制重读（编辑弹窗打开时刷新）。 */
export function loadHeroRoster(force: boolean = false): Promise<HeroRoster> {
    const now = Date.now();
    if (cached != null && !force && now - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.promise;
    }
    const promise = (async (): Promise<HeroRoster> => {
        try {
            const resp = await new AISessionsServiceType().HeroRoster({});
            return { root: resp?.root ?? "", heroes: Array.isArray(resp?.heroes) ? resp.heroes : [] };
        } catch (err) {
            console.warn("[heroRoster] loadHeroRoster failed:", err);
            return EmptyRoster;
        }
    })();
    cached = { promise, fetchedAt: now };
    return promise;
}

/** 丢弃缓存，下一次 loadHeroRoster 重新读配置（hero 增删改后调用）。 */
export function invalidateHeroRoster(): void {
    cached = undefined;
}
