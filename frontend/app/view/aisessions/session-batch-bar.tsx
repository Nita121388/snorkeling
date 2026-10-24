// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 批量操作栏：列表多选后的动作条。
//
// 放在列表面板底部固定区（不随列表滚动），选中 ≥1 时出现。首版只做
// 「复制」与「Star/Unstar」两类动作 —— 复制是纯前端字符串拼接，Star 复用
// model.toggleMark（逐条 RPC）。批量删除 / 批量 note 都是破坏性或需新 RPC
// 的操作，不在本组件里出现。
//
// 视觉沿用 controls.tsx 的按钮尺寸（h-7）与 token，不引入新设计系统；
// 窄窗口用 flex-wrap 换行，不横向溢出。

import { cn } from "@/util/util";
import type { BatchCopyKind } from "./utils";

type BatchAction = {
    kind: BatchCopyKind;
    icon: string;
    /** 宽度够时显示的短标签 */
    label: string;
    title: string;
};

const CopyActions: BatchAction[] = [
    {
        kind: "ids",
        icon: "fa-fingerprint",
        label: "IDs",
        title: "Copy session IDs",
    },
    {
        kind: "filePaths",
        icon: "fa-file-lines",
        label: "Files",
        title: "Copy session file paths",
    },
    {
        kind: "projectPaths",
        icon: "fa-folder",
        label: "Dirs",
        title: "Copy working directories",
    },
    {
        kind: "resumeCommands",
        icon: "fa-terminal",
        label: "Resume",
        title: "Copy resume commands",
    },
];

export function SessionBatchBar({
    selectedCount,
    copiedKind,
    starred,
    onCopy,
    onStar,
    onUnstar,
    onClear,
}: {
    selectedCount: number;
    /** 刚刚复制成功的产物类型；null = 无反馈 */
    copiedKind: BatchCopyKind | null;
    /** 选区是否全部已 star；决定显示 Star 还是 Unstar */
    starred: boolean;
    onCopy: (kind: BatchCopyKind) => void;
    onStar: () => void;
    onUnstar: () => void;
    onClear: () => void;
}) {
    if (selectedCount <= 0) {
        return null;
    }
    return (
        <div
            role="toolbar"
            aria-label="Batch actions for selected sessions"
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 bg-accent/5 px-3 py-2"
        >
            <span className="mr-1 shrink-0 text-[11px] font-medium text-accent tabular-nums">
                {selectedCount} selected
            </span>
            {CopyActions.map((action) => {
                const copied = copiedKind === action.kind;
                return (
                    <button
                        key={action.kind}
                        type="button"
                        title={copied ? "Copied" : action.title}
                        aria-label={action.title}
                        onClick={() => onCopy(action.kind)}
                        className={cn(
                            "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
                            copied
                                ? "border-accent/60 bg-accent/15 text-accent"
                                : "border-border/70 bg-surface text-secondary hover:bg-hover hover:text-primary"
                        )}
                    >
                        <i
                            className={cn(
                                "fa-sharp fa-solid text-[10px]",
                                copied ? "fa-check" : action.icon
                            )}
                        />
                        <span>{copied ? "Copied" : action.label}</span>
                    </button>
                );
            })}
            <span className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
            <button
                type="button"
                title={starred ? "Unstar selected sessions" : "Star selected sessions"}
                aria-label={starred ? "Unstar selected sessions" : "Star selected sessions"}
                aria-pressed={starred}
                onClick={starred ? onUnstar : onStar}
                className={cn(
                    "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
                    starred
                        ? "border-warning/60 bg-warning/10 text-warning"
                        : "border-border/70 bg-surface text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i className={cn("fa-sharp text-[10px]", starred ? "fa-solid fa-star" : "fa-regular fa-star")} />
                <span>{starred ? "Unstar" : "Star"}</span>
            </button>
            <div className="flex-1" />
            <button
                type="button"
                title="Clear selection"
                aria-label="Clear selection"
                onClick={onClear}
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
            >
                <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                <span>Clear</span>
            </button>
        </div>
    );
}
