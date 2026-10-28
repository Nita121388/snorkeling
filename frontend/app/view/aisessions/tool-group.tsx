// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tool Group 组件：将连续的工具调用合并为一行摘要（Ref: Lyra ToolGroup.tsx）
// - 摘要行：自然语言描述 + diff 统计 + 展开 chevron
// - 运行中：ly-glide 文字扫光
// - 展开/折叠：ResizeObserver 实测高度 + transition-[height]

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { memo, useEffect, useRef, useState } from "react";
import { describeRun } from "./tool-describe";

interface ToolGroupProps {
    /** 组内工具调用的名称列表 */
    toolNames: string[];
    /** 组内工具调用的参数列表（用于提取 subject） */
    toolArgs?: Array<Record<string, unknown> | undefined>;
    /** 行数变更统计 */
    added?: number;
    removed?: number;
    /** 是否正在运行 */
    running?: boolean;
    /** 覆盖默认摘要文案（如折叠组的「执行命令 ×3」）；不传时用 describeRun 自然语言。 */
    summary?: string;
    children: ReactNode;
}

export const ToolGroup = memo(function ToolGroup({
    toolNames,
    toolArgs,
    added = 0,
    removed = 0,
    running = false,
    summary: summaryOverride,
    children,
}: ToolGroupProps) {
    const [open, setOpen] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    // 用 ResizeObserver 实测展开高度（Ref: Lyra ToolGroup）
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const measure = () => setHeight(el.scrollHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [children, open]);

    const calls = toolNames.map((name, i) => ({
        toolName: name,
        subject: toolArgs?.[i] ? subjectOf(toolArgs[i]) : undefined,
    }));
    const summary = summaryOverride ?? describeRun(calls);
    const hasDiff = added + removed > 0;

    return (
        <div
            className="mb-2 overflow-hidden rounded-lg border border-border/50 border-l-2 border-l-accent/60 bg-surface-soft transition-colors hover:bg-surface"
            data-ly-run={running ? "running" : "done"}
        >
            {/* 摘要行：始终可见的 chevron + 计数徽标，让「这里折叠了几个工具」一眼可辨 */}
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="group/run flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] text-secondary transition-colors hover:bg-hover"
            >
                <i
                    className={cn(
                        "fa-sharp fa-solid shrink-0 text-[9px] text-secondary transition-transform duration-200",
                        open ? "fa-chevron-down" : "fa-chevron-right"
                    )}
                />
                <span className="shrink-0 rounded bg-accent/15 px-1.5 py-px font-mono text-[10px] font-semibold text-accent-300">
                    {toolNames.length}
                </span>
                <i className="fa-sharp fa-solid fa-wrench shrink-0 text-[10px] text-accent-300/80" />
                <span className={cn("min-w-0 flex-1 truncate", running && "ly-glide")}>
                    <span key={summary} className="ly-enter">
                        {summary}
                    </span>
                </span>
                {hasDiff && (
                    <span className="shrink-0 font-mono text-[10px]">
                        <span className="text-success">+{added}</span>{" "}
                        <span className="text-error">-{removed}</span>
                    </span>
                )}
            </button>

            {/* 展开内容：ResizeObserver 实测高度 + transition */}
            <div
                style={{ height: open ? height : 0 }}
                className="overflow-hidden transition-[height] duration-200 ease-out"
            >
                <div ref={bodyRef} className="px-2 pb-1 pt-1">
                    {children}
                </div>
            </div>
        </div>
    );
});

function subjectOf(args: Record<string, unknown>): string | undefined {
    const path = (args.path ?? args.file ?? args.filepath) as string | undefined;
    if (typeof path === "string") {
        const parts = path.replace(/\\/g, "/").split("/");
        return parts[parts.length - 1] || undefined;
    }
    const command = args.command as string | undefined;
    if (typeof command === "string") {
        const first = command.trim().split(/\s+/)[0];
        return first || undefined;
    }
    return undefined;
}
