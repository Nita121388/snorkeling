// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";

/**
 * 会话详情加载骨架。
 *
 * 详情请求返回前（或分帧续拉且尚无消息时）用占位行撑出时间线结构，替代单个
 * 居中 spinner。占位行对齐真实 MessageCard 的节奏：左侧角色点 + 右侧 2–3 条
 * 宽度递减的文本条。
 *
 * 约定：
 * - 仅用于「没有可渲染内容」的加载阶段；有 liveTurn 时绝不能用它盖住实时流。
 * - 容器与真实列表同 padding，避免加载完成后高度跳变。
 */
const SkeletonRowWidths = [
    ["90%", "72%", "48%"],
    ["86%", "64%"],
    ["92%", "78%", "56%"],
    ["84%", "60%"],
    ["88%", "70%", "44%"],
    ["82%", "58%"],
];

export function SessionDetailSkeleton({ rows = SkeletonRowWidths.length }: { rows?: number }) {
    return (
        <div
            className="flex h-full w-full min-h-0 flex-col gap-4 overflow-hidden p-3"
            role="status"
            aria-busy="true"
            aria-label="Loading conversation"
        >
            {SkeletonRowWidths.slice(0, Math.max(1, rows)).map((widths, rowIdx) => (
                <div key={rowIdx} className="flex items-start gap-2.5">
                    <div className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-secondary/30" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {widths.map((width, lineIdx) => (
                            <div
                                key={lineIdx}
                                className={cn(
                                    "h-2.5 animate-pulse rounded bg-secondary/15",
                                    // 每条消息最后一行更矮，模拟真实段落收尾
                                    lineIdx === widths.length - 1 && "h-2"
                                )}
                                style={{ width }}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}