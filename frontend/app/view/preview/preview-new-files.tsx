// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useFloating, FloatingPortal, offset, useDismiss, useInteractions } from "@floating-ui/react";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget, isBlank } from "@/util/util";
import { basename } from "@/util/util";
import clsx from "clsx";
import { memo, useCallback, useMemo } from "react";
import type { PreviewModel } from "./preview-model";

type NewFilesFloatingWindowProps = {
    model: PreviewModel;
    isOpen: boolean;
    onClose: () => void;
};

function formatPath(path: string): string {
    if (path.startsWith("~")) return path;
    if (path.length > 40) {
        const parts = path.replace(/\\/g, "/").split("/");
        if (parts.length > 3) {
            return parts[0] + "/…/" + parts.slice(-2).join("/");
        }
    }
    return path;
}

function DefaultCheckButton({
    checked,
    onClick,
}: {
    checked: boolean;
    onClick: (e: React.MouseEvent) => void;
}) {
    return (
        <button
            type="button"
            className={clsx(
                "w-5 h-5 shrink-0 inline-flex items-center justify-center cursor-pointer transition-colors",
                checked ? "text-accent" : "text-border"
            )}
            title={checked ? "Default for this tab (click to unset)" : "Set as tab default"}
            onClick={onClick}
        >
            {checked ? (
                <i className="fa-solid fa-check text-accent text-[10px]" />
            ) : (
                <span className="w-3 h-3 rounded-[2px] border border-border opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
        </button>
    );
}

const NewFilesFloatingWindow = memo(function NewFilesFloatingWindow({
    model,
    isOpen,
    onClose,
}: NewFilesFloatingWindowProps) {
    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        placement: "right-start",
        middleware: [offset(0)],
        onOpenChange: (open) => {
            if (!open) onClose();
        },
    });

    const { getReferenceProps, getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: true })]);

    const pinnedDirs = globalStore.get(model.pinnedDirs);
    const recentDirsMap = globalStore.get(model.recentDirs);
    const tabDefault = model.getTabDefaultPath();

    // Sort recent dirs by timestamp, most recent first
    const recentDirs = useMemo(() => {
        return [...recentDirsMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([path]) => path);
    }, [recentDirsMap]);

    const handleNavigate = useCallback(
        (path: string) => {
            fireAndForget(() => model.goHistory(path));
            onClose();
        },
        [model, onClose]
    );

    const handleToggleDefault = useCallback(
        (path: string, e: React.MouseEvent) => {
            e.stopPropagation();
            fireAndForget(() => model.setTabDefaultPath(path));
        },
        [model]
    );

    const handleAddCurrent = useCallback(() => {
        const currentPath = globalStore.get(model.explorerRootPath);
        if (!isBlank(currentPath)) {
            model.togglePinnedDir(currentPath);
        }
    }, [model]);

    const handleRemovePinned = useCallback(
        (path: string, e: React.MouseEvent) => {
            e.stopPropagation();
            model.togglePinnedDir(path);
        },
        [model]
    );

    const handleClearRecent = useCallback(
        (path: string, e: React.MouseEvent) => {
            e.stopPropagation();
            model.clearRecentDir(path);
        },
        [model]
    );

    const handleOpenInNewBlock = useCallback(
        async (path: string) => {
            await model.openPathInNewBlockSmart(path, true);
            onClose();
        },
        [model, onClose]
    );

    if (!isOpen) {
        return null;
    }

    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                style={{
                    ...floatingStyles,
                    transform: `${floatingStyles.transform ?? ""} translate(-50%, -50%)`.trim(),
                }}
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
                                className={clsx(
                                    "group flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 rounded-md cursor-pointer transition-colors min-h-[36px]",
                                    tabDefault === pinned.path ? "bg-accent/12 relative" : "hover:bg-hoverbg"
                                )}
                                onClick={() => handleNavigate(pinned.path)}
                            >
                                {tabDefault === pinned.path && (
                                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-accent rounded-full" />
                                )}
                                <i className="fa-solid fa-star text-green text-xs w-4 text-center shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-foreground font-medium truncate">{pinned.label}</div>
                                    <div className="text-[11px] text-muted font-mono truncate">
                                        {formatPath(pinned.path)}
                                    </div>
                                </div>
                                <DefaultCheckButton
                                    checked={tabDefault === pinned.path}
                                    onClick={(e) => handleToggleDefault(pinned.path, e)}
                                />
                                <button
                                    type="button"
                                    className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-sm text-muted opacity-0 group-hover:opacity-100 hover:bg-error/12 hover:text-error transition-all cursor-pointer border-none bg-transparent"
                                    title="Unpin"
                                    onClick={(e) => handleRemovePinned(pinned.path, e)}
                                >
                                    <i className="fa-solid fa-xmark text-[10px]" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 my-1 rounded-md cursor-pointer transition-colors w-[calc(100%-8px)] text-action-softtext border border-dashed border-green/30 bg-transparent hover:bg-green/12 hover:border-green hover:text-green text-xs"
                            onClick={handleAddCurrent}
                        >
                            <i className="fa-solid fa-plus text-[11px] w-4 text-center" />
                            <span>Add current directory</span>
                        </button>
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
                                    className={clsx(
                                        "group flex items-center gap-2.5 py-1.5 pl-3.5 pr-2 mx-1 rounded-md cursor-pointer transition-colors min-h-[36px]",
                                        tabDefault === dirPath ? "bg-accent/12 relative" : "hover:bg-hoverbg"
                                    )}
                                    onClick={() => handleNavigate(dirPath)}
                                >
                                    {tabDefault === dirPath && (
                                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-accent rounded-full" />
                                    )}
                                    <i className="fa-regular fa-clock text-muted text-xs w-4 text-center shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-foreground font-medium truncate">
                                            {basename(dirPath)}
                                        </div>
                                        <div className="text-[11px] text-muted font-mono truncate">
                                            {formatPath(dirPath)}
                                        </div>
                                    </div>
                                    <DefaultCheckButton
                                        checked={tabDefault === dirPath}
                                        onClick={(e) => handleToggleDefault(dirPath, e)}
                                    />
                                    <button
                                        type="button"
                                        className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-sm text-muted opacity-0 group-hover:opacity-100 hover:bg-error/12 hover:text-error transition-all cursor-pointer border-none bg-transparent"
                                        title="Clear from recent"
                                        onClick={(e) => handleClearRecent(dirPath, e)}
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
                        onClick={handleAddCurrent}
                        title="Pin current directory"
                    >
                        <i className="fa-solid fa-plus text-[9px]" />
                        Pin Current
                    </button>
                    <span className="w-0.5 h-0.5 rounded-full bg-border shrink-0" />
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-medium text-secondary bg-transparent hover:bg-surface-soft transition-colors cursor-pointer border-none"
                        onClick={() => {
                            const currentPath = globalStore.get(model.explorerRootPath);
                            if (!isBlank(currentPath)) {
                                handleOpenInNewBlock(currentPath);
                            }
                        }}
                        title="Open in new Files block"
                    >
                        <i className="fa-solid fa-plus text-[9px]" />
                        New Block
                    </button>
                </div>
            </div>
        </FloatingPortal>
    );
});

export { NewFilesFloatingWindow };
