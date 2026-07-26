// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";

type CommonTextTagChipProps = {
    tag: string;
    count?: number;
    selected?: boolean;
    onClick?: () => void;
}; 

function commonTextTagChipClassName(selected?: boolean, clickable?: boolean): string {
    return cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] leading-none transition-colors",
        selected
            ? "border-transparent bg-accent/10 text-accent"
            : "border-border bg-surface-soft text-secondary",
        clickable && "cursor-pointer hover:bg-hover hover:text-primary"
    );
}

export function CommonTextTagChip({ tag, count, selected, onClick }: CommonTextTagChipProps) {
    const content = (
        <>
            <span className="truncate">
                <span className="opacity-50">#</span>
                {tag}
            </span>
            {count != null && <span className="text-[10px] opacity-70">{count}</span>}
        </>
    );
    if (onClick == null) {
        return <span className={commonTextTagChipClassName(selected)}>{content}</span>;
    }
    return (
        <button type="button" className={commonTextTagChipClassName(selected, true)} onClick={onClick}>
            {content}
        </button>
    );
}

type CommonTextTagListProps = {
    tags?: string[];
    maxVisible?: number;
    selectedTags?: string[];
};

export function CommonTextTagList({ tags = [], maxVisible, selectedTags = [] }: CommonTextTagListProps) {
    const visibleTags = maxVisible == null ? tags : tags.slice(0, maxVisible);
    const hiddenCount = maxVisible == null ? 0 : Math.max(0, tags.length - maxVisible);
    const selectedTagSet = new Set(selectedTags.map((tag) => tag.toLowerCase()));
    if (tags.length === 0) {
        return null;
    }
    return (
        <div className="flex min-w-0 flex-wrap gap-1">
            {visibleTags.map((tag) => (
                <CommonTextTagChip
                    key={tag}
                    tag={tag}
                    selected={selectedTagSet.has(tag.toLowerCase())}
                />
            ))}
            {hiddenCount > 0 && (
                <span className={commonTextTagChipClassName(false)}>
                    <span>+{hiddenCount}</span>
                </span>
            )}
        </div>
    );
}
