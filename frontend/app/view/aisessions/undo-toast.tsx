// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Note 被 AI 静默覆盖后的撤销条。
//
// 设计取舍：不弹确认框（用户要求点击后不等待），改为写入后给 10 秒 Undo。
// Undo 走 saveSessionNote（既有乐观合并 + 广播），不做新的落库路径。

import { AISessionsServiceType } from "@/app/store/services";
import { saveSessionNote } from "@/app/store/session-note-cache";
import { cn } from "@/util/util";
import * as React from "react";

export type NoteUndoSnapshot = { note: string; tags: string[] };

const UndoWindowMs = 10_000;

export function useNoteUndo(service: AISessionsServiceType, sessionKey: string, connection: string | null | undefined) {
    const [pending, setPending] = React.useState<(NoteUndoSnapshot & { expiresAt: number }) | null>(null);
    const [error, setError] = React.useState("");
    const timerRef = React.useRef<number | null>(null);

    const clearTimer = React.useCallback(() => {
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    React.useEffect(() => () => clearTimer(), [clearTimer]);

    const capture = React.useCallback(
        (snapshot: NoteUndoSnapshot | null | undefined) => {
            if (snapshot == null) return;
            const hasContent = (snapshot.note ?? "").trim() !== "" || (snapshot.tags?.length ?? 0) > 0;
            if (!hasContent) return;
            clearTimer();
            setError("");
            setPending({
                note: snapshot.note ?? "",
                tags: [...(snapshot.tags ?? [])],
                expiresAt: Date.now() + UndoWindowMs,
            });
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                setPending(null);
            }, UndoWindowMs);
        },
        [clearTimer]
    );

    const dismiss = React.useCallback(() => {
        clearTimer();
        setPending(null);
        setError("");
    }, [clearTimer]);

    const undo = React.useCallback(async () => {
        if (pending == null) return;
        const target = pending;
        dismiss();
        const result = await saveSessionNote(service, sessionKey, connection, target.note, target.tags);
        if (result.status !== "ok") {
            setError(result.error || "Undo failed");
        }
    }, [connection, dismiss, pending, service, sessionKey]);

    return { pending, error, capture, undo, dismiss };
}

export function UndoNoteBar({
    pending,
    error,
    onUndo,
    onDismiss,
    className,
}: {
    pending: { expiresAt: number } | null;
    error?: string;
    onUndo: () => void;
    onDismiss: () => void;
    className?: string;
}) {
    if (pending == null) {
        return error ? <span className={cn("text-[10px] text-error", className)}>{error}</span> : null;
    }
    return (
        <span
            className={cn(
                "inline-flex items-center gap-2 rounded border border-border/70 bg-surface px-2 py-0.5 text-[10px] text-secondary",
                className
            )}
            role="status"
        >
            <span>Note replaced by AI</span>
            <button
                type="button"
                className="cursor-pointer rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent/10"
                onClick={(event) => {
                    event.stopPropagation();
                    onUndo();
                }}
                data-row-action="true"
            >
                Undo
            </button>
            <button
                type="button"
                className="cursor-pointer text-secondary hover:text-primary"
                title="Dismiss"
                aria-label="Dismiss"
                onClick={(event) => {
                    event.stopPropagation();
                    onDismiss();
                }}
                data-row-action="true"
            >
                <i className="fa-sharp fa-solid fa-xmark" />
            </button>
        </span>
    );
}
