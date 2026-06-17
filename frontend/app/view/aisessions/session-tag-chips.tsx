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
    className,
}: {
    tags: string[] | null | undefined;
    selectedTags?: string[];
    removable?: boolean;
    onRemove?: (tag: string) => void;
    onClick?: (tag: string) => void;
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
                return (
                    <button
                        key={tag}
                        type="button"
                        className={cn(
                            "inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 text-[10px] leading-none",
                            active ? "border-accent bg-accent/10 text-accent" : "border-border bg-bg/40 text-secondary",
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
                        <span className="truncate">#{tag}</span>
                        {removable ? <i className="fa-sharp fa-solid fa-xmark text-[9px]" /> : null}
                    </button>
                );
            })}
        </div>
    );
}

export { SessionTagChips };
