// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { MouseEventHandler } from "react";
import { formatDateTimeToSecond } from "./utils";

export function SessionRow({
    session,
    selected,
    onSelect,
    onMark,
}: {
    session: SessionSummary;
    selected: boolean;
    onSelect: () => void;
    onMark: MouseEventHandler<HTMLButtonElement>;
}) {
    return (
        <div
            className={cn(
                "group cursor-pointer border-b border-border px-3 py-2 text-sm hover:bg-hover",
                selected && "bg-accent/10"
            )}
            onClick={onSelect}
        >
            <div className="flex min-w-0 items-start gap-2">
                <button
                    className="mt-0.5 shrink-0 text-secondary hover:text-accent"
                    title="Mark session"
                    onClick={onMark}
                >
                    <i
                        className={cn(
                            "fa-sharp",
                            session.marked ? "fa-solid fa-star text-accent" : "fa-regular fa-star"
                        )}
                    />
                </button>
                <div className="min-w-0 flex-1 border-l border-border pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate font-medium">{session.title || session.id}</div>
                        {session.note ? (
                            <span className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                                Note
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xxs text-secondary">
                        <span className="uppercase">{session.source}</span>
                        <span>{formatDateTimeToSecond(session.updatedAt || session.createdAt || 0)}</span>
                        <span>{session.messageCount ?? 0} msgs</span>
                    </div>
                    {session.snippet ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-secondary">{session.snippet}</div>
                    ) : null}
                    {session.note ? (
                        <div className="mt-1 line-clamp-1 border-l-2 border-accent/50 pl-2 text-xs text-primary">
                            {session.note}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
