// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 折叠组（工具组 / 子代理卡）的时长展示纯逻辑。
 *
 * 数据来源与近似口径：
 * - 工具组：没有独立的工具起止时间，用「组内首条工具锚定的消息 timestamp」到
 *   「组后第一条消息的 timestamp」近似这段工具批次的耗时。两者都来自
 *   SQLite 已持久化的 `Message.timestamp`，一次建表 $O(n)$，之后每组 $O(1)$。
 * - 子代理卡：`SubagentMatch.UpdatedAt - SubagentCall.Timestamp`（后端回填），
 *   折叠态即可显示，不依赖子会话内容加载。
 */

/** 将毫秒格式化为紧凑的人类可读时长；无效值返回空串。 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds - totalMinutes * 60);
    if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes - hours * 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * 条形宽度比例：按「本会话最长折叠组」归一化，最小 6% 保证极短时长也可见。
 * 无有效时长返回 0（不渲染条）。
 */
export function durationBarFraction(durationMs: number, maxDurationMs: number): number {
    if (!(durationMs > 0)) return 0;
    const max = maxDurationMs > 0 ? maxDurationMs : durationMs;
    const ratio = durationMs / max;
    return Math.min(1, Math.max(0.06, ratio));
}

/** 工具组总时长；起点或终点时间戳缺失 / 非正差值时返回 undefined。 */
export function toolGroupDurationMs(
    seqToTimestamp: ReadonlyMap<number, number> | undefined,
    startSeq: number,
    endSeq: number
): number | undefined {
    if (seqToTimestamp == null) return undefined;
    const start = seqToTimestamp.get(startSeq);
    const end = seqToTimestamp.get(endSeq);
    if (start == null || end == null) return undefined;
    const delta = end - start;
    return delta > 0 ? delta : undefined;
}

/** 子代理时长；派发时间或结束时间缺失 / 非正差值时返回 undefined。 */
export function subagentDurationMs(dispatchedAt?: number, updatedAt?: number): number | undefined {
    if (dispatchedAt == null || updatedAt == null) return undefined;
    if (!(dispatchedAt > 0) || !(updatedAt > 0)) return undefined;
    const delta = updatedAt - dispatchedAt;
    return delta > 0 ? delta : undefined;
}
