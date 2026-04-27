// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getElemAsStr } from "@/util/focusutil";
import { autoUpdate, FloatingPortal, Middleware, offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import debug from "debug";
import { atom, useAtom, WritableAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton, ToggleIconButton } from "./iconbutton";
import { Input } from "./input";
import "./search.scss";

const dlog = debug("wave:search");
dlog.enabled = true;

function getActiveElementLog(): string {
    if (typeof document === "undefined") {
        return "no-document";
    }
    return getElemAsStr(document.activeElement);
}

function searchLog(message: string, details: Record<string, unknown> = {}) {
    const payload = { ...details, activeElement: getActiveElementLog() };
    dlog(message, payload);
    console.info("[search]", message, payload);
}

type SearchProps = SearchAtoms & {
    anchorRef?: React.RefObject<HTMLElement>;
    offsetX?: number;
    offsetY?: number;
    onSearch?: (search: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
    onReplace?: () => void;
    onReplaceAll?: () => void;
    replaceDisabled?: boolean;
};

const SearchComponent = ({
    searchValue: searchAtom,
    resultsIndex: indexAtom,
    resultsCount: numResultsAtom,
    regex: regexAtom,
    caseSensitive: caseSensitiveAtom,
    wholeWord: wholeWordAtom,
    replaceValue: replaceAtom,
    isOpen: isOpenAtom,
    focusInput: focusInputAtom,
    anchorRef,
    offsetX = 10,
    offsetY = 10,
    onSearch,
    onNext,
    onPrev,
    onReplace,
    onReplaceAll,
    replaceDisabled = false,
}: SearchProps) => {
    const fallbackReplaceAtom = useMemo(() => atom(""), []);
    const [isOpen, setIsOpen] = useAtom<boolean>(isOpenAtom);
    const [search, setSearch] = useAtom<string>(searchAtom);
    const [replaceValue, setReplaceValue] = useAtom<string>(replaceAtom ?? fallbackReplaceAtom);
    const [index, setIndex] = useAtom<number>(indexAtom);
    const [numResults, setNumResults] = useAtom<number>(numResultsAtom);
    const [focusInputCounter, setFocusInputCounter] = useAtom<number>(focusInputAtom);
    const [replaceExpanded, setReplaceExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const replaceInputRef = useRef<HTMLInputElement>(null);
    const activeInputRef = useRef<"search" | "replace">("search");
    const onSearchRef = useRef(onSearch);
    const replaceAvailable = replaceAtom != null && !replaceDisabled;
    const replaceActionsDisabled = search === "" || numResults === 0;
    const hasSearch = search.length > 0;
    const resultPosition = numResults > 0 ? Math.min(index + 1, numResults) : 0;
    const resultSummary = hasSearch ? `${resultPosition}/${numResults}` : "";

    const handleOpenChange = useCallback((open: boolean) => {
        setIsOpen(open);
    }, []);

    const focusSearchInput = useCallback((select = true, reason = "search") => {
        activeInputRef.current = "search";
        searchLog("focus search requested", { reason, select });
        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) {
                searchLog("focus search skipped: input missing", { reason });
                return;
            }
            input.focus();
            if (select) {
                input.select();
            }
            searchLog("focus search applied", { reason, focused: document.activeElement === input });
        });
    }, []);

    const focusReplaceInput = useCallback((select = false, reason = "replace") => {
        activeInputRef.current = "replace";
        searchLog("focus replace requested", { reason, select });
        requestAnimationFrame(() => {
            const input = replaceInputRef.current;
            if (!input) {
                searchLog("focus replace skipped: input missing", { reason });
                return;
            }
            input.focus();
            if (select) {
                input.select();
            }
            searchLog("focus replace applied", { reason, focused: document.activeElement === input });
        });
    }, []);

    useEffect(() => {
        if (!isOpen) {
            searchLog("close and reset");
            activeInputRef.current = "search";
            setSearch("");
            setReplaceValue("");
            setIndex(0);
            setNumResults(0);
            setFocusInputCounter(0);
            setReplaceExpanded(false);
            return;
        }
        searchLog("open");
        focusSearchInput(true, "open");
    }, [focusSearchInput, isOpen, setFocusInputCounter, setIndex, setNumResults, setReplaceValue, setSearch]);

    useEffect(() => {
        if (!replaceAvailable) {
            searchLog("replace unavailable: collapse and reset");
            activeInputRef.current = "search";
            setReplaceExpanded(false);
            setReplaceValue("");
        }
    }, [replaceAvailable, setReplaceValue]);

    useEffect(() => {
        if (isOpen && replaceExpanded) {
            focusReplaceInput(false, "replace-expanded");
        }
    }, [focusReplaceInput, isOpen, replaceExpanded]);

    useEffect(() => {
        onSearchRef.current = onSearch;
    }, [onSearch]);

    useEffect(() => {
        if (search === "") {
            setIndex(0);
            setNumResults(0);
        }
        searchLog("search changed", { queryLength: search.length });
        onSearchRef.current?.(search);
    }, [search, setIndex, setNumResults]);

    useEffect(() => {
        if (search !== "") {
            searchLog("results state", { index, numResults, queryLength: search.length });
        }
    }, [index, numResults, search]);

    // When activateSearch fires while already open, it increments focusInputCounter
    // to signal this specific instance to grab focus (avoids global DOM queries).
    useEffect(() => {
        if (focusInputCounter > 0 && isOpen) {
            focusSearchInput(true, "focus-counter");
        }
    }, [focusInputCounter, focusSearchInput, isOpen]);

    const focusActiveInput = useCallback(
        (selectSearch = false) => {
            if (activeInputRef.current === "replace" && replaceAvailable && replaceExpanded) {
                focusReplaceInput(false, "active-input");
                return;
            }
            focusSearchInput(selectSearch, "active-input");
        },
        [focusReplaceInput, focusSearchInput, replaceAvailable, replaceExpanded]
    );

    const middleware: Middleware[] = [];
    const offsetCallback = useCallback(
        ({ rects }) => {
            const docRect = document.documentElement.getBoundingClientRect();
            let yOffsetCalc = -rects.floating.height - offsetY;
            let xOffsetCalc = -offsetX;
            const floatingBottom = rects.reference.y + rects.floating.height + offsetY;
            const floatingLeft = rects.reference.x + rects.reference.width - (rects.floating.width + offsetX);
            if (floatingBottom > docRect.bottom) {
                yOffsetCalc -= docRect.bottom - floatingBottom;
            }
            if (floatingLeft < 5) {
                xOffsetCalc += 5 - floatingLeft;
            }
            return {
                mainAxis: yOffsetCalc,
                crossAxis: xOffsetCalc,
            };
        },
        [offsetX, offsetY]
    );
    middleware.push(offset(offsetCallback));

    const { refs, floatingStyles } = useFloating({
        placement: "top-end",
        open: isOpen,
        onOpenChange: handleOpenChange,
        whileElementsMounted: autoUpdate,
        middleware,
        elements: {
            reference: anchorRef!.current,
        },
    });

    const onPrevWrapper = useCallback(() => {
        searchLog("navigate previous", { activeInput: activeInputRef.current, index, numResults });
        if (onPrev) {
            onPrev();
        } else {
            setIndex((index - 1) % numResults);
        }
        focusActiveInput(false);
    }, [focusActiveInput, index, numResults, onPrev, setIndex]);
    const onNextWrapper = useCallback(() => {
        searchLog("navigate next", { activeInput: activeInputRef.current, index, numResults });
        if (onNext) {
            onNext();
        } else {
            setIndex((index + 1) % numResults);
        }
        focusActiveInput(false);
    }, [focusActiveInput, index, numResults, onNext, setIndex]);

    const onReplaceWrapper = useCallback(() => {
        searchLog("replace current", {
            activeInput: activeInputRef.current,
            disabled: replaceActionsDisabled,
            numResults,
        });
        if (replaceActionsDisabled) {
            focusReplaceInput(false, "replace-current-disabled");
            return;
        }
        onReplace?.();
        focusReplaceInput(false, "replace-current");
    }, [focusReplaceInput, numResults, onReplace, replaceActionsDisabled]);

    const onReplaceAllWrapper = useCallback(() => {
        searchLog("replace all", {
            activeInput: activeInputRef.current,
            disabled: replaceActionsDisabled,
            numResults,
        });
        if (replaceActionsDisabled) {
            focusReplaceInput(false, "replace-all-disabled");
            return;
        }
        onReplaceAll?.();
        focusReplaceInput(false, "replace-all");
    }, [focusReplaceInput, numResults, onReplaceAll, replaceActionsDisabled]);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    onPrevWrapper();
                } else {
                    onNextWrapper();
                }
                e.preventDefault();
                return;
            }
            if (e.key === "Escape") {
                setIsOpen(false);
                e.preventDefault();
            }
        },
        [onPrevWrapper, onNextWrapper, setIsOpen]
    );

    const onReplaceKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    onReplaceAllWrapper();
                } else {
                    onReplaceWrapper();
                }
                e.preventDefault();
                return;
            }
            if (e.key === "Escape") {
                setIsOpen(false);
                e.preventDefault();
            }
        },
        [onReplaceAllWrapper, onReplaceWrapper, setIsOpen]
    );

    const prevDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-up",
        title: "Previous Result (Shift+Enter)",
        disabled: numResults === 0,
        click: onPrevWrapper,
    };

    const nextDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "chevron-down",
        title: "Next Result (Enter)",
        disabled: numResults === 0,
        click: onNextWrapper,
    };

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close (Esc)",
        click: () => setIsOpen(false),
    };

    const replaceToggleDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: replaceExpanded ? "chevron-down" : "chevron-right",
        title: replaceExpanded ? "Hide Replace" : "Show Replace",
        click: () => {
            setReplaceExpanded((expanded) => {
                const nextExpanded = !expanded;
                searchLog("toggle replace", { expanded: nextExpanded });
                if (!nextExpanded) {
                    focusSearchInput(false, "replace-collapsed");
                }
                return nextExpanded;
            });
        },
    };

    const replaceDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "arrow-right",
        title: "Replace (Enter)",
        disabled: replaceActionsDisabled,
        click: onReplaceWrapper,
    };

    const replaceAllDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "arrows-rotate",
        title: "Replace All (Shift+Enter)",
        disabled: replaceActionsDisabled,
        click: onReplaceAllWrapper,
    };

    const regexDecl = createToggleButtonDecl(regexAtom, "custom@regex", "Regular Expression");
    const wholeWordDecl = createToggleButtonDecl(wholeWordAtom, "custom@whole-word", "Whole Word");
    const caseSensitiveDecl = createToggleButtonDecl(caseSensitiveAtom, "custom@case-sensitive", "Case Sensitive");
    const preventButtonFocus = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const button = (e.target as HTMLElement).closest("button");
        if (button) {
            searchLog("prevent button focus", { button: button.getAttribute("aria-label") ?? button.title });
            e.preventDefault();
        }
    }, []);
    const stopSearchPortalEvent = useCallback((e: React.SyntheticEvent<HTMLElement>) => {
        searchLog("stop portal event", { target: getElemAsStr(e.target), type: e.type });
        e.stopPropagation();
    }, []);

    return (
        <>
            {isOpen && (
                <FloatingPortal>
                    <div
                        className={clsx("search-container", { "has-replace": replaceAvailable && replaceExpanded })}
                        style={{ ...floatingStyles }}
                        ref={refs.setFloating}
                        onClick={stopSearchPortalEvent}
                        onDoubleClick={stopSearchPortalEvent}
                        onMouseDown={stopSearchPortalEvent}
                        onPointerDown={stopSearchPortalEvent}
                    >
                        <div className="search-row">
                            {replaceAvailable && (
                                <div className="replace-toggle" onMouseDown={preventButtonFocus}>
                                    <IconButton decl={replaceToggleDecl} />
                                </div>
                            )}
                            <Input
                                ref={inputRef}
                                placeholder="Search"
                                value={search}
                                onChange={setSearch}
                                onKeyDown={onKeyDown}
                                onFocus={() => {
                                    activeInputRef.current = "search";
                                    searchLog("search input focus", { queryLength: search.length });
                                }}
                                onBlur={() => searchLog("search input blur", { queryLength: search.length })}
                                autoFocus
                            />
                            <div
                                className={clsx("search-results", { empty: hasSearch && numResults === 0 })}
                                aria-live="polite"
                                aria-label="Search Results"
                                title={hasSearch ? `${resultPosition} of ${numResults} results` : "Search Results"}
                            >
                                {resultSummary}
                            </div>

                            {(caseSensitiveDecl || wholeWordDecl || regexDecl) && (
                                <div className="additional-buttons" onMouseDown={preventButtonFocus}>
                                    {caseSensitiveDecl && <ToggleIconButton decl={caseSensitiveDecl} />}
                                    {wholeWordDecl && <ToggleIconButton decl={wholeWordDecl} />}
                                    {regexDecl && <ToggleIconButton decl={regexDecl} />}
                                </div>
                            )}

                            <div className="right-buttons" onMouseDown={preventButtonFocus}>
                                <IconButton decl={prevDecl} />
                                <IconButton decl={nextDecl} />
                                <IconButton decl={closeDecl} />
                            </div>
                        </div>
                        {replaceAvailable && replaceExpanded && (
                            <div className="search-row replace-row">
                                <Input
                                    ref={replaceInputRef}
                                    placeholder="Replace"
                                    value={replaceValue}
                                    onChange={setReplaceValue}
                                    onKeyDown={onReplaceKeyDown}
                                    onFocus={() => {
                                        activeInputRef.current = "replace";
                                        searchLog("replace input focus", { replacementLength: replaceValue.length });
                                    }}
                                    onBlur={() =>
                                        searchLog("replace input blur", { replacementLength: replaceValue.length })
                                    }
                                />
                                <div className="right-buttons" onMouseDown={preventButtonFocus}>
                                    <IconButton decl={replaceDecl} />
                                    <IconButton decl={replaceAllDecl} />
                                </div>
                            </div>
                        )}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
};

export const Search = memo(SearchComponent) as typeof SearchComponent;

type SearchOptions = {
    anchorRef?: React.RefObject<HTMLElement>;
    viewModel?: ViewModel;
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    replace?: boolean;
};

export function useSearch(options?: SearchOptions): SearchProps {
    const searchAtoms: SearchAtoms = useMemo(
        () => ({
            searchValue: atom(""),
            resultsIndex: atom(0),
            resultsCount: atom(0),
            isOpen: atom(false),
            focusInput: atom(0),
            regex: options?.regex !== undefined ? atom(options.regex) : undefined,
            caseSensitive: options?.caseSensitive !== undefined ? atom(options.caseSensitive) : undefined,
            wholeWord: options?.wholeWord !== undefined ? atom(options.wholeWord) : undefined,
            replaceValue: options?.replace ? atom("") : undefined,
        }),
        []
    );
    const anchorRef = options?.anchorRef ?? useRef(null);
    useEffect(() => {
        if (options?.viewModel) {
            options.viewModel.searchAtoms = searchAtoms;
            return () => {
                options.viewModel.searchAtoms = undefined;
            };
        }
    }, [options?.viewModel]);
    return { ...searchAtoms, anchorRef };
}

const createToggleButtonDecl = (
    atom: WritableAtom<boolean, [boolean], void> | undefined,
    icon: string,
    title: string
): ToggleIconButtonDecl =>
    atom
        ? {
              elemtype: "toggleiconbutton",
              icon,
              title,
              active: atom,
          }
        : null;
