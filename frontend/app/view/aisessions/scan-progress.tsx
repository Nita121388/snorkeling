// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 会话列表首次加载的骨架占位行。
 *
 * 只在「首屏还没有任何会话数据」时出现；一旦列表里有内容，后台扫描补索引
 * 或手动刷新都不再插骨架（否则会顶动列表、干扰用户阅读）。刷新/扫描的进度
 * 统一由右上角的刷新 icon 体现。
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
