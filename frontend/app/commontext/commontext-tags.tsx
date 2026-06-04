// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";

type CommonTextTagChipProps = {
    tag: string;
    count?: number;
    selected?: boolean;
    compact?: boolean;
    onClick?: () => void;
};

function commonTextTagChipClassName(selected?: boolean, compact?: boolean): string {
    return cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-medium leading-none transition-colors",
        compact ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        selected
            ? "border-accent bg-highlightbg text-primary"
            : "border-border bg-background text-secondary hover:border-accent/70 hover:text-primary"
    );
}

export function CommonTextTagChip({ tag, count, selected, compact, onClick }: CommonTextTagChipProps) {
    const content = (
        <>
            <span className="truncate">#{tag}</span>
            {count != null && <span className="text-[10px] opacity-70">{count}</span>}
        </>
    );
    if (onClick == null) {
        return <span className={commonTextTagChipClassName(selected, compact)}>{content}</span>;
    }
    return (
        <button type="button" className={commonTextTagChipClassName(selected, compact)} onClick={onClick}>
            {content}
        </button>
    );
}

type CommonTextTagListProps = {
    tags?: string[];
    maxVisible?: number;
    selectedTags?: string[];
    compact?: boolean;
};

export function CommonTextTagList({ tags = [], maxVisible, selectedTags = [], compact }: CommonTextTagListProps) {
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
                    compact={compact}
                />
            ))}
            {hiddenCount > 0 && (
                <span className={commonTextTagChipClassName(false, compact)}>
                    <span>+{hiddenCount}</span>
                </span>
            )}
        </div>
    );
}
