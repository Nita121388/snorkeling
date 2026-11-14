// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { atom, type PrimitiveAtom } from "jotai";

/**
 * 乐观激活高亮（R9.1，见 .trellis/tasks/10-26-tab-startup-restore）。
 *
 * 点击 Tab 后不等后端 activetabid 广播往返（主进程动作队列串行，dev 下首开一个
 * Tab 的 webview 初始化可达数秒），主栏 active 高亮立即跟随点击。
 *
 * 边界（重要）：该值只影响「视觉高亮」（Tab 的 active prop）；关闭确认、
 * 可见性判定、布局分组等逻辑继续使用 staticTabId（本 renderer 真实所属 Tab）。
 *
 * 清除时机：
 * - 后端广播确认：workspace.activetabid === 乐观值（各栏组件的 effect）；
 * - 安全超时：后端迟迟未确认（切换被阻塞/失败）时兜底回退，避免高亮永久错位。
 */

export const optimisticActiveTabIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export const optimisticActiveTabClearTimeoutMs = 2000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSafetyClear(): void {
    if (clearTimer != null) {
        clearTimeout(clearTimer);
    }
    clearTimer = setTimeout(() => {
        clearTimer = null;
        globalStore.set(optimisticActiveTabIdAtom, null);
    }, optimisticActiveTabClearTimeoutMs);
}

export function setOptimisticActiveTab(tabId: string): void {
    if (!tabId) {
        return;
    }
    globalStore.set(optimisticActiveTabIdAtom, tabId);
    scheduleSafetyClear();
}

export function clearOptimisticActiveTab(): void {
    if (clearTimer != null) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
    globalStore.set(optimisticActiveTabIdAtom, null);
}

/** 高亮判定：乐观值优先，否则用本 renderer 的 staticTabId。 */
export function resolveHighlightTabId(optimisticTabId: string | null, staticTabId: string): string {
    return optimisticTabId ?? staticTabId;
}

/** React 侧便捷 hook：订阅乐观值并解析出高亮 Tab。 */
export function useHighlightTabId(staticTabId: string): string {
    const optimisticTabId = useAtomValue(optimisticActiveTabIdAtom);
    return resolveHighlightTabId(optimisticTabId, staticTabId);
}
