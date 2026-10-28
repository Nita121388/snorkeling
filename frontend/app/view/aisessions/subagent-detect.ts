// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 子代理派发工具名别名（前后端必须一致）。
 *
 * 后端 `subagent_fold.go` 里 `subagentToolNameAliases` 是权威来源；这里用于前端
 * 把「派发了子代理的工具行」从普通工具里挑出来。任何 provider 的子代理工具名
 * 都得同时出现在两边，否则会被解析出却链接不上。
 */
export const SUBAGENT_TOOL_ALIASES = new Set<string>([
    "subagent",
    "task",
    "spawn_agent",
    "spawn_subagent",
    "subagentstart",
]);

/** 判断一个工具名（小写归一化）是否代表子代理派发。 */
export function isSubagentToolName(name: string | undefined): boolean {
    if (!name) return false;
    return SUBAGENT_TOOL_ALIASES.has(name.trim().toLowerCase());
}

/** 从后端 summarizeToolInput 产生的 JSON 摘要里尽力还原参数。 */
function parseSummaryArgs(summary: string | undefined): Record<string, unknown> | null {
    if (!summary) return null;
    const trimmed = summary.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function firstStringValue(source: Record<string, unknown> | null, keys: string[]): string {
    if (source == null) return "";
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return "";
}

/**
 * 从 ToolCall 还原 agent / task。
 *
 * ToolCall 没有结构化 arguments，但后端把 input 序列化进了 `summary`
 * （`summarizeToolInput` → JSON 字符串），这里尽力解析；解析不到就退回工具名。
 */
export function subagentInfoFromToolCall(toolCall: { name?: string; summary?: string }): {
    agent: string;
    task: string;
} {
    const args = parseSummaryArgs(toolCall.summary);
    const agent =
        firstStringValue(args, ["agent", "subagent_type", "agent_type"]) ||
        (toolCall.name ?? "").trim() ||
        "subagent";
    const task = firstStringValue(args, ["task", "prompt", "description", "instructions"]);
    return { agent, task };
}

/**
 * 未匹配到子会话时，合成一个 `missing` 匹配。
 *
 * 目的：即使后端拿不到候选（非 pi provider / 无子会话文件），子代理派发仍然以
 * 子代理样式呈现，而不是静默退化成普通工具行。`missing` 不可展开，但能看到
 * agent + task + 状态，足以让用户知道"这里派发了子代理"。
 */
export function synthesizeSubagentMatch(toolCall: {
    name?: string;
    itemKey?: string;
    entryId?: string;
    summary?: string;
    seq?: number;
}): SubagentMatch {
    const info = subagentInfoFromToolCall(toolCall);
    return {
        call: {
            entryId: toolCall.entryId,
            itemKey: toolCall.itemKey,
            agent: info.agent,
            task: info.task || undefined,
            timestamp: 0,
        },
        status: "dispatched",
        sessionKey: "",
    };
}
