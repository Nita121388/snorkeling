// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero 绑定在「定时任务编辑弹窗」里的纯逻辑（N-1123-hero-sched-ui）。
//
// 后端 `ScheduledTaskType.Hero` 是 `json:"hero,omitempty"`：
//   · 选中 hero → 提交载荷必须带 hero（否则后端不会按 hero home 解析 cwd / provider / model）；
//   · 清空选择（"不绑定"）→ 载荷必须**不含** hero 键（清除绑定靠键缺失，不靠空值赌博）。
//
// 这里只做纯函数，弹窗组件负责渲染与 RPC。

import { heroRosterLabel, type HeroRosterEntry } from "@/app/workspace/hero-launch";

export type HeroSelectOption = { value: string; label: string };

/** 提交前归一化 hero 绑定：有值写入裁剪后的 id，空值删除键。返回新对象，不改入参。 */
export function normalizeHeroBinding<T extends { hero?: string | null }>(draft: T): T {
    const next = { ...draft };
    const hero = (next.hero ?? "").toString().trim();
    if (hero === "") {
        delete next.hero;
    } else {
        next.hero = hero;
    }
    return next;
}

/**
 * hero 下拉选项：首项是清空项（"不绑定"），其后按名册给出 emoji + 名称。
 * 名册条目缺 name 时回落 id（与 heroRosterLabel 同口径）。
 */
export function heroSelectOptions(
    heroes: HeroRosterEntry[] | null | undefined,
    emptyLabel: string
): HeroSelectOption[] {
    const options: HeroSelectOption[] = [{ value: "", label: emptyLabel }];
    for (const hero of heroes ?? []) {
        if (hero == null || !hero.id) continue;
        options.push({ value: hero.id, label: heroRosterLabel(hero) });
    }
    return options;
}
