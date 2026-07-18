// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { normalizeSessionTags } from "./session-tags";

function SessionTagChips({
    tags,
    selectedTags,
    removable = false,
    onRemove,
    onClick,
    countMap,
    className,
}: {
    tags: string[] | null | undefined;
    selectedTags?: string[];
    removable?: boolean;
    onRemove?: (tag: string) => void;
    onClick?: (tag: string) => void;
    countMap?: Map<string, number>;
    className?: string;
}) {
    const normalizedTags = normalizeSessionTags(tags);
    if (normalizedTags.length === 0) return null;
    const selected = new Set(normalizeSessionTags(selectedTags));
    return (
        <div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
            {normalizedTags.map((tag) => {
                const active = selected.has(tag);
                const clickable = onClick != null;
                const count = countMap?.get(tag.toLowerCase()) ?? countMap?.get(tag);
                return (
                    <button
                        key={tag}
                        type="button"
                        className={cn(
                            "inline-flex h-6 max-w-full items-center gap-1 rounded-md px-2 text-[11px] leading-none cursor-pointer",
                            active ? "bg-accent/10 text-accent" : "bg-surface-soft text-secondary",
                            clickable && "hover:bg-hover hover:text-primary"
                        )}
                        title={`#${tag}`}
                        disabled={!clickable && !removable}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (removable) {
                                onRemove?.(tag);
                            } else {
                                onClick?.(tag);
                            }
                        }}
                    >
                        <span className="truncate">
                            <span className="opacity-50">#</span>
                            {tag}
                        </span>
                        {count != null ? <span className="text-[10px] opacity-70">{count}</span> : null}
                        {removable ? (
                            <i className="fa-sharp fa-solid fa-xmark text-[9px] opacity-60" />
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}

export { SessionTagChips };
