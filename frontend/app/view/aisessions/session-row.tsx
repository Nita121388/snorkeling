// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { MouseEventHandler } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyIconButton, IconButton } from "./controls";
import { formatDateTimeToSecond, restoreCommandForSession } from "./utils";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export function SessionRow({
    session,
    selected,
    onSelect,
    onMark,
    onNoteSave,
}: {
    session: SessionSummary;
    selected: boolean;
    onSelect: () => void;
    onMark: MouseEventHandler<HTMLButtonElement>;
    onNoteSave: (note: string) => Promise<boolean>;
}) {
    const [noteEditing, setNoteEditing] = useState(false);
    const [noteDraft, setNoteDraft] = useState(session.note ?? "");
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");

    useEffect(() => {
        if (!noteEditing) {
            setNoteDraft(session.note ?? "");
        }
    }, [noteEditing, session.note]);

    useEffect(() => {
        if (noteSaveStatus !== "saved" && noteSaveStatus !== "error") return;
        const handle = window.setTimeout(() => setNoteSaveStatus("idle"), noteSaveStatus === "saved" ? 1200 : 1800);
        return () => window.clearTimeout(handle);
    }, [noteSaveStatus]);

    const tooltip = useMemo(
        () =>
            [
                session.title || session.id,
                session.snippet ? `Content: ${session.snippet}` : "",
                session.note ? `Note: ${session.note}` : "",
                session.projectPath || session.filePath ? `Path: ${session.projectPath || session.filePath}` : "",
            ]
                .filter(Boolean)
                .join("\n\n"),
        [session]
    );

    const saveNote = useCallback(async () => {
        if (noteSaveStatus === "saving") return;
        const nextNote = noteDraft.trim();
        setNoteSaveStatus("saving");
        const saved = await onNoteSave(nextNote);
        setNoteSaveStatus(saved ? "saved" : "error");
        if (saved) {
            setNoteEditing(false);
        }
    }, [noteDraft, noteSaveStatus, onNoteSave]);

    const noteUnchanged = noteDraft.trim() === (session.note ?? "");
    const noteSaving = noteSaveStatus === "saving";

    return (
        <div
            className={cn(
                "group cursor-pointer border-b border-border px-3 py-2 text-sm hover:bg-hover",
                selected && "bg-accent/10"
            )}
            title={tooltip}
            onClick={onSelect}
        >
            <div className="flex min-w-0 items-start gap-2">
                <button
                    className="mt-0.5 shrink-0 text-secondary hover:text-accent"
                    title="Mark session"
                    onClick={onMark}
                >
                    <i
                        className={cn(
                            "fa-sharp",
                            session.marked ? "fa-solid fa-star text-accent" : "fa-regular fa-star"
                        )}
                    />
                </button>
                <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</div>
                        <CopyIconButton
                            text={restoreCommandForSession(session)}
                            label="Copy resume command"
                            size="xs"
                            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        />
                        <IconButton
                            icon="fa-tag"
                            label={noteEditing ? "Close note editor" : "Edit note"}
                            size="xs"
                            className={cn(
                                "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                                session.note && "border-accent/40 bg-accent/10 text-accent opacity-100"
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                setNoteEditing((current) => !current);
                            }}
                        />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xxs text-secondary">
                        <span className="uppercase">{session.source}</span>
                        <span>{formatDateTimeToSecond(session.updatedAt || session.createdAt || 0)}</span>
                        <span>{session.messageCount ?? 0} msgs</span>
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-secondary">{session.snippet}</div>
                    ) : null}
                    {session.note ? (
                        <div className="mt-1 line-clamp-1 border-l-2 border-accent/50 pl-2 text-xs text-primary">
                            {session.note}
                        </div>
                    ) : null}
                    {noteEditing ? (
                        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                                className="min-h-[56px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
                                placeholder="Add a note"
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                            />
                            <div className="flex items-center gap-2">
                                <IconButton
                                    icon={
                                        noteSaveStatus === "saving"
                                            ? "fa-spinner animate-spin"
                                            : noteSaveStatus === "saved"
                                              ? "fa-check"
                                              : noteSaveStatus === "error"
                                                ? "fa-triangle-exclamation"
                                                : "fa-floppy-disk"
                                    }
                                    label={
                                        noteSaveStatus === "saving"
                                            ? "Saving..."
                                            : noteSaveStatus === "saved"
                                              ? "Saved"
                                              : noteSaveStatus === "error"
                                                ? "Save failed"
                                                : "Save note"
                                    }
                                    size="xs"
                                    disabled={noteSaving || noteUnchanged}
                                    className={cn(
                                        noteSaveStatus === "saved" && "border-accent bg-accent/10 text-accent",
                                        noteSaveStatus === "error" && "border-error bg-error/10 text-error"
                                    )}
                                    onClick={() => void saveNote()}
                                />
                                <IconButton
                                    icon="fa-eraser"
                                    label="Clear note"
                                    size="xs"
                                    disabled={noteSaving || (!session.note && noteDraft.trim() === "")}
                                    onClick={() => {
                                        setNoteSaveStatus("saving");
                                        setNoteDraft("");
                                        void onNoteSave("").then((saved) => {
                                            setNoteSaveStatus(saved ? "saved" : "error");
                                            if (saved) {
                                                setNoteEditing(false);
                                            }
                                        });
                                    }}
                                />
                                <button
                                    className="h-5 rounded border border-border px-2 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                                    disabled={noteSaving}
                                    onClick={() => {
                                        setNoteDraft(session.note ?? "");
                                        setNoteEditing(false);
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
