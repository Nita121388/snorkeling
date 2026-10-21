// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 子会话（subagent）内容的低优先级加载队列。
 *
 * 为什么需要它：一个父会话可能派发出很多子代理，每个子会话又是几千条消息的完整
 * 会话。如果同时展开多个，N 个完整会话的解析/渲染会直接把主时间线卡死，正好是
 * "界面卡顿"的来源。这里约定：
 *
 * - 全进程只允许 1 个子会话请求在飞（主时间线的 DetailDelta 不经此队列，不受影响）
 * - FIFO：用户先展开的先加载
 * - 可取消：折叠 / 切换会话时用世代号丢弃迟到响应，避免内容串位
 */

/** 同时最多几个子会话请求在飞。1 = 完全串行，主时间线永远优先。 */
export const SubagentLoadConcurrency = 1;

export type SubagentLoadTask<T> = {
    /** 用于日志/测试的身份标识（一般是子会话 key） */
    id: string;
    run: () => Promise<T>;
};

export type SubagentLoadOutcome<T> =
    | { status: "fulfilled"; id: string; value: T }
    | { status: "rejected"; id: string; error: unknown };

type QueueEntry<T> = {
    id: string;
    run: () => Promise<T>;
    resolve: (outcome: SubagentLoadOutcome<T>) => void;
};

/**
 * 串行队列。提交顺序即执行顺序；`cancel(predicate)` 丢弃尚未开始的匹配任务，
 * 并对进行中的任务置上世代号，调用方据此忽略迟到结果。
 */
export class SubagentLoadQueue {
    private queue: Array<QueueEntry<unknown>> = [];
    private running = 0;
    private generation = 0;
    private cancelledIds = new Set<string>();

    /** 当前世代号：调用方保存后与回来时对比，不一致即为过期响应。 */
    currentGeneration(): number {
        return this.generation;
    }

    /** 丢弃尚未开始的匹配任务，并让进行中的任务结果作废。 */
    cancel(match: (id: string) => boolean): void {
        this.generation += 1;
        const stillPending: Array<QueueEntry<unknown>> = [];
        for (const entry of this.queue) {
            if (match(entry.id)) {
                entry.resolve({ status: "rejected", id: entry.id, error: new CancelledError(entry.id) });
            } else {
                stillPending.push(entry);
            }
        }
        this.queue = stillPending;
        this.cancelledIds = new Set();
    }

    /** 取消全部（例如切换会话）。 */
    cancelAll(): void {
        this.cancel(() => true);
    }

    submit<T>(task: SubagentLoadTask<T>): Promise<SubagentLoadOutcome<T>> {
        return new Promise<SubagentLoadOutcome<T>>((resolve) => {
            this.queue.push({ id: task.id, run: task.run, resolve } as QueueEntry<unknown>);
            this.pump();
        });
    }

    /** 排队中的任务数（不含在飞的）。 */
    pending(): number {
        return this.queue.length;
    }

    inFlight(): boolean {
        return this.running > 0;
    }

    private pump(): void {
        while (this.running < SubagentLoadConcurrency && this.queue.length > 0) {
            const entry = this.queue.shift()!;
            const generationAtStart = this.generation;
            this.running += 1;
            void (async () => {
                try {
                    const value = await entry.run();
                    this.finish(entry, generationAtStart, { status: "fulfilled", id: entry.id, value });
                } catch (error) {
                    this.finish(entry, generationAtStart, { status: "rejected", id: entry.id, error });
                }
            })();
        }
    }

    private finish<T>(
        entry: QueueEntry<T>,
        generationAtStart: number,
        outcome: SubagentLoadOutcome<T>
    ): void {
        this.running -= 1;
        if (generationAtStart !== this.generation || this.cancelledIds.has(entry.id)) {
            // 已取消：仍然 resolve（否则调用方 Promise 悬挂），但由调用方按世代号丢弃。
            entry.resolve({ status: "rejected", id: entry.id, error: new CancelledError(entry.id) });
        } else {
            entry.resolve(outcome);
        }
        this.pump();
    }
}

/** 取消不是失败：UI 应静默丢弃，不显示错误横幅。 */
export class CancelledError extends Error {
    constructor(id: string) {
        super(`subagent load cancelled: ${id}`);
        this.name = "CancelledError";
    }
}

export function isCancelled(error: unknown): boolean {
    return error instanceof CancelledError;
}
