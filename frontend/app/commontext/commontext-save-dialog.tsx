// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { SessionTagChips } from "@/app/view/aisessions/session-tag-chips";
import { extractSessionTagsFromNote, removeSessionTagFromNote } from "@/app/view/aisessions/session-tags";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OpenCommonTextSaveDialogEvent, type CommonTextSaveDialogDetail } from "./commontext-events";
import {
    type CommonTextItem,
    findDuplicateCommonText,
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    normalizeCommonTextTags,
    upsertCommonTextItem,
} from "./commontext-model";

type EditingState = {
    existingId?: string;
    title: string;
    text: string;
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
    // 历史可能把 tag 独立存进 `existing.tags` 而没写进 text。迁移方式：若是已有 item
    // 且 text 里没体现这些 tag，把它们以 `#tag` 串追加到 text 末尾，让 Text 成为唯一
    // 真相源（保存时 tags 完全由 text 派生）。
    let migratedText = text;
    if (existing != null) {
        const existingTags = normalizeCommonTextTags(existing.tags ?? []);
        const presentTags = new Set(
            extractSessionTagsFromNote(text).tags.map((t) => t.toLowerCase())
        );
        const missing = existingTags.filter((t) => !presentTags.has(t.toLowerCase()));
        if (missing.length > 0) {
            const sep = migratedText.length > 0 && !/\s$/.test(migratedText) ? "\n" : "";
            migratedText = `${migratedText}${sep}${missing.map((t) => `#${t}`).join(" ")}`;
        }
    }
    const pinned = existing?.pinned === true;
    return {
        state: { existingId: detail.existingId, title, text: migratedText, pinned },
        existingItem: existing,
    };
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
        pinned: false,
    }));
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);
    const autoCloseTimerRef = useRef<number | null>(null);

    const settings = useAtomValue(atoms.settingsAtom);
    const items = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(items), [items]);
    // tags 由 text 派生，保存与渲染共用同一提取器（extractSessionTagsFromNote），
    // 保证"看到什么 chip 就存什么 tag"，无第二套过滤规则干扰。
    const editingTags = useMemo(() => extractSessionTagsFromNote(editing.text).tags, [editing.text]);
    // All tags 面板改用 SessionTagChips：与 "Tags parsed from text" / session Note 同款样式。
    // countMap = tag(lower) -> count，让 chip 末尾能渲染计数副标。
    const allTagsCountMap = useMemo(() => {
        const m = new Map<string, number>();
        for (const s of tagSummaries) m.set(s.tag.toLowerCase(), s.count);
        return m;
    }, [tagSummaries]);
    const allTagsList = useMemo(() => tagSummaries.map((s) => s.tag), [tagSummaries]);
    const canSave = editing.text.trim() !== "" && !saving;

    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<CommonTextSaveDialogDetail>).detail ?? {};
            const { state } = buildInitialState(detail, getCommonTextItemsFromSettings(settings));
            if (autoCloseTimerRef.current != null) {
                window.clearTimeout(autoCloseTimerRef.current);
                autoCloseTimerRef.current = null;
            }
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

    useEffect(() => {
        return () => {
            if (autoCloseTimerRef.current != null) {
                window.clearTimeout(autoCloseTimerRef.current);
                autoCloseTimerRef.current = null;
            }
        };
    }, []);

    if (!open) return null;

    const close = () => setOpen(false);

    // 点击 All tags 面板里的 chip：若 text 已含此 tag 则用 removeSessionTagFromNote
    // 把它从 text 里抹掉，否则在 text 末尾追加 `#tag`。这样 tags 始终由 text 唯一决定。
    const toggleTag = (tag: string) => {
        setEditing((cur) => {
            const present = extractSessionTagsFromNote(cur.text).tags.some(
                (t) => t.toLowerCase() === tag.toLowerCase()
            );
            if (present) {
                return { ...cur, text: removeSessionTagFromNote(cur.text, tag) };
            }
            const sep = cur.text.length > 0 && !/\s$/.test(cur.text) ? " " : "";
            return { ...cur, text: `${cur.text}${sep}#${tag}` };
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
        const tags = extractSessionTagsFromNote(text).tags;
        setSaving(true);
        try {
            await upsertCommonTextItem(
                {
                    title: editing.title,
                    text,
                    tags,
                    pinned: editing.pinned,
                },
                editing.existingId
            );
            setMessage("Saved");
            if (autoCloseTimerRef.current != null) {
                window.clearTimeout(autoCloseTimerRef.current);
            }
            autoCloseTimerRef.current = window.setTimeout(() => {
                autoCloseTimerRef.current = null;
                setOpen(false);
            }, 600);
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
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 h-9 rounded border border-border bg-background px-3 outline-none focus:border-accent"
                            value={editing.title}
                            onChange={(e) => setEditing((cur) => ({ ...cur, title: e.target.value }))}
                            placeholder="Display name (defaults to first line of text)"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setEditing((cur) => ({ ...cur, pinned: !cur.pinned }))}
                            title={editing.pinned ? "Unpin this text to the top of the list" : "Pin this text to the top of the list"}
                            className={
                                "shrink-0 w-9 h-9 flex items-center justify-center rounded border transition-colors cursor-pointer " +
                                (editing.pinned
                                    ? "border-accent bg-highlightbg text-accent"
                                    : "border-border text-secondary hover:border-accent/70 hover:text-primary")
                            }
                        >
                            <i className="fa fa-solid fa-thumbtack text-[13px]" />
                        </button>
                    </div>
                </label>

                <div className="flex flex-col gap-1 text-sm">
                    <span className="text-secondary">Text</span>
                    <SessionTagChips
                        tags={editingTags}
                        className="min-h-[1.5rem]"
                    />
                    <textarea
                        className="min-h-[160px] resize-y rounded border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                        value={editing.text}
                        onChange={(e) => setEditing((cur) => ({ ...cur, text: e.target.value }))}
                        placeholder="Save a reusable phrase, template, command, or reply. Use #tag to add tags."
                        spellCheck={false}
                    />
                </div>

                {tagSummaries.length > 0 && (
                    <div className="flex flex-col gap-2 rounded border border-border bg-background/40 p-3">
                        <div className="text-xs font-medium uppercase text-secondary">All tags</div>
                        <div className="max-h-24 overflow-y-auto">
                            <SessionTagChips
                                tags={allTagsList}
                                selectedTags={editingTags}
                                countMap={allTagsCountMap}
                                onClick={toggleTag}
                            />
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
