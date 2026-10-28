// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 自然语言工具摘要生成器（Ref: Lyra ToolGroup.tsx describeRun）
// 将连续的工具调用合并为一句自然语言描述。

const KIND: Record<string, string> = {
    write: "Create file",
    edit: "Edit file",
    read: "Read file",
    bash: "Run command",
    bash_output: "View output",
    glob: "Find files",
    grep: "Search content",
    ls: "List directory",
    todo_write: "Update list",
    web_fetch: "Fetch page",
    web_search: "Search web",
    task: "Spawn subagent",
    subagent: "Spawn subagent",
    preview: "Generate preview",
    symbol: "Find symbol",
    skill: "Invoke skill",
};

function kindOf(toolName: string): string {
    return KIND[toolName] ?? "Use tool";
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
            parts.push(`${kind} ${subjects[0]}`);
        } else if (count === 1) {
            parts.push(kind);
        } else {
            parts.push(`${kind} ×${count}`);
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
        return `${[...kinds][0]} ×${count}`;
    }
    return `Tool ×${count}`;
}

/**
 * 折叠组标题用的「类别」标签（不含数量）：同类型返回类别名，混合返回「工具」。
 *
 * 数量由 UI 的计数徽标单独呈现，所以这里不再拼 ×N，避免同一行出现两个数字。
 */
export function describeToolGroupKind(toolNames: string[]): string {
    if (toolNames.length === 0) return "";
    const kinds = new Set(toolNames.map((name) => kindOf(name)));
    return kinds.size === 1 ? [...kinds][0] : "Tool";
}
