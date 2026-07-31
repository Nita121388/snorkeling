// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import type { BreadcrumbSegment, PathRootOption } from "./utils";
import type { DatePreset, DateRangeFilter, MarkedFilter, PathFilter, TagPresenceFilter } from "./types";
import { DefaultPathFilter, DefaultTagPresence, PathFilterOtherRoot } from "./types";

function msToDateInput(ms: number | undefined): string {
    if (!ms) return "";
    const d = new Date(ms);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function dayStartMs(value: string): number {
    if (!value) return 0;
    const t = new Date(value + "T00:00:00").getTime();
    return Number.isFinite(t) ? t : 0;
}

function dayEndMs(value: string): number {
    if (!value) return 0;
    const t = new Date(value + "T23:59:59.999").getTime();
    return Number.isFinite(t) ? t : 0;
}

const DatePresets: { value: DatePreset; label: string }[] = [
    { value: "all", label: "All" },
    { value: "today", label: "Today" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "custom", label: "Custom" },
];

const MarkedOptions: { value: MarkedFilter; icon: string; label: string }[] = [
    { value: "all", icon: "fa-solid fa-list", label: "All" },
    { value: "starred", icon: "fa-solid fa-star", label: "Starred" },
    { value: "unstarred", icon: "fa-regular fa-star", label: "Unstarred" },
];

const TagPresenceOptions: { value: TagPresenceFilter; icon: string; label: string }[] = [
    { value: "any", icon: "fa-solid fa-tag", label: "Any tags" },
    { value: "untagged", icon: "fa-regular fa-tag", label: "Untagged" },
];

function markedLabel(value: MarkedFilter): string {
    return MarkedOptions.find((o) => o.value === value)?.label ?? "";
}

function tagPresenceLabel(value: TagPresenceFilter): string {
    return TagPresenceOptions.find((o) => o.value === value)?.label ?? "";
}

function dateLabel(range: DateRangeFilter): string {
    if (range.preset === "custom") return "Custom";
    return DatePresets.find((p) => p.value === range.preset)?.label ?? "";
}

function SegTrack({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={cn("inline-flex rounded-lg border border-border/70 bg-surface p-0.5 shadow-sm", className)}>
            {children}
        </div>
    );
}

function SegButton({
    active,
    onClick,
    title,
    children,
}: {
    active: boolean;
    onClick: () => void;
    title: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                "flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs transition-colors",
                active
                    ? "border-border/70 bg-background text-primary shadow-sm"
                    : "text-secondary hover:bg-hover hover:text-primary"
            )}
        >
            {children}
        </button>
    );
}

function ActiveChip({
    icon,
    label,
    onRemove,
}: {
    icon?: string;
    label: string;
    onRemove: () => void;
}) {
    return (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent/10 px-1.5 pl-2.5 text-[11px] text-accent">
            {icon ? <i className={cn("fa-sharp", icon)} /> : null}
            <span className="truncate">{label}</span>
            <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={onRemove}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] opacity-65 hover:opacity-100 hover:bg-surface-strong cursor-pointer"
            >
                <i className="fa-sharp fa-solid fa-xmark" />
            </button>
        </span>
    );
}

export function FilterPanel({
    markedFilter,
    setMarkedFilter,
    dateRange,
    setDateRange,
    availableTags,
    tagFilters,
    tagPresence,
    setTagPresence,
    toggleTagFilter,
    onClearAll,
    pathFilter,
    setPathFilter,
    availablePathRoots,
    breadcrumbSegments,
}: {
    markedFilter: MarkedFilter;
    setMarkedFilter: (value: MarkedFilter) => void;
    dateRange: DateRangeFilter;
    setDateRange: (value: DateRangeFilter) => void;
    availableTags: SessionTagSummary[];
    tagFilters: string[];
    tagPresence: TagPresenceFilter;
    setTagPresence: (value: TagPresenceFilter) => void;
    toggleTagFilter: (tag: string) => void;
    onClearAll: () => void;
    pathFilter: PathFilter;
    setPathFilter: (value: PathFilter) => void;
    availablePathRoots: PathRootOption[];
    breadcrumbSegments: BreadcrumbSegment[];
}) {
    const selectedTags = new Set(tagFilters);
    const markedActive = markedFilter !== "all";
    const dateActive = dateRange.preset !== "all";
    const pathActive = pathFilter.root !== "";
    const tagPresenceActive = tagPresence !== DefaultTagPresence;
    // Untagged is mutually exclusive with tag-include at the ViewModel layer
    // (setTagPresence / setTagFilters enforce the reset on the other side).
    // We visually dim the tag chip row while Untagged is active so the user
    // sees the constraint instead of clicking into a no-op.
    const tagSectionDim = tagPresence === "untagged";
    const hasActive = markedActive || dateActive || pathActive || selectedTags.size > 0 || tagPresenceActive;
    return (
        <div className="m-2.5 overflow-hidden rounded-xl border border-border/60 bg-panel shadow-sm">
            <div className="flex items-center justify-end px-2.5 pt-2 pb-1">
                <button
                    type="button"
                    title="Clear all filters"
                    aria-label="Clear all filters"
                    onClick={onClearAll}
                    className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:text-accent cursor-pointer",
                        hasActive ? "text-secondary" : "text-secondary/50"
                    )}
                >
                    <i className="fa-sharp fa-solid fa-broom" />
                </button>
            </div>
            <div className="px-2.5 pb-1">
                <div className="flex items-center gap-2.5 py-1.5">
                    <i className="fa-sharp fa-solid fa-star w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                    <SegTrack>
                        {MarkedOptions.map((opt) => (
                            <SegButton
                                key={opt.value}
                                active={markedFilter === opt.value}
                                title={opt.label}
                                onClick={() => setMarkedFilter(opt.value)}
                            >
                                <i className={cn("fa-sharp text-[11px]", opt.icon)} />
                            </SegButton>
                        ))}
                    </SegTrack>
                    {markedActive ? (
                        <span className="text-[11px] text-secondary">{markedLabel(markedFilter)}</span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2.5 border-t border-border/40 py-1.5">
                    <i className="fa-sharp fa-regular fa-calendar w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                    <SegTrack className="flex-1">
                        {DatePresets.map((preset) => (
                            <SegButton
                                key={preset.value}
                                active={dateRange.preset === preset.value}
                                title={preset.label}
                                onClick={() => setDateRange({ preset: preset.value })}
                            >
                                {preset.label}
                            </SegButton>
                        ))}
                    </SegTrack>
                </div>
                {dateRange.preset === "custom" ? (
                    <div className="flex items-center gap-2.5 border-t border-border/40 py-1.5">
                        <i className="fa-sharp fa-regular fa-calendar w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                        <input
                            type="date"
                            value={msToDateInput(dateRange.from)}
                            onChange={(e) =>
                                setDateRange({ preset: "custom", from: dayStartMs(e.target.value), to: dateRange.to })
                            }
                            className="h-7 min-w-0 flex-1 rounded-md bg-surface px-2 text-xs text-primary outline-none focus:bg-surface-strong"
                        />
                        <span className="text-[11px] text-secondary">→</span>
                        <input
                            type="date"
                            value={msToDateInput(dateRange.to)}
                            onChange={(e) =>
                                setDateRange({ preset: "custom", from: dateRange.from, to: dayEndMs(e.target.value) })
                            }
                            className="h-7 min-w-0 flex-1 rounded-md bg-surface px-2 text-xs text-primary outline-none focus:bg-surface-strong"
                        />
                    </div>
                ) : null}
                {availablePathRoots.length > 0 ? (
                    <div className="flex items-center gap-2.5 border-t border-border/40 py-1.5">
                        <i className="fa-sharp fa-solid fa-folder-tree w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                        <SegTrack className="min-w-0 flex-1">
                            <SegButton
                                active={pathFilter.root === ""}
                                title="All paths"
                                onClick={() => setPathFilter(DefaultPathFilter)}
                            >
                                <span className="text-xs">All</span>
                            </SegButton>
                            {availablePathRoots.map((opt) => {
                                if (opt.isMore) {
                                    return null;
                                }
                                const active = pathFilter.root === opt.root;
                                return (
                                    <SegButton
                                        key={opt.root}
                                        active={active}
                                        title={
                                            opt.isOther
                                                ? `Other (empty / unrecognized projectPath) — ${opt.count}`
                                                : `${opt.label} (${opt.count})`
                                        }
                                        onClick={() => setPathFilter({ root: opt.root, subPath: "" })}
                                    >
                                        <span
                                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: opt.color }}
                                        />
                                        <span className="truncate text-xs">{opt.label}</span>
                                        <span className="rounded-full bg-surface-strong px-1 text-[9px] opacity-85 tabular-nums">
                                            {opt.count}
                                        </span>
                                    </SegButton>
                                );
                            })}
                        </SegTrack>
                    </div>
                ) : null}
                {pathFilter.root !== "" && pathFilter.root !== PathFilterOtherRoot && breadcrumbSegments.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1 border-t border-border/40 py-1.5 pl-[24px]">
                        {breadcrumbSegments.map((seg, index) => (
                            <span key={seg.fullPrefix} className="inline-flex items-center gap-1">
                                {index > 0 ? (
                                    <i className="fa-sharp fa-solid fa-angle-right text-[9px] text-secondary/60" />
                                ) : null}
                                <button
                                    type="button"
                                    title={seg.fullPrefix}
                                    onClick={() =>
                                        setPathFilter({
                                            root: pathFilter.root,
                                            subPath: seg.fullPrefix.slice(pathFilter.root.length),
                                        })
                                    }
                                    className={cn(
                                        "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] cursor-pointer",
                                        seg.isLeaf
                                            ? "bg-accent/10 text-accent"
                                            : "text-secondary hover:bg-hover hover:text-primary"
                                    )}
                                >
                                    <span className="truncate">{seg.label}</span>
                                    <span className="rounded-full bg-surface-strong px-1 text-[9px] opacity-85 tabular-nums">
                                        {seg.count}
                                    </span>
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="flex flex-col gap-1.5 border-t border-border/40 py-1.5">
                    <div className="flex items-center gap-2.5">
                        <i className="fa-sharp fa-solid fa-tag w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                        <SegTrack>
                            {TagPresenceOptions.map((opt) => (
                                <SegButton
                                    key={opt.value}
                                    active={tagPresence === opt.value}
                                    title={opt.label}
                                    onClick={() => setTagPresence(opt.value)}
                                >
                                    <i className={cn("fa-sharp text-[11px]", opt.icon)} />
                                </SegButton>
                            ))}
                        </SegTrack>
                        {tagPresenceActive ? (
                            <span className="text-[11px] text-secondary">{tagPresenceLabel(tagPresence)}</span>
                        ) : null}
                    </div>
                    {availableTags.length > 0 ? (
                        <div
                            className={cn(
                                "flex items-start gap-2.5 pl-[24px]",
                                tagSectionDim && "opacity-40 pointer-events-none"
                            )}
                        >
                            <div className="flex min-w-0 max-h-40 flex-wrap gap-1 overflow-y-auto pr-1">
                                {availableTags.map((tagSummary) => {
                                    const active = selectedTags.has(tagSummary.tag);
                                    return (
                                        <button
                                            key={tagSummary.tag}
                                            type="button"
                                            title={`#${tagSummary.tag}`}
                                            onClick={() => toggleTagFilter(tagSummary.tag)}
                                            className={cn(
                                                "inline-flex h-6 max-w-full items-center gap-1 rounded-md px-2 text-[11px] cursor-pointer",
                                                active
                                                    ? "bg-accent/10 text-accent"
                                                    : "bg-surface-soft text-secondary hover:bg-hover hover:text-primary"
                                            )}
                                        >
                                            <span className="truncate">
                                                <span className="opacity-50">#</span>
                                                {tagSummary.tag}
                                            </span>
                                            <span className="rounded-full bg-surface-strong px-1 text-[9px] opacity-85 tabular-nums">
                                                {tagSummary.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
            {hasActive ? (
                <div className="flex flex-wrap items-center gap-1 border-t border-border/40 px-2.5 py-2">
                    {tagPresenceActive ? (
                        <ActiveChip
                            icon="fa-regular fa-tag"
                            label={tagPresenceLabel(tagPresence)}
                            onRemove={() => setTagPresence(DefaultTagPresence)}
                        />
                    ) : null}
                    {markedActive ? (
                        <ActiveChip
                            icon={markedFilter === "starred" ? "fa-solid fa-star" : "fa-regular fa-star"}
                            label={markedLabel(markedFilter)}
                            onRemove={() => setMarkedFilter("all")}
                        />
                    ) : null}
                    {dateActive ? (
                        <ActiveChip label={dateLabel(dateRange)} onRemove={() => setDateRange({ preset: "all" })} />
                    ) : null}
                    {pathActive ? (
                        <ActiveChip
                            icon="fa-solid fa-folder-tree"
                            label={
                                pathFilter.root === PathFilterOtherRoot
                                    ? "Other"
                                    : pathFilter.subPath || pathFilter.root
                            }
                            onRemove={() => setPathFilter(DefaultPathFilter)}
                        />
                    ) : null}
                    {tagFilters.map((tag) => (
                        <ActiveChip
                            key={tag}
                            label={`#${tag}`}
                            onRemove={() => toggleTagFilter(tag)}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
