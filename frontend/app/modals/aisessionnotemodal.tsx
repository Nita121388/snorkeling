// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { dispatchAISessionNoteUpdated } from "@/app/view/aisessions/session-note-events";
import { shortSessionId } from "@/app/view/aisessions/utils";
import { cn } from "@/util/util";
import { useCallback, useEffect, useMemo, useState } from "react";

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

    const closeModal = useCallback(() => {
        modalsModel.popModal();
    }, []);

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
        async (nextNote: string) => {
            if (summary == null || saveStatus === "saving") return;
            setSaveStatus("saving");
            setError("");
            try {
                const updated = await service.Note(summary.key, nextNote.trim());
                setSummary({ ...summary, ...updated });
                setNoteDraft(updated.note ?? "");
                setSaveStatus("saved");
                dispatchAISessionNoteUpdated(updated);
            } catch (e) {
                setSaveStatus("error");
                setError(e instanceof Error ? e.message : String(e));
            }
        },
        [saveStatus, service, summary]
    );

    const currentNote = summary?.note ?? "";
    const trimmedNoteDraft = noteDraft.trim();
    const noteUnchanged = trimmedNoteDraft === currentNote;
    const saving = saveStatus === "saving";
    const title = summary?.title || summary?.id || sessionId;
    const statusText =
        saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "saved"
              ? "Saved"
              : saveStatus === "error"
                ? "Save failed"
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
                        <textarea
                            className="min-h-[140px] w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                            placeholder="Add a note"
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
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
                                    Cancel
                                </button>
                                <button
                                    className="flex h-8 items-center gap-2 rounded border border-accent bg-accent px-3 text-xs text-white hover:bg-accent/90 disabled:opacity-60"
                                    disabled={saving || noteUnchanged}
                                    onClick={() => void saveNote(trimmedNoteDraft)}
                                >
                                    <i
                                        className={cn(
                                            "fa-sharp fa-solid",
                                            saving ? "fa-spinner animate-spin" : "fa-floppy-disk"
                                        )}
                                    />
                                    <span>Save</span>
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
