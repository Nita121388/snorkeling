// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { useState } from "react";
import { CHAT_SOURCES, getChatSource } from "./sources";
import type {
    AttachMode,
    DatePreset,
    DateRangeFilter,
    MarkedFilter,
    PathFilter,
    SourceFilter,
    TagPresenceFilter,
} from "./types";
import { DefaultPathFilter, DefaultTagPresence, PathFilterOtherRoot } from "./types";
import type { PathAncestorSegment, PathCountGroup, PathRootOption } from "./utils";
import { normalizePathPrefix, pathFilterToPrefix, pathPrefixCoveredBy, pathSelectionLabel } from "./utils";

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

type Mode = "include" | "exclude";

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (next: Mode) => void }) {
    return (
        <SegTrack>
            <SegButton active={mode === "include"} title="Include" onClick={() => onChange("include")}>
                <i className="fa-sharp fa-solid fa-check text-[10px]" />
            </SegButton>
            <SegButton active={mode === "exclude"} title="Exclude" onClick={() => onChange("exclude")}>
                <i className="fa-sharp fa-solid fa-ban text-[10px]" />
            </SegButton>
        </SegTrack>
    );
}

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
    title,
    tone,
    onRemove,
}: {
    icon?: string;
    label: string;
    title?: string;
    /** "exclude" renders the negative-filter style (⊘ + dashed error border). */
    tone?: "exclude";
    onRemove: () => void;
}) {
    return (
        <span
            title={title}
            className={cn(
                "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-1.5 pl-2.5 text-[11px]",
                tone === "exclude"
                    ? "border border-dashed border-error/60 bg-error/10 text-error"
                    : "bg-accent/10 text-accent"
            )}
        >
            {icon ? <i className={cn("fa-sharp", icon)} /> : null}
            <span className="min-w-0 truncate">{label}</span>
            <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={onRemove}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] opacity-65 hover:opacity-100 hover:bg-surface-strong cursor-pointer"
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
    source,
    setSource,
    attachMode,
    setAttachMode,
    availableTags,
    tagFilters,
    excludeTags,
    tagPresence,
    setTagPresence,
    toggleTagFilter,
    toggleExcludeTag,
    onClearAll,
    pathFilter,
    setPathFilter,
    pathSelections,
    togglePathSelection,
    pathExcludes,
    togglePathExclude,
    availablePathRoots,
    pathChildren,
    pathAncestors,
}: {
    markedFilter: MarkedFilter;
    setMarkedFilter: (value: MarkedFilter) => void;
    dateRange: DateRangeFilter;
    setDateRange: (value: DateRangeFilter) => void;
    source: SourceFilter;
    setSource: (value: SourceFilter) => void;
    /** 筛选结果是否补带父子上下文行（精确 / 智能 / 只带子代理）。 */
    attachMode: AttachMode;
    setAttachMode: (value: AttachMode) => void;
    availableTags: SessionTagSummary[];
    tagFilters: string[];
    excludeTags: string[];
    tagPresence: TagPresenceFilter;
    setTagPresence: (value: TagPresenceFilter) => void;
    toggleTagFilter: (tag: string) => void;
    toggleExcludeTag: (tag: string) => void;
    onClearAll: () => void;
    pathFilter: PathFilter;
    setPathFilter: (value: PathFilter) => void;
    /** 包含侧已选目录前缀（多选并集） */
    pathSelections: string[];
    togglePathSelection: (prefix: string) => void;
    /** 排除侧目录前缀 */
    pathExcludes: string[];
    togglePathExclude: (prefix: string) => void;
    availablePathRoots: PathRootOption[];
    pathChildren: PathCountGroup[];
    pathAncestors: PathAncestorSegment[];
}) {
    // 含/排 模式：chips 点击根据当前模式分发（同一段内互斥，避免一个 chip 承载三态）。
    const [tagMode, setTagMode] = useState<Mode>("include");
    const [pathMode, setPathMode] = useState<Mode>("include");
    const selectedTags = new Set(tagFilters);
    const excludedTags = new Set(excludeTags);
    const selectedPaths = new Set(pathSelections);
    const excludedPaths = new Set(pathExcludes);
    const markedActive = markedFilter !== "all";
    const dateActive = dateRange.preset !== "all";
    const pathActive = pathSelections.length > 0;
    const pathExcludeActive = pathExcludes.length > 0;
    const tagPresenceActive = tagPresence !== DefaultTagPresence;
    const sourceActive = source !== "";
    const tagExcludeActive = excludeTags.length > 0;
    // Untagged is mutually exclusive with tag-include at the ViewModel layer
    // (setTagPresence / setTagFilters enforce the reset on the other side).
    // We visually dim the tag chip row while Untagged is active so the user
    // sees the constraint instead of clicking into a no-op.
    const tagSectionDim = tagPresence === "untagged";
    const hasActive =
        markedActive ||
        dateActive ||
        pathActive ||
        pathExcludeActive ||
        selectedTags.size > 0 ||
        tagExcludeActive ||
        tagPresenceActive ||
        sourceActive;
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
                    <i className="fa-sharp fa-solid fa-robot w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                    <SegTrack className="min-w-0 flex-1">
                        <SegButton
                            active={source === ""}
                            title="All agents"
                            onClick={() => setSource("")}
                        >
                            <span className="text-xs">All</span>
                        </SegButton>
                        {CHAT_SOURCES.map((s) => (
                            <SegButton
                                key={s.id}
                                active={source === s.id}
                                title={s.label}
                                onClick={() => setSource(s.id as SourceFilter)}
                            >
                                {s.icon ? (
                                    <span className="flex items-center [&_svg]:h-3.5 [&_svg]:w-3.5">{s.icon}</span>
                                ) : null}
                                <span className="text-xs">{s.label}</span>
                            </SegButton>
                        ))}
                    </SegTrack>
                    {sourceActive ? (
                        <span className="text-[11px] text-secondary">{getChatSource(source).label}</span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2.5 border-t border-border/40 py-1.5">
                    <i className="fa-sharp fa-solid fa-sitemap w-3.5 shrink-0 text-center text-[11px] text-secondary" />
                    <SegTrack className="flex-1">
                        <SegButton
                            active={attachMode === "off"}
                            title="精确：只显示自身命中筛选的会话"
                            onClick={() => setAttachMode("off")}
                        >
                            <span className="text-xs">精确</span>
                        </SegButton>
                        <SegButton
                            active={attachMode === "both"}
                            title="智能：命中子代理时补带父，命中父代理时带出子代理"
                            onClick={() => setAttachMode("both")}
                        >
                            <span className="text-xs">智能</span>
                        </SegButton>
                        <SegButton
                            active={attachMode === "children"}
                            title="只带出子代理：命中父才展开子，命中子不回填父"
                            onClick={() => setAttachMode("children")}
                        >
                            <span className="text-xs">只带子</span>
                        </SegButton>
                    </SegTrack>
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
                                active={pathSelections.length === 0 && pathExcludes.length === 0}
                                title="All paths"
                                onClick={() => {
                                    setPathFilter(DefaultPathFilter);
                                    pathSelections.forEach((prefix) => togglePathSelection(prefix));
                                    pathExcludes.forEach((prefix) => togglePathExclude(prefix));
                                }}
                            >
                                <span className="text-xs">All</span>
                            </SegButton>
                            {availablePathRoots.map((opt) => {
                                if (opt.isMore) {
                                    return null;
                                }
                                const active =
                                    pathMode === "include"
                                        ? selectedPaths.has(opt.root)
                                        : excludedPaths.has(opt.root);
                                return (
                                    <SegButton
                                        key={opt.root}
                                        active={active}
                                        title={
                                            opt.isOther
                                                ? `Other (empty / unrecognized projectPath) — ${opt.count}`
                                                : `${opt.label} (${opt.count})`
                                        }
                                        onClick={() => {
                                            if (pathMode === "include") {
                                                togglePathSelection(opt.root);
                                                if (!selectedPaths.has(opt.root)) {
                                                    setPathFilter({ root: opt.root, subPath: "" });
                                                }
                                            } else {
                                                togglePathExclude(opt.root);
                                            }
                                        }}
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
                        <ModeToggle mode={pathMode} onChange={setPathMode} />
                    </div>
                ) : null}
                {pathFilter.root !== "" && pathFilter.root !== PathFilterOtherRoot ? (
                    <div className="flex flex-col gap-1.5 border-t border-border/40 py-1.5 pl-[24px]">
                        {/* Parents chain: root + ancestors, current level highlighted.
                            Click any crumb to pop navigation back to that level.
                            Navigation is deliberately separate from selection: drilling
                            into a directory must never change the filter. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                            {[{ name: pathFilter.root, fullSubPath: "" }, ...pathAncestors].map((crumb, index) => {
                                const isCurrent = index === pathAncestors.length;
                                return (
                                    <span key={crumb.fullSubPath + index} className="inline-flex items-center gap-1">
                                        {index > 0 ? (
                                            <i className="fa-sharp fa-solid fa-angle-right text-[9px] text-secondary/60" />
                                        ) : null}
                                        <button
                                            type="button"
                                            title={
                                                crumb.fullSubPath === ""
                                                    ? pathFilter.root
                                                    : pathFilterToPrefix({
                                                          root: pathFilter.root,
                                                          subPath: crumb.fullSubPath,
                                                      })
                                            }
                                            onClick={() =>
                                                setPathFilter({ root: pathFilter.root, subPath: crumb.fullSubPath })
                                            }
                                            className={cn(
                                                "inline-flex h-6 min-w-0 max-w-[160px] items-center gap-1 rounded-md px-1.5 text-[11px] cursor-pointer",
                                                isCurrent
                                                    ? "bg-accent/10 text-accent"
                                                    : "text-secondary hover:bg-hover hover:text-primary"
                                            )}
                                        >
                                            <span className="truncate">{crumb.name}</span>
                                        </button>
                                    </span>
                                );
                            })}
                            {/* 当前浏览层级的一键选中/排除（浏览只导航，选不选由这两个按钮决定） */}
                            {pathFilterToPrefix(pathFilter) !== "" ? (
                                <span className="ml-auto inline-flex items-center gap-1">
                                    <button
                                        type="button"
                                        title={`Include ${pathFilterToPrefix(pathFilter)}`}
                                        aria-pressed={selectedPaths.has(normalizePathPrefix(pathFilterToPrefix(pathFilter)))}
                                        onClick={() => togglePathSelection(pathFilterToPrefix(pathFilter))}
                                        className={cn(
                                            "inline-flex h-5 w-5 items-center justify-center rounded-md text-[9px] cursor-pointer",
                                            selectedPaths.has(normalizePathPrefix(pathFilterToPrefix(pathFilter)))
                                                ? "bg-accent/15 text-accent"
                                                : "text-secondary hover:bg-hover hover:text-primary"
                                        )}
                                    >
                                        <i className="fa-sharp fa-solid fa-check" />
                                    </button>
                                    <button
                                        type="button"
                                        title={`Exclude ${pathFilterToPrefix(pathFilter)}`}
                                        aria-pressed={excludedPaths.has(normalizePathPrefix(pathFilterToPrefix(pathFilter)))}
                                        onClick={() => togglePathExclude(pathFilterToPrefix(pathFilter))}
                                        className={cn(
                                            "inline-flex h-5 w-5 items-center justify-center rounded-md text-[9px] cursor-pointer",
                                            excludedPaths.has(normalizePathPrefix(pathFilterToPrefix(pathFilter)))
                                                ? "bg-error/15 text-error"
                                                : "text-secondary hover:bg-hover hover:text-primary"
                                        )}
                                    >
                                        <i className="fa-sharp fa-solid fa-ban" />
                                    </button>
                                </span>
                            ) : null}
                        </div>
                        {/* Direct children of the selected path: one chip per child dir,
                            with real counts from the full distribution. Scrollable when long.
                            Name area toggles selection; the › chevron drills down. */}
                        {pathChildren.length > 0 ? (
                            <div className="flex max-h-[132px] min-w-0 flex-wrap items-start gap-1 overflow-y-auto pr-1">
                                {pathChildren.map((child) => {
                                    const sep = pathFilter.root.endsWith("\\") ? "\\" : "/";
                                    const childSubPath = pathFilter.subPath
                                        ? `${pathFilter.subPath}${sep}${child.name}`
                                        : child.name;
                                    const prefix = pathFilterToPrefix({
                                        root: pathFilter.root,
                                        subPath: childSubPath,
                                    });
                                    const active =
                                        pathMode === "include"
                                            ? selectedPaths.has(prefix)
                                            : excludedPaths.has(prefix);
                                    const covered =
                                        pathMode === "include" &&
                                        !active &&
                                        pathPrefixCoveredBy(prefix, pathSelections);
                                    return (
                                        <span
                                            key={child.name}
                                            className={cn(
                                                "inline-flex h-6 max-w-full items-center rounded-md text-[11px]",
                                                active
                                                    ? pathMode === "include"
                                                        ? "bg-accent/10 text-accent"
                                                        : "bg-error/10 text-error border border-dashed border-error/60"
                                                    : covered
                                                      ? "bg-accent/5 text-accent/80"
                                                      : "bg-surface-soft text-secondary"
                                            )}
                                        >
                                            <button
                                                type="button"
                                                title={
                                                    covered
                                                        ? `${prefix} — already covered by a parent selection`
                                                        : `${pathMode === "include" ? "Include" : "Exclude"} ${prefix}`
                                                }
                                                onClick={() =>
                                                    pathMode === "include"
                                                        ? togglePathSelection(prefix)
                                                        : togglePathExclude(prefix)
                                                }
                                                className="inline-flex h-6 min-w-0 items-center gap-1 rounded-l-md px-1.5 hover:bg-hover/60 cursor-pointer"
                                            >
                                                {active || covered ? (
                                                    <i className="fa-sharp fa-solid fa-check text-[9px]" />
                                                ) : null}
                                                <span className="truncate">{child.name}</span>
                                                <span className="rounded-full bg-surface-strong px-1 text-[9px] opacity-85 tabular-nums">
                                                    {child.count}
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                title={`Browse ${prefix}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setPathFilter({
                                                        root: pathFilter.root,
                                                        subPath: childSubPath,
                                                    });
                                                }}
                                                className="inline-flex h-6 w-5 items-center justify-center rounded-r-md text-[9px] opacity-70 hover:opacity-100 hover:bg-hover cursor-pointer"
                                            >
                                                <i className="fa-sharp fa-solid fa-angle-right" />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        ) : pathChildren.length === 0 && pathAncestors.length > 0 ? (
                            <span className="text-[10px] text-secondary/70">No deeper subdirectories</span>
                        ) : null}
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
                        <span className={cn("ml-auto", tagSectionDim && "opacity-40 pointer-events-none")}>
                            <ModeToggle mode={tagMode} onChange={setTagMode} />
                        </span>
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
                                    const active =
                                        tagMode === "include"
                                            ? selectedTags.has(tagSummary.tag)
                                            : excludedTags.has(tagSummary.tag);
                                    return (
                                        <button
                                            key={tagSummary.tag}
                                            type="button"
                                            title={
                                                tagMode === "include"
                                                    ? `Include #${tagSummary.tag}`
                                                    : `Exclude #${tagSummary.tag}`
                                            }
                                            onClick={() =>
                                                tagMode === "include"
                                                    ? toggleTagFilter(tagSummary.tag)
                                                    : toggleExcludeTag(tagSummary.tag)
                                            }
                                            className={cn(
                                                "inline-flex h-6 max-w-full items-center gap-1 rounded-md px-2 text-[11px] cursor-pointer",
                                                active
                                                    ? tagMode === "include"
                                                        ? "bg-accent/10 text-accent"
                                                        : "border border-dashed border-error/60 bg-error/10 text-error"
                                                    : "bg-surface-soft text-secondary hover:bg-hover hover:text-primary"
                                            )}
                                        >
                                            {active ? (
                                                <i
                                                    className={cn(
                                                        "fa-sharp text-[9px]",
                                                        tagMode === "include" ? "fa-check" : "fa-ban"
                                                    )}
                                                />
                                            ) : null}
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
                    {sourceActive ? (
                        <ActiveChip
                            icon="fa-solid fa-robot"
                            label={getChatSource(source).label}
                            onRemove={() => setSource("")}
                        />
                    ) : null}
                    {dateActive ? (
                        <ActiveChip label={dateLabel(dateRange)} onRemove={() => setDateRange({ preset: "all" })} />
                    ) : null}
                    {pathActive ? (
                        pathSelections.map((prefix) => (
                            <ActiveChip
                                key={`path:${prefix}`}
                                icon="fa-solid fa-folder-tree"
                                label={pathSelectionLabel(prefix)}
                                title={prefix === PathFilterOtherRoot ? "Other (empty / unrecognized projectPath)" : prefix}
                                onRemove={() => togglePathSelection(prefix)}
                            />
                        ))
                    ) : null}
                    {pathExcludeActive ? (
                        pathExcludes.map((prefix) => (
                            <ActiveChip
                                key={`exclPath:${prefix}`}
                                tone="exclude"
                                icon="fa-solid fa-ban"
                                label={pathSelectionLabel(prefix)}
                                title={prefix === PathFilterOtherRoot ? "Exclude Other" : `Exclude ${prefix}`}
                                onRemove={() => togglePathExclude(prefix)}
                            />
                        ))
                    ) : null}
                    {tagFilters.map((tag) => (
                        <ActiveChip key={tag} label={`#${tag}`} onRemove={() => toggleTagFilter(tag)} />
                    ))}
                    {excludeTags.map((tag) => (
                        <ActiveChip
                            key={`exclTag:${tag}`}
                            tone="exclude"
                            icon="fa-solid fa-ban"
                            label={`#${tag}`}
                            title={`Exclude #${tag}`}
                            onRemove={() => toggleExcludeTag(tag)}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
