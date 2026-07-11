// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { fireAndForget } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    OpenCommonTextSearchEvent,
    openCommonTextSaveDialog,
    type CommonTextSearchDetail,
} from "./commontext-events";
import { copyCommonText, insertTextIntoFocused } from "./commontext-insert";
import {
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextItemsFuzzy,
    type CommonTextItem,
} from "./commontext-model";
import { CommonTextTagChip } from "./commontext-tags";
import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";

const LIST_LIMIT = 500;
const MAX_TAG_CHIPS = 16;

type ComposeState =
    | { open: false }
    | {
          open: true;
          editor: string;
          manualQuery: string;
          selectedTags: string[];
          selectedIndex: number;
          status: string;
          statusKind: "info" | "ok" | "err";
      };

const initialOpenState = (): Extract<ComposeState, { open: true }> => ({
    open: true,
    editor: "",
    manualQuery: "",
    selectedTags: [],
    selectedIndex: 0,
    status: "",
    statusKind: "info",
});

const CommonTextComposeModal = memo(() => {
    const [state, setState] = useState<ComposeState>({ open: false });
    const settings = useAtomValue(atoms.settingsAtom);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listScrollRef = useRef<HTMLDivElement>(null);

    const allItems = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const tagSummaries = useMemo(() => getCommonTextTagSummaries(allItems).slice(0, MAX_TAG_CHIPS), [allItems]);

    // List filtering:
    //  - When the manual search box has text, it overrides the editor (replace semantics, not
    //    intersection): the editor's body is ignored and only the search box words drive filtering.
    //  - Otherwise, fuzzy-match the *ent editor body* token-by-token (OR semantics, ranked by
    //    hit count). Caret position in the editor is irrelevant — only what the user has typed.
    //  - Both paths use searchCommonTextItemsFuzzy (OR + hits ranking) so the search box and
    //    editor-driven suggestions behave consistently: typing one keyword surfaces every item
    //    that contains it, with multi-hit items ranked first. The previous AND semantics for the
    //    manual search box made multi-token queries return empty whenever any token was missing
    //    from a candidate, which felt like "the search box does nothing".
    const filteredItems = useMemo(() => {
        if (state.open !== true) return [];
        if (state.manualQuery.trim() !== "") {
            return searchCommonTextItemsFuzzy(allItems, state.manualQuery, LIST_LIMIT, state.selectedTags);
        }
        return searchCommonTextItemsFuzzy(allItems, state.editor, LIST_LIMIT, state.selectedTags);
    }, [allItems, state]);

    // Compose Modal open/close wiring.
    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<CommonTextSearchDetail>).detail ?? {};
            void detail; // backward-compat: Compose ignores insertTarget/onSelect from the old API
            setState((cur) => ({ ...initialOpenState(), ...(cur.open === true ? {} : {}) }));
            requestAnimationFrame(() => editorRef.current?.focus());
        };
        window.addEventListener(OpenCommonTextSearchEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSearchEvent, handleOpen);
    }, []);

    // Reset selectedIndex when filteredItems shrinks. Must be declared before any early return
    // to keep hook order stable across open/closed renders.
    useEffect(() => {
        if (state.open !== true) return;
        if (state.selectedIndex >= filteredItems.length) {
            setState((cur) =>
                cur.open === true
                    ? { ...cur, selectedIndex: Math.max(0, filteredItems.length - 1) }
                    : cur
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredItems.length, state]);

    if (state.open !== true) return null;

    const close = () => setState({ open: false });

    const update = (patch: Partial<Extract<ComposeState, { open: true }>>) =>
        setState((cur) => (cur.open === true ? { ...cur, ...patch } : cur));

    const setEditor = (editor: string) => {
        update({ editor });
    };

    const setManualQuery = (manualQuery: string) => update({ manualQuery, selectedIndex: 0 });

    const toggleTag = (tag: string) => {
        setState((cur) => {
            if (cur.open !== true) return cur;
            const present = cur.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
            const selectedTags = present
                ? cur.selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                : [...cur.selectedTags, tag];
            return { ...cur, selectedTags, selectedIndex: 0 };
        });
    };

    const setStatus = (status: string, statusKind: "info" | "ok" | "err" = "info") =>
        update({ status, statusKind });

    const handleListItemSelected = (item: CommonTextItem) => {
        const editor = editorRef.current;
        if (editor == null) {
            update({ editor: state.editor + item.text });
            return;
        }
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        const newEditor = editor.value.slice(0, start) + item.text + editor.value.slice(end);
        editor.focus();
        editor.setRangeText(item.text, start, end, "end");
        // Sync React state with the textarea's value without an extra input event.
        update({ editor: newEditor });
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
        const ok = insertTextIntoFocused(text);
        if (ok) {
            setStatus("Sent to focused terminal", "ok");
        } else {
            setStatus("Focus a terminal first", "err");
        }
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

    const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Escape closes regardless. Enter without modifiers inserts the highlighted list item.
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            const selected = filteredItems[state.selectedIndex];
            if (selected != null) {
                event.preventDefault();
                handleListItemSelected(selected);
            }
        }
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
                        className="h-8 px-2 rounded border border-border text-secondary hover:bg-hoverbg hover:text-primary transition-colors cursor-pointer"
                        onClick={openManager}
                        title="Manage common text"
                    >
                        <i className="fa fa-solid fa-gear mr-1" />
                        Manage
                    </button>
                </div>

                {/* Editor — typing here drives the fuzzy list below (whole-text, multi-token OR). */}
                <textarea
                    ref={editorRef}
                    className="shrink-0 min-h-[120px] max-h-[280px] resize-y rounded border border-border bg-background text-sm font-mono p-2 focus:outline-none focus:border-accent leading-relaxed"
                    value={state.editor}
                    onChange={(e) => setEditor(e.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    placeholder="Compose here. The list below suggests common text matching what you type."
                    autoFocus
                    spellCheck={false}
                />

                {/* Action row */}
                <div className="shrink-0 flex items-center gap-2">
                    <Button className="grey" onClick={handleCopy} title="Copy editor content to clipboard">
                        <i className="fa fa-regular fa-copy" />
                    </Button>
                    <Button className="grey" onClick={handleSendToTerm} title="Paste into the focused terminal">
                        <i className="fa fa-solid fa-terminal mr-1" />
                        Send
                    </Button>
                    <Button className="grey" onClick={handleSaveDialog} title="Save editor content as a Common Text item">
                        <i className="fa fa-solid fa-plus" />
                    </Button>
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
                    <div className="shrink-0 p-2 border-b border-border">
                        <InputGroup>
                            <Input
                                ref={searchInputRef}
                                value={state.manualQuery}
                                onChange={setManualQuery}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        close();
                                    } else if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        editorRef.current?.focus();
                                    }
                                }}
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
                    <div ref={listScrollRef} className="flex-1 overflow-y-auto flex flex-col" tabIndex={0} onKeyDown={handleListKeyDown}>
                        {filteredItems.length === 0 ? (
                            <div className="flex flex-1 min-h-[80px] items-center justify-center gap-2 text-secondary text-sm">
                                <i className="fa fa-regular fa-quote-left text-xl opacity-60" />
                                <div>
                                    {state.manualQuery.trim() !== "" || state.editor.trim() !== ""
                                        ? "No matching text"
                                        : "No common text yet"}
                                </div>
                                <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                    Manage
                                </button>
                            </div>
                        ) : (
                            filteredItems.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={
                                        "flex items-start gap-1.5 px-2 py-1 cursor-pointer transition-colors " +
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
                                        <div className="text-[11px] text-secondary truncate">{makePreview(item.text)}</div>
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
