// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 列表卡的「└ 发给它」纯逻辑：请求组装 + 结果映射。无 React/jotai 依赖。
//
// 为什么单独成模块：这是"发一句话给 agent"的唯一入口，映射顺序错一位就会把
//   · 等回复超时显示成"发送失败"（用户会重发，重复投递），
//   · 或者把"未确认提交"显示成"已提交"（用户以为对方收到了，其实文本卡在输入框）。
// 后端 `AgentSendResult` 已经把 injected/submitted/submitconfirmed/replied/warnings
// 都给了，客户端只允许按 design §3 的固定顺序判定（见 outcomeFromSend）。
//
// 契约来源：`11-22-overview-card-send` design §3 / PRD R3；roundtrip 语义见
// `.trellis/spec/snorkeling-docs/backend/agent-roundtrip-contract.md`（超时不是错误）。

import { stringToBase64 } from "@/util/util";

/** 卡片行程状态（v1 三段 + 目标形态的等待/超时态）。 */
export type CardSendPhase =
    | "sending" // 请求在飞
    | "submitted" // ok && submitconfirmed
    | "unconfirmed" // ok && !submitconfirmed（文本在输入框里，没吃到回车）
    | "replied" // replied=true（已拿到回复）
    | "timeout" // warnings 含 reply-timeout / reply-rpc-deadline（不算失败）
    | "failed"; // 抛错（E_AGENT_NOT_READY 等）

export interface CardSendResult {
    phase: CardSendPhase;
    replyText: string;
    truncated: boolean;
    turn: number;
    waitedMs: number;
    warnings: string[];
    /** failed 时从 "E_XXX: ..." 里取；其余为 null。 */
    errorCode: string | null;
    errorMessage: string | null;
}

/** 徽章色调（UI 只按这个上色，不再各自判定 phase）。 */
export type CardSendTone = "neutral" | "pending" | "ok" | "warn" | "danger";

export const CardSendSubmitTimeoutWarnings: readonly string[] = ["reply-timeout", "reply-rpc-deadline"];

const ErrorCodePattern = /\bE_[A-Z_]+/;

export const CardSendReplyWaitMsMin = 5000;
export const CardSendReplyWaitMsMax = 300000;
export const CardSendReplyWaitMsDefault = 60000;
export const CardSendReplyCharsMin = 200;
export const CardSendReplyCharsMax = 8000;
export const CardSendReplyCharsDefault = 2000;

/**
 * 等回复时 RPC timeout 必须放大：服务端窗口 60s 起步（cap 300s），
 * 沿用 8s/15s 默认会让等待窗口被假杀（agent-roundtrip-contract §3）。
 * 窗口 + 20s 余量，上限 320s。
 */
export function cardSendRpcTimeoutMs(replyWaitMs?: number): number {
    const waitMs = clampInt(replyWaitMs ?? CardSendReplyWaitMsDefault, CardSendReplyWaitMsMin, CardSendReplyWaitMsMax);
    return Math.min(320_000, waitMs + 20_000);
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    const rounded = Math.round(value);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
}

function errorText(error: unknown): string {
    if (error == null) return "";
    if (error instanceof Error) return error.message ?? "";
    return String(error);
}

function emptyOutcome(phase: CardSendPhase): CardSendResult {
    return {
        phase,
        replyText: "",
        truncated: false,
        turn: 0,
        waitedMs: 0,
        warnings: [],
        errorCode: null,
        errorMessage: null,
    };
}

/**
 * 把一次 `AgentSendCommand` 的结果映射成卡片行程状态。
 *
 * 映射顺序（design §3，不可调换）：
 *   1. 抛错 → failed（errorCode 取消息里的 `E_[A-Z_]+` 前缀）
 *   2. replied === true → replied
 *   3. warnings 含 reply-timeout / reply-rpc-deadline → timeout（不算失败）
 *   4. submitconfirmed === true → submitted
 *   5. 其余 ok → unconfirmed
 */
export function outcomeFromSend(rtn: AgentSendResult | null, error?: unknown): CardSendResult {
    if (error != null) {
        const message = errorText(error);
        const code = ErrorCodePattern.exec(message)?.[0] ?? null;
        // 去掉 "E_XXX:" 前缀，只留人话；code 单独给 UI 徽章用。
        const detail = code == null ? message : message.replace(new RegExp(`^\\s*${code}\\s*:?\\s*`), "");
        return {
            ...emptyOutcome("failed"),
            errorCode: code,
            errorMessage: detail.trim() !== "" ? detail.trim() : message.trim(),
        };
    }
    if (rtn == null) {
        return { ...emptyOutcome("failed"), errorMessage: "empty send result" };
    }
    const warnings = Array.isArray(rtn.warnings) ? rtn.warnings : [];
    const base: CardSendResult = {
        ...emptyOutcome("submitted"),
        replyText: rtn.replytext ?? "",
        truncated: rtn.truncated === true,
        turn: rtn.turn ?? 0,
        // replywaitedms 只覆盖等回复窗口，waitedms 是服务端总等待；优先前者（更贴近 UI 显示）。
        waitedMs: rtn.replywaitedms ?? rtn.waitedms ?? 0,
        warnings,
    };
    if (rtn.replied === true) {
        return { ...base, phase: "replied" };
    }
    if (warnings.some((warning) => CardSendSubmitTimeoutWarnings.includes(warning))) {
        return { ...base, phase: "timeout" };
    }
    if (rtn.submitconfirmed === true) {
        return { ...base, phase: "submitted" };
    }
    return { ...base, phase: "unconfirmed" };
}

export interface CardSendRequestArgs {
    blockId: string;
    text: string;
    /** true = waitreply 同步等回复（绝不能带 async，服务端 E_USAGE）。 */
    waitReply: boolean;
    replyWaitMs?: number;
    replyChars?: number;
    /**
     * 派发模式（失败后的「改为不等待」用它）：async:true 后台投递，立即返回 queued。
     * waitReply=true 时被忽略——等回复与异步派发互斥。
     */
    dispatch?: boolean;
}

export type CardSendRequestOutcome = { ok: true; req: AgentSendRequest } | { ok: false; error: string };

/** 组装一次发送请求。空文本直接拒绝（UI 据此禁发送），其余全部有夹取与互斥保护。 */
export function buildCardSendRequest(args: CardSendRequestArgs): CardSendRequestOutcome {
    const text = args.text ?? "";
    if (text.trim() === "") {
        return { ok: false, error: "empty" };
    }
    const req: AgentSendRequest = {
        blockid: args.blockId,
        // 走 text64：多字节/换行经过 JSON 的裸 text 会被服务端按字节截断。
        text64: stringToBase64(text),
        submit: true,
        requester: "desktop",
    };
    if (args.waitReply) {
        req.waitreply = true;
        req.replywaitms = clampInt(
            args.replyWaitMs ?? CardSendReplyWaitMsDefault,
            CardSendReplyWaitMsMin,
            CardSendReplyWaitMsMax
        );
        req.replychars = clampInt(
            args.replyChars ?? CardSendReplyCharsDefault,
            CardSendReplyCharsMin,
            CardSendReplyCharsMax
        );
        // 绝不给 waitreply 请求带 async（服务端 E_USAGE）。
        delete req.async;
    } else if (args.dispatch === true) {
        req.async = true;
    }
    return { ok: true, req };
}

/** phase → i18n key（文案只在这里定义一次，UI 直接 t(key)）。 */
export const CardSendPhaseLabelKey = {
    sending: "session-overview:panel.cardSendSending",
    submitted: "session-overview:panel.cardSendSubmitted",
    unconfirmed: "session-overview:panel.cardSendUnconfirmed",
    replied: "session-overview:panel.cardSendReplied",
    timeout: "session-overview:panel.cardSendTimeout",
    failed: "session-overview:panel.cardSendFailed",
} as const satisfies Record<CardSendPhase, string>;

export const CardSendPhaseTone: Record<CardSendPhase, CardSendTone> = {
    sending: "pending",
    submitted: "ok",
    unconfirmed: "warn",
    replied: "ok",
    timeout: "warn",
    failed: "danger",
};

/** 只有 `E_AGENT_NOT_READY` 才给「改为不等待」逃生口（其余失败重试同一路径即可）。 */
export function isAgentNotReadyCode(code: string | null): boolean {
    return code === "E_AGENT_NOT_READY";
}
