// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（实验插件）— block meta 契约（纯函数）。
//   - preview:idxbadges   开关：缺省 = 关（"on" / true 才算开）
//   - preview:idxrefresh  定向刷新：agent 用 `wsh setmeta -b <blockid> preview:idxrefresh=<ms>` 触发
// 说明：写 meta 走既有 SetMetaCommand → SendWaveObjUpdate 事件链，不加新 RPC。

export const IDX_BADGES_META_KEY = "preview:idxbadges";
export const IDX_REFRESH_META_KEY = "preview:idxrefresh";

type MetaLike = Record<string, unknown> | null | undefined;

/** 开关判定：只有显式开（"on" / true）才算开，其余一律关。 */
export function isIdxBadgesEnabled(meta: MetaLike): boolean {
    const value = meta?.[IDX_BADGES_META_KEY];
    if (value === true) {
        return true;
    }
    return typeof value === "string" && value.trim().toLowerCase() === "on";
}

/** 定向刷新版本号：非数字/缺失 → 0。值变化即需要重算。 */
export function refreshRevisionFromMeta(meta: MetaLike): number {
    const value = meta?.[IDX_REFRESH_META_KEY];
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
}

/** 菜单开关里要写的 meta 值（关显式写 "off"，不删键，便于排障）。 */
export function idxBadgesMetaValue(enabled: boolean): Record<string, unknown> {
    return { [IDX_BADGES_META_KEY]: enabled ? "on" : "off" };
}
