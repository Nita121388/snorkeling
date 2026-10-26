// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 排序链下拉（SortMenu）。
//
// 形态（见 .trellis/tasks/10-26-aisessions-sort-chain/design.md §4）：
//  - 上半区：链内项，①②③ 序号 + 字段名 + 方向箭头（点击翻转）+ ✕（移除）
//  - 下半区：未入选项 ⊕（满 MaxSortChainLength 时置灰）
//  - 底部：Reset to default
//
// 纯受控组件：所有状态由父层 sortChainAtom 持有，这里只发 onChange。

import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { cn } from "@/util/util";
import { useState } from "react";
import {
    DefaultSortChain,
    MaxSortChainLength,
    SessionSortChain,
    SessionSortField,
    SessionSortKey,
} from "./types";

const FieldLabels: Record<SessionSortField, { name: string; icon: string }> = {
    time: { name: "Time", icon: "fa-clock" },
    messages: { name: "Messages", icon: "fa-comment-dots" },
    subagents: { name: "Sub-sessions", icon: "fa-sitemap" },
};

const DirectionLabels: Record<SessionSortField, { desc: string; asc: string }> = {
    time: { desc: "Newest first", asc: "Oldest first" },
    messages: { desc: "Most messages", asc: "Fewest messages" },
    subagents: { desc: "Most sub-sessions", asc: "Fewest sub-sessions" },
};

const CircledNumbers = ["①", "②", "③"];

function optionLabel(field: SessionSortField, desc: boolean): string {
    return desc ? DirectionLabels[field].desc : DirectionLabels[field].asc;
}

/** 按钮上显示的当前链摘要：单键用方向文案，多键用 `Time·Msgs·Subs`。 */
export function sortChainSummary(chain: SessionSortChain): string {
    const active = chain.length > 0 ? chain : DefaultSortChain;
    if (active.length === 1) {
        return optionLabel(active[0].field, active[0].desc);
    }
    return active.map((key) => FieldLabels[key.field].name).join("·");
}

function toggleDirection(chain: SessionSortChain, index: number): SessionSortChain {
    return chain.map((key, i) => (i === index ? { ...key, desc: !key.desc } : key));
}

function appendKey(chain: SessionSortChain, field: SessionSortField): SessionSortChain {
    if (chain.length >= MaxSortChainLength || chain.some((key) => key.field === field)) {
        return chain;
    }
    return [...chain, { field, desc: true }];
}

function removeKey(chain: SessionSortChain, index: number): SessionSortChain {
    const next = chain.filter((_, i) => i !== index);
    return next.length > 0 ? next : DefaultSortChain.map((key) => ({ ...key }));
}

export interface SortMenuProps {
    chain: SessionSortChain;
    onChange: (chain: SessionSortChain) => void;
}

export function SortMenu({ chain, onChange }: SortMenuProps) {
    const [open, setOpen] = useState(false);
    const [reference, setReference] = useState<HTMLButtonElement | null>(null);
    const activeChain = chain.length > 0 ? chain : DefaultSortChain;
    const inChain = new Set(activeChain.map((key) => key.field));
    const available = (Object.keys(FieldLabels) as SessionSortField[]).filter((field) => !inChain.has(field));
    const chainFull = activeChain.length >= MaxSortChainLength;
    const primary = activeChain[0];

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

    const directionIcon =
        primary.desc === false ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short";

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Sort by ${sortChainSummary(activeChain)}`}
                title={`Sort by ${sortChainSummary(activeChain)}`}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs transition-colors",
                    open
                        ? "bg-background text-primary shadow-sm ring-1 ring-accent/40"
                        : "bg-surface text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i className={cn("fa-sharp fa-solid text-[11px]", directionIcon)} />
                <span className="max-w-[110px] truncate">{sortChainSummary(activeChain)}</span>
                <i className="fa-sharp fa-solid fa-chevron-down text-[8px] opacity-60" />
            </button>
            {open && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{ ...floatingStyles, width: 264 }}
                        {...getFloatingProps()}
                        role="menu"
                        className="z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-modalbg shadow-xl backdrop-blur"
                    >
                        <div className="flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted">
                            <span>Sort by</span>
                            <span>
                                {activeChain.length} / {MaxSortChainLength}
                            </span>
                        </div>
                        <div className="border-t border-border/60 p-1">
                            {activeChain.map((key, index) => (
                                <div
                                    key={key.field}
                                    role="menuitem"
                                    data-sort-field={key.field}
                                    className="group flex h-[30px] items-center gap-1.5 rounded px-2 text-xs text-primary"
                                >
                                    <span className="w-4 shrink-0 text-center text-[11px] text-secondary">
                                        {CircledNumbers[index] ?? index + 1}
                                    </span>
                                    <i
                                        className={cn(
                                            "fa-sharp fa-solid w-3 shrink-0 text-[10px] text-secondary",
                                            FieldLabels[key.field].icon
                                        )}
                                    />
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-accent"
                                        title="Toggle direction"
                                        aria-label={`Toggle direction for ${FieldLabels[key.field].name}`}
                                        onClick={() =>
                                            onChange(toggleDirection(activeChain, index))
                                        }
                                    >
                                        {optionLabel(key.field, key.desc)}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${FieldLabels[key.field].name} from sort`}
                                        title="Remove"
                                        className="shrink-0 cursor-pointer rounded p-0.5 text-[10px] text-muted opacity-0 transition group-hover:opacity-100 hover:text-primary"
                                        onClick={() => onChange(removeKey(activeChain, index))}
                                    >
                                        <i className="fa fa-solid fa-xmark" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        {available.length > 0 && (
                            <div className="border-t border-border/60 p-1">
                                {available.map((field) => {
                                    const disabled = chainFull;
                                    return (
                                        <button
                                            key={field}
                                            type="button"
                                            role="menuitem"
                                            data-add-field={field}
                                            disabled={disabled}
                                            title={disabled ? `Max ${MaxSortChainLength} keys` : `Add ${FieldLabels[field].name}`}
                                            onClick={() => onChange(appendKey(activeChain, field))}
                                            className={cn(
                                                "flex h-[30px] w-full items-center gap-1.5 rounded px-2 text-xs transition-colors",
                                                disabled
                                                    ? "cursor-default text-muted opacity-50"
                                                    : "cursor-pointer text-secondary hover:bg-hover hover:text-primary"
                                            )}
                                        >
                                            <span className="w-4 shrink-0 text-center text-[11px]">⊕</span>
                                            <i
                                                className={cn(
                                                    "fa-sharp fa-solid w-3 shrink-0 text-[10px]",
                                                    FieldLabels[field].icon
                                                )}
                                            />
                                            <span className="min-w-0 flex-1 truncate text-left">
                                                {optionLabel(field, true)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className="border-t border-border/60 p-1">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    onChange(DefaultSortChain.map((key) => ({ ...key })));
                                    setOpen(false);
                                }}
                                className="flex h-[28px] w-full cursor-pointer items-center gap-1.5 rounded px-2 text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
                            >
                                <i className="fa-sharp fa-solid fa-rotate-left text-[10px]" />
                                <span>Reset to default</span>
                            </button>
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}

export type { SessionSortKey };
