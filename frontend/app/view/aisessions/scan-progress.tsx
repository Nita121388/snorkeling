// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";

/**
 * 会话列表的「扫描中」占位与进度条。
 *
 * 背景：会话历史达到几千个文件时，一次全量 summary 扫描不可能在首屏内完成。
 * 后端因此改成「先返回索引里已有的行 + 后台继续扫」，前端在这里用骨架行占位，
 * 并用一条进度条说明后台还在补齐，避免出现「加载失败/空白」的观感。
 *
 * 约定：
 * - 骨架只占位，不参与交互：容器 aria-hidden，永不被聚焦或点击。
 * - 与 SessionRow 共用行高与缩进（border-b + px-3 py-2 + 左侧点 + 右侧两行），
 *   补齐后行高不跳变。
 */

const SkeletonTitleWidths = ["62%", "48%", "71%", "55%", "66%", "43%"];
const SkeletonMetaWidths = ["38%", "30%", "42%", "34%", "28%", "36%"];

export function SkeletonSessionRow({ index }: { index: number }) {
    const titleWidth = SkeletonTitleWidths[index % SkeletonTitleWidths.length];
    const metaWidth = SkeletonMetaWidths[index % SkeletonMetaWidths.length];
    return (
        <div className="flex min-w-0 items-start gap-2 border-b border-border bg-block-solid px-3 py-2 text-sm">
            <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
                <div className="h-3.5 w-3.5 animate-pulse rounded bg-secondary/20" />
            </div>
            <div className="min-w-0 flex-1 border-l border-border pl-3">
                <div className="h-3.5 animate-pulse rounded bg-secondary/20" style={{ width: titleWidth }} />
                <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-secondary/25" />
                    <div className="h-2.5 animate-pulse rounded bg-secondary/15" style={{ width: metaWidth }} />
                </div>
            </div>
        </div>
    );
}

export function SkeletonSessionRows({ rows = 6 }: { rows?: number }) {
    return (
        <div aria-hidden="true" data-testid="aisessions-scan-skeleton">
            {Array.from({ length: rows }, (_, index) => (
                <SkeletonSessionRow key={index} index={index} />
            ))}
        </div>
    );
}

/**
 * 后台扫描进度条。`scanned/total` 来自 wps 的 aisessions:scanstatus 事件；
 * total 为 0 时只显示不定态文案，避免出现 "0/0"。
 */
export function ScanProgressStrip({ scanned, total }: { scanned: number; total: number }) {
    const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
    const label = total > 0 ? `Syncing sessions ${scanned}/${total}` : "Syncing sessions";
    return (
        <div
            className="border-b border-border bg-surface/40 px-3 py-1.5"
            role="status"
            aria-live="polite"
            aria-busy="true"
            data-testid="aisessions-scan-progress"
        >
            <div className="flex items-center gap-2 text-[11px] text-secondary tabular-nums">
                <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {total > 0 ? <span className="shrink-0">{percent}%</span> : null}
            </div>
            <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-secondary/15">
                <div
                    className={cn(
                        "h-full bg-accent transition-all duration-300",
                        total > 0 ? "" : "w-1/3 animate-pulse"
                    )}
                    style={total > 0 ? { width: `${percent}%` } : undefined}
                />
            </div>
        </div>
    );
}
