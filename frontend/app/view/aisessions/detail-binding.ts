// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 详情块绑定解析的纯判定逻辑。
//
// 背景：列表块双击 / Agent TUI 右键打开的详情块都带 `aisessions:sessionid`。
// 挂载后 `loadSessions` 要把「绑定 id」解析成当前选中项；旧实现在解析失败时
// 静默退化成「列表第一行」，块从此粘死在别的会话上。这里把三条判定抽成
// 纯函数，让红证测试能机器判定：
//
//   1. detailFallbackDecision — 绑定块解析失败后能不能回落（不能）。
//   2. shouldCommitDetailLoad — 详情响应是否还是「最新且仍选中」的那一次。
//   3. detailBelongsToSelection — 正文是否属于当前选中的会话。

/** 绑定块解析失败后的回落去向。 */
export type DetailFallbackDecision =
    /** 保留现状（错误态 / 骨架），不动选中，等下次刷新或重试。 */
    | { kind: "keep" }
    /** 未绑定块且是 newchat 块：按原逻辑自动起新会话。 */
    | { kind: "newchat" }
    /** 未绑定的纯列表块：沿用「自动选最新一行」。 */
    | { kind: "first-session" };

export type DetailFallbackInput = {
    /** 刱是否绑定到具体会话（meta 有 `aisessions:sessionid`，或孤儿 id 刚被清绑）。 */
    blockBound: boolean;
    /** `loadDetailById` 是否失败（false = 成功，调用方应已 return）。 */
    loadByIdFailed: boolean;
    /** 失败是否明确为 session not found（绑定已失效 / 会话被删）。 */
    sessionNotFound: boolean;
    /** 块是否带 `aisessions:newchat`。 */
    newChat: boolean;
};

/**
 * 详情块的回落决策。
 *
 * 关键不变式：**绑定块永不返回 `first-session`** —— 这是「打开的详情 ≠ 点的那一行」
 * 的根因（解析失败时被改成列表第一条，且因 selectedKey 落在列表内不会自愈）。
 * 只有未绑定的纯列表块才允许自动选最新一行。
 */
export function detailFallbackDecision(input: DetailFallbackInput): DetailFallbackDecision {
    if (!input.blockBound) {
        return input.newChat ? { kind: "newchat" } : { kind: "first-session" };
    }
    // 绑定块：无论是一般失败还是 session not found，都保留现状。
    // not-found 由调用方负责清绑（保留错误态），不在这里改成别的会话。
    return { kind: "keep" };
}

export type CommitDetailLoadInput = {
    /** 发起这次请求时的序号。 */
    loadSeq: number;
    /** 当前最新的序号（`detailLoadSeq`）。 */
    latestSeq: number;
    /** 响应到达时的选中 key。 */
    selectedKey: string;
    /** 这次请求针对的 key / id。 */
    targetKey: string;
};

/**
 * 详情响应是否应该提交。
 *
 * 与 `loadDetail` 原有守卫同义（seq 最新 + 仍然选中同一个），供 `loadDetailById`
 * 复用，避免旧响应把用户刚点的那一行覆盖掉。
 */
export function shouldCommitDetailLoad(input: CommitDetailLoadInput): boolean {
    const target = (input.targetKey ?? "").trim();
    if (target === "") {
        return false;
    }
    if (input.loadSeq !== input.latestSeq) {
        return false;
    }
    return (input.selectedKey ?? "").trim() === target;
}

/**
 * 正文是否属于当前选中的会话。
 *
 * 归属不符时面板必须显示骨架 / 错误态，不能拿旧会话的正文冒充当前选中
 * （切换瞬间「详情和选中项不对应」的视觉来源）。
 *
 * 入参用最小结构类型：调用方传 `SessionDetail`，测试不必造全量 summary。
 */
export function detailBelongsToSelection(
    detail: { summary?: { key?: string; id?: string } | null } | null | undefined,
    selectedKey: string
): boolean {
    const key = (selectedKey ?? "").trim();
    if (detail == null) {
        return false;
    }
    if (key === "") {
        return false;
    }
    const summaryKey = (detail.summary?.key ?? "").trim();
    const summaryId = (detail.summary?.id ?? "").trim();
    return summaryKey !== "" && (summaryKey === key || summaryId === key);
}
