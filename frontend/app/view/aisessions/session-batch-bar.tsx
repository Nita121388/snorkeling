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

import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import { useTranslation } from "react-i18next";
import { useBatchGenCounts } from "./aisession-gen-store";
import type { BatchCopyKind } from "./utils";

type BatchAction = {
    kind: BatchCopyKind;
    icon: string;
    /** 宽度够时显示的短标签 */
    labelKey: string;
    titleKey: string;
};

const CopyActions: BatchAction[] = [
    {
        kind: "ids",
        icon: "fa-fingerprint",
        labelKey: "aisessions:batchBar.ids",
        titleKey: "aisessions:batchBar.copyIds",
    },
    {
        kind: "filePaths",
        icon: "fa-file-lines",
        labelKey: "aisessions:batchBar.files",
        titleKey: "aisessions:batchBar.copyFiles",
    },
    {
        kind: "projectPaths",
        icon: "fa-folder",
        labelKey: "aisessions:batchBar.dirs",
        titleKey: "aisessions:batchBar.copyDirs",
    },
    {
        kind: "resumeCommands",
        icon: "fa-terminal",
        labelKey: "aisessions:batchBar.resume",
        titleKey: "aisessions:batchBar.copyResume",
    },
];

export function SessionBatchBar({
    selectedCount,
    selectedKeys,
    connection,
    copiedKind,
    starred,
    onCopy,
    onStar,
    onUnstar,
    onClear,
    onAutoGenerate,
}: {
    selectedCount: number;
    /** 选中会话的 key 列表（供批量 AI 生成）。 */
    selectedKeys?: string[];
    connection?: string;
    /** 刚刚复制成功的产物类型；null = 无反馈 */
    copiedKind: BatchCopyKind | null;
    /** 选区是否全部已 star；决定显示 Star 还是 Unstar */
    starred: boolean;
    onCopy: (kind: BatchCopyKind) => void;
    onStar: () => void;
    onUnstar: () => void;
    onClear: () => void;
    onAutoGenerate?: (kind: "title" | "metadata") => void;
}) {
    const { t } = useTranslation("aisessions");
    const titleGenCounts = useBatchGenCounts(connection, selectedKeys ?? [], "title");
    if (selectedCount <= 0) {
        return null;
    }
    const overLimit = selectedCount > 50;
    const genSummary =
        titleGenCounts.total > 0
            ? i18n.t("aisessions:batchBar.done", { done: titleGenCounts.done, total: titleGenCounts.total }) +
              (titleGenCounts.failed > 0 ? i18n.t("aisessions:batchBar.failedSuffix", { failed: titleGenCounts.failed }) : "")
            : "";
    return (
        <div
            role="toolbar"
            aria-label={t("aisessions:batchBar.toolbarAria")}
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 bg-accent/5 px-3 py-2"
        >
            <span className="mr-1 shrink-0 text-[11px] font-medium text-accent tabular-nums">
                {i18n.t("aisessions:batchBar.selected", { count: selectedCount })}
            </span>
            {CopyActions.map((action) => {
                const copied = copiedKind === action.kind;
                return (
                    <button
                        key={action.kind}
                        type="button"
                        title={copied ? t("aisessions:batchBar.copied") : t(action.titleKey as never)}
                        aria-label={t(action.titleKey as never)}
                        onClick={() => onCopy(action.kind)}
                        className={cn(
                            "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors",
                            copied
                                ? "border-accent/60 bg-accent/15 text-accent"
                                : "border-border/70 bg-surface text-secondary hover:bg-hover hover:text-primary"
                        )}
                    >
                        <i className={cn("fa-sharp fa-solid text-[10px]", copied ? "fa-check" : action.icon)} />
                        <span>{copied ? t("aisessions:batchBar.copied") : t(action.labelKey as never)}</span>
                    </button>
                );
            })}
            <span className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
            <button
                type="button"
                title={starred ? t("aisessions:batchBar.unstarSelected") : t("aisessions:batchBar.starSelected")}
                aria-label={starred ? t("aisessions:batchBar.unstarSelected") : t("aisessions:batchBar.starSelected")}
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
                <span>{starred ? t("aisessions:batchBar.unstar") : t("aisessions:batchBar.star")}</span>
            </button>
            {onAutoGenerate != null ? (
                <>
                    <button
                        type="button"
                        title={overLimit ? t("aisessions:batchBar.overLimit") : t("aisessions:batchBar.generateTitles")}
                        aria-label={t("aisessions:batchBar.generateTitles")}
                        disabled={overLimit}
                        onClick={() => onAutoGenerate("title")}
                        className={cn(
                            "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary",
                            overLimit && "cursor-default opacity-50"
                        )}
                    >
                        <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-[10px]" />
                        <span>{t("aisessions:batchBar.aiTitle")}</span>
                    </button>
                    <button
                        type="button"
                        title={overLimit ? t("aisessions:batchBar.overLimit") : t("aisessions:batchBar.generateNote")}
                        aria-label={t("aisessions:batchBar.generateNote")}
                        disabled={overLimit}
                        onClick={() => onAutoGenerate("metadata")}
                        className={cn(
                            "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary",
                            overLimit && "cursor-default opacity-50"
                        )}
                    >
                        <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-[10px]" />
                        <span>{t("aisessions:batchBar.aiNote")}</span>
                    </button>
                    {genSummary !== "" ? (
                        <span className="shrink-0 text-[10px] text-secondary tabular-nums">{genSummary}</span>
                    ) : null}
                </>
            ) : null}
            <div className="flex-1" />
            <button
                type="button"
                title={t("aisessions:batchBar.clearSelection")}
                aria-label={t("aisessions:batchBar.clearSelection")}
                onClick={onClear}
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] text-secondary transition-colors hover:bg-hover hover:text-primary"
            >
                <i className="fa-sharp fa-solid fa-xmark text-[10px]" />
                <span>{t("aisessions:batchBar.clear")}</span>
            </button>
        </div>
    );
}
