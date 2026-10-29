// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「折叠」下拉：把子会话折叠与标签行内折叠收进一个和 SortMenu 同形的控件。
//
// 与排序正交：排序决定顺序，这里决定结构展开/收起，是纯视图偏好（不进筛选链）。
// 按钮摘要只显示子会话主状态；标签状态进 title，不拼进按钮文案（避免中点分隔符）。

import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { cn } from "@/util/util";
import { useState } from "react";

export type SubSessionsFold = "folded" | "expanded" | "smart";
export type TagsFold = "folded" | "expanded";

export interface FoldMenuProps {
    subSessionsFold: SubSessionsFold;
    tagsFold: TagsFold;
    onSubSessionsFoldChange: (value: SubSessionsFold) => void;
    onTagsFoldChange: (value: TagsFold) => void;
}

const SubSessionsLabels: { value: SubSessionsFold; label: string; title: string }[] = [
    { value: "folded", label: "Folded", title: "Collapse sub-sessions by default" },
    { value: "expanded", label: "Expanded", title: "Expand sub-sessions by default" },
    { value: "smart", label: "Smart", title: "Expand when the filter matches" },
];

const TagsLabels: { value: TagsFold; label: string; title: string }[] = [
    { value: "folded", label: "Folded", title: "Show the first four tags in every row" },
    { value: "expanded", label: "Expanded", title: "Show all tags in every row" },
];

/** 按钮上的摘要：只显示子会话状态。 */
export function foldSummary(value: SubSessionsFold): string {
    return SubSessionsLabels.find((item) => item.value === value)?.label ?? "Folded";
}

export function FoldMenu({ subSessionsFold, tagsFold, onSubSessionsFoldChange, onTagsFoldChange }: FoldMenuProps) {
    const [open, setOpen] = useState(false);
    const [reference, setReference] = useState<HTMLButtonElement | null>(null);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Fold sub-sessions: ${foldSummary(subSessionsFold)}`}
                title={`Sub-sessions: ${foldSummary(subSessionsFold)}`}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs transition-colors",
                    open
                        ? "bg-background text-primary"
                        : "bg-surface text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i className="fa-sharp fa-solid fa-layer-group text-[11px]" />
                <span className="max-w-[110px] truncate">{foldSummary(subSessionsFold)}</span>
                <i className="fa-sharp fa-solid fa-chevron-down text-[8px] opacity-60" />
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        className="z-50 flex w-56 flex-col overflow-hidden rounded-lg border border-border bg-modalbg"
                    >
                        <div className="border-b border-border/40 px-2.5 py-1.5 text-[12px] text-secondary">
                            Sub-sessions
                        </div>
                        <div className="p-1.5">
                            <Segmented
                                options={SubSessionsLabels}
                                value={subSessionsFold}
                                onChange={onSubSessionsFoldChange}
                            />
                        </div>
                        <div className="border-b border-t border-border/40 px-2.5 py-1.5 text-[12px] text-secondary">
                            Tags
                        </div>
                        <div className="p-1.5">
                            <Segmented options={TagsLabels} value={tagsFold} onChange={onTagsFoldChange} />
                        </div>
                    </div>
                </FloatingPortal>
            ) : null}
        </>
    );
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string; title: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex rounded-md border border-border bg-surface p-0.5">
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        title={option.title}
                        aria-label={option.title}
                        aria-pressed={active}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "flex h-6 flex-1 cursor-pointer items-center justify-center rounded px-1.5 text-[12px] transition-colors duration-250 ease-out",
                            active ? "bg-background text-primary" : "text-secondary hover:text-primary"
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
