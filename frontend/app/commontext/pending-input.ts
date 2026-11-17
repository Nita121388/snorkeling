// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// pending input 队列：CommonText「新建 agent block 并发送」时，文本先排队，
// 等 term 块 TUI 就绪（首输出 + 静默窗口）后经 terminal.paste 注入。
// 注意：绝不使用 meta 键 `cmd:initialinput`（全仓库零消费点，见
// docs/project/agent-session-plan.md 的评审结论）。

export type PendingInputEntry = {
    blockId: string;
    text: string;
    registeredAt: number;
    quietMs: number;
    ttlMs: number;
};

export type PendingInputOptions = {
    /** 首次观察到输出后，需要连续无新输出的毫秒数才算就绪 */
    quietMs?: number;
    /** 总超时：超过即放弃注入（消费端回退剪贴板） */
    ttlMs?: number;
    /** 便于测试注入的时钟 */
    now?: () => number;
};

export const DefaultPendingInputQuietMs = 600;
export const DefaultPendingInputTtlMs = 60_000;

const registry = new Map<string, PendingInputEntry>();

// ───────── 变更通知（跨模块订阅） ─────────
// term.tsx 的注入 effect 依赖「registry 里有我的 entry」这一时刻：后台发送时建块 await 之后
// 才注册，若 effect 已经挂载（隐藏预挂载路径），晚注册会被漏接。所有变更统一 emit，
// 订阅方重跑判定。纯内存、无持久化（启动安全红线，见 design.md）。
const listeners = new Set<() => void>();

export function subscribePendingInput(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function emitPendingInputChange(): void {
    for (const cb of Array.from(listeners)) {
        try {
            cb();
        } catch (error) {
            console.warn("[pending-input] listener failed", error);
        }
    }
}

// ───────── pending Tab 隐藏挂载队列 ─────────
// CommonText「后台发送」时目标 Tab 不能是激活 Tab，注入又依赖 TabContent 挂载（xterm 活着
// 才能判定 TUI 就绪 + bracketed paste）。做法：把目标 Tab 临时并入 workspace 的
// renderPreloadTabIds（visibility:hidden，真实尺寸），注入完成/回退/块被删后移出。
// FIFO + 去重 + 上限；纯内存，禁止持久化。
export const PendingInputTabMountCap = 2;

export type PendingInputTabEntry = {
    tabId: string;
    blockId: string;
    /** 硬过期：块被删/组件再也不会挂载时，防止隐藏挂载永久泄漏（TTL + 5s 宽限）。 */
    expiresAt: number;
};

const pendingTabs: PendingInputTabEntry[] = [];

/** 登记一个需要隐藏挂载的 Tab；同 tabId 重复登记时移到队尾（最新一个生效）。 */
export function mountPendingInputTab(tabId: string, blockId: string): void {
    if (tabId == null || tabId === "") return;
    const index = pendingTabs.findIndex((entry) => entry.tabId === tabId);
    if (index >= 0) {
        pendingTabs.splice(index, 1);
    }
    const pending = registry.get(blockId);
    // 5s 宽限：让正常 inject/expire 路径先跑完，兜底只在它们没机会跑时生效。
    const expiresAt =
        pending != null
            ? pending.registeredAt + pending.ttlMs + 5000
            : Date.now() + DefaultPendingInputTtlMs + 5000;
    pendingTabs.push({ tabId, blockId, expiresAt });
    emitPendingInputChange();
}

/**
 * 硬过期兜底：块在等待期间被删 / 目标 Tab 的组件再也不会挂载时，注入链路不会跑，
 * 靠这条把隐藏挂载收掉（否则会永久留一个隐藏的 TabContent + xterm/WebGL 上下文）。
 * 正常路径（inject / expire / 关 Tab）都会更早移除，这里只是兜底。
 */
export function pruneExpiredPendingInputTabs(now: number = Date.now()): void {
    let changed = false;
    for (let i = pendingTabs.length - 1; i >= 0; i--) {
        if (pendingTabs[i].expiresAt <= now) {
            pendingTabs.splice(i, 1);
            changed = true;
        }
    }
    if (changed) emitPendingInputChange();
}

export function unmountPendingInputTab(tabId: string): void {
    const index = pendingTabs.findIndex((entry) => entry.tabId === tabId);
    if (index < 0) return;
    pendingTabs.splice(index, 1);
    emitPendingInputChange();
}

export function unmountPendingInputTabByBlock(blockId: string): void {
    if (blockId == null || blockId === "") return;
    let changed = false;
    for (let i = pendingTabs.length - 1; i >= 0; i--) {
        if (pendingTabs[i].blockId === blockId) {
            pendingTabs.splice(i, 1);
            changed = true;
        }
    }
    if (changed) emitPendingInputChange();
}

/** 前 cap 个待隐藏挂载的 Tab（供 workspace 合并进 renderPreloadTabIds）。 */
export function getPendingMountTabIds(cap: number = PendingInputTabMountCap): string[] {
    return pendingTabs.slice(0, Math.max(0, cap)).map((entry) => entry.tabId);
}

export function pendingInputTabCount(): number {
    return pendingTabs.length;
}

/** 自愈：workspace 的 tabids 里已不存在的 Tab 一律移除（关 Tab / 切 workspace / 块被删）。 */
export function prunePendingInputTabs(validTabIds: Iterable<string>): void {
    const valid = new Set(validTabIds);
    let changed = false;
    for (let i = pendingTabs.length - 1; i >= 0; i--) {
        const entry = pendingTabs[i];
        if (!valid.has(entry.tabId) || registry.has(entry.blockId) === false) {
            pendingTabs.splice(i, 1);
            changed = true;
        }
    }
    if (changed) emitPendingInputChange();
}

function nowMs(opts?: PendingInputOptions): number {
    return opts?.now != null ? opts.now() : Date.now();
}

/**
 * 验证台专用的运行时覆盖（只读 window 标记，未设置时为 undefined）。
 * TTL 60s 的真机断言要等一分钟；verify 里用 `window.__snorkelingPendingInputOverride = { ttlMs: 1500 }`
 * 缩短等待。生产环境没人设置这个键，等价于不生效（不落盘、不参与启动路径）。
 */
function runtimeOverrideOptions(): PendingInputOptions | undefined {
    if (typeof window === "undefined") return undefined;
    const override = (window as unknown as { __snorkelingPendingInputOverride?: PendingInputOptions })
        .__snorkelingPendingInputOverride;
    return override ?? undefined;
}

/** 登记一条 pending input；同 blockId 重复登记时后者覆盖前者。 */
export function registerPendingInput(blockId: string, text: string, opts?: PendingInputOptions): PendingInputEntry {
    const effective = opts ?? runtimeOverrideOptions();
    const entry: PendingInputEntry = {
        blockId,
        text,
        registeredAt: nowMs(effective),
        quietMs: effective?.quietMs ?? DefaultPendingInputQuietMs,
        ttlMs: effective?.ttlMs ?? DefaultPendingInputTtlMs,
    };
    registry.set(blockId, entry);
    emitPendingInputChange();
    return entry;
}

/** 取走（删除并返回）该块的 pending input；没有则 null。 */
export function takePendingInput(blockId: string): string | null {
    const entry = registry.get(blockId);
    if (entry == null) return null;
    registry.delete(blockId);
    emitPendingInputChange();
    return entry.text;
}

/** 只读查看，不删除。 */
export function peekPendingInput(blockId: string): PendingInputEntry | null {
    return registry.get(blockId) ?? null;
}

export function pendingInputCount(): number {
    return registry.size;
}

/** 清空（测试用）。 */
export function clearPendingInput(): void {
    registry.clear();
    pendingTabs.length = 0;
    emitPendingInputChange();
}

export function isPendingInputExpired(entry: PendingInputEntry, now: number): boolean {
    return now - entry.registeredAt >= entry.ttlMs;
}

export type InjectDecision =
    | { action: "wait" } // 尚未观察到任何输出，继续等
    | { action: "quiet" } // 观察到输出但静默窗口未满，继续等
    | { action: "inject" } // 就绪，取出文本注入
    | { action: "expire" }; // 超过 TTL，取出文本回退剪贴板

/**
 * 注入时机的纯判定：
 *   - baseline：轮询开始时 TermWrap 的 lastUpdated（无输出恒定为初始值）。
 *   - lastUpdated > baseline 表示块已收到新输出（TUI 已开始渲染）。
 *   - 首次输出后，连续 quietMs 无新输出 → inject。
 *   - 全程超过 ttlMs → expire。
 */
export function computeInjectDecision(input: {
    entry: PendingInputEntry;
    baselineLastUpdated: number;
    lastUpdated: number;
    now: number;
}): InjectDecision {
    const { entry, baselineLastUpdated, lastUpdated, now } = input;
    if (isPendingInputExpired(entry, now)) return { action: "expire" };
    if (lastUpdated > baselineLastUpdated) {
        if (now - lastUpdated >= entry.quietMs) return { action: "inject" };
        return { action: "quiet" };
    }
    return { action: "wait" };
}
