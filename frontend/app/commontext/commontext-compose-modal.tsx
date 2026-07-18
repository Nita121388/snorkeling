// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { getBlockComponentModel, atoms } from "@/app/store/global";
import { blockComponentModelMap } from "@/app/store/global-atoms";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OpenCommonTextSearchEvent, openCommonTextSaveDialog, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, sendTextToFocusedTerm } from "./commontext-insert";
import {
    deleteCommonTextItem,
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextComposeItems,
    type CommonTextItem,
} from "./commontext-model";
import { CommonTextTagChip } from "./commontext-tags";

const LIST_LIMIT = 500;
const MAX_TAG_CHIPS = 16;

type ComposeState = {
    open: boolean;
    editor: string;
    editorCaret: number;
    manualQuery: string;
    selectedTags: string[];
    selectedIndex: number;
    insertedIds: string[];
    status: string;
    statusKind: "info" | "ok" | "err";
};

// 进程内草稿暂存：弹窗关闭后保留 editor 内容，下次无 query 打开时还原；重启进程即丢。
// 带 detail.query 的外部触发（如选区 overlay 复制场景）不取草稿，避免与外部文本冲突。
type ComposeDraft = Pick<ComposeState, "editor" | "editorCaret" | "insertedIds">;
let composeDraft: ComposeDraft | null = null;

const initialOpenState = (manualQuery = ""): ComposeState => ({
    open: true,
    editor: "",
    editorCaret: 0,
    manualQuery,
    selectedTags: [],
    selectedIndex: 0,
    insertedIds: [],
    status: "",
    statusKind: "info",
});

const restoreOpenState = (): ComposeState => {
    if (composeDraft == null) return initialOpenState();
    return {
        ...initialOpenState(),
        ...composeDraft,
    };
};

// Resolves the truly-active block of the focused layout node. Layout nodes use
// either `blockId` (single-block) or `blockIds` + `activeBlockId` (inline-tabs
// container holding several blocks) — `data.blockId` alone misses the latter, so
// we go through `getLayoutDataActiveBlockId`, the same helper `closeFocusedNode`
// / `keymodel` use. Returns the blockId only when it's a term view, else null.
// Drives the Send button's availability so users see it disabled up-front
// instead of clicking first, and feeds `sendTextToFocusedTerm` so Send doesn't
// route through the modal's own textarea.
const focusedTermBlockIdAtom = atom<string | null>((get) => {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) return null;
    const focusedNode = get(layoutModel.focusedNode);
    const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
    if (blockId == null) return null;
    const bcm = getBlockComponentModel(blockId);
    if (bcm?.viewModel?.viewType !== "term") return null;
    return blockId;
});

// All term-block ids visible in the current static tab. Used as a fallback chain
// when the focused block isn't a term (e.g. focus is on the AI panel, a file
// viewer, or the compose modal's own editor). Without this, "Send" silently
// failed whenever the user opened the modal without keeping focus on a terminal
// — modal focus moved to the textarea, so the user had no way to re-focus the
// term without closing the modal first.
const availableTermBlockIdsAtom = atom<string[]>((get) => {
    // preferred: the statically-tracked term belonging to the focused layout node
    const focusedTermId = get(focusedTermBlockIdAtom);
    const seen = new Set<string>();
    const out: string[] = [];
    // We don't have a layout-walk helper handy, so enumerate every block in the
    // app via the model map and keep the ones whose viewModel is a term. The
    // focused term (if any) is always first so "Send" defaults to the user's
    // most recently relevant terminal.
    if (focusedTermId != null) {
        out.push(focusedTermId);
        seen.add(focusedTermId);
    }
    for (const [blockId, bcm] of blockComponentModelMap.entries()) {
        if (blockId == null || seen.has(blockId)) continue;
        if (bcm?.viewModel?.viewType === "term") {
            out.push(blockId);
            seen.add(blockId);
        }
    }
    return out;
});

const CommonTextComposeModal = memo(() => {
    const [state, setState] = useState<ComposeState>(() => ({ ...initialOpenState(), open: false }));
    const settings = useAtomValue(atoms.settingsAtom);
    const availableTermBlockIds = useAtomValue(availableTermBlockIdsAtom);
    const canSendToTerm = availableTermBlockIds.length > 0;
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listScrollRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);
    const compositionEndTimerRef = useRef<number>(null);

    const allItems = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(allItems).slice(0, MAX_TAG_CHIPS), [allItems]);

    const filteredItems = useMemo(() => {
        if (!state.open) return [];
        return searchCommonTextComposeItems(allItems, state.editor, state.manualQuery, {
            limit: LIST_LIMIT,
            selectedTags: state.selectedTags,
            caret: state.editorCaret,
            insertedIds: state.insertedIds,
        });
    }, [
        allItems,
        state.editor,
        state.editorCaret,
        state.insertedIds,
        state.manualQuery,
        state.open,
        state.selectedTags,
    ]);

    // Compose Modal open/close wiring.
    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<CommonTextSearchDetail>).detail ?? {};
            const hasExternalQuery = (detail.query ?? "").trim() !== "";
            const manualQuery = detail.query ?? "";
            if (compositionEndTimerRef.current != null) {
                window.clearTimeout(compositionEndTimerRef.current);
                compositionEndTimerRef.current = null;
            }
            isComposingRef.current = false;
            // 外部带入 query（选区 overlay 找条目）走全新状态；纯打开尝试还原上次草稿。
            setState(hasExternalQuery ? initialOpenState(manualQuery) : restoreOpenState());
            requestAnimationFrame(() =>
                (manualQuery.trim() === "" ? editorRef.current : searchInputRef.current)?.focus()
            );
        };
        window.addEventListener(OpenCommonTextSearchEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSearchEvent, handleOpen);
    }, []);

    useEffect(() => {
        if (!state.open) return;
        if (state.selectedIndex >= filteredItems.length) {
            setState((cur) => ({ ...cur, selectedIndex: Math.max(0, filteredItems.length - 1) }));
        }
    }, [filteredItems.length, state.open, state.selectedIndex]);

    useEffect(() => {
        if (!state.open) return;
        listScrollRef.current?.scrollTo({ top: 0 });
    }, [state.editor, state.editorCaret, state.insertedIds, state.manualQuery, state.open, state.selectedTags]);

    useEffect(() => {
        if (!state.open) return;
        listScrollRef.current
            ?.querySelector(`[data-common-text-index="${state.selectedIndex}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [state.open, state.selectedIndex]);

    useEffect(() => {
        return () => {
            if (compositionEndTimerRef.current != null) {
                window.clearTimeout(compositionEndTimerRef.current);
            }
        };
    }, []);

    if (!state.open) return null;

    const close = () => {
        if (compositionEndTimerRef.current != null) {
            window.clearTimeout(compositionEndTimerRef.current);
            compositionEndTimerRef.current = null;
        }
        isComposingRef.current = false;
        setState((cur) => {
            composeDraft = {
                editor: cur.editor,
                editorCaret: cur.editorCaret,
                insertedIds: cur.insertedIds,
            };
            return { ...cur, open: false };
        });
    };

    const update = (patch: Partial<ComposeState>) => setState((cur) => ({ ...cur, ...patch }));

    const setEditor = (editor: string, editorCaret: number) => update({ editor, editorCaret, selectedIndex: 0 });

    const setManualQuery = (manualQuery: string) => update({ manualQuery, selectedIndex: 0 });

    const updateEditorCaret = (target: HTMLTextAreaElement) =>
        update({ editorCaret: target.selectionStart ?? target.value.length, selectedIndex: 0 });

    const toggleTag = (tag: string) => {
        setState((cur) => {
            const present = cur.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            const selectedTags = present
                ? cur.selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                : [...cur.selectedTags, tag];
            return { ...cur, selectedTags, selectedIndex: 0 };
        });
    };

    const setStatus = (status: string, statusKind: "info" | "ok" | "err" = "info") => update({ status, statusKind });

    const handleListItemSelected = (item: CommonTextItem) => {
        const editor = editorRef.current;
        const manualSearchActive = state.manualQuery.trim() !== "";
        const insertedIds = state.insertedIds.includes(item.id) ? state.insertedIds : [...state.insertedIds, item.id];
        if (editor == null) {
            const newEditor = state.editor + item.text;
            update({
                editor: newEditor,
                editorCaret: newEditor.length,
                selectedIndex: 0,
                insertedIds,
            });
            if (manualSearchActive) {
                requestAnimationFrame(() => searchInputRef.current?.focus());
            }
            fireAndForget(() => recordCommonTextUse(item.id));
            return;
        }
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        const newEditor = editor.value.slice(0, start) + item.text + editor.value.slice(end);
        if (!manualSearchActive) {
            editor.focus();
        }
        editor.setRangeText(item.text, start, end, "end");
        update({
            editor: newEditor,
            editorCaret: start + item.text.length,
            selectedIndex: 0,
            insertedIds,
        });
        if (manualSearchActive) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
        fireAndForget(() => recordCommonTextUse(item.id));
    };

    const handleCopy = async () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to copy", "err");
            return;
        }
        try {
            await copyCommonText(text);
            setStatus("Copied", "ok");
        } catch (err) {
            setStatus(`Copy failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleSendToTerm = () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to send", "err");
            return;
        }
        // Pick from the candidate chain (focused term → fallback terms in this
        // tab) so that opening the modal without focus on a terminal no longer
        // silently drops the Send. `sendTextToFocusedTerm` returns the blockId
        // it actually pasted into, or null when every candidate's TermWrap was
        // not live (panel mid-transition).
        const target = sendTextToFocusedTerm(text, availableTermBlockIds);
        if (target != null) {
            setStatus("Sent to focused terminal", "ok");
        } else {
            setStatus("No live terminal — focus a terminal and retry", "err");
        }
    };

    const handleListItemCopy = async (item: CommonTextItem) => {
        try {
            await copyCommonText(item.text);
            setStatus("Copied", "ok");
        } catch (err) {
            setStatus(`Copy failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleListItemEdit = (item: CommonTextItem) => {
        openCommonTextSaveDialog({
            existingId: item.id,
            text: item.text,
            title: item.title,
        });
    };

    const handleListItemSend = (item: CommonTextItem) => {
        const target = sendTextToFocusedTerm(item.text, availableTermBlockIds);
        if (target != null) {
            setStatus("Sent to focused terminal", "ok");
            fireAndForget(() => recordCommonTextUse(item.id));
        } else {
            setStatus("No live terminal — focus a terminal and retry", "err");
        }
    };

    const handleListItemDelete = async (item: CommonTextItem) => {
        if (!window.confirm("Delete this common text?")) {
            return;
        }
        try {
            await deleteCommonTextItem(item.id);
            setStatus("Deleted", "ok");
        } catch (err) {
            setStatus(`Delete failed: ${(err as Error).message ?? "unknown"}`, "err");
        }
    };

    const handleClearEditor = () => {
        if (state.editor.trim() === "") return;
        setEditor("", 0);
        requestAnimationFrame(() => editorRef.current?.focus());
    };

    const handleSaveDialog = () => {
        const text = state.editor;
        if (text.trim() === "") {
            setStatus("Nothing to save", "err");
            return;
        }
        openCommonTextSaveDialog({ text });
    };

    const openManager = () => {
        close();
        fireAndForget(openCommonTextManager);
    };

    const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            update({ selectedIndex: Math.min(state.selectedIndex + 1, Math.max(0, filteredItems.length - 1)) });
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            update({ selectedIndex: Math.max(0, state.selectedIndex - 1) });
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const selected = filteredItems[state.selectedIndex];
            if (selected != null) handleListItemSelected(selected);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
    };

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const isComposing =
            isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode == 229 || event.key === "Process";
        if (isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            if (state.manualQuery.trim() === "") {
                close();
                return;
            }
            setManualQuery("");
            requestAnimationFrame(() => editorRef.current?.focus());
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            update({ selectedIndex: Math.min(state.selectedIndex + 1, Math.max(0, filteredItems.length - 1)) });
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            update({ selectedIndex: Math.max(0, state.selectedIndex - 1) });
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const selected = filteredItems[state.selectedIndex];
            if (selected != null) handleListItemSelected(selected);
        }
    };

    const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing =
            isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode == 229 || event.key === "Process";
        if (isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
    };

    const handleCompositionStart = () => {
        if (compositionEndTimerRef.current != null) {
            window.clearTimeout(compositionEndTimerRef.current);
            compositionEndTimerRef.current = null;
        }
        isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
        if (compositionEndTimerRef.current != null) {
            window.clearTimeout(compositionEndTimerRef.current);
        }
        compositionEndTimerRef.current = window.setTimeout(() => {
            isComposingRef.current = false;
            compositionEndTimerRef.current = null;
        }, 0);
    };

    return (
        <Modal
            className={"w-[min(720px,calc(100vw-32px))] h-[min(640px,calc(100vh-32px))] pt-6 pb-3"}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ overflow: "hidden" }}>
                {/* Header */}
                <div className="shrink-0 flex items-start justify-between gap-3 pr-8">
                    <div>
                        <div className="text-base font-semibold">Common Text</div>
                        <div className="text-[11px] text-muted">
                            Compose text. Pick from the list below; enter inserts, shift+enter for newline.
                        </div>
                    </div>
                    <button
                        type="button"
                        className="w-8 h-8 flex items-center justify-center rounded text-secondary hover:bg-hoverbg hover:text-primary transition-colors cursor-pointer"
                        onClick={openManager}
                        title="Manage common text"
                    >
                        <i className="fa fa-solid fa-gear" />
                    </button>
                </div>

                <textarea
                    ref={editorRef}
                    className="shrink-0 min-h-[120px] max-h-[280px] resize-y rounded border border-border bg-background text-sm font-mono p-2 focus:outline-none focus:border-accent leading-relaxed"
                    value={state.editor}
                    onChange={(event) =>
                        setEditor(
                            event.currentTarget.value,
                            event.currentTarget.selectionStart ?? event.currentTarget.value.length
                        )
                    }
                    onSelect={(event) => updateEditorCaret(event.currentTarget)}
                    onKeyDown={handleEditorKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="Compose here. The list below suggests common text matching what you type."
                    autoFocus
                    spellCheck={false}
                />

                {/* Action row */}
                <div className="shrink-0 flex items-center gap-2">
                    <Button
                        className="grey"
                        disabled={state.editor.trim() === ""}
                        onClick={handleClearEditor}
                        title="Clear editor"
                    >
                        <i className="fa fa-solid fa-eraser" />
                    </Button>
                    <Button
                        className="grey"
                        onClick={handleSaveDialog}
                        title="Save editor content as a Common Text item"
                    >
                        <i className="fa fa-solid fa-plus" />
                    </Button>
                    <Button className="grey" onClick={handleCopy} title="Copy editor content to clipboard">
                        <i className="fa fa-regular fa-copy" />
                    </Button>
                    {canSendToTerm ? (
                        <Button className="grey" onClick={handleSendToTerm} title="Paste into the focused terminal">
                            <i className="fa fa-solid fa-terminal mr-1" />
                            Send
                        </Button>
                    ) : (
                        <span title="Focus a terminal to enable Send" className="inline-flex">
                            <Button className="grey" disabled>
                                <i className="fa fa-solid fa-terminal mr-1" />
                                Send
                            </Button>
                        </span>
                    )}
                    {state.status && (
                        <span
                            className={
                                state.statusKind === "err"
                                    ? "text-xs text-red-500"
                                    : state.statusKind === "ok"
                                      ? "text-xs text-accent"
                                      : "text-xs text-muted"
                            }
                        >
                            {state.status}
                        </span>
                    )}
                </div>

                {/* List area */}
                <div className="min-h-0 flex-1 border border-border rounded flex flex-col overflow-hidden">
                    <div
                        className="shrink-0 p-2 border-b border-border"
                        onCompositionStart={handleCompositionStart}
                        onCompositionEnd={handleCompositionEnd}
                    >
                        <InputGroup>
                            <Input
                                ref={searchInputRef}
                                value={state.manualQuery}
                                onChange={setManualQuery}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={
                                    state.editor.trim() !== ""
                                        ? "Type to override editor-based suggestions"
                                        : "Search common text"
                                }
                            />
                            <InputRightElement>
                                <i className="fa-regular fa-magnifying-glass" />
                            </InputRightElement>
                        </InputGroup>
                        {tagSummaries.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {tagSummaries.map((tagSummary) => (
                                    <CommonTextTagChip
                                        key={tagSummary.tag}
                                        tag={tagSummary.tag}
                                        count={tagSummary.count}
                                        compact
                                        selected={state.selectedTags.some(
                                            (t) => t.toLowerCase() === tagSummary.tag.toLowerCase()
                                        )}
                                        onClick={() => toggleTag(tagSummary.tag)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <div
                        ref={listScrollRef}
                        className="flex-1 overflow-y-auto flex flex-col"
                        tabIndex={0}
                        onKeyDown={handleListKeyDown}
                    >
                        {filteredItems.length === 0 ? (
                            <div className="flex flex-1 min-h-[80px] items-center justify-center gap-2 text-secondary text-sm">
                                <i className="fa fa-regular fa-quote-left text-xl opacity-60" />
                                <div>{allItems.length === 0 ? "No common text yet" : "No matching text"}</div>
                                <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                    Manage
                                </button>
                            </div>
                        ) : (
                            filteredItems.map((item, index) => (
                                <div
                                    key={item.id}
                                    data-common-text-index={index}
                                    className={
                                        "group flex items-start gap-1.5 px-2 py-1 cursor-pointer transition-colors " +
                                        (state.selectedIndex === index ? "bg-highlightbg" : "hover:bg-hoverbg")
                                    }
                                    onMouseEnter={() => update({ selectedIndex: index })}
                                    onClick={() => handleListItemSelected(item)}
                                >
                                    <div className="pt-0.5 w-4 shrink-0 text-secondary">
                                        {item.pinned ? <i className="fa fa-solid fa-thumbtack text-[11px]" /> : null}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-medium truncate">{item.title}</div>
                                        <div className="text-[11px] text-secondary truncate">
                                            {makePreview(item.text)}
                                        </div>
                                        {(item.tags?.length ?? 0) > 0 && (
                                            <div className="mt-0 flex flex-wrap gap-1">
                                                {item.tags!.slice(0, 4).map((tag) => (
                                                    <span
                                                        key={tag}
                                                        className="inline-flex items-center rounded-full border border-border bg-background text-[10px] text-secondary px-1.5 h-4"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {(item.tags!.length ?? 0) > 4 && (
                                                    <span className="text-[10px] text-secondary/70 self-center">
                                                        +{item.tags!.length - 4}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="shrink-0 self-start pt-0.5 flex items-start gap-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                        <button
                                            type="button"
                                            title="Edit this text"
                                            className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] bg-transparent border-0 text-secondary hover:text-[#6366f1] transition-colors duration-150 cursor-pointer"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleListItemEdit(item);
                                            }}
                                        >
                                            <i className="fa fa-regular fa-pen-to-square text-[11px]" />
                                        </button>
                                        {canSendToTerm ? (
                                            <button
                                                type="button"
                                                title="Send to terminal"
                                                className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] bg-transparent border-0 text-secondary hover:text-accent transition-colors duration-150 cursor-pointer"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    fireAndForget(async () => handleListItemSend(item));
                                                }}
                                            >
                                                <i className="fa fa-regular fa-paper-plane text-[11px]" />
                                            </button>
                                        ) : (
                                            <span
                                                title="Focus a terminal to enable Send"
                                                className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] opacity-40 text-muted pointer-events-none"
                                            >
                                                <i className="fa fa-regular fa-paper-plane text-[11px]" />
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            title="Copy this text"
                                            className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] bg-transparent border-0 text-secondary hover:text-accent transition-colors duration-150 cursor-pointer"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                fireAndForget(async () => handleListItemCopy(item));
                                            }}
                                        >
                                            <i className="fa fa-regular fa-copy text-[11px]" />
                                        </button>
                                        <div className="w-px h-[14px] bg-border self-center mx-[2px]" />
                                        <button
                                            type="button"
                                            title="Delete this text"
                                            className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] bg-transparent border-0 text-secondary hover:text-[#e54d2e] hover:bg-[rgba(229,77,46,0.12)] transition-colors duration-150 cursor-pointer"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                fireAndForget(async () => handleListItemDelete(item));
                                            }}
                                        >
                                            <i className="fa fa-regular fa-trash-can text-[11px]" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
});

CommonTextComposeModal.displayName = "CommonTextComposeModal";

function makePreview(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export { CommonTextComposeModal };
