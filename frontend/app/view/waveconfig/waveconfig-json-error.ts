// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 设置 JSON 保存校验失败 → Copy for Agent 的细节收集与 payload 构建（纯函数）。
//
// 「我的配置坏了」这句话对 agent 毫无信息量：这个模块把行列号、出错行 ±5 行片段、
// 总行数、失败信息（schema 校验里已含具体键名）收集成三段式 payload。

import { buildAgentPayload, MERGED_CONTENT_ONLY } from "@/app/element/agent-payload";

/** 出错行上下各保留的行数。 */
export const JSON_SNIPPET_CONTEXT_LINES = 5;

export type JsonFailurePosition = { line: number; column: number };

export type WaveConfigSaveFailure = {
    /** 设置文件名（settings.json 等）。 */
    filePath: string;
    /** 校验失败信息（JSON.parse 或 schema validator 的原文）。 */
    message: string;
    /** 解析错误位置（schema 校验错误通常没有位置）。 */
    line?: number;
    column?: number;
    /** 出错行 ±5 行的编号片段；无位置时为空串。 */
    snippet: string;
    totalLines: number;
};

/**
 * 从 JSON.parse 的错误信息里抠位置。
 * V8 两种格式都见过：
 *   "Unexpected token '}' ... in JSON at position 42 (line 3 column 5)"
 *   "Unexpected end of JSON input"（无位置 → null）
 * 只有 position 时按内容换算行列（1-based）。
 */
export function extractJsonErrorPosition(message: string, content: string): JsonFailurePosition | null {
    const lineCol = /line (\d+) column (\d+)/.exec(message ?? "");
    if (lineCol != null) {
        return { line: Number(lineCol[1]), column: Number(lineCol[2]) };
    }
    const position = /position (\d+)/.exec(message ?? "");
    if (position != null) {
        const pos = Math.max(0, Math.min(Number(position[1]), content.length));
        const before = content.slice(0, pos);
        const line = before.split("\n").length;
        const lastNewline = before.lastIndexOf("\n");
        const column = pos - (lastNewline === -1 ? 0 : lastNewline + 1) + 1;
        return { line, column };
    }
    return null;
}

/** 生成出错行 ±context 行的编号片段（1-based，错误行以 `>` 标记）。 */
export function buildSnippet(
    content: string,
    position: JsonFailurePosition | null,
    context: number = JSON_SNIPPET_CONTEXT_LINES
): { snippet: string; totalLines: number } {
    const lines = content.split("\n");
    const totalLines = lines.length;
    if (position == null || totalLines === 0) {
        return { snippet: "", totalLines };
    }
    const errorIdx = Math.min(Math.max(position.line - 1, 0), totalLines - 1);
    const from = Math.max(0, errorIdx - context);
    const to = Math.min(totalLines - 1, errorIdx + context);
    const parts: string[] = [];
    for (let i = from; i <= to; i++) {
        const marker = i === errorIdx ? ">" : " ";
        parts.push(`${marker}${String(i + 1).padStart(4, " ")}: ${lines[i]}`);
    }
    return { snippet: parts.join("\n"), totalLines };
}

/** 把一次保存失败组装成 WaveConfigSaveFailure（含行列与片段）。 */
export function describeJsonFailure(filePath: string, message: string, content: string): WaveConfigSaveFailure {
    const position = extractJsonErrorPosition(message, content);
    const { snippet, totalLines } = buildSnippet(content, position);
    return {
        filePath,
        message,
        line: position?.line,
        column: position?.column,
        snippet,
        totalLines,
    };
}

/** 保存校验失败 → 三段式 payload（只回修好的完整 JSON）。 */
export function buildSettingsJsonFailurePayload(failure: WaveConfigSaveFailure): string {
    const hasPosition = failure.line != null && failure.column != null;
    const context = [
        `- file: ${failure.filePath || "(unknown)"}`,
        `- error: ${failure.message || "(no message)"}`,
        hasPosition
            ? `- position: line ${failure.line} column ${failure.column} (of ${failure.totalLines} lines)`
            : `- position: (not reported by the parser; ${failure.totalLines} lines total)`,
    ];
    if (failure.snippet !== "") {
        context.push("- snippet (±5 lines around the error, `>` marks it):", failure.snippet);
    }
    return buildAgentPayload({
        context: context.join("\n"),
        task: "Fix this settings JSON so it parses and matches the expected key types, and list every key you changed.",
        outputContract: MERGED_CONTENT_ONLY,
    });
}
