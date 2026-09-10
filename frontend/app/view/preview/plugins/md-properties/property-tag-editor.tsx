// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 标签/列表属性编辑器（Wolai 风格浮层内容）。
//
// 交互对齐实测的 Wolai：
// - 已选 chip 与输入框在同一行流内（不是先弹一个空输入框）
// - 输入即过滤；无匹配时列表只剩一行「创建 xxx」（带 chip 预览）
// - 多选：点击 toggle；单选：点击即替换并关闭
// - Backspace（空输入）删最后一个 chip；Esc / 点击外部关闭
//
// 数据语义仍守 markdown 优先：本组件只产出 string[]，写回由上层走最小 diff。

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tagColorVars } from "./property-palette";
import "./property-tag-editor.scss";

export type PropertyTagEditorProps = {
    items: string[];
    /** 候选值（P0：当前值全集；P1：vault 索引）。 */
    options?: string[];
    /** 多选（tags/list）为 true；单选（tag）为 false。 */
    multiple?: boolean;
    placeholder?: string;
    onChange: (items: string[]) => void;
    onClose: () => void;
};

/** 候选过滤：包含匹配、忽略大小写与首尾空格，保留已选项（Wolai 同行为）。 */
export function filterOptions(options: string[], draft: string): string[] {
    const q = draft.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) => o.toLowerCase().includes(q));
}

/** 是否显示「创建」行：输入非空且候选里没有同名项。 */
export function canCreateOption(draft: string, options: string[]): boolean {
    const value = draft.trim();
    if (value === "") return false;
    return !options.some((o) => o.toLowerCase() === value.toLowerCase());
}

export function PropertyTagEditor({
    items,
    options,
    multiple = true,
    placeholder = "搜索或输入选项",
    onChange,
    onClose,
}: PropertyTagEditorProps) {
    const [chips, setChips] = useState<string[]>(items);
    const [draft, setDraft] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        requestAnimationFrame(() => inputRef.current?.focus());
        // 仅在挂载时聚焦
    }, []);

    const candidates = useMemo(() => options ?? items, [options, items]);
    const filtered = useMemo(() => filterOptions(candidates, draft), [candidates, draft]);
    const showCreate = canCreateOption(draft, candidates);

    const commit = useCallback(
        (next: string[]) => {
            setChips(next);
            onChange(next); // 即时写草稿（与 Wolai 的即时感一致；Revert 可回退）
        },
        [onChange]
    );

    const addValue = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            if (trimmed === "") return;
            if (!multiple) {
                commit([trimmed]);
                onClose();
                return;
            }
            if (chips.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
            commit([...chips, trimmed]);
        },
        [chips, commit, multiple, onClose]
    );

    const removeValue = useCallback(
        (value: string) => {
            commit(chips.filter((c) => c !== value));
        },
        [chips, commit]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (filtered.length > 0 && activeIndex < filtered.length) {
                    const target = filtered[activeIndex];
                    if (multiple && chips.includes(target)) {
                        removeValue(target);
                    } else {
                        addValue(target);
                    }
                } else if (showCreate) {
                    addValue(draft);
                }
                setDraft("");
                setActiveIndex(0);
                return;
            }
            if (e.key === "Backspace" && draft === "" && chips.length > 0) {
                e.preventDefault();
                removeValue(chips[chips.length - 1]);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        },
        [activeIndex, addValue, chips, draft, filtered, multiple, onClose, removeValue, showCreate]
    );

    // 焦点移出整个浮层内容才关闭（点 chip 的 × 不算）
    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            onClose();
        },
        [onClose]
    );

    const toggleValue = useCallback(
        (value: string) => {
            if (multiple && chips.includes(value)) {
                removeValue(value);
            } else {
                addValue(value);
            }
        },
        [addValue, chips, multiple, removeValue]
    );

    const rows = showCreate && filtered.length === 0 ? 1 : filtered.length;

    return (
        <div className="property-tag-editor" ref={containerRef} onBlur={handleBlur} data-testid="property-tag-editor">
            <div className="ptag-selected">
                {chips.map((chip) => (
                    <span key={chip} className="ptag-chip" style={tagColorVars(chip)}>
                        <span className="ptag-chip-text">{chip}</span>
                        <button
                            type="button"
                            className="ptag-chip-remove"
                            title="移除"
                            aria-label={`移除 ${chip}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => removeValue(chip)}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                    fill="currentColor"
                                    d="m5.976 4.856.09.077 5.933 5.934 5.934-5.934a.8.8 0 0 1 1.209 1.042l-.078.09-5.934 5.934 5.936 5.937a.8.8 0 0 1-1.042 1.208l-.09-.077L12 13.13l-5.933 5.934a.8.8 0 0 1-1.21-1.041l.078-.09 5.934-5.935-5.934-5.934a.8.8 0 0 1 1.042-1.208Z"
                                />
                            </svg>
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    className="ptag-input"
                    value={draft}
                    placeholder={chips.length === 0 ? placeholder : ""}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setActiveIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                />
            </div>
            <div className="ptag-list">
                {filtered.map((option, i) => (
                    <div
                        key={option}
                        className={clsx("ptag-option", i === activeIndex && "is-active", chips.includes(option) && "is-selected")}
                        role="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggleValue(option)}
                    >
                        <span className="ptag-option-chip" style={tagColorVars(option)}>
                            {option}
                        </span>
                    </div>
                ))}
                {showCreate && filtered.length === 0 && (
                    <div
                        className="ptag-option is-create is-active"
                        role="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            addValue(draft);
                            setDraft("");
                        }}
                    >
                        <span className="ptag-option-chip" style={tagColorVars(draft.trim())}>
                            {draft.trim()}
                        </span>
                        <span className="ptag-create-label">创建</span>
                    </div>
                )}
                {rows === 0 && filtered.length === 0 && !showCreate && (
                    <div className="ptag-empty">无匹配选项</div>
                )}
            </div>
        </div>
    );
}
