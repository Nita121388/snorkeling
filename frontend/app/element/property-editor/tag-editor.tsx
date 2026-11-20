// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 标签/列表属性编辑器（Wolai 风格浮层内容）。
//
// 共享层：md 预览属性卡（preview/plugins/md-properties）与 AI 会话属性面板
// （view/aisessions/property/property-list）共用，避免两套标签交互漂移。
//
// 交互对齐实测的 Wolai：
// - 已选 chip 与输入框在同一行流内（不是先弹一个空输入框）
// - 输入即过滤（子串包含）；**精确值不存在**时列表尾部追加一行「创建 xxx」（带 chip 预览）
//   —— 即使有子串命中（输入「设计中」命中「原型设计中」）创建行也要出现，否则精确值无法新增
// - 多选：点击 toggle；单选：点击即替换并关闭
// - 回车：默认 = 创建（精确值不存在时，延续「无匹配时回车即建」）或选中第一行；
//   方向键/悬停主动挑选过则选中高亮行（含创建行）
// - Backspace（空输入）删最后一个 chip；Esc / 点击浮层外部关闭
//
// 关闭语义（2026-11-20 修「列表弹窗容易误关闭」，task 11-20-property-status-to-select）：
// 只有三种情况关：Esc、点浮层外部（PropertyValuePopover 的 outsidePress）、
// 单选点选提交。**不做 blur 关门** —— 旧版容器 onBlur 把「焦点逃逸」当关闭信号，
// 在 Windows/Electron 下点浮层自身空白（列表 padding、行间隙）也会把焦点归 body
// → 立即误关。空白区 mousedown 一律 preventDefault 保住输入焦点，用户能继续打字。
//
// 数据语义仍守 markdown 优先：本组件只产出 string[]，写回由上层走最小 diff。

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { tagColorVars } from "./tag-palette";
import "./tag-editor.scss";

export type PropertyTagEditorProps = {
    items: string[];
    /** 候选值（P0：当前值全集；P1：vault 索引）。 */
    options?: string[];
    /**
     * 候选值的使用次数（可选）。
     *
     * 缺省时渲染结果与加入该参数之前**逐字节等价** —— md 预览属性卡没有 count 数据源，
     * 不传它就走旧路径。缺失的 key（用户新建的标签、本会话已选值）不渲染计数字段，
     * 不伪造 0。
     */
    optionCounts?: Record<string, number>;
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

/**
 * 是否显示「创建」行：输入非空，且候选与已选值里都没有**精确同名项**（忽略大小写）。
 *
 * 与显示过滤（子串包含）是两套判据：只要精确值不存在，即使候选里有子串命中
 * （输入「设计中」命中「原型设计中」），创建行也要出现 —— 否则精确值无法新增。
 * `selected` 可选：调用方传的 `options` 未必包含已选值（如 CommonText 全局清单），
 * 已选过的精确值不再出现在创建行里。
 */
export function canCreateOption(draft: string, options: string[], selected?: string[]): boolean {
    const value = draft.trim();
    if (value === "") return false;
    const lower = value.toLowerCase();
    if (options.some((o) => o.toLowerCase() === lower)) return false;
    if (selected?.some((c) => c.toLowerCase() === lower)) return false;
    return true;
}

export function PropertyTagEditor({
    items,
    options,
    optionCounts,
    multiple = true,
    placeholder,
    onChange,
    onClose,
}: PropertyTagEditorProps) {
    const { t } = useTranslation("element");
    const [chips, setChips] = useState<string[]>(items);
    const [draft, setDraft] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    // 有效高亮行是否被方向键/鼠标主动挑选过。未挑选时用默认高亮（见 active），
    // 挑选过则尊重 activeIndex —— 回车语义据此分流（见顶部交互注释）。
    const [activeTouched, setActiveTouched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        requestAnimationFrame(() => inputRef.current?.focus());
        // 仅在挂载时聚焦
    }, []);

    const candidates = useMemo(() => options ?? items, [options, items]);
    const filtered = useMemo(() => filterOptions(candidates, draft), [candidates, draft]);
    const showCreate = canCreateOption(draft, candidates, chips);
    const rows = filtered.length + (showCreate ? 1 : 0);
    // 默认高亮：精确值不存在 → 创建行（延续「无匹配时创建行高亮、回车即建」的现状）；
    // 否则第一行。主动挑选过（方向键/悬停）后以 activeIndex 为准。
    const active = Math.min(
        activeTouched ? activeIndex : showCreate ? filtered.length : 0,
        Math.max(rows - 1, 0)
    );

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
                if (active < filtered.length) {
                    const target = filtered[active];
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
                setActiveTouched(false);
                return;
            }
            if (e.key === "Backspace" && draft === "" && chips.length > 0) {
                e.preventDefault();
                removeValue(chips[chips.length - 1]);
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex(Math.min(active + 1, Math.max(rows - 1, 0)));
                setActiveTouched(true);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(Math.max(active - 1, 0));
                setActiveTouched(true);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        },
        [active, addValue, chips, draft, filtered, multiple, onClose, removeValue, rows, showCreate]
    );

    // 焦点移出整个浮层内容才关闭（点 chip 的 × 不算）
    // ↑ 旧版行为已删除：见顶部「关闭语义」注释。关闭只认 Esc / 浀层外部点击 / 单选提交。

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

    return (
        <div className="property-tag-editor" data-testid="property-tag-editor">
            <div className="ptag-selected">
                {chips.map((chip) => (
                    <span key={chip} className="ptag-chip" style={tagColorVars(chip)}>
                        <span className="ptag-chip-text">{chip}</span>
                        <button
                            type="button"
                            className="ptag-chip-remove"
                            title={t("element:tagEditor.remove")}
                            aria-label={i18n.t("element:tagEditor.removeLabel", { value: chip })}
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
                    placeholder={chips.length === 0 ? (placeholder ?? t("element:tagEditor.placeholder")) : ""}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setActiveIndex(0);
                        setActiveTouched(false);
                    }}
                    onKeyDown={handleKeyDown}
                />
            </div>
            {/* 列表区空白（padding、行间隙）mousedown 一律 preventDefault：
                不让焦点归 body（旧版会因此触发 onBlur 误关），用户点空后还能继续打字。
                选项行自身也有 preventDefault，这里是从容器层面兑底。 */}
            <div className="ptag-list" onMouseDown={(e) => e.preventDefault()}>
                {filtered.map((option, i) => (
                    <div
                        key={option}
                        className={clsx("ptag-option", i === active && "is-active", chips.includes(option) && "is-selected")}
                        role="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => {
                            setActiveIndex(i);
                            setActiveTouched(true);
                        }}
                        onClick={() => toggleValue(option)}
                    >
                        <span className="ptag-option-chip" style={tagColorVars(option)}>
                            {option}
                        </span>
                        {/* 行尾组：计数 + 选中 ✓，整体靠右。
                            用组而不是给两个元素各加 margin-left:auto —— 那样自由空间会被两个 auto 平分，
                           ✓ 会跑到中间。没有 count 时组里只剩 ✓，视觉与之前一致。 */}
                        <span className="ptag-option-tail">
                            {optionCounts?.[option] != null ? (
                                <span
                                    className="ptag-option-count"
                                    aria-label={i18n.t("element:tagEditor.countAria", { count: optionCounts[option] })}
                                >
                                    {optionCounts[option]}
                                </span>
                            ) : null}
                            {/* 选中态用行尾 ✓ 表达：不再给 chip 描边（描边会让同色 chip 看起来像另一个控件）。 */}
                            {chips.includes(option) && (
                                <i className="fa-sharp fa-solid fa-check ptag-option-check" aria-hidden="true" />
                            )}
                        </span>
                    </div>
                ))}
                {showCreate && (
                    <div
                        className={clsx("ptag-option", "is-create", active === filtered.length && "is-active")}
                        role="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => {
                            setActiveIndex(filtered.length);
                            setActiveTouched(true);
                        }}
                        onClick={() => {
                            addValue(draft);
                            setDraft("");
                            setActiveIndex(0);
                            setActiveTouched(false);
                        }}
                    >
                        <span className="ptag-option-chip" style={tagColorVars(draft.trim())}>
                            {draft.trim()}
                        </span>
                        <span className="ptag-create-label">{t("element:tagEditor.create")}</span>
                    </div>
                )}
                {rows === 0 && <div className="ptag-empty">{t("element:tagEditor.empty")}</div>}
            </div>
        </div>
    );
}
