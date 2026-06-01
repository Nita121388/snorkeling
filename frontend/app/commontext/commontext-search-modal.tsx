// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OpenCommonTextSearchEvent, type CommonTextSearchDetail } from "./commontext-events";
import { copyCommonText, getCurrentEditableElement, insertOrCopyCommonText } from "./commontext-insert";
import {
    getCommonTextItemsFromSettings,
    openCommonTextManager,
    recordCommonTextUse,
    searchCommonTextItems,
    type CommonTextItem,
} from "./commontext-model";

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
    const [status, setStatus] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const results = useMemo(() => searchCommonTextItems(items, state.query, 60), [items, state.query]);
    const hasInsertTarget = state.insertTarget != null;

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

    return (
        <Modal
            className="w-[min(760px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] pt-8 pb-4"
            onClose={close}
            onClickBackdrop={close}
        >
            <div className="flex flex-col gap-3 min-h-[420px]">
                <div className="flex items-start justify-between gap-3">
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
                        className="h-8 px-2 rounded border border-border text-secondary hover:bg-hoverbg hover:text-primary transition-colors"
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
                {status && <div className="text-xs text-accent">{status}</div>}
                <div className="min-h-0 flex-1 overflow-y-auto border border-border rounded">
                    {results.length === 0 ? (
                        <div className="h-full min-h-[280px] flex flex-col items-center justify-center gap-2 text-secondary">
                            <i className="fa fa-regular fa-quote-left text-2xl opacity-60" />
                            <div>{items.length === 0 ? "No common text yet" : "No matching text"}</div>
                            <button type="button" className="text-accent hover:underline" onClick={openManager}>
                                Manage Common Text
                            </button>
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {results.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={cn(
                                        "flex items-start gap-3 px-3 py-2 cursor-pointer transition-colors",
                                        selectedIndex === index ? "bg-highlightbg" : "hover:bg-hoverbg"
                                    )}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    onClick={() => fireAndForget(() => handleUse(item))}
                                >
                                    <div className="pt-0.5 text-secondary w-4 shrink-0">
                                        {item.pinned ? <i className="fa fa-solid fa-thumbtack text-[11px]" /> : null}
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
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
});

CommonTextSearchModal.displayName = "CommonTextSearchModal";

export { CommonTextSearchModal };
