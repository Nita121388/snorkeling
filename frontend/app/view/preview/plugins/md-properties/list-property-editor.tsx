// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 列表属性编辑器 - 支持标签/列表类型的可视化编辑

import { useCallback, useEffect, useRef, useState } from "react";
import "./list-property-editor.scss";

type ListPropertyEditorProps = {
    /** 当前标签列表 */
    items: string[];
    /** 输入框占位符 */
    placeholder?: string;
    /** 标签变更回调 */
    onChange: (items: string[]) => void;
    /** 编辑结束回调 */
    onClose: () => void;
};

export function ListPropertyEditor({ items, placeholder, onChange, onClose }: ListPropertyEditorProps) {
    const [chips, setChips] = useState(items);
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 自动聚焦输入框
    useEffect(() => {
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const addChip = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (trimmed !== "" && !chips.includes(trimmed)) {
                setChips((prev) => [...prev, trimmed]);
            }
            setDraft("");
        },
        [chips],
    );

    const removeChip = useCallback((index: number) => {
        setChips((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addChip(draft);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onChange(chips);
                onClose();
            } else if (e.key === "Backspace" && draft === "" && chips.length > 0) {
                removeChip(chips.length - 1);
            }
        },
        [addChip, chips, draft, onChange, onClose, removeChip],
    );

    const handlePaste = useCallback(
        (e: React.ClipboardEvent) => {
            const text = e.clipboardData.getData("text/plain");
            if (text.includes(",") || text.includes("，")) {
                e.preventDefault();
                const newItems = text
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter((s) => s !== "" && !chips.includes(s));
                if (newItems.length > 0) {
                    setChips((prev) => [...prev, ...newItems]);
                }
            }
        },
        [chips],
    );

    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            // 如果焦点移到容器内的 chip 删除按钮，不关闭编辑器
            if (containerRef.current?.contains(e.relatedTarget as Node)) {
                return;
            }
            // 添加未完成的草稿
            if (draft.trim() !== "") {
                addChip(draft);
            }
            onChange(chips);
            onClose();
        },
        [addChip, chips, draft, onChange, onClose],
    );

    return (
        <div className="list-property-editor" ref={containerRef}>
            <div className="list-property-chips">
                {chips.map((chip, i) => (
                    <span key={`${chip}-${i}`} className="list-property-chip">
                        <span className="list-property-chip-text">{chip}</span>
                        <button
                            type="button"
                            className="list-property-chip-remove"
                            title="删除"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                removeChip(i);
                            }}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    className="list-property-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onBlur={handleBlur}
                    placeholder={chips.length === 0 ? (placeholder || "输入标签...") : ""}
                />
            </div>
        </div>
    );
}
