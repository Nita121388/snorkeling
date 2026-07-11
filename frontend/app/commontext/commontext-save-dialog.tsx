// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { OpenCommonTextSaveDialogEvent, type CommonTextSaveDialogDetail } from "./commontext-events";
import {
    type CommonTextItem,
    findDuplicateCommonText,
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    normalizeCommonTextTags,
    upsertCommonTextItem,
} from "./commontext-model";
import { CommonTextTagChip, CommonTextTagList } from "./commontext-tags";

type EditingState = {
    existingId?: string;
    title: string;
    text: string;
    tags: string;
    pinned: boolean;
};

function buildInitialState(
    detail: CommonTextSaveDialogDetail,
    items: CommonTextItem[]
): { state: EditingState; existingItem?: CommonTextItem } {
    const text = detail.text ?? "";
    const existing = detail.existingId != null ? items.find((item) => item.id === detail.existingId) : undefined;
    const title =
        detail.title ??
        (existing?.title ?? (text.trim() === "" ? "" : deriveTitleFromText(text)));
    const tags = existing != null ? (existing.tags ?? []).join(", ") : "";
    const pinned = existing?.pinned === true;
    return { state: { existingId: detail.existingId, title, text, tags, pinned }, existingItem: existing };
}

function deriveTitleFromText(text: string): string {
    const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== "");
    if (!firstLine) return "";
    return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
}

const CommonTextSaveDialog = memo(() => {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<EditingState>(() => ({
        title: "",
        text: "",
        tags: "",
        pinned: false,
    }));
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);

    const settings = useAtomValue(atoms.settingsAtom);
    const items = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(items), [items]);
    const editingTags = useMemo(() => normalizeCommonTextTags(editing.tags), [editing.tags]);
    const canSave = editing.text.trim() !== "" && !saving;

    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<CommonTextSaveDialogDetail>).detail ?? {};
            const { state } = buildInitialState(detail, getCommonTextItemsFromSettings(settings));
            setEditing(state);
            setError("");
            setMessage("");
            setSaving(false);
            setOpen(true);
        };
        window.addEventListener(OpenCommonTextSaveDialogEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSaveDialogEvent, handleOpen);
        // settings is captured intentionally; we read it on event arrival via closure
    }, [settings]);

    if (!open) return null;

    const close = () => setOpen(false);

    const toggleTag = (tag: string) => {
        setEditing((cur) => {
            const currentTags = normalizeCommonTextTags(cur.tags);
            const hasTag = currentTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            const nextTags = hasTag
                ? currentTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                : [...currentTags, tag];
            return { ...cur, tags: nextTags.join(", ") };
        });
    };

    const handleSave = async () => {
        setError("");
        setMessage("");
        const text = editing.text;
        if (text.trim() === "") {
            setError("Text is empty.");
            return;
        }
        const dup = findDuplicateCommonText(items, text, editing.existingId);
        if (dup != null) {
            setError(`Already exists: ${dup.title}`);
            return;
        }
        setSaving(true);
        try {
            const saved = await upsertCommonTextItem(
                {
                    title: editing.title,
                    text,
                    tags: editing.tags.split(","),
                    pinned: editing.pinned,
                },
                editing.existingId
            );
            setEditing((cur) => ({ ...cur, existingId: saved.id }));
            setMessage("Saved");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            className={"w-[min(560px,calc(100vw-32px))] pt-6 pb-3"}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-3 p-1">
                <div className="flex items-center justify-between gap-3 pr-8">
                    <div className="text-base font-semibold">
                        {editing.existingId ? "Edit Common Text" : "Save Common Text"}
                    </div>
                </div>

                <label className="flex flex-col gap-1 text-sm">
                    <span className="text-secondary">Title</span>
                    <input
                        className="h-9 rounded border border-border bg-background px-3 outline-none focus:border-accent"
                        value={editing.title}
                        onChange={(e) => setEditing((cur) => ({ ...cur, title: e.target.value }))}
                        placeholder="Display name (defaults to first line of text)"
                        autoFocus
                    />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                    <span className="text-secondary">Text</span>
                    <textarea
                        className="min-h-[160px] resize-y rounded border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                        value={editing.text}
                        onChange={(e) => setEditing((cur) => ({ ...cur, text: e.target.value }))}
                        placeholder="Save a reusable phrase, template, command, or reply."
                        spellCheck={false}
                    />
                </label>

                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-secondary">Tags</span>
                        <input
                            className="h-9 rounded border border-border bg-background px-3 outline-none focus:border-accent"
                            value={editing.tags}
                            onChange={(e) => setEditing((cur) => ({ ...cur, tags: e.target.value }))}
                            placeholder="email, support"
                        />
                        {editingTags.length > 0 && (
                            <div className="mt-1">
                                <CommonTextTagList tags={editingTags} />
                            </div>
                        )}
                    </label>
                    <label className="flex h-9 items-center gap-2 text-sm text-secondary">
                        <input
                            type="checkbox"
                            checked={editing.pinned}
                            onChange={(e) => setEditing((cur) => ({ ...cur, pinned: e.target.checked }))}
                        />
                        Pinned
                    </label>
                </div>

                {tagSummaries.length > 0 && (
                    <div className="flex flex-col gap-2 rounded border border-border bg-background/40 p-3">
                        <div className="text-xs font-medium uppercase text-secondary">All tags</div>
                        <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1.5">
                            {tagSummaries.map((tagSummary) => (
                                <CommonTextTagChip
                                    key={tagSummary.tag}
                                    tag={tagSummary.tag}
                                    count={tagSummary.count}
                                    selected={editingTags.some(
                                        (tag) => tag.toLowerCase() === tagSummary.tag.toLowerCase()
                                    )}
                                    onClick={() => toggleTag(tagSummary.tag)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div className="min-h-5 text-sm">
                    {error ? (
                        <span className="text-error">{error}</span>
                    ) : message ? (
                        <span className="text-accent">{message}</span>
                    ) : null}
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button className="grey" onClick={close}>
                        Close
                    </Button>
                    <Button className="green" onClick={() => fireAndForget(handleSave)} disabled={!canSave}>
                        {editing.existingId ? "Update" : "Save"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
});

CommonTextSaveDialog.displayName = "CommonTextSaveDialog";

export { CommonTextSaveDialog };
