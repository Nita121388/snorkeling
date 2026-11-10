// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 终端块失败输出 → Copy for Agent 的 payload 构建（纯函数，term.tsx 只负责接线）。
//
// Context 证据本体：命令行 + cwd + 退出码 + 末 N 行输出（ANSI 剥离后）。
// 输出契约用 FIX_COMMAND_ONLY：agent 只回结论 + 修复命令，不写分析长文。

import { buildAgentPayload, FIX_COMMAND_ONLY } from "@/app/element/agent-payload";

/** 默认取末 40 行；上限 200（调用方不得自造更大的 N）。 */
export const TERM_FAILURE_DEFAULT_LINES = 40;
export const TERM_FAILURE_MAX_LINES = 200;

/* eslint-disable no-control-regex */
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_ESC = /\x1b[@-_]/g;
/* eslint-enable no-control-regex */

/**
 * 剥离 ANSI 控制序列：OSC（标题/超链接）、CSI（颜色/光标/清屏）、双字符转义。
 * 终端 scrollback 里带颜色码的输出直接粘给 agent 是纯噪声。
 */
export function stripAnsi(text: string): string {
    return text
        .replace(ANSI_OSC, "") // OSC（含清屏后重打的段标题）
        .replace(ANSI_CSI, "") // CSI（SGR 颜色 / 光标移动 / 2J 清屏）
        .replace(ANSI_ESC, ""); // 其余双字符转义（BEL 保留在 OSC 分支外）
}

export type TermFailureOutput = {
    /** 截断保留的末 N 行。 */
    lines: string[];
    /** 剥离 ANSI 后的总行数（截断标注用）。 */
    total: number;
    /** 是否发生了截断。 */
    truncated: boolean;
};

/** 取剥离 ANSI 后的末 N 行（默认 40，钳制到 200）。 */
export function tailOutputLines(text: string, n: number = TERM_FAILURE_DEFAULT_LINES): TermFailureOutput {
    const limit = Math.min(Math.max(n, 1), TERM_FAILURE_MAX_LINES);
    const allLines = stripAnsi(text).split("\n");
    const lines = allLines.slice(-limit);
    return { lines, total: allLines.length, truncated: allLines.length > limit };
}

/**
 * 何时显示「复制给 agent」入口：只有 cmd 控制器块、且已结束、且非零退出码。
 * 成功（exit 0）与运行中都不渲染——摆一个复制不到失败证据的按钮比不摆更糟。
 */
export function shouldShowTermFailureCopy(
    meta: MetaType | null | undefined,
    status: BlockControllerRuntimeStatus | null | undefined
): boolean {
    if (meta?.["controller"] !== "cmd") return false;
    if (status?.shellprocstatus !== "done") return false;
    const exitCode = status?.shellprocexitcode;
    return exitCode != null && exitCode !== 0;
}

export type TermFailureContext = {
    /** 完整命令行（含参数）。 */
    command: string;
    cwd: string;
    exitCode: number;
    /** 终端 scrollback 原文（含 ANSI）。 */
    output: string;
    /** 末 N 行的 N；默认 40。 */
    maxLines?: number;
};

/** 组装终端失败 payload：Context（command/cwd/exit code/末 N 行）+ Task + FIX_COMMAND_ONLY。 */
export function buildTermFailurePayload(ctx: TermFailureContext): string {
    const tail = tailOutputLines(ctx.output ?? "", ctx.maxLines);
    const contextLines = [
        `- command: ${ctx.command || "(unknown)"}`,
        `- cwd: ${ctx.cwd || "(unknown)"}`,
        `- exit code: ${ctx.exitCode}`,
        `- output (last ${tail.lines.length} of ${tail.total} lines):`,
    ];
    if (tail.truncated) {
        contextLines.push(`  … (truncated, full scrollback: ${tail.total} lines)`);
    }
    for (const line of tail.lines) {
        contextLines.push(`  ${line}`);
    }
    return buildAgentPayload({
        context: contextLines.join("\n"),
        task: "Diagnose why this command failed and name the smallest fix.",
        outputContract: FIX_COMMAND_ONLY,
    });
}
