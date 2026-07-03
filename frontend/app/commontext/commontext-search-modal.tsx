// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OpenCommonTextSearchEvent, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, getCurrentEditableElement, insertOrCopyCommonText } from "./commontext-insert";
import {
    getCommonTextItemsFromSettings,
    getCommonTextTagSummaries,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextItems,
    type CommonTextItem,
} from "./commontext-model";
import { CommonTextTagChip, CommonTextTagList } from "./commontext-tags";

type SearchState = Required<Pick<CommonTextSearchDetail, "mode">> & {
    open: boolean;
    query: string;
    onSelect?: (item: CommonTextItem) => void;
    insertTarget?: HTMLElement | null;
};

function makePreview(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

const CommonTextSearchModal = memo(() => {
    const settings = useAtomValue(atoms.settingsAtom);
    const items = useMemo(() => getCommonTextItemsFromSettings(settings), [settings]);
    const [state, setState] = useState<SearchState>({
        open: false,
        query: "",
        mode: "insert-or-copy",
        insertTarget: null,
    });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [status, setStatus] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const tagSummaries = useMemo(() => getCommonTextTagSummaries(items), [items]);
    const results = useMemo(
        () => searchCommonTextItems(items, state.query, 500, selectedTags),
        [items, selectedTags, state.query]
    );
    const hasInsertTarget = state.insertTarget != null;

    const ITEM_ESTIMATED_SIZE = 64;
    const overscan = 5;

    const virtualizer = useVirtualizer({
        count: results.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ITEM_ESTIMATED_SIZE,
        overscan,
    });

    useEffect(() => {
        const handleOpen = (event: Event) => {
            const customEvent = event as CustomEvent<CommonTextSearchDetail>;
            const detail = customEvent.detail ?? {};
            setState({
                open: true,
                query: detail.query ?? "",
                mode: detail.mode ?? "insert-or-copy",
                onSelect: detail.onSelect,
                insertTarget: getCurrentEditableElement(),
            });
            setSelectedIndex(0);
            setSelectedTags([]);
            setStatus("");
            requestAnimationFrame(() => inputRef.current?.focus());
        };
        window.addEventListener(OpenCommonTextSearchEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSearchEvent, handleOpen);
    }, []);

    useEffect(() => {
        if (selectedIndex >= results.length) {
            setSelectedIndex(Math.max(0, results.length - 1));
        }
    }, [results.length, selectedIndex]);

    if (!state.open) {
        return null;
    }

    const close = () => setState((cur) => ({ ...cur, open: false }));

    const handleUse = async (item: CommonTextItem, forceCopy = false) => {
        if (state.onSelect != null) {
            state.onSelect(item);
        } else if (forceCopy || state.mode === "copy") {
            await copyCommonText(item.text);
            setStatus("Copied");
        } else {
            const result = await insertOrCopyCommonText(item.text, state.insertTarget);
            setStatus(result === "inserted" ? "Inserted" : "Copied");
        }
        await recordCommonTextUse(item.id);
        window.setTimeout(close, 120);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((cur) => Math.min(cur + 1, Math.max(0, results.length - 1)));
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((cur) => Math.max(0, cur - 1));
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const selected = results[selectedIndex];
            if (selected != null) {
                fireAndForget(() => handleUse(selected, event.metaKey || event.ctrlKey));
            }
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    };

    const openManager = () => {
        close();
        fireAndForget(openCommonTextManager);
    };

    const toggleTag = (tag: string) => {
        setSelectedTags((cur) =>
            cur.some((selectedTag) => selectedTag.toLowerCase() === tag.toLowerCase())
                ? cur.filter((selectedTag) => selectedTag.toLowerCase() !== tag.toLowerCase())
                : [...cur, tag]
        );
        setSelectedIndex(0);
    };

    return (
        <Modal
            className={"w-[min(760px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] pt-8 pb-4"}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-3 min-h-0 h-full">
                <div className="flex items-start justify-between gap-3 pr-8">
                    <div>
                        <div className="text-lg font-semibold">Common Text</div>
                        <div className="text-xs text-muted">
                            {hasInsertTarget && state.mode !== "copy"
                                ? "Enter inserts. Cmd/Ctrl+Enter copies."
                                : "Enter copies."}
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
                <InputGroup>
                    <Input
                        ref={inputRef}
                        value={state.query}
                        onChange={(query) => setState((cur) => ({ ...cur, query }))}
                        onKeyDown={handleKeyDown}
                        placeholder="Search by title, shortcut, tag, or text"
                        autoFocus
                    />
                    <InputRightElement>
                        <i className="fa-regular fa-magnifying-glass" />
                    </InputRightElement>
                </InputGroup>
                {tagSummaries.length > 0 && (
                    <div className="max-h-20 overflow-y-auto flex flex-wrap gap-1.5">
                        {tagSummaries.map((tagSummary) => (
                            <CommonTextTagChip
                                key={tagSummary.tag}
                                tag={tagSummary.tag}
                                count={tagSummary.count}
                                selected={selectedTags.some(
                                    (selectedTag) => selectedTag.toLowerCase() === tagSummary.tag.toLowerCase()
                                )}
                                onClick={() => toggleTag(tagSummary.tag)}
                            />
                        ))}
                    </div>
                )}
                {status && <div className="text-xs text-accent">{status}</div>}
                <div className="min-h-0 flex-1 border border-border rounded overflow-hidden">
                    {results.length === 0 ? (
                        <div className="h-full min-h-[280px] flex flex-col items-center justify-center gap-2 text-secondary">
                            <i className="fa fa-regular fa-quote-left text-2xl opacity-60" />
                            <div>{items.length === 0 ? "No common text yet" : "No matching text"}</div>
                            <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                Manage Common Text
                            </button>
                        </div>
                    ) : (
                        <div ref={scrollRef} className="h-full overflow-y-auto">
                            <div
                                className="relative w-full"
                                style={{ height: virtualizer.getTotalSize() }}
                            >
                                {virtualizer.getVirtualItems().map((virtualRow) => {
                                    const item = results[virtualRow.index];
                                    return (
                                        <div
                                            key={item.id}
                                            className={cn(
                                                "absolute left-0 right-0 flex items-start gap-3 px-3 py-2 cursor-pointer transition-colors",
                                                selectedIndex === virtualRow.index
                                                    ? "bg-highlightbg"
                                                    : "hover:bg-hoverbg"
                                            )}
                                            style={{
                                                height: virtualRow.size,
                                                transform: `translateY(${virtualRow.start}px)`,
                                            }}
                                            onMouseEnter={() => setSelectedIndex(virtualRow.index)}
                                            onClick={() => fireAndForget(() => handleUse(item))}
                                        >
                                            <div className="pt-0.5 text-secondary w-4 shrink-0">
                                                {item.pinned ? (
                                                    <i className="fa fa-solid fa-thumbtack text-[11px]" />
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="font-medium truncate">{item.title}</div>
                                                    {item.shortcut && (
                                                        <div className="text-[11px] font-mono text-secondary border border-border rounded px-1">
                                                            {item.shortcut}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-xs text-secondary truncate mt-0.5">
                                                    {makePreview(item.text)}
                                                </div>
                                                {(item.tags?.length ?? 0) > 0 && (
                                                    <div className="mt-1">
                                                        <CommonTextTagList
                                                            tags={item.tags}
                                                            maxVisible={4}
                                                            selectedTags={selectedTags}
                                                            compact
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="h-7 w-7 rounded text-secondary hover:bg-hoverbg hover:text-primary"
                                                title="Copy"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    fireAndForget(() => handleUse(item, true));
                                                }}
                                            >
                                                <i className="fa fa-regular fa-copy" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
});

CommonTextSearchModal.displayName = "CommonTextSearchModal";

export { CommonTextSearchModal };
