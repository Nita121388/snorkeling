// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Sync conflict drawer — the paste-back half of Copy for Agent.
//
// 出口（复制给 AI 合并）走 <CopyForAgent>：单条冲突用 SyncConflictCopy(id)（Go 端渲染，
// 与 CLI 逐字节一致）；回程（粘回合并文本）走 SyncResolve(id, text)，成功后该条消失。
// 全程不离开设置面板，不再要求用户切终端跑 `wsh commontext-sync resolve`。

import { CopyForAgent } from "@/app/element/copy-for-agent";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { CommonTextService } from "@/app/store/services";
import { cn, fireAndForget } from "@/util/util";
import { useCallback, useEffect, useState } from "react";

/** RFC3339 → readable local time; unparseable input falls back to the raw string. */
function formatDetected(rfc3339: string): string {
    const ts = Date.parse(rfc3339);
    if (Number.isNaN(ts)) return rfc3339;
    return new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** One conflict: meta line + per-conflict copy + paste-back resolve. */
function ConflictRow({
    conflict,
    onResolved,
}: {
    conflict: Entry;
    onResolved: () => void;
}) {
    const [mergedText, setMergedText] = useState("");
    const [resolving, setResolving] = useState(false);
    const [error, setError] = useState("");

    const resolve = useCallback(() => {
        if (resolving) return;
        if (mergedText.trim() === "") {
            setError("Paste the merged text first — empty resolves go through the UI.");
            return;
        }
        setResolving(true);
        setError("");
        fireAndForget(async () => {
            try {
                await CommonTextService.SyncResolve({ id: conflict.id, text: mergedText });
                onResolved();
            } catch (err) {
                // Readable failure beats silent: the conflict stays in the list either way.
                setError(err instanceof Error ? err.message : String(err));
                setResolving(false);
            }
        });
    }, [conflict.id, mergedText, onResolved, resolving]);

    const title = conflict.title || "(untitled)";
    const meta = [
        conflict.deviceName ? `from ${conflict.deviceName}` : null,
        `detected ${formatDetected(conflict.detectedAt)}`,
        conflict.fields?.length > 0 ? `fields: ${conflict.fields.join(", ")}` : null,
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <div
            data-sync-conflict-row={conflict.id}
            className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-primary">{title}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{conflict.id}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
                </div>
                <CopyForAgent
                    title={`Copy this conflict for an AI to merge`}
                    text={async () => {
                        const resp = await CommonTextService.SyncConflictCopy({ id: conflict.id });
                        return resp?.text ?? "";
                    }}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <textarea
                    value={mergedText}
                    onChange={(e) => {
                        setMergedText(e.target.value);
                        setError("");
                    }}
                    placeholder="Paste the merged text from the AI here…"
                    aria-label={`Merged text for ${title}`}
                    data-sync-merged-input={conflict.id}
                    spellCheck={false}
                    className="h-24 w-full resize-y rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-primary outline-none transition-colors focus:border-accent"
                />
                <div className="flex items-center justify-between gap-2">
                    {error ? (
                        <span className="text-xs text-error" data-sync-resolve-error={conflict.id}>
                            {error}
                        </span>
                    ) : (
                        <span className="text-xs text-muted-foreground">
                            Resolving writes the merged text and marks this conflict resolved.
                        </span>
                    )}
                    <button
                        type="button"
                        data-sync-resolve-action={conflict.id}
                        disabled={resolving}
                        onClick={resolve}
                        className={cn(
                            "h-7 shrink-0 rounded px-3 text-xs transition-colors",
                            resolving
                                ? "cursor-default opacity-50"
                                : "cursor-pointer bg-action text-actiontext hover:bg-actionhover"
                        )}
                    >
                        {resolving ? "Resolving…" : "Resolve"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export const SyncConflictModal = ({ onResolved }: { onResolved?: () => void }) => {
    const [conflicts, setConflicts] = useState<Entry[] | null>(null);
    const [loadError, setLoadError] = useState("");

    const load = useCallback(() => {
        fireAndForget(async () => {
            try {
                const resp = await CommonTextService.SyncConflicts();
                setConflicts(resp?.conflicts ?? []);
                setLoadError("");
            } catch (err) {
                setLoadError(err instanceof Error ? err.message : String(err));
            }
        });
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleResolved = useCallback(() => {
        // Refresh both the list and the settings panel's live status counter.
        load();
        onResolved?.();
    }, [load, onResolved]);

    return (
        <Modal
            className="w-[560px] max-w-[calc(100vw-32px)]"
            title="Unresolved sync conflicts"
            subtitle="Copy a conflict to an AI, then paste the merged text back and resolve."
            onClose={() => modalsModel.popModal()}
            onClickBackdrop={() => modalsModel.popModal()}
            padding={false}
        >
            <div className="max-h-[60vh] overflow-auto" data-sync-conflict-modal="">
                {loadError != "" && (
                    <div className="px-4 py-6 text-center text-xs text-error">{loadError}</div>
                )}
                {loadError == "" && conflicts == null && (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
                )}
                {loadError == "" && conflicts != null && conflicts.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        Nothing to resolve — all conflicts are cleared.
                    </div>
                )}
                {loadError == "" &&
                    conflicts?.map((c) => <ConflictRow key={c.id} conflict={c} onResolved={handleResolved} />)}
            </div>
        </Modal>
    );
};

SyncConflictModal.displayName = "SyncConflictModal";
