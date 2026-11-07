// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// RepoLine — Files 类 Block 悬浮卡里的 Git 分区（仓库分支 + 未提交变更）。
//
// 纯展示组件：自己不请求、不缓存，数据来自 useRepoInfo。
// info 为 null（不在仓库内 / 失败 / 还在等 150ms 阈值）时渲染 null ——
// 卡片此时与改动前逐像素一致，宁可缺一行也不留空占位。
//
// 样式与 treeview-file-tooltip.tsx（Files 树悬浮卡）同一套 token，
// 将来树卡加分支行时直接复用本组件。

import { useRepoInfo, type RepoInfo } from "@/app/block/use-repo-info";
import { cn } from "@/util/util";
import * as React from "react";

/** 变更统计的展示文本：`+42 −7 · 5f`。 */
export function formatRepoChanges(info: RepoInfo): string {
    return `+${info.added} \u2212${info.removed} \u00b7 ${info.files}f`;
}

/** 单行 label/value，与 Files 树悬浮卡同款排版。 */
function RepoRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <span className="shrink-0 text-[10px] text-secondary/70 uppercase tracking-wider">{label}</span>
            <span className="min-w-0 truncate text-[12px] text-foreground">{children}</span>
        </div>
    );
}

export type RepoLineProps = {
    /** 被悬浮 Block 的路径（目录或文件均可，后端会自己找仓库根）。 */
    path: string;
    /** Block 的 connection；"" 表示本地。 */
    connection?: string;
    className?: string;
};

/**
 * Git 分区。
 *
 * 性能：请求由 useRepoInfo 延迟 150ms 触发并缓存，本组件卸载即取消 ——
 * 快速划过 Tab 栏不会产生任何 RPC。
 */
export const RepoLine = React.memo(function RepoLine({ path, connection = "", className }: RepoLineProps) {
    const info = useRepoInfo(path, connection);
    if (info == null) {
        return null;
    }
    return (
        <div className={cn("mt-1 flex flex-col gap-1 border-t border-border/60 pt-1.5", className)}>
            <RepoRow label="Branch">
                <span className="font-mono" title={info.branch}>
                    {info.branch}
                </span>
            </RepoRow>
            <RepoRow label="Changes">
                <span className="tabular-nums">
                    <span className="text-success">+{info.added}</span>{" "}
                    <span className="text-error">{"\u2212" + info.removed}</span>
                    <span className="text-secondary/70">{" \u00b7 " + info.files + "f"}</span>
                </span>
            </RepoRow>
        </div>
    );
});
