// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 自然语言工具摘要生成器（Ref: Lyra ToolGroup.tsx describeRun）
// 将连续的工具调用合并为一句自然语言描述。

import { i18n } from "@/i18n/config";

const KIND: Record<string, string> = {
    write: "aisessions:toolDescribe.kind.write",
    edit: "aisessions:toolDescribe.kind.edit",
    read: "aisessions:toolDescribe.kind.read",
    bash: "aisessions:toolDescribe.kind.bash",
    bash_output: "aisessions:toolDescribe.kind.bash_output",
    glob: "aisessions:toolDescribe.kind.glob",
    grep: "aisessions:toolDescribe.kind.grep",
    ls: "aisessions:toolDescribe.kind.ls",
    todo_write: "aisessions:toolDescribe.kind.todo_write",
    web_fetch: "aisessions:toolDescribe.kind.web_fetch",
    web_search: "aisessions:toolDescribe.kind.web_search",
    task: "aisessions:toolDescribe.kind.task",
    subagent: "aisessions:toolDescribe.kind.subagent",
    preview: "aisessions:toolDescribe.kind.preview",
    symbol: "aisessions:toolDescribe.kind.symbol",
    skill: "aisessions:toolDescribe.kind.skill",
};

function kindOf(toolName: string): string {
    const key = KIND[toolName];
    return key != null ? i18n.t(key as never) : i18n.t("aisessions:toolDescribe.useTool");
}

function subjectOf(args?: Record<string, unknown>): string | undefined {
    if (!args) return undefined;
    const path = (args.path ?? args.file ?? args.filepath) as string | undefined;
    if (typeof path === "string") {
        const parts = path.replace(/\\/g, "/").split("/");
        return parts[parts.length - 1] || undefined;
    }
    const command = args.command as string | undefined;
    if (typeof command === "string") {
        // 取命令第一段作为摘要
        const first = command.trim().split(/\s+/)[0];
        return first || undefined;
    }
    return undefined;
}

interface ToolCallInfo {
    toolName: string;
    subject?: string;
}

/**
 * 将一组工具调用合并为一句自然语言描述。
 *
 * 示例：
 * - "Read file main.ts"
 * - "Create 2 files, Run command"
 * - "Read 3 files, Edit file package.json"
 */
export function describeRun(calls: ToolCallInfo[]): string {
    const buckets = new Map<string, string[]>();
    const counts = new Map<string, number>();

    for (const call of calls) {
        const kind = kindOf(call.toolName);
        const list = buckets.get(kind) ?? [];
        if (call.subject) list.push(call.subject);
        buckets.set(kind, list);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }

    const parts: string[] = [];
    for (const [kind, count] of counts) {
        const subjects = buckets.get(kind) ?? [];
        if (count === 1 && subjects.length === 1) {
            parts.push(i18n.t("aisessions:toolDescribe.withSubject", { kind, subject: subjects[0] }));
        } else if (count === 1) {
            parts.push(kind);
        } else {
            parts.push(i18n.t("aisessions:toolDescribe.count", { kind, count }));
        }
    }
    return parts.join(", ");
}

/**
 * 连续工具折叠成一行时的紧凑摘要：同类型给「执行命令 ×3」，混合给「工具 ×5」。
 *
 * 与 describeRun 的区别：那个是完整自然语言（带文件名/命令），适合展开前的
 * 信息展示；折叠组只用「类别 × 数量」，一行高度稳定，避免长文件名把摘要撑成两行。
 */
export function describeToolGroupCompact(toolNames: string[]): string {
    if (toolNames.length === 0) return "";
    const kinds = new Set(toolNames.map((name) => kindOf(name)));
    const count = toolNames.length;
    if (kinds.size === 1) {
        return i18n.t("aisessions:toolDescribe.count", { kind: [...kinds][0], count });
    }
    return i18n.t("aisessions:toolDescribe.toolCount", { count });
}

/**
 * 折叠组标题用的「类别」标签（不含数量）：同类型返回类别名，混合返回「工具」。
 *
 * 数量由 UI 的计数徽标单独呈现，所以这里不再拼 ×N，避免同一行出现两个数字。
 */
export function describeToolGroupKind(toolNames: string[]): string {
    if (toolNames.length === 0) return "";
    const kinds = new Set(toolNames.map((name) => kindOf(name)));
    return kinds.size === 1 ? [...kinds][0] : i18n.t("aisessions:toolDescribe.tool");
}
