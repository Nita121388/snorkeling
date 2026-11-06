// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultCommonTextSortKey, normalizeCommonTextSortKey, type CommonTextSortKey } from "./commontext-model";

/**
 * CommonText 列表排序偏好。与弹窗尺寸偏好同属「无设置 UI、无 schema 文件」的本地偏好，
 * 直接落 localStorage；隐私模式 / 配额满 / 旧值脏数据一律静默回落默认排序，不抛错。
 */
const CommonTextSortStorageKey = "commontext:sortKey";

export function loadCommonTextSortKey(): CommonTextSortKey {
    try {
        const raw = localStorage.getItem(CommonTextSortStorageKey);
        return normalizeCommonTextSortKey(raw);
    } catch {
        return DefaultCommonTextSortKey;
    }
}

export function saveCommonTextSortKey(key: CommonTextSortKey): void {
    try {
        const normalized = normalizeCommonTextSortKey(key);
        if (normalized === DefaultCommonTextSortKey) {
            localStorage.removeItem(CommonTextSortStorageKey);
            return;
        }
        localStorage.setItem(CommonTextSortStorageKey, normalized);
    } catch {
        // 隐私模式 / 配额满：本次会话内仍生效，只是下次打开回到默认排序。
    }
}
