// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { MouseEventHandler } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CopyIconButton, IconButton } from "./controls";
import { SessionTagChips } from "./session-tag-chips";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    normalizeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
    sessionTagsLabel,
    stripSessionTagHashes,
} from "./session-tags";
import type { SessionRunningState } from "./use-sessions-running";
import { formatDateTimeToSecond, formatFileSize, formatSessionRelativeTime, restoreCommandForSession } from "./utils";

/**
 * A note's *real* content is whatever survives stripping `#tag` hash-tags.
 * A note like "#fix #snorkeling" has empty body but still passes `Boolean(session.note)`,
 * which would wrongly render the accent stripe. Use this for visual decorations that
 * should only appear when there's prose, not when only tags are present.
 */
function noteHasProse(note: string | null | undefined): boolean {
    return Boolean(note) && stripSessionTagHashes(note).trim().length > 0;
}

function sourceDotClass(source: string): string {
    if (source === "claude") return "bg-source-claude";
    if (source === "codex") return "bg-source-codex";
    return "bg-secondary";
}

/**
 * Four-dot spinner shown beneath the mark button when the session has a live block.
 * Four dots sit at the top/right/bottom/left of a small box and the whole box rotates,
 * so the dots appear to chase each other around a square path.
 * Returns null for any non-running state so callers can drop it straight into JSX.
 */
export function RunningDot({ runningState }: { runningState: SessionRunningState | null }): ReactElement | null {
    if (runningState !== "running") return null;
    const dotClass = "absolute rounded-full bg-accent";
    return (
        <span
            className="relative mt-0.5 block h-4 w-4 shrink-0 animate-spin"
            title="This session has a live block in the app"
        >
            <span className={cn(dotClass, "left-1/2 top-0 h-1 w-1 -translate-x-1/2")} />
            <span className={cn(dotClass, "right-0 top-1/2 h-1 w-1 -translate-y-1/2")} />
            <span className={cn(dotClass, "bottom-0 left-1/2 h-1 w-1 -translate-x-1/2")} />
            <span className={cn(dotClass, "left-0 top-1/2 h-1 w-1 -translate-y-1/2")} />
        </span>
    );
}

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export function SessionRow({
    session,
    selected,
    onSelect,
    onMark,
    onNoteSave,
    onResume,
    resumeDisabled = false,
    runningState = null,
}: {
    session: SessionSummary;
    selected: boolean;
    onSelect: () => void;
    onMark: MouseEventHandler<HTMLButtonElement>;
    onNoteSave: (note: string, tags: string[]) => Promise<boolean>;
    onResume: MouseEventHandler<HTMLButtonElement>;
    resumeDisabled?: boolean;
    runningState?: SessionRunningState | null;
}) {
    const [noteEditing, setNoteEditing] = useState(false);
    const [noteDraft, setNoteDraft] = useState(session.note ?? "");
    const [tagDraft, setTagDraft] = useState<string[]>(() => normalizeSessionTags(session.tags));
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    const latestDraftRef = useRef(session.note ?? "");

    useEffect(() => {
        if (!noteEditing) {
            const nextNote = session.note ?? "";
            latestDraftRef.current = nextNote;
            setNoteDraft(nextNote);
            setTagDraft(normalizeSessionTags(session.tags));
        }
    }, [noteEditing, session.note, session.tags]);

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
                session.tags?.length ? `Tags: ${sessionTagsLabel(session.tags)}` : "",
                session.size != null ? `Size: ${formatFileSize(session.size)} (${session.size} bytes)` : "",
                session.projectPath || session.filePath ? `Path: ${session.projectPath || session.filePath}` : "",
            ]
                .filter(Boolean)
                .join("\n\n"),
        [session]
    );

    const parsedDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(tagDraft, parsedDraft.tags);
    const noteUnchanged = parsedDraft.note === (session.note ?? "") && sessionTagsEqual(nextTags, session.tags);
    const noteSaving = noteSaveStatus === "saving";
    const sessionTime = session.updatedAt || session.createdAt || 0;
    const sessionTags = normalizeSessionTags(session.tags);
    const visibleSessionTags = sessionTags.slice(0, 3);
    const hasNoteInfo = Boolean(session.note || sessionTags.length);
    const noteToggleLabel =
        !hasNoteInfo && !noteEditing
            ? "Add note and tags"
            : noteEditing && noteUnchanged
              ? "Collapse note and tags"
              : noteEditing
                ? "Save and collapse note and tags"
                : "Edit note and tags";

    const saveNote = useCallback(async (): Promise<boolean> => {
        if (noteSaveStatus === "saving") return false;
        const parsed = extractSessionTagsFromNote(noteDraft);
        const tags = mergeSessionTags(tagDraft, parsed.tags);
        if (parsed.note === (session.note ?? "") && sessionTagsEqual(tags, session.tags)) {
            return true;
        }
        setNoteSaveStatus("saving");
        const saved = await onNoteSave(parsed.note, tags);
        const currentDraftSaved = extractSessionTagsFromNote(latestDraftRef.current).note === parsed.note;
        setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
        return saved && currentDraftSaved;
    }, [noteDraft, noteSaveStatus, onNoteSave, session.note, session.tags, tagDraft]);

    const toggleNoteEditor = useCallback(async () => {
        if (!noteEditing) {
            setNoteEditing(true);
            return;
        }
        if (noteSaving) {
            return;
        }
        if (!noteUnchanged) {
            const saved = await saveNote();
            if (!saved) {
                return;
            }
        }
        setNoteEditing(false);
    }, [noteEditing, noteSaving, noteUnchanged, saveNote]);

    return (
        <div
            className={cn(
                "group relative cursor-pointer border-b border-border px-3 py-2 text-sm hover:bg-hover",
                selected &&
                    "bg-accent/10 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent"
            )}
            title={tooltip}
            onClick={onSelect}
        >
            <div className="flex min-w-0 items-start gap-2">
                <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                    <button
                        className={cn(
                            "text-secondary opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 group-focus-within:opacity-100",
                            session.marked && "text-accent opacity-100"
                        )}
                        title="Mark session"
                        onClick={onMark}
                    >
                        <i className={cn("fa-sharp", session.marked ? "fa-solid fa-star" : "fa-regular fa-star")} />
                    </button>
                    <RunningDot runningState={runningState} />
                </div>
                <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</div>
                        <button
                            type="button"
                            className="flex h-5 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-secondary group-hover:opacity-100 group-focus-within:opacity-100"
                            title="Resume session"
                            disabled={resumeDisabled}
                            onClick={onResume}
                        >
                            <i className="fa-sharp fa-solid fa-square-terminal" />
                            <span>Resume</span>
                        </button>
                        <CopyIconButton
                            text={restoreCommandForSession(session)}
                            label="Copy resume command"
                            size="xs"
                            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-secondary tabular-nums">
                        <span className="inline-flex items-center gap-1">
                            <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(session.source))} />
                            {session.source}
                        </span>
                        <span title={formatDateTimeToSecond(sessionTime)}>
                            {formatSessionRelativeTime(sessionTime)}
                        </span>
                        <span>{session.messageCount ?? 0} msgs</span>
                        {session.size != null ? <span>{formatFileSize(session.size)}</span> : null}
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 flex items-start gap-1">
                            <div className="min-w-0 flex-1 line-clamp-2 text-xs leading-5 text-secondary">
                                {session.snippet}
                            </div>
                            {!hasNoteInfo && !noteEditing ? (
                                <button
                                    type="button"
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                                    title="Add note and tags"
                                    aria-label="Add note and tags"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void toggleNoteEditor();
                                    }}
                                >
                                    <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {hasNoteInfo || noteEditing ? (
                        <button
                            type="button"
                            className={cn(
                                "relative mt-1 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded py-0.5 pl-2 pr-1 text-left text-xs text-primary transition-colors hover:bg-hover hover:text-accent",
                                noteHasProse(session.note) &&
                                    "before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5 before:bg-accent/50 before:content-['']",
                                noteEditing && "bg-hover/60 text-accent"
                            )}
                            title={noteToggleLabel}
                            aria-label={noteToggleLabel}
                            onClick={(e) => {
                                e.stopPropagation();
                                void toggleNoteEditor();
                            }}
                        >
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                {session.note ? <span className="min-w-0 flex-1 truncate">{stripSessionTagHashes(session.note)}</span> : null}
                                {visibleSessionTags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="shrink-0 rounded-md border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] leading-none text-accent"
                                    >
                                        <span className="opacity-50">#</span>
                                        {tag}
                                    </span>
                                ))}
                                {sessionTags.length > visibleSessionTags.length ? (
                                    <span className="shrink-0 rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10px] leading-none text-accent">
                                        +{sessionTags.length - visibleSessionTags.length}
                                    </span>
                                ) : null}
                            </span>
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary opacity-0 transition-opacity hover:bg-hover hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100">
                                <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                            </span>
                        </button>
                    ) : null}
                    {noteEditing ? (
                        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <SessionTagChips
                                tags={nextTags}
                                removable
                                onRemove={(tag) => {
                                    setTagDraft((current) => current.filter((item) => item !== tag));
                                    const nextNote = removeSessionTagFromNote(noteDraft, tag);
                                    latestDraftRef.current = nextNote;
                                    setNoteDraft(nextNote);
                                }}
                            />
                            <textarea
                                className="min-h-[56px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
                                placeholder="Add a note, use #tag to add tags"
                                value={noteDraft}
                                onChange={(e) => {
                                    latestDraftRef.current = e.target.value;
                                    setNoteDraft(e.target.value);
                                    if (noteSaveStatus !== "saving") {
                                        setNoteSaveStatus("idle");
                                    }
                                }}
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    title={
                                        noteSaveStatus === "saving"
                                            ? "Saving..."
                                            : noteSaveStatus === "saved"
                                              ? "Saved"
                                              : noteSaveStatus === "error"
                                                ? "Save failed"
                                                : "Save note"
                                    }
                                    className={cn(
                                        "flex h-5 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] text-secondary hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-secondary",
                                        noteSaveStatus === "saved" && "border-accent bg-accent/10 text-accent",
                                        noteSaveStatus === "error" && "border-error bg-error/10 text-error"
                                    )}
                                    disabled={noteSaving || noteUnchanged}
                                    onClick={() => void saveNote()}
                                >
                                    <i
                                        className={cn(
                                            "fa-sharp fa-solid",
                                            noteSaveStatus === "saving"
                                                ? "fa-spinner animate-spin"
                                                : noteSaveStatus === "saved"
                                                  ? "fa-check"
                                                  : noteSaveStatus === "error"
                                                    ? "fa-triangle-exclamation"
                                                    : "fa-floppy-disk"
                                        )}
                                    />
                                    <span>Save</span>
                                </button>
                                <IconButton
                                    icon="fa-eraser"
                                    label="Clear note"
                                    size="xs"
                                    disabled={noteSaving || (!session.note && noteDraft.trim() === "")}
                                    onClick={() => {
                                        const nextNote = "";
                                        latestDraftRef.current = nextNote;
                                        setNoteSaveStatus("saving");
                                        setNoteDraft(nextNote);
                                        setTagDraft([]);
                                        void onNoteSave(nextNote, []).then((saved) => {
                                            const currentDraftSaved = latestDraftRef.current.trim() === nextNote;
                                            setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
                                            if (saved && currentDraftSaved) {
                                                setNoteEditing(false);
                                            }
                                        });
                                    }}
                                />
                                <span
                                    className={cn(
                                        "text-[10px] text-secondary",
                                        noteSaveStatus === "saved" && "text-accent",
                                        noteSaveStatus === "error" && "text-error"
                                    )}
                                    aria-live="polite"
                                >
                                    {noteSaveStatus === "saving"
                                        ? "Saving..."
                                        : noteSaveStatus === "saved"
                                          ? "Saved"
                                          : noteSaveStatus === "error"
                                            ? "Save failed"
                                            : !noteUnchanged
                                              ? "Unsaved changes"
                                              : ""}
                                </span>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
