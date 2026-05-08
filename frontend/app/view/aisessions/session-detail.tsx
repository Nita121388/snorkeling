// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiSessionsViewModel } from "./aisessions";
import { CopyIconButton, IconButton } from "./controls";
import { EmptyState } from "./empty-state";
import { MessageCard } from "./session-message";
import { defaultVisibleMessageCount, visibleMessageCountStep } from "./types";
import { isReadableMessage, outlinePreview, outlineRoleClass, restoreCommandForSession, shortSessionId } from "./utils";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export function SessionDetailPane({
    model,
    detail,
    loading,
    restoring,
    deleting,
}: {
    model: AiSessionsViewModel;
    detail: SessionDetail | null;
    loading: boolean;
    restoring: boolean;
    deleting: boolean;
}) {
    const [noteDraft, setNoteDraft] = useState("");
    const [noteCollapsed, setNoteCollapsed] = useState(true);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    const [visibleMessageCount, setVisibleMessageCount] = useState(defaultVisibleMessageCount);
    const [collapsedMessages, setCollapsedMessages] = useState<Record<number, boolean>>({});
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingJumpSeqRef = useRef<number | null>(null);

    useEffect(() => {
        setNoteDraft(detail?.summary?.note ?? "");
    }, [detail?.summary?.key, detail?.summary?.note]);

    useEffect(() => {
        messageRefs.current = {};
        pendingJumpSeqRef.current = null;
        setDeleteConfirmOpen(false);
        setNoteCollapsed(true);
        setNoteSaveStatus("idle");
        setCollapsedMessages({});
        setVisibleMessageCount(defaultVisibleMessageCount);
    }, [detail?.summary?.key]);

    const readableMessages = useMemo(
        () => (detail?.messages ?? []).filter((message) => isReadableMessage(message)),
        [detail?.messages]
    );
    const detailMessages = useMemo(
        () => readableMessages.slice(-visibleMessageCount),
        [readableMessages, visibleMessageCount]
    );
    const outlineMessages = useMemo(
        () => readableMessages.filter((message) => message.role === "user"),
        [readableMessages]
    );
    const hasPreviousMessages = visibleMessageCount < readableMessages.length;
    const firstVisibleMessage = detailMessages[0];
    const lastVisibleMessage = detailMessages[detailMessages.length - 1];

    const scrollToVisibleMessage = useCallback((seq: number) => {
        const node = messageRefs.current[seq];
        const container = detailScrollRef.current;
        if (node && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            const top = nodeRect.top - containerRect.top + container.scrollTop - 12;
            container.scrollTo({ top, behavior: "smooth" });
            return;
        }
        node?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []);

    const loadPreviousMessages = useCallback(() => {
        setVisibleMessageCount((current) => Math.min(current + visibleMessageCountStep, readableMessages.length));
    }, [readableMessages.length]);

    const toggleMessageCollapsed = useCallback((seq: number) => {
        setCollapsedMessages((current) => ({ ...current, [seq]: !current[seq] }));
    }, []);

    const jumpToMessage = useCallback(
        (seq: number) => {
            if (messageRefs.current[seq]) {
                scrollToVisibleMessage(seq);
                return;
            }
            const targetIndex = readableMessages.findIndex((message) => message.seq === seq);
            if (targetIndex < 0) return;
            pendingJumpSeqRef.current = seq;
            setVisibleMessageCount((current) => Math.max(current, readableMessages.length - targetIndex));
        },
        [readableMessages, scrollToVisibleMessage]
    );

    useEffect(() => {
        const pendingSeq = pendingJumpSeqRef.current;
        if (pendingSeq == null || !messageRefs.current[pendingSeq]) return;
        pendingJumpSeqRef.current = null;
        window.requestAnimationFrame(() => scrollToVisibleMessage(pendingSeq));
    }, [detailMessages, scrollToVisibleMessage]);

    useEffect(() => {
        if (noteSaveStatus !== "saved" && noteSaveStatus !== "error") return;
        const handle = window.setTimeout(() => setNoteSaveStatus("idle"), noteSaveStatus === "saved" ? 1200 : 1800);
        return () => window.clearTimeout(handle);
    }, [noteSaveStatus]);

    const saveNote = useCallback(
        async (nextNote: string) => {
            if (detail?.summary == null || noteSaveStatus === "saving") return;
            setNoteSaveStatus("saving");
            const saved = await model.updateNote(detail.summary, nextNote);
            setNoteSaveStatus(saved ? "saved" : "error");
        },
        [detail?.summary, model, noteSaveStatus]
    );

    if (loading && detail == null) {
        return <EmptyState text="Loading detail..." />;
    }
    if (detail == null) {
        return <EmptyState text="Select a session to view details." />;
    }
    const summary = detail.summary;
    const trimmedNoteDraft = noteDraft.trim();
    const noteUnchanged = trimmedNoteDraft === (summary.note ?? "");
    const noteSaving = noteSaveStatus === "saving";
    const noteStatusText =
        noteSaveStatus === "saving"
            ? "Saving..."
            : noteSaveStatus === "saved"
              ? "Saved"
              : noteSaveStatus === "error"
                ? "Save failed"
                : "";
    return (
        <div className="relative flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 truncate text-sm font-medium" title={summary.title || summary.id}>
                                {summary.title || summary.id}
                            </div>
                            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-secondary">
                                {summary.source}
                            </span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-3 text-xxs text-secondary">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="min-w-0 truncate">{summary.projectPath || summary.filePath}</span>
                                <CopyIconButton
                                    text={summary.filePath}
                                    label="Copy session file path"
                                    size="xs"
                                    className="!border-transparent"
                                />
                                <IconButton
                                    icon="fa-folder-open"
                                    label="Open session folder in files"
                                    size="xs"
                                    className="!border-transparent"
                                    onClick={() => void model.openSessionFolder(summary)}
                                />
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="shrink-0">ID: {shortSessionId(summary.id)}</span>
                                <CopyIconButton
                                    text={summary.id}
                                    label="Copy session ID"
                                    size="xs"
                                    className="!border-transparent"
                                />
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs">
                            <button
                                className="flex h-7 items-center gap-2 rounded border border-accent bg-accent px-2 text-white hover:bg-accent/90 disabled:opacity-60"
                                disabled={restoring}
                                onClick={() => void model.restoreSession(summary)}
                            >
                                <i className="fa-sharp fa-solid fa-square-terminal" />
                                <span>{restoring ? "Resuming..." : "Resume"}</span>
                            </button>
                            <CopyIconButton text={restoreCommandForSession(summary)} label="Copy resume command" />
                            <IconButton
                                icon="fa-trash"
                                label="Delete session"
                                className={deleteConfirmOpen ? "border-error text-error" : ""}
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(true)}
                            />
                            <IconButton
                                icon="fa-tag"
                                label={noteCollapsed ? "Expand note" : "Collapse note"}
                                className={cn(
                                    summary.note && "border-accent/40 bg-accent/10 text-accent",
                                    !noteCollapsed && "border-accent text-accent"
                                )}
                                onClick={() => setNoteCollapsed((current) => !current)}
                            />
                            {summary.note ? (
                                <div
                                    className="min-w-0 flex-1 truncate border-l border-accent/40 pl-2 text-xs text-secondary"
                                    title={summary.note}
                                >
                                    {summary.note}
                                </div>
                            ) : null}
                        </div>
                        {deleteConfirmOpen ? (
                            <div className="mt-2 flex items-center justify-between gap-3 rounded border border-error/40 bg-error/10 px-2 py-2 text-xs">
                                <div className="min-w-0 text-error">
                                    Delete this session? The source file will be moved to deleted storage.
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        className="h-7 rounded border border-border px-2 text-secondary hover:bg-hover hover:text-primary"
                                        disabled={deleting}
                                        onClick={() => setDeleteConfirmOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="flex h-7 items-center gap-2 rounded border border-error bg-error px-2 text-white disabled:opacity-60"
                                        disabled={deleting}
                                        onClick={() => void model.deleteSession(summary)}
                                    >
                                        <i
                                            className={cn(
                                                "fa-sharp fa-solid",
                                                deleting ? "fa-spinner animate-spin" : "fa-trash"
                                            )}
                                        />
                                        <span>{deleting ? "Deleting..." : "Delete"}</span>
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        {!noteCollapsed ? (
                            <div className="mt-2 space-y-2 rounded border border-border bg-bg/40 px-2 py-2">
                                <textarea
                                    className="min-h-[72px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
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
                                        label={noteStatusText || "Save note"}
                                        disabled={noteSaving || noteUnchanged}
                                        className={cn(
                                            noteSaveStatus === "saved" && "border-accent bg-accent/10 text-accent",
                                            noteSaveStatus === "error" && "border-error bg-error/10 text-error"
                                        )}
                                        onClick={() => void saveNote(trimmedNoteDraft)}
                                    />
                                    <IconButton
                                        icon="fa-eraser"
                                        label="Clear note"
                                        disabled={noteSaving || (!summary.note && noteDraft.trim() === "")}
                                        onClick={() => {
                                            setNoteDraft("");
                                            void saveNote("");
                                        }}
                                    />
                                    <span
                                        className={cn(
                                            "min-w-[64px] text-[11px] text-secondary",
                                            noteSaveStatus === "saved" && "text-accent",
                                            noteSaveStatus === "error" && "text-error"
                                        )}
                                        aria-live="polite"
                                    >
                                        {noteStatusText}
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                        <button
                            className={cn(
                                "h-7 w-7 shrink-0 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary",
                                summary.marked && "border-accent bg-accent/10 text-accent"
                            )}
                            title={summary.marked ? "Unmark session" : "Mark session"}
                            aria-label={summary.marked ? "Unmark session" : "Mark session"}
                            onClick={() => void model.toggleMark(summary)}
                        >
                            <i className={cn("fa-sharp", summary.marked ? "fa-solid fa-star" : "fa-regular fa-star")} />
                        </button>
                        <IconButton
                            icon={loading ? "fa-spinner animate-spin" : "fa-rotate"}
                            label="Refresh session detail"
                            disabled={loading}
                            onClick={() => void model.loadDetail(summary, true)}
                        />
                    </div>
                </div>
            </div>
            <div className="relative min-h-0 flex-1">
                <div className={cn("flex h-full min-h-0", outlineOpen && "pr-0")}>
                    <div ref={detailScrollRef} className="min-h-0 flex-1 overflow-auto p-3">
                        {detailMessages.length === 0 ? (
                            <EmptyState text="No readable messages." />
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2 text-xs text-secondary">
                                    <div>
                                        Showing #{firstVisibleMessage?.seq ?? 0}-#{lastVisibleMessage?.seq ?? 0} of{" "}
                                        {readableMessages.length}
                                    </div>
                                    {hasPreviousMessages ? (
                                        <button
                                            className="h-7 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                            onClick={loadPreviousMessages}
                                        >
                                            Load previous messages
                                        </button>
                                    ) : (
                                        <div className="text-xxs uppercase text-secondary">Start reached</div>
                                    )}
                                </div>
                                {detailMessages.map((message) => (
                                    <MessageCard
                                        key={message.seq}
                                        message={message}
                                        collapsed={Boolean(collapsedMessages[message.seq])}
                                        onToggleCollapsed={() => toggleMessageCollapsed(message.seq)}
                                        registerRef={(node) => {
                                            messageRefs.current[message.seq] = node;
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    {outlineOpen ? (
                        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-panel">
                            <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
                                <div className="text-xxs uppercase text-secondary">Outline</div>
                                <IconButton
                                    icon="fa-chevron-right"
                                    label="Collapse outline"
                                    onClick={() => setOutlineOpen(false)}
                                />
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto p-2">
                                {outlineMessages.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-secondary">No readable messages.</div>
                                ) : (
                                    <div className="space-y-1">
                                        {outlineMessages.map((message, index) => (
                                            <button
                                                key={message.seq}
                                                className={cn(
                                                    "flex w-full items-start gap-2 rounded border px-2 py-2 text-left text-xs hover:bg-hover",
                                                    outlineRoleClass(message)
                                                )}
                                                onClick={() => jumpToMessage(message.seq)}
                                            >
                                                <span className="mt-0.5 shrink-0 text-[10px] uppercase text-secondary">
                                                    {index + 1}
                                                </span>
                                                <span className="min-w-0 flex-1 break-words text-primary">
                                                    {outlinePreview(message)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </aside>
                    ) : (
                        <button
                            className="absolute right-3 top-3 z-10 flex h-10 items-center gap-2 rounded-full border border-border bg-panel px-3 text-xs text-primary shadow-lg hover:bg-hover"
                            title="Outline"
                            aria-label="Outline"
                            onClick={() => setOutlineOpen(true)}
                        >
                            <i className="fa-sharp fa-solid fa-list" />
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                                {outlineMessages.length}
                            </span>
                        </button>
                    )}
                </div>
            </div>
            {loading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/70 backdrop-blur-[1px]">
                    <div className="rounded border border-border bg-bg px-3 py-2 text-xs text-secondary shadow-lg">
                        Loading session detail...
                    </div>
                </div>
            ) : null}
        </div>
    );
}
