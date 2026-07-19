// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { atoms } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useMemo, useState } from "react";
import { copyCommonText } from "./commontext-insert";
import {
    type CommonTextItem,
    deleteCommonTextItem,
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    normalizeCommonTextTags,
    searchCommonTextItems,
    upsertCommonTextItem,
} from "./commontext-model";
import { CommonTextTagChip, CommonTextTagList } from "./commontext-tags";

type EditingState = {
    id?: string;
    title: string;
    text: string;
    tags: string;
    pinned: boolean;
};

function makeEmptyDraft(): EditingState {
    return {
        title: "",
        text: "",
        tags: "",
        pinned: false,
    };
}

function makeEditingDraft(item: CommonTextItem): EditingState {
    return {
        id: item.id,
        title: item.title,
        text: item.text,
        tags: (item.tags ?? []).join(", "),
        pinned: item.pinned === true,
    };
}

function formatDate(ts?: number): string {
    if (!ts) {
        return "";
    }
    return new Date(ts).toLocaleString();
}

const CommonTextManagerContent = memo(() => {
    const settings = useAtomValue(atoms.settingsAtom);
    const items = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<EditingState>(() => makeEmptyDraft());
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const filteredItems = useMemo(() => searchCommonTextItems(items, query, 500), [items, query]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(items), [items]);
    const editingTags = useMemo(() => normalizeCommonTextTags(editing.tags), [editing.tags]);
    const selectedId = editing.id;
    const canSave = editing.text.trim() !== "";

    const resetDraft = () => {
        setEditing(makeEmptyDraft());
        setError("");
        setMessage("");
    };

    const saveDraft = async () => {
        setError("");
        setMessage("");
        try {
            const saved = await upsertCommonTextItem(
                {
                    title: editing.title,
                    text: editing.text,
                    tags: editing.tags.split(","),
                    pinned: editing.pinned,
                },
                editing.id
            );
            setEditing(makeEditingDraft(saved));
            setMessage("Saved");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const deleteSelected = async () => {
        if (editing.id == null) {
            resetDraft();
            return;
        }
        if (!window.confirm("Delete this common text?")) {
            return;
        }
        await deleteCommonTextItem(editing.id);
        resetDraft();
        setMessage("Deleted");
    };

    const copySelected = async () => {
        if (editing.text.trim() === "") {
            return;
        }
        await copyCommonText(editing.text);
        setMessage("Copied");
    };

    const toggleEditingTag = (tag: string) => {
        setEditing((cur) => {
            const currentTags = normalizeCommonTextTags(cur.tags);
            const hasTag = currentTags.some((currentTag) => currentTag.toLowerCase() === tag.toLowerCase());
            const nextTags = hasTag
                ? currentTags.filter((currentTag) => currentTag.toLowerCase() !== tag.toLowerCase())
                : [...currentTags, tag];
            return { ...cur, tags: nextTags.join(", ") };
        });
    };

    return (
        <div className="@container flex h-full min-h-0 w-full flex-col bg-background">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <div className="text-lg font-semibold">Common Text</div>
                    <div className="text-xs text-secondary">{items.length} saved</div>
                </div>
                <button
                    type="button"
                    className="h-8 px-3 rounded bg-action text-actiontext hover:bg-actionhover transition-colors cursor-pointer"
                    onClick={resetDraft}
                >
                    <i className="fa fa-solid fa-plus mr-1" />
                    New
                </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,320px)_1fr] @max-w600:grid-cols-1">
                <div className="flex min-h-0 flex-col border-r border-border @max-w600:border-r-0 @max-w600:border-b">
                    <div className="p-3">
                        <InputGroup>
                            <Input value={query} onChange={setQuery} placeholder="Search common text" />
                            <InputRightElement>
                                <i className="fa-regular fa-magnifying-glass" />
                            </InputRightElement>
                        </InputGroup>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {filteredItems.length === 0 ? (
                            <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-4 text-center text-secondary">
                                <i className="fa fa-regular fa-quote-left text-2xl opacity-60" />
                                <div>{items.length === 0 ? "No common text yet" : "No matching text"}</div>
                            </div>
                        ) : (
                            <div className="divide-y divide-border">
                                {filteredItems.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={cn(
                                            "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                                            selectedId === item.id ? "bg-highlightbg" : "hover:bg-hoverbg"
                                        )}
                                        onClick={() => {
                                            setEditing(makeEditingDraft(item));
                                            setError("");
                                            setMessage("");
                                        }}
                                    >
                                        <div className="mt-0.5 w-4 text-secondary">
                                            {item.pinned ? (
                                                <i className="fa fa-solid fa-thumbtack text-[11px]" />
                                            ) : null}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate font-medium">{item.title}</div>
                                            {(item.tags?.length ?? 0) > 0 && (
                                                <div className="mt-1">
                                                    <CommonTextTagList tags={item.tags} maxVisible={3} compact />
                                                </div>
                                            )}
                                            <div className="truncate text-xs text-secondary">
                                                {item.text.replace(/\s+/g, " ")}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="min-h-0 overflow-y-auto p-4">
                    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
                        <div className="grid grid-cols-1 gap-3">
                            <label className="flex flex-col gap-1 text-sm">
                                <span className="text-secondary">Title</span>
                                <input
                                    className="h-9 rounded border border-border bg-background px-3 outline-none focus:border-accent"
                                    value={editing.title}
                                    onChange={(e) => setEditing((cur) => ({ ...cur, title: e.target.value }))}
                                    placeholder="Display name"
                                />
                            </label>
                        </div>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-secondary">Text</span>
                            <textarea
                                className="min-h-[220px] resize-y rounded border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                                value={editing.text}
                                onChange={(e) => setEditing((cur) => ({ ...cur, text: e.target.value }))}
                                placeholder="Save a reusable phrase, template, command, or reply."
                            />
                        </label>
                        <div className="grid grid-cols-[1fr_auto] items-end gap-3 @max-w600:grid-cols-1">
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
                                            onClick={() => toggleEditingTag(tagSummary.tag)}
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
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-secondary">
                                {editing.id
                                    ? `Updated ${formatDate(items.find((item) => item.id === editing.id)?.updatedat)}`
                                    : "New common text"}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="h-8 px-3 rounded border border-border text-secondary hover:bg-hoverbg hover:text-primary"
                                    onClick={() => fireAndForget(copySelected)}
                                    disabled={editing.text.trim() === ""}
                                >
                                    <i className="fa fa-regular fa-copy mr-1" />
                                    Copy
                                </button>
                                <button
                                    type="button"
                                    className="h-8 px-3 rounded border border-border text-secondary hover:bg-hoverbg hover:text-primary"
                                    onClick={() => fireAndForget(deleteSelected)}
                                >
                                    <i className="fa fa-regular fa-trash-can mr-1" />
                                    Delete
                                </button>
                                <button
                                    type="button"
                                    className="h-8 px-3 rounded bg-action text-actiontext hover:bg-actionhover disabled:opacity-50 cursor-pointer disabled:cursor-default"
                                    onClick={() => fireAndForget(saveDraft)}
                                    disabled={!canSave}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

CommonTextManagerContent.displayName = "CommonTextManagerContent";

export { CommonTextManagerContent };
