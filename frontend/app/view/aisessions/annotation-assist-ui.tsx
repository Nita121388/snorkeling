// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 编辑器里三处 ✨ 共用的按钮/状态条。

import { cn } from "@/util/util";
import { useTranslation } from "react-i18next";

export type AssistFieldStatus = "idle" | "running" | "error";

export function AIAssistButton({
    status,
    onRun,
    disabled = false,
    title,
}: {
    status: AssistFieldStatus;
    onRun: () => void;
    disabled?: boolean;
    title?: string;
}) {
    const { t } = useTranslation("aisessions");
    const running = status === "running";
    const label = title ?? t("aisessions:assist.generateWithAi");
    return (
        <button
            type="button"
            className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] transition-colors",
                status === "error"
                    ? "text-warning hover:bg-warning/10"
                    : "text-secondary hover:bg-hover hover:text-accent"
            )}
            title={running ? t("aisessions:assist.generatingCancel") : label}
            aria-label={label}
            disabled={disabled}
            onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onRun();
            }}
        >
            <i className={cn("fa-sharp fa-solid", running ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles")} />
            <span>AI</span>
        </button>
    );
}

export function AssistFieldState({
    status,
    error,
    onUndo,
}: {
    status: AssistFieldStatus;
    error: string;
    onUndo?: () => void;
}) {
    const { t } = useTranslation("aisessions");
    if (status === "running") {
        return <span className="text-[10px] text-secondary">{t("aisessions:assist.generating")}</span>;
    }
    if (status === "error") {
        return <span className="min-w-0 text-[10px] text-warning break-words">{error}</span>;
    }
    if (onUndo == null) {
        return null;
    }
    return (
        <span className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
            {t("aisessions:assist.unsaved")}
            <button
                type="button"
                className="cursor-pointer rounded px-1 hover:bg-accent/15"
                onClick={(event) => {
                    event.stopPropagation();
                    onUndo();
                }}
            >
                {t("aisessions:assist.undo")}
            </button>
        </span>
    );
}
