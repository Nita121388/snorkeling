// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { dispatchAISessionNoteUpdated } from "@/app/view/aisessions/session-note-events";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "@/app/view/aisessions/session-note-autosave";
import { SessionTagChips } from "@/app/view/aisessions/session-tag-chips";
import { extractSessionTagsFromNote, mergeSessionTags, sessionTagsEqual } from "@/app/view/aisessions/session-tags";
import { shortSessionId } from "@/app/view/aisessions/utils";
import { cn } from "@/util/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

type AISessionNoteModalProps = {
    sessionId: string;
};

function AISessionNoteModal({ sessionId }: AISessionNoteModalProps) {
    const service = useMemo(() => new AISessionsServiceType(), []);
    const [summary, setSummary] = useState<SessionSummary | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("idle");
    const latestDraftRef = useRef("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        service
            .Summary({ id: sessionId })
            .then((nextSummary) => {
                if (cancelled) return;
                setSummary(nextSummary);
                setNoteDraft(nextSummary.note ?? "");
                latestDraftRef.current = nextSummary.note ?? "";
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [service, sessionId]);

    useEffect(() => {
        if (saveStatus !== "saved" && saveStatus !== "error") return;
        const handle = window.setTimeout(() => setSaveStatus("idle"), saveStatus === "saved" ? 1200 : 1800);
        return () => window.clearTimeout(handle);
    }, [saveStatus]);

    const saveNote = useCallback(
        async (nextNote: string): Promise<boolean> => {
            if (summary == null || saveStatus === "saving") return false;
            const parsed = extractSessionTagsFromNote(nextNote);
            const tags = mergeSessionTags(summary.tags ?? [], parsed.tags);
            if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                setError("");
                return true;
            }
            setSaveStatus("saving");
            setError("");
            try {
                const updated = await service.NoteAndTags({ id: summary.key, note: parsed.note, tags });
                const currentDraftSaved = extractSessionTagsFromNote(latestDraftRef.current).note === parsed.note;
                setSummary((current) => (current?.key === updated.key ? { ...current, ...updated } : current));
                if (currentDraftSaved) {
                    setNoteDraft(updated.note ?? "");
                    latestDraftRef.current = updated.note ?? "";
                }
                setSaveStatus(currentDraftSaved ? "saved" : "idle");
                dispatchAISessionNoteUpdated(updated);
                return currentDraftSaved;
            } catch (e) {
                setSaveStatus("error");
                setError(e instanceof Error ? e.message : String(e));
                return false;
            }
        },
        [saveStatus, service, summary]
    );

    const currentNote = summary?.note ?? "";
    const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(summary?.tags ?? [], parsedNoteDraft.tags);
    const trimmedNoteDraft = noteDraft.trim();
    const noteUnchanged = parsedNoteDraft.note === currentNote && sessionTagsEqual(nextTags, summary?.tags);
    const saving = saveStatus === "saving";
    const title = summary?.title || summary?.id || sessionId;
    const closeModal = useCallback(() => {
        if (saving) return;
        if (summary != null && !saving && !noteUnchanged) {
            void saveNote(trimmedNoteDraft).then((saved) => {
                if (saved) {
                    modalsModel.popModal();
                }
            });
            return;
        }
        modalsModel.popModal();
    }, [noteUnchanged, saveNote, saving, summary, trimmedNoteDraft]);

    useEffect(() => {
        if (
            !shouldAutoSaveNote({
                loaded: summary != null,
                visible: true,
                unchanged: noteUnchanged,
                saving,
            })
        ) {
            return;
        }
        const handle = window.setTimeout(() => void saveNote(trimmedNoteDraft), NoteAutoSaveDelayMs);
        return () => window.clearTimeout(handle);
    }, [noteUnchanged, saveNote, saving, summary, trimmedNoteDraft]);

    const statusText =
        saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "saved"
              ? "Saved"
              : saveStatus === "error"
                ? "Save failed"
                : !noteUnchanged
                  ? "Unsaved changes"
                  : "";

    return (
        <Modal className="w-[520px] max-w-[calc(100vw-32px)]" onClose={closeModal} onClickBackdrop={closeModal}>
            <div className="space-y-3 text-primary">
                <div className="space-y-1 pr-7">
                    <div className="text-base font-semibold">Session Note</div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-secondary">
                        {summary?.source ? (
                            <span className="rounded border border-border px-1.5 py-0.5 uppercase">
                                {summary.source}
                            </span>
                        ) : null}
                        <span className="min-w-0 truncate">{title}</span>
                        <span className="shrink-0">ID: {shortSessionId(summary?.id ?? sessionId)}</span>
                    </div>
                </div>
                {loading ? (
                    <div className="flex h-28 items-center justify-center gap-2 text-sm text-secondary">
                        <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                        <span>Loading note...</span>
                    </div>
                ) : summary == null ? (
                    <div className="rounded border border-error/40 bg-error/10 p-3 text-sm text-error">
                        {error || "Session not found."}
                    </div>
                ) : (
                    <>
                        {error ? (
                            <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error">
                                {error}
                            </div>
                        ) : null}
                        <SessionTagChips tags={nextTags} />
                        <textarea
                            className="min-h-[140px] w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                            placeholder="Add a note, use #tag to add tags"
                            value={noteDraft}
                            onChange={(e) => {
                                latestDraftRef.current = e.target.value;
                                setNoteDraft(e.target.value);
                                setError("");
                                if (saveStatus !== "saving") {
                                    setSaveStatus("idle");
                                }
                            }}
                            onBlur={() => {
                                if (!noteUnchanged && !saving) {
                                    void saveNote(trimmedNoteDraft);
                                }
                            }}
                        />
                        <div className="flex items-center justify-between gap-3">
                            <span
                                className={cn(
                                    "min-w-[72px] text-xs text-secondary",
                                    saveStatus === "saved" && "text-accent",
                                    saveStatus === "error" && "text-error"
                                )}
                                aria-live="polite"
                            >
                                {statusText}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                                    disabled={saving}
                                    onClick={closeModal}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

AISessionNoteModal.displayName = "AISessionNoteModal";

export { AISessionNoteModal };
