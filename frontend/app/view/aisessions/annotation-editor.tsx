// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 批注编辑器（Modal）。一条消息可有多条批注。
//
// 焦点说明：Modal 由 app 级 modalModel 之外的本组件直接渲染在 session-detail
// 内部时，点击会冒泡到 block frame。这里沿用 note 弹窗的结论：所有交互元素
// stopPropagation，Modal 自带 backdrop 关闭。

import { Modal } from "@/app/modals/modal";
import { cn } from "@/util/util";
import * as React from "react";
import { deleteAnnotation, saveAnnotation } from "./annotation-store";
import { normalizeSessionTags } from "./session-tags";

const KindOptions = [
    { value: "note", label: "Note" },
    { value: "milestone", label: "Milestone" },
    { value: "decision", label: "Decision" },
    { value: "question", label: "Question" },
] as const;

export function AnnotationEditor({
    sessionKey,
    connection,
    seq,
    anchorKey,
    annotation = null,
    onClose,
    onSaved,
}: {
    sessionKey: string;
    connection?: string;
    seq: number;
    anchorKey: string;
    annotation?: AnnotationView | null;
    onClose: () => void;
    onSaved?: () => void;
}) {
    const [kind, setKind] = React.useState(annotation?.kind ?? "note");
    const [title, setTitle] = React.useState(annotation?.title ?? "");
    const [body, setBody] = React.useState(annotation?.body ?? "");
    const [tagsText, setTagsText] = React.useState((annotation?.tags ?? []).join(" "));
    const [saving, setSaving] = React.useState(false);
    const [deleting, setDeleting] = React.useState(false);
    const [error, setError] = React.useState("");

    const handleSave = React.useCallback(async () => {
        if (saving) return;
        const tags = normalizeSessionTags(
            tagsText
                .split(/[\s,，]+/)
                .map((tag) => tag.replace(/^#+/, "").trim())
                .filter(Boolean)
        );
        if (title.trim() === "" && body.trim() === "" && tags.length === 0) {
            setError("Add a title, body or tag first.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            await saveAnnotation({
                id: annotation?.id,
                sessionKey,
                anchorKey,
                seq,
                kind,
                title: title.trim(),
                body: body.trim(),
                tags,
                status: annotation?.status ?? "accepted",
                source: annotation?.source ?? "user",
                connection: connection?.trim() || undefined,
            });
            onSaved?.();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }, [anchorKey, annotation, body, connection, kind, onClose, onSaved, saving, seq, sessionKey, tagsText, title]);

    const handleDelete = React.useCallback(async () => {
        if (annotation == null || deleting) return;
        setDeleting(true);
        setError("");
        try {
            await deleteAnnotation(annotation.id, sessionKey, connection);
            onSaved?.();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDeleting(false);
        }
    }, [annotation, connection, deleting, onClose, onSaved, sessionKey]);

    return (
        <Modal className="w-[min(560px,calc(100vw-32px))]" onClose={onClose} onClickBackdrop={onClose}>
            <div className="space-y-3 text-primary" data-row-action="true" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-2 pr-7">
                    <div className="text-base font-semibold">{annotation ? "Edit annotation" : "Add annotation"}</div>
                    <span className="text-[10px] text-secondary">#{seq}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {KindOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={cn(
                                "h-6 rounded-full border px-2 text-[10px] transition-colors",
                                kind === option.value
                                    ? "border-accent/60 bg-accent/15 text-accent"
                                    : "border-border text-secondary hover:bg-hover hover:text-primary"
                            )}
                            onClick={() => setKind(option.value)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <input
                    autoFocus
                    className="h-8 w-full rounded border border-border bg-transparent px-2 text-sm outline-none focus:border-accent"
                    placeholder="Title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <textarea
                    className="min-h-[140px] w-full resize-y rounded border border-border bg-transparent px-3 py-2 text-sm leading-5 outline-none focus:border-accent"
                    placeholder="Annotation body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                />
                <input
                    className="h-8 w-full rounded border border-border bg-transparent px-2 text-xs outline-none focus:border-accent"
                    placeholder="tags (space separated, # optional)"
                    value={tagsText}
                    onChange={(event) => setTagsText(event.target.value)}
                />
                {error ? (
                    <div className="rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px] text-error">
                        {error}
                    </div>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                    {annotation != null ? (
                        <button
                            type="button"
                            className="h-8 rounded border border-error/40 px-3 text-xs text-error hover:bg-error/10 disabled:opacity-60"
                            disabled={deleting || saving}
                            onClick={() => void handleDelete()}
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary"
                            disabled={saving || deleting}
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="h-8 rounded bg-action px-3 text-xs text-actiontext hover:bg-actionhover disabled:opacity-60"
                            disabled={saving || deleting}
                            onClick={() => void handleSave()}
                        >
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
