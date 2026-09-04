// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useEffect, useRef, useState } from "react";

interface InlineRenameInputProps {
    defaultValue: string;
    onCommit: (value: string) => void;
    onCancel: () => void;
    className?: string;
}

/**
 * Inline rename input used by the file directory table and the directory tree.
 * Matches Finder-style behavior: focuses and selects the basename (without the
 * extension), Enter/blur commits, Escape cancels. stopPropagation prevents the
 * keystrokes from leaking into the block-level directory shortcuts.
 */
export const InlineRenameInput = memo(
    ({ defaultValue, onCommit, onCancel, className }: InlineRenameInputProps) => {
        const [value, setValue] = useState(defaultValue);
        const doneRef = useRef(false);
        const inputRef = useRef<HTMLInputElement>(null);

        useEffect(() => {
            const el = inputRef.current;
            if (el == null) {
                return;
            }
            el.focus();
            // Select basename without the extension, like Finder. Dotfiles keep full selection.
            const dotIdx = defaultValue.lastIndexOf(".");
            if (dotIdx > 0 && !defaultValue.startsWith(".")) {
                el.setSelectionRange(0, dotIdx);
            } else {
                el.select();
            }
        }, [defaultValue]);

        const commit = () => {
            if (doneRef.current) {
                return;
            }
            doneRef.current = true;
            onCommit(value);
        };

        const cancel = () => {
            if (doneRef.current) {
                return;
            }
            doneRef.current = true;
            onCancel();
        };

        return (
            <input
                ref={inputRef}
                className={
                    className ??
                    "w-full min-w-0 rounded-[3px] border border-[var(--accent-color)] bg-[var(--overlay-bg-color)] px-1 py-[1px] text-sm outline-none"
                }
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancel();
                    }
                }}
                onBlur={() => commit()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
            />
        );
    }
);

InlineRenameInput.displayName = "InlineRenameInput";