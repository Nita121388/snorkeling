// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { Input, InputGroup, InputRightElement } from "@/app/element/input";
import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { copyText } from "@/util/clipboard";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import React, { forwardRef, useLayoutEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";

import "./typeaheadmodal.scss";

import "./typeaheadmodal.scss";

/**
 * Badge spec per connection source. Icons instead of words because the row is a dense list and
the meaning belongs in the tooltip - the same rule the rest of this list follows.
 */
const ConnectionSourceBadge: Record<string, { icon: string; solid: boolean; title: string }> = {
    settings: {
        icon: "gear",
        solid: true,
        title: "Configured in Snorkeling (settings.json)",
    },
    sshconfig: {
        icon: "file-lines",
        solid: false,
        title: "From ~/.ssh/config",
    },
    history: {
        icon: "clock-rotate-left",
        solid: false,
        title: "No current config; this machine connected to it before",
    },
};

interface SuggestionsProps {
    suggestions?: SuggestionsType[];
    onSelect?: (_: string) => void;
    selectIndex: number;
}

/**
 * One row renders as three zones: left icon / ellipsizable label / fixed-width right rail.
 * The rail is a direct child of the row on purpose - when the badges lived inside the
 * label box (whose width is its content) `margin-left: auto` could only push them to the
 * end of the text, so every row's icons sat at a different x.
 */
const Suggestions = forwardRef<HTMLDivElement, SuggestionsProps>(
    ({ suggestions, onSelect, selectIndex }: SuggestionsProps, ref) => {
        const { t } = useTranslation("modals");

        const renderIcon = (icon: string | React.ReactNode, color: string) => {
            if (typeof icon === "string") {
                return <i className={makeIconClass(icon, false)} style={{ color: color }}></i>;
            }
            return icon;
        };

        const handleRowClick = (item: SuggestionBaseItem | SuggestionConnectionItem) => {
            if ("onSelect" in item && item.onSelect) {
                item.onSelect(item.value);
            } else {
                onSelect(item.value);
            }
        };

        const renderSources = (sources: string[]) => {
            const known = sources.filter((source) => ConnectionSourceBadge[source] != null);
            if (known.length === 0) return null;
            // 来源徽标只占右侧固定小位，不增加行高；含义全走 title（读屏用 aria-label）。
            return (
                <span className="typeahead-item-source" data-conn-sources={known.join(",")}>
                    {known.map((source) => {
                        const spec = ConnectionSourceBadge[source];
                        return (
                            <i
                                key={source}
                                className={clsx(makeIconClass(spec.icon, spec.solid), "typeahead-source-icon")}
                                title={spec.title}
                                aria-label={spec.title}
                                data-conn-source={source}
                            />
                        );
                    })}
                </span>
            );
        };

        const renderItem = (item: SuggestionBaseItem | SuggestionConnectionItem, index: number) => {
            const sources = "sources" in item && Array.isArray(item.sources) ? item.sources : null;
            // 只有「连接名」语义的行才给复制槽：动作行（Disconnect / Edit Connections /
            // New Connection）与本机行复制出来是空串或命令名，等于骗人。
            const copyValue =
                "copyText" in item && typeof item.copyText === "string" && item.copyText.trim() !== ""
                    ? item.copyText
                    : null;
            const isCurrent = "current" in item && item.current === true;
            const hasRail = (sources?.length ?? 0) > 0 || copyValue != null || isCurrent;
            return (
                <div
                    key={index}
                    data-row-index={index}
                    onClick={() => handleRowClick(item)}
                    className={clsx("suggestion-item", { selected: selectIndex === index })}
                >
                    <div className="typeahead-item-name">
                        {item.icon &&
                            renderIcon(item.icon, "iconColor" in item && item.iconColor ? item.iconColor : "inherit")}
                        <span className="typeahead-item-label ellipsis">{item.label}</span>
                    </div>
                    {hasRail && (
                        <div className="typeahead-item-rail">
                            {sources != null && renderSources(sources)}
                            {copyValue != null && (
                                // 复制槽常驻固定宽度（默认 opacity 0），hover 才浮现 —— 这样
                                // 悬浮不会改变行宽/行高，也不会让 trailing 图标左右跳。
                                // stopPropagation：点复制不能顺带把这一行的连接动作也触发了。
                                <span
                                    className="typeahead-row-copy"
                                    data-copy-conn={copyValue}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <CopyButton
                                        title={t("modals:connTypeahead.copyName")}
                                        onClick={() => copyText(copyValue)}
                                    />
                                </span>
                            )}
                            {isCurrent && (
                                <i className={clsx(makeIconClass("check", false), "typeahead-current-checkbox")} />
                            )}
                        </div>
                    )}
                </div>
            );
        };

        let fullIndex = -1;
        return (
            <div ref={ref} className="suggestions">
                {suggestions.map((item, index) => {
                    if ("headerText" in item) {
                        return (
                            <div key={index}>
                                {item.headerText && <div className="suggestion-header">{item.headerText}</div>}
                                {item.items.map((subItem, subIndex) => {
                                    fullIndex += 1;
                                    return renderItem(subItem, fullIndex);
                                })}
                            </div>
                        );
                    }
                    fullIndex += 1;
                    return renderItem(item as SuggestionBaseItem, fullIndex);
                })}
            </div>
        );
    }
);

/**
 * 骨架条宽度：刻意不等宽，看起来像一串真实连接名而不是表格。
 * 行数与行高都要和真实行对齐，否则「加载完成」那一下会整体跳高。
 */
const SkeletonRowWidths = ["62%", "78%", "54%", "70%", "46%"];

interface TypeAheadModalProps {
    anchorRef: React.RefObject<HTMLElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
    suggestions?: SuggestionsType[];
    label?: string;
    className?: string;
    value?: string;
    onChange?: (_: string) => void;
    onSelect?: (_: string) => void;
    onClickBackdrop?: () => void;
    onKeyDown?: (_) => void;
    giveFocusRef?: React.RefObject<() => boolean>;
    autoFocus?: boolean;
    selectIndex?: number;
    /** 数据未到位：渲染骨架行并保持面板布局，不再「先塌成输入框再撑开」。 */
    loading?: boolean;
}

const TypeAheadModal = ({
    className,
    suggestions,
    label,
    anchorRef,
    blockRef,
    value,
    onChange,
    onSelect,
    onKeyDown,
    onClickBackdrop,
    giveFocusRef,
    autoFocus,
    selectIndex,
    loading,
}: TypeAheadModalProps) => {
    const { t } = useTranslation("modals");
    const domRect = useDimensionsWithExistingRef(blockRef, 30);
    const width = domRect?.width ?? 0;
    const height = domRect?.height ?? 0;
    const modalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const inputGroupRef = useRef<HTMLDivElement>(null);
    const suggestionsWrapperRef = useRef<HTMLDivElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const busy = loading === true;
    const hasSuggestions = !busy && (suggestions?.length ?? 0) > 0;
    // 骨架也算「有内容」：面板要提前占住真实高度，否则加载完会跳一下。
    const hasContent = busy || hasSuggestions;

    useLayoutEffect(() => {
        if (!modalRef.current || !inputGroupRef.current || !suggestionsRef.current || !suggestionsWrapperRef.current) {
            return;
        }

        const modalStyles = window.getComputedStyle(modalRef.current);
        const paddingTop = parseFloat(modalStyles.paddingTop) || 0;
        const paddingBottom = parseFloat(modalStyles.paddingBottom) || 0;
        const borderTop = parseFloat(modalStyles.borderTopWidth) || 0;
        const borderBottom = parseFloat(modalStyles.borderBottomWidth) || 0;
        const modalPadding = paddingTop + paddingBottom;
        const modalBorder = borderTop + borderBottom;

        const suggestionsWrapperStyles = window.getComputedStyle(suggestionsWrapperRef.current);
        const suggestionsWrapperMarginTop = parseFloat(suggestionsWrapperStyles.marginTop) || 0;

        const inputHeight = inputGroupRef.current.getBoundingClientRect().height;
        let suggestionsTotalHeight = 0;

        const suggestionItems = suggestionsRef.current.children;
        for (let i = 0; i < suggestionItems.length; i++) {
            suggestionsTotalHeight += suggestionItems[i].getBoundingClientRect().height;
        }

        const totalHeight =
            modalPadding + modalBorder + inputHeight + suggestionsTotalHeight + suggestionsWrapperMarginTop;
        const maxHeight = height * 0.8;
        const computedHeight = totalHeight > maxHeight ? maxHeight : totalHeight;

        modalRef.current.style.height = `${computedHeight}px`;

        suggestionsWrapperRef.current.style.height = `${computedHeight - inputHeight - modalPadding - modalBorder - suggestionsWrapperMarginTop}px`;
    }, [height, suggestions, loading]);

    useLayoutEffect(() => {
        if (!blockRef.current || !modalRef.current) return;

        const blockRect = blockRef.current.getBoundingClientRect();
        const anchorRect = anchorRef.current.getBoundingClientRect();

        const minGap = 20;

        const availableWidth = blockRect.width - minGap * 2;
        let modalWidth = 300;

        if (modalWidth > availableWidth) {
            modalWidth = availableWidth;
        }

        let leftPosition = anchorRect.left - blockRect.left;

        const modalRightEdge = leftPosition + modalWidth;
        const blockRightEdge = blockRect.width - (minGap - 4);

        if (modalRightEdge > blockRightEdge) {
            leftPosition -= modalRightEdge - blockRightEdge;
        }

        if (leftPosition < minGap) {
            leftPosition = minGap;
        }

        modalRef.current.style.width = `${modalWidth}px`;
        modalRef.current.style.left = `${leftPosition}px`;
    }, [width]);

    useLayoutEffect(() => {
        if (giveFocusRef) {
            giveFocusRef.current = () => {
                inputRef.current?.focus();
                return true;
            };
        }
        return () => {
            if (giveFocusRef) {
                giveFocusRef.current = null;
            }
        };
    }, []);

    useLayoutEffect(() => {
        if (anchorRef.current && modalRef.current) {
            const parentElement = anchorRef.current.closest(".block-frame-default-header");
            modalRef.current.style.top = `${parentElement?.getBoundingClientRect().height}px`;
        }
    }, []);

    const renderBackdrop = (onClick) => <div className="type-ahead-modal-backdrop" onClick={onClick}></div>;

    const handleKeyDown = (e) => {
        onKeyDown?.(e);
    };

    const handleChange = (value) => {
        onChange?.(value);
    };

    const handleSelect = (value) => {
        onSelect?.(value);
    };

    const renderModal = () => (
        <div className="type-ahead-modal-wrapper" onKeyDown={handleKeyDown}>
            {renderBackdrop(onClickBackdrop)}
            <div
                ref={modalRef}
                className={clsx("type-ahead-modal", className, { "has-suggestions": hasContent })}
            >
                <InputGroup ref={inputGroupRef}>
                    <Input
                        ref={inputRef}
                        onChange={handleChange}
                        value={value}
                        autoFocus={autoFocus}
                        placeholder={label}
                    />
                    <InputRightElement>
                        <i className="fa-regular fa-magnifying-glass"></i>
                    </InputRightElement>
                </InputGroup>
                <div
                    ref={suggestionsWrapperRef}
                    className="suggestions-wrapper"
                    style={{
                        marginTop: hasContent ? "8px" : "0",
                        overflowY: "auto",
                    }}
                >
                    {busy ? (
                        <div
                            ref={suggestionsRef}
                            className="suggestions typeahead-skeleton"
                            role="status"
                            aria-busy="true"
                            aria-label={t("modals:connTypeahead.loading")}
                        >
                            {SkeletonRowWidths.map((barWidth, index) => (
                                <div key={index} className="typeahead-skeleton-row">
                                    <span className="typeahead-skeleton-dot" />
                                    <span className="typeahead-skeleton-bar" style={{ width: barWidth }} />
                                </div>
                            ))}
                        </div>
                    ) : hasSuggestions ? (
                        <Suggestions
                            ref={suggestionsRef}
                            suggestions={suggestions}
                            onSelect={handleSelect}
                            selectIndex={selectIndex}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );

    if (blockRef && blockRef.current == null) {
        return null;
    }

    return ReactDOM.createPortal(renderModal(), blockRef.current);
};

export { Suggestions, TypeAheadModal };
