// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 自然语言工具摘要生成器（Ref: Lyra ToolGroup.tsx describeRun）
// 将连续的工具调用合并为一句自然语言描述。

const KIND: Record<string, string> = {
    write: "创建文件",
    edit: "修改文件",
    read: "读取文件",
    bash: "执行命令",
    bash_output: "查看输出",
    glob: "查找文件",
    grep: "搜索内容",
    ls: "列出目录",
    todo_write: "更新清单",
    web_fetch: "抓取网页",
    web_search: "搜索网络",
    task: "派发子任务",
    preview: "生成预览",
    symbol: "查找符号",
    skill: "调用技能",
};

function kindOf(toolName: string): string {
    return KIND[toolName] ?? "使用工具";
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
 * - "读取文件 main.ts"
 * - "创建 2 个文件、执行命令"
 * - "读取 3 个文件、修改文件 package.json"
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
            parts.push(`${kind} ${count} 个`);
        }
    }
    return parts.join("、");
}
