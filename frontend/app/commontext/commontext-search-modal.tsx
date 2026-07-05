// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { cn, fireAndForget } from "@/util/util";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { OpenCommonTextSearchEvent, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, getCurrentEditableElement, insertOrCopyCommonText } from "./commontext-insert";
import {
    getCommonTextTagSummaries,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextItemsPaged,
    type CommonTextItem,
    type PagedSearchResult,
} from "./commontext-model";
import { CommonTextTagChip, CommonTextTagList } from "./commontext-tags";

const PAGE_SIZE = 20;

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
    const [state, setState] = useState<SearchState>({
        open: false,
        query: "",
        mode: "insert-or-copy",
        insertTarget: null,
    });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [status, setStatus] = useState("");
    const [loadedItems, setLoadedItems] = useState<CommonTextItem[]>([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const searchKeyRef = useRef(0);
    const prevSearchKeyRef = useRef(0);
    const allTagsRef = useRef<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const hasInsertTarget = state.insertTarget != null;
    const totalLoaded = loadedItems.length;

    const loadPage = useCallback(async (searchKey: number, query: string, tags: string[], pageNum: number) => {
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoading(true);
        try {
            const result: PagedSearchResult = await searchCommonTextItemsPaged(query, tags, pageNum);

            if (ctrl.signal.aborted) return;
            if (searchKeyRef.current !== searchKey) return;

            if (pageNum === 0) {
                setLoadedItems(result.items);
            } else {
                setLoadedItems((prev) => [...prev, ...result.items]);
            }
            setHasMore(result.hasMore);
            setPage(pageNum);
        } finally {
            if (!ctrl.signal.aborted) {
                setLoading(false);
            }
        }
    }, []);

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
            setLoadedItems([]);
            setPage(0);
            setHasMore(false);
            setLoading(false);
            prevSearchKeyRef.current = 0;
            abortRef.current?.abort();
            requestAnimationFrame(() => inputRef.current?.focus());
        };
        window.addEventListener(OpenCommonTextSearchEvent, handleOpen);
        return () => window.removeEventListener(OpenCommonTextSearchEvent, handleOpen);
    }, []);

    const searchKey = searchKeyRef.current;
    const doSearch = useCallback(
        (query: string, tags: string[]) => {
            const key = ++searchKeyRef.current;
            abortRef.current?.abort();
            setLoadedItems([]);
            setPage(0);
            setHasMore(false);
            setSelectedIndex(0);
            fireAndForget(() => loadPage(key, query, tags, 0));
        },
        [loadPage]
    );

    useEffect(() => {
        if (!state.open) return;
        const timer = window.setTimeout(() => {
            if (searchKeyRef.current !== prevSearchKeyRef.current) return;
            doSearch(state.query, selectedTags);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [state.open]);

    useEffect(() => {
        if (!state.open) return;
        prevSearchKeyRef.current = searchKeyRef.current;
        doSearch(state.query, selectedTags);
    }, [state.query, selectedTags, state.open, doSearch]);

    useEffect(() => {
        if (selectedIndex >= totalLoaded) {
            setSelectedIndex(Math.max(0, totalLoaded - 1));
        }
    }, [totalLoaded, selectedIndex]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore || loading) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loading) {
                    fireAndForget(() => loadPage(searchKeyRef.current, state.query, selectedTags, page + 1));
                }
            },
            { root: scrollRef.current, rootMargin: "200px" }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loading, page, state.query, selectedTags, loadPage]);

    if (!state.open) {
        return null;
    }

    const close = () => {
        abortRef.current?.abort();
        setState((cur) => ({ ...cur, open: false }));
        setLoadedItems([]);
    };

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
            setSelectedIndex((cur) => Math.min(cur + 1, Math.max(0, totalLoaded - 1)));
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((cur) => Math.max(0, cur - 1));
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const selected = loadedItems[selectedIndex];
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

    const tagSummaries = getCommonTextTagSummaries(loadedItems);

    return (
        <Modal
            className={"w-[min(640px,calc(100vw-32px))] max-h-[min(640px,calc(100vh-32px))] pt-6 pb-3"}
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-2 flex-1 min-h-0" style={{ overflow: 'hidden' }}>
                <div className="shrink-0 flex items-start justify-between gap-3 pr-8">
                    <div>
                        <div className="text-base font-semibold">Common Text</div>
                        <div className="text-[11px] text-muted">
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
                    <div className="shrink-0 max-h-20 overflow-y-auto flex flex-wrap gap-1.5">
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
                {status && <div className="shrink-0 text-xs text-accent">{status}</div>}
                <div className="min-h-0 flex-1 border border-border rounded flex flex-col overflow-hidden">
                    {totalLoaded === 0 && !loading ? (
                        <div className="flex flex-1 min-h-[280px] items-center justify-center gap-2 text-secondary">
                            <i className="fa fa-regular fa-quote-left text-2xl opacity-60" />
                            <div>{loadedItems.length === 0 && page === 0 ? "No matching text" : "No common text yet"}</div>
                            <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                Manage Common Text
                            </button>
                        </div>
                    ) : (
                        <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
                            {loadedItems.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={cn(
                                        "flex items-start gap-1.5 -mx-1 px-1 py-1 cursor-pointer transition-colors",
                                        selectedIndex === index ? "bg-highlightbg" : "hover:bg-hoverbg"
                                    )}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    onClick={() => fireAndForget(() => handleUse(item))}
                                >
                                    <div className="pt-0.5 text-secondary w-4 shrink-0">
                                        {item.pinned ? (
                                            <i className="fa fa-solid fa-thumbtack text-[11px]" />
                                        ) : null}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="text-xs font-medium truncate">{item.title}</div>
                                            {item.shortcut && (
                                                <div className="text-[10px] font-mono text-secondary border border-border rounded px-1">{item.shortcut}</div>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-secondary truncate">
                                            {makePreview(item.text)}
                                        </div>
                                        {(item.tags?.length ?? 0) > 0 && (
                                            <div className="mt-0">
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
                                        className="h-5 w-5 rounded text-secondary hover:bg-hoverbg hover:text-primary shrink-0 text-[11px]"
                                        title="Copy"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            fireAndForget(() => handleUse(item, true));
                                        }}
                                    >
                                        <i className="fa fa-regular fa-copy" />
                                    </button>
                                </div>
                            ))}
                            {loading && (
                                <div className="flex items-center justify-center py-4 text-secondary text-xs gap-2">
                                    <i className="fa fa-solid fa-spinner fa-spin" />
                                    Loading...
                                </div>
                            )}
                            {!hasMore && totalLoaded > 0 && !loading && (
                                <div className="flex items-center justify-center py-3 text-secondary/40 text-xs select-none">
                                    <span className="text-secondary/25">─ ─ ─</span>
                                </div>
                            )}
                            {hasMore && !loading && <div ref={sentinelRef} className="h-px" />}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
});

CommonTextSearchModal.displayName = "CommonTextSearchModal";

export { CommonTextSearchModal };
