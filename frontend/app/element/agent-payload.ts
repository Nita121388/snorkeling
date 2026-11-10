// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy for Agent 的 payload 三段式契约（构建器）。
//
// 「复制给 agent」的成败关键在第三段：没有 Output contract，agent 默认输出一篇
// 分析而不是可直接回填的内容。三段小节结构与 pkg/syncconflict/render.go 的
// RenderMarkdown 对齐（### Task / ### Output contract 小节），Go 端与 TS 端
// 视觉一致。Task 与 Output contract 由本构建器统一追加，消费面只拼 Context，
// 格式不可能长歪。

/**
 * 常用输出契约预设。消费面不允许自造长句——选预设；确需自定义时必须在调用点
 * 写明理由注释，否则 review 不放行。
 */
export const MERGED_CONTENT_ONLY =
    "Reply with the merged content only — no explanation, no code fences around the whole answer." as const;
export const FIX_COMMAND_ONLY =
    "Reply with the exact command(s) to run, one per line — no explanation." as const;
export const DIAGNOSIS_BRIEF =
    "Reply with a short diagnosis first, then the single most likely fix — no long analysis." as const;

export type AgentOutputContract = typeof MERGED_CONTENT_ONLY | typeof FIX_COMMAND_ONLY | typeof DIAGNOSIS_BRIEF;

export type AgentPayloadOpts = {
    /** 结构化事实段（键值行，机器可读优先）。数据源差异大，由调用方拼装，本模块不抽象形状。 */
    context: string;
    /** 一句祈使句，如 "Merge both versions into one, keeping every intentional change from each side." */
    task: string;
    /** 输出契约：优先用预设常量；自定义需给理由注释。 */
    outputContract: string | AgentOutputContract;
};

/**
 * 组装三段式 payload。缺 task / outputContract 直接 throw：宁可编译期失败，
 * 也不产出一段「用户还得解释半天」的没契约文本。
 */
export function buildAgentPayload(opts: AgentPayloadOpts): string {
    const context = (opts?.context ?? "").trim();
    const task = (opts?.task ?? "").trim();
    const outputContract = (opts?.outputContract ?? "").trim();
    if (!task) {
        throw new Error("buildAgentPayload: task is required — without it the user still has to explain");
    }
    if (!outputContract) {
        throw new Error(
            "buildAgentPayload: outputContract is required — without it the agent will answer with an essay"
        );
    }
    return [
        "### Context",
        "",
        context,
        "",
        "### Task",
        "",
        task,
        "",
        "### Output contract",
        "",
        outputContract,
        "",
    ].join("\n");
}
