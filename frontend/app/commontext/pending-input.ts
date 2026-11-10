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

function nowMs(opts?: PendingInputOptions): number {
    return opts?.now != null ? opts.now() : Date.now();
}

/** 登记一条 pending input；同 blockId 重复登记时后者覆盖前者。 */
export function registerPendingInput(blockId: string, text: string, opts?: PendingInputOptions): PendingInputEntry {
    const entry: PendingInputEntry = {
        blockId,
        text,
        registeredAt: nowMs(opts),
        quietMs: opts?.quietMs ?? DefaultPendingInputQuietMs,
        ttlMs: opts?.ttlMs ?? DefaultPendingInputTtlMs,
    };
    registry.set(blockId, entry);
    return entry;
}

/** 取走（删除并返回）该块的 pending input；没有则 null。 */
export function takePendingInput(blockId: string): string | null {
    const entry = registry.get(blockId);
    if (entry == null) return null;
    registry.delete(blockId);
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
