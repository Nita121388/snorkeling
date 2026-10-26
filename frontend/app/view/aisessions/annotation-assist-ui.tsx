// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 编辑器里三处 ✨ 共用的按钮/状态条。

import { cn } from "@/util/util";

export type AssistFieldStatus = "idle" | "running" | "error";

export function AIAssistButton({
    status,
    onRun,
    disabled = false,
    title = "Generate with AI",
}: {
    status: AssistFieldStatus;
    onRun: () => void;
    disabled?: boolean;
    title?: string;
}) {
    const running = status === "running";
    return (
        <button
            type="button"
            className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] transition-colors",
                status === "error"
                    ? "text-warning hover:bg-warning/10"
                    : "text-secondary hover:bg-hover hover:text-accent"
            )}
            title={running ? "Generating… click again to cancel" : title}
            aria-label={title}
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
    if (status === "running") {
        return <span className="text-[10px] text-secondary">AI · generating…</span>;
    }
    if (status === "error") {
        return <span className="min-w-0 text-[10px] text-warning break-words">{error}</span>;
    }
    if (onUndo == null) {
        return null;
    }
    return (
        <span className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
            AI · 未保存
            <button
                type="button"
                className="cursor-pointer rounded px-1 hover:bg-accent/15"
                onClick={(event) => {
                    event.stopPropagation();
                    onUndo();
                }}
            >
                Undo
            </button>
        </span>
    );
}
