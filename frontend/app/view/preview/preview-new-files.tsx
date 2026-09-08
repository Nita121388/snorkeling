// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useFloating, FloatingPortal, offset, useDismiss, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { memo, useCallback } from "react";

export type PinnedDirectory = PinnedDirectoryType;

type NewFilesFloatingWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    referenceElement: HTMLElement | null;
    pinnedDirs: PinnedDirectory[];
    recentDirs: string[];
    onRemovePinned: (path: string) => void;
    onClearRecent: (path: string) => void;
};

function formatPath(path: string): string {
    if (path.startsWith("~")) return path;
    if (path.length > 40) {
        const parts = path.replace(/\\/g, "/").split("/");
        if (parts.length > 3) return parts[0] + "/…/" + parts.slice(-2).join("/");
    }
    return path;
}

const NewFilesFloatingWindow = memo(function NewFilesFloatingWindow({
    isOpen,
    onClose,
    onSelect,
    referenceElement,
    pinnedDirs,
    recentDirs,
    onRemovePinned,
    onClearRecent,
}: NewFilesFloatingWindowProps) {
    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        placement: "left-start",
        middleware: [offset(8)],
        elements: { reference: referenceElement },
        onOpenChange: (open) => {
            if (!open) onClose();
        },
    });

    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: true })]);

    const handleSelect = useCallback(
        (path: string) => {
            onSelect(path);
            onClose();
        },
        [onSelect, onClose]
    );

    if (!isOpen) return null;

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                {...getFloatingProps()}
                className="bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl z-50 min-w-[400px] max-w-[480px] max-h-[500px] overflow-hidden flex flex-col"
            >
                {/* header */}
                <div className="flex items-center px-3 py-2 text-sm font-medium text-foreground border-b border-border/60">
                    <i className="fa-solid fa-location-crosshairs text-accent text-xs mr-2" />
                    <span>New Files</span>
                </div>

                {/* scrollable content */}
                <div className="flex-1 overflow-y-auto px-1 py-1 min-h-0">
                    {/* Pinned section */}
                    <div className="border-b border-border/60">
                        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] text-muted uppercase tracking-wide font-medium">
                            <i className="fa-solid fa-star text-[10px] text-green" />
                            <span>Pinned</span>
                            <span className="text-[10px] px-1.5 rounded bg-surface-soft">{pinnedDirs.length}</span>
                        </div>
                        {pinnedDirs.map((pinned) => (
                            <div
                                key={pinned.path}
                                className="group flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 rounded-md cursor-pointer transition-colors min-h-[36px] hover:bg-hoverbg"
                                onClick={() => handleSelect(pinned.path)}
                            >
                                <i className="fa-solid fa-star text-green text-xs w-4 text-center shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-foreground font-medium truncate">{pinned.label}</div>
                                    <div className="text-[11px] text-muted font-mono truncate">
                                        {formatPath(pinned.path)}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-sm text-muted opacity-0 group-hover:opacity-100 hover:bg-error/12 hover:text-error transition-all cursor-pointer border-none bg-transparent"
                                    title="Unpin"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemovePinned(pinned.path);
                                    }}
                                >
                                    <i className="fa-solid fa-xmark text-[10px]" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Recent section */}
                    <div>
                        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] text-muted uppercase tracking-wide font-medium">
                            <i className="fa-regular fa-clock text-[10px]" />
                            <span>Recent</span>
                            <span className="text-[10px] px-1.5 rounded bg-surface-soft">{recentDirs.length}</span>
                        </div>
                        {recentDirs.length === 0 ? (
                            <div className="px-4 py-5 text-center text-muted text-xs">
                                <i className="fa-regular fa-clock text-lg mb-2 block opacity-40" />
                                Directories you navigate to will appear here.
                            </div>
                        ) : (
                            recentDirs.map((dirPath) => (
                                <div
                                    key={dirPath}
                                    className="group flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 rounded-md cursor-pointer transition-colors min-h-[36px] hover:bg-hoverbg"
                                    onClick={() => handleSelect(dirPath)}
                                >
                                    <i className="fa-regular fa-clock text-muted text-xs w-4 text-center shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-foreground font-medium truncate">
                                            {dirPath.split("/").filter(Boolean).pop() || dirPath}
                                        </div>
                                        <div className="text-[11px] text-muted font-mono truncate">
                                            {formatPath(dirPath)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-sm text-muted opacity-0 group-hover:opacity-100 hover:bg-error/12 hover:text-error transition-all cursor-pointer border-none bg-transparent"
                                        title="Clear from recent"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onClearRecent(dirPath);
                                        }}
                                    >
                                        <i className="fa-solid fa-xmark text-[10px]" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* footer */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border/60">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-medium text-secondary bg-transparent hover:bg-surface-soft transition-colors cursor-pointer border-none"
                        onClick={() => handleSelect("~")}
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
