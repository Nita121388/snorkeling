// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    buildPathPanelSections,
    flattenPanelRows,
    type PathPanelRow,
    type PathSelection,
} from "@/app/view/preview/path-panel-model";
import {
    flip,
    FloatingPortal,
    limitShift,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
    type VirtualElement,
} from "@floating-ui/react";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PinnedDirectory = PinnedDirectoryType;

type NewFilesFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (selection: PathSelection) => void;
    /**
     * HTMLElement（右侧 WidgetsBar 的 Files widget 按钮）或 floating-ui VirtualElement
     * （Blocks 组「＋」菜单的冻结锚点快照，见 launch-popup-bus 的 LaunchPopupAnchor）。
     */
    referenceElement: HTMLElement | VirtualElement | null;
    pinnedDirs: PinnedDirectory[];
    usageEntries: PathUsageEntryType[];
    onTogglePin: (selection: PathSelection, label?: string) => void;
    onRemoveUsage: (selection: PathSelection) => void;
};

function rowIcon(row: PathPanelRow): string {
    if (row.pinned) return "fa-solid fa-star text-green";
    if (row.kind === "file") return "fa-regular fa-file text-muted";
    return "fa-regular fa-folder text-muted";
}

const NewFilesFloatingWindow = memo(function NewFilesFloatingWindow({
    isOpen,
    onClose,
    onSelect,
    referenceElement,
    pinnedDirs,
    usageEntries,
    onTogglePin,
    onRemoveUsage,
}: NewFilesFloatingWindowProps) {
    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        placement: "left-start",
        middleware: [offset(8), flip(), shift({ padding: 12, limiter: limitShift() })],
        elements: { reference: referenceElement },
        onOpenChange: (open) => {
            if (!open) onClose();
        },
    });

    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: true })]);

    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);

    const sections = useMemo(
        () =>
            buildPathPanelSections({
                pinnedDirs,
                usage: usageEntries,
                query,
                now: Date.now(),
            }),
        [pinnedDirs, usageEntries, query]
    );
    const rows = useMemo(() => flattenPanelRows(sections), [sections]);
    // Flat index per row: the same path can legitimately appear in both Pinned and
    // Frequent, so row keys are not unique across sections and cannot drive nav.
    const rowIndex = useMemo(() => {
        const map = new Map<PathPanelRow, number>();
        rows.forEach((row, index) => map.set(row, index));
        return map;
    }, [rows]);

    // Reset transient state whenever the panel opens so it always starts clean.
    useEffect(() => {
        if (!isOpen) return;
        setQuery("");
        setActiveIndex(-1);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(handle);
    }, [isOpen]);

    const handleSelect = useCallback(
        (row: PathPanelRow) => {
            onSelect({ path: row.path, connection: row.connection });
            onClose();
        },
        [onSelect, onClose]
    );

    const moveActive = useCallback(
        (delta: number) => {
            if (rows.length === 0) return;
            setActiveIndex((prev) => {
                if (prev < 0) return delta > 0 ? 0 : rows.length - 1;
                return (prev + delta + rows.length) % rows.length;
            });
        },
        [rows.length]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                moveActive(1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                moveActive(-1);
            } else if (e.key === "Enter") {
                e.preventDefault();
                const row = activeIndex >= 0 ? rows[activeIndex] : rows[0];
                if (row != null) handleSelect(row);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        },
        [moveActive, rows, activeIndex, handleSelect, onClose]
    );

    const copyPath = useCallback((path: string) => {
        void navigator.clipboard?.writeText(path);
    }, []);

    if (!isOpen) return null;

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl z-50 min-w-[400px] max-w-[480px] max-h-[min(500px,calc(100vh-32px))] overflow-hidden flex flex-col"
            >
                {/* header */}
                <div className="flex items-center px-3 py-2 text-sm font-medium text-foreground border-b border-border/60">
                    <i className="fa-solid fa-location-crosshairs text-accent text-xs mr-2" />
                    <span>Files</span>
                </div>

                {/* search */}
                <div className="px-2 pt-2 pb-1">
                    <div className="flex items-center gap-2 px-2 h-7 rounded-md bg-surface-soft/60 border border-border/50">
                        <i className="fa-solid fa-magnifying-glass text-[10px] text-muted" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Search paths"
                            className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted"
                            spellCheck={false}
                        />
                    </div>
                </div>

                {/* scrollable content */}
                <div className="flex-1 overflow-y-auto px-1 py-1 min-h-0">
                    {sections.map((section) => (
                        <div key={section.id} className="border-b border-border/60 last:border-b-0">
                            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] text-muted uppercase tracking-wide font-medium">
                                <i className={clsx(section.icon, "text-[10px]", section.id === "pinned" && "text-green")} />
                                <span>{section.title}</span>
                                <span className="text-[10px] px-1.5 rounded bg-surface-soft">{section.rows.length}</span>
                            </div>
                            {section.rows.length === 0 ? (
                                section.emptyHint != null ? (
                                    <div className="px-4 py-4 text-center text-muted text-xs">{section.emptyHint}</div>
                                ) : null
                            ) : (
                                section.rows.map((row) => (
                                    <div
                                        key={row.key}
                                        className={clsx(
                                            "group flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 rounded-md cursor-pointer transition-colors min-h-[36px] hover:bg-hoverbg",
                                            activeIndex >= 0 && rowIndex.get(row) === activeIndex && "bg-hoverbg"
                                        )}
                                        onClick={() => handleSelect(row)}
                                    >
                                        <i className={clsx(rowIcon(row), "text-xs w-4 text-center shrink-0")} />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-foreground font-medium truncate">{row.label}</div>
                                            <div className="text-[11px] text-muted font-mono truncate">
                                                {row.displayPath}
                                            </div>
                                        </div>
                                        {row.count != null && section.id !== "search" ? (
                                            <span className="text-[10px] text-muted shrink-0">×{row.count}</span>
                                        ) : null}
                                        {/* 行内按钮默认不占位（max-w-0 + opacity-0），hover 时展开并渐显；
                                            max-width 可动画，比 w-auto 更平顺。 */}
                                        <div className="flex items-center gap-0.5 shrink-0 overflow-hidden max-w-0 opacity-0 transition-[max-width,opacity] duration-150 ease-out group-hover:max-w-[96px] group-hover:opacity-100">
                                            {/* Pinned 区里的行已经固定，星标按钮与删除按钮动作重复，只保留删除。 */}
                                            {section.id !== "pinned" ? (
                                                <button
                                                    type="button"
                                                    className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-sm text-muted hover:bg-surface-soft hover:text-foreground transition-all cursor-pointer border-none bg-transparent"
                                                    title={row.pinned ? "Unpin" : "Pin"}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onTogglePin({ path: row.path, connection: row.connection }, row.label);
                                                    }}
                                                >
                                                    <i
                                                        className={clsx(
                                                            "text-[10px]",
                                                            row.pinned ? "fa-solid fa-star text-green" : "fa-regular fa-star"
                                                        )}
                                                    />
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-sm text-muted hover:bg-surface-soft hover:text-foreground transition-all cursor-pointer border-none bg-transparent"
                                                title="Copy path"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    copyPath(row.path);
                                                }}
                                            >
                                                <i className="fa-regular fa-copy text-[10px]" />
                                            </button>
                                            {/* 每行都支持删除，hover 时才显示（外层 group-hover 控制）。
                                                Pinned 区的删除是取消固定，其余分区是删掉使用记录。 */}
                                            <button
                                                type="button"
                                                className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-sm text-muted hover:bg-error/12 hover:text-error transition-all cursor-pointer border-none bg-transparent"
                                                title={section.id === "pinned" ? "Unpin" : "Remove"}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (section.id === "pinned") {
                                                        onTogglePin(
                                                            { path: row.path, connection: row.connection },
                                                            row.label
                                                        );
                                                    } else {
                                                        onRemoveUsage({ path: row.path, connection: row.connection });
                                                    }
                                                }}
                                            >
                                                <i className="fa-solid fa-xmark text-[10px]" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    ))}
                </div>

                {/* footer */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border/60">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-medium text-secondary bg-transparent hover:bg-surface-soft transition-colors cursor-pointer border-none"
                        onClick={() => {
                            onSelect({ path: "~" });
                            onClose();
                        }}
                        title="Open home directory"
                    >
                        <i className="fa-solid fa-home text-[9px]" />
                        Home
                    </button>
                </div>
            </div>
        </FloatingPortal>
    );
});

export { NewFilesFloatingWindow };
