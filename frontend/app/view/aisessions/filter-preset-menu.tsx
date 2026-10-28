// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions 工具栏「筛选方案」下拉：保存当前筛选为具名方案，应用/覆盖/重命名/删除。
// 纯展示组件：所有状态（方案列表、active、dirty）由 ViewModel 通过 props 下发。
//
// 面板走 FloatingPortal 挂到 body：block 容器本身有 overflow 裁剪，
// 就地 absolute 定位会被 block 边框截断（与 SortMenu 同一套做法）。

import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useEffect, useRef, useState } from "react";
import type { FilterPreset } from "./filter-presets";

type Props = {
    presets: FilterPreset[];
    activePresetId: string;
    /** 当前筛选是否已偏离 active 方案（用于「覆盖」提示与圆环）。 */
    activeDirty: boolean;
    /** 当前是否存在可保存的有效筛选（全默认时禁用保存）。 */
    canSave: boolean;
    onApply: (preset: FilterPreset) => void;
    onSaveNew: (name: string) => void;
    onOverwrite: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
};

/** 行内 `⋯` 菜单：定位用视口坐标（fixed），同样放 portal 里避免被列表滚动区裁剪。 */
type RowMenu = { id: string; top: number; left: number };

const RowMenuWidth = 176;
const RowMenuHeight = 100;

export function FilterPresetMenu({
    presets,
    activePresetId,
    activeDirty,
    canSave,
    onApply,
    onSaveNew,
    onOverwrite,
    onRename,
    onDelete,
}: Props) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [renamingId, setRenamingId] = useState("");
    const [renameDraft, setRenameDraft] = useState("");
    const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
    const [reference, setReference] = useState<HTMLButtonElement | null>(null);
    const rowMenuRef = useRef<HTMLDivElement>(null);

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });
    const dismiss = useDismiss(context, {
        // 行内 `⋯` 菜单也在 portal 里（在浮动面板之外），点它不能算「点外面」。
        outsidePress: (event) => rowMenuRef.current == null || !rowMenuRef.current.contains(event.target as Node),
        escapeKey: false,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    // 关闭面板时清掉行内菜单与草稿态。
    useEffect(() => {
        if (open) return;
        setSaving(false);
        setRenamingId("");
        setRowMenu(null);
    }, [open]);

    // 点行内菜单外部关闭它。
    useEffect(() => {
        if (rowMenu == null) return;
        const handler = (event: MouseEvent) => {
            if (rowMenuRef.current != null && rowMenuRef.current.contains(event.target as Node)) return;
            setRowMenu(null);
        };
        document.addEventListener("mousedown", handler, true);
        return () => document.removeEventListener("mousedown", handler, true);
    }, [rowMenu]);

    const activePreset = presets.find((preset) => preset.id === activePresetId);
    const triggerActive = open || activePreset != null;
    const menuPreset = rowMenu == null ? null : (presets.find((preset) => preset.id === rowMenu.id) ?? null);

    const commitNew = () => {
        const name = draftName.trim();
        if (name === "") return;
        onSaveNew(name);
        setDraftName("");
        setSaving(false);
    };

    const commitRename = () => {
        if (renamingId !== "" && renameDraft.trim() !== "") {
            onRename(renamingId, renameDraft.trim());
        }
        setRenamingId("");
        setRenameDraft("");
    };

    const openRowMenu = (presetId: string, button: HTMLButtonElement) => {
        if (rowMenu?.id === presetId) {
            setRowMenu(null);
            return;
        }
        const rect = button.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right - RowMenuWidth, window.innerWidth - RowMenuWidth - 8));
        const below = rect.bottom + 4;
        const top = below + RowMenuHeight + 8 > window.innerHeight ? Math.max(8, rect.top - RowMenuHeight - 4) : below;
        setRowMenu({ id: presetId, top, left });
    };

    return (
        <>
            <button
                ref={setReference}
                {...getReferenceProps({
                    onClick: () => setOpen((current) => !current),
                })}
                type="button"
                title="Filter presets"
                aria-label="Filter presets"
                aria-pressed={triggerActive}
                className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors cursor-pointer",
                    triggerActive
                        ? "border border-border/70 bg-background text-primary shadow-sm ring-1 ring-accent/40"
                        : "border border-border/70 bg-surface text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i className="fa-sharp fa-solid fa-bookmark text-[11px]" />
                {presets.length > 0 ? (
                    <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-surface-strong px-1 text-[10px] font-bold leading-none text-secondary tabular-nums">
                        {presets.length}
                    </span>
                ) : null}
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{ ...floatingStyles, width: 264 }}
                        {...getFloatingProps()}
                        className="z-50 flex flex-col rounded-xl border border-border/70 bg-modalbg shadow-xl"
                    >
                        <div className="border-b border-border/40 p-2">
                            {saving ? (
                                <div className="flex items-center gap-1.5">
                                    <input
                                        autoFocus
                                        value={draftName}
                                        maxLength={40}
                                        placeholder="Preset name"
                                        onChange={(e) => setDraftName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") commitNew();
                                            if (e.key === "Escape") {
                                                setSaving(false);
                                                setDraftName("");
                                            }
                                        }}
                                        className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-2 text-xs text-primary outline-none focus:border-accent/60"
                                    />
                                    <button
                                        type="button"
                                        title="Save"
                                        onClick={commitNew}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer"
                                    >
                                        <i className="fa-sharp fa-solid fa-check text-[11px]" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    disabled={!canSave}
                                    title={canSave ? "Save current filters as a preset" : "No active filters to save"}
                                    onClick={() => {
                                        setSaving(true);
                                        setRowMenu(null);
                                    }}
                                    className={cn(
                                        "flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-dashed text-xs transition-colors",
                                        canSave
                                            ? "border-border/70 text-secondary hover:border-accent/50 hover:text-primary cursor-pointer"
                                            : "border-border/40 text-secondary/40 cursor-not-allowed"
                                    )}
                                >
                                    <i className="fa-sharp fa-solid fa-plus text-[10px]" />
                                    Save current as…
                                </button>
                            )}
                        </div>
                        <div className="max-h-72 overflow-y-auto py-1">
                            {presets.length === 0 ? (
                                <div className="px-3 py-4 text-center text-[11px] text-secondary/70">
                                    No saved presets yet.
                                </div>
                            ) : (
                                presets.map((preset) => {
                                    const isActive = preset.id === activePresetId;
                                    const menuOpen = rowMenu?.id === preset.id;
                                    return (
                                        <div
                                            key={preset.id}
                                            className={cn(
                                                "group flex items-center gap-1 px-1.5",
                                                isActive && "bg-accent/5"
                                            )}
                                        >
                                            {renamingId === preset.id ? (
                                                <div className="flex flex-1 items-center gap-1.5 py-0.5">
                                                    <input
                                                        autoFocus
                                                        value={renameDraft}
                                                        maxLength={40}
                                                        onChange={(e) => setRenameDraft(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") commitRename();
                                                            if (e.key === "Escape") setRenamingId("");
                                                        }}
                                                        className="h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-1.5 text-xs text-primary outline-none focus:border-accent/60"
                                                    />
                                                    <button
                                                        type="button"
                                                        title="Confirm rename"
                                                        onClick={commitRename}
                                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent hover:bg-hover cursor-pointer"
                                                    >
                                                        <i className="fa-sharp fa-solid fa-check text-[10px]" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        title={`Apply preset: ${preset.name}`}
                                                        onClick={() => onApply(preset)}
                                                        className={cn(
                                                            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs cursor-pointer hover:bg-hover",
                                                            isActive ? "text-primary" : "text-secondary"
                                                        )}
                                                    >
                                                        <i
                                                            className={cn(
                                                                "fa-sharp shrink-0 text-[8px]",
                                                                isActive
                                                                    ? "fa-solid fa-circle text-accent"
                                                                    : "fa-regular fa-circle text-secondary/40"
                                                            )}
                                                        />
                                                        <span className="min-w-0 truncate">{preset.name}</span>
                                                        {isActive && activeDirty ? (
                                                            <i
                                                                title="Filters changed since this preset was applied"
                                                                className="fa-sharp fa-solid fa-pen shrink-0 text-[9px] text-warning"
                                                            />
                                                        ) : null}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="Preset actions"
                                                        aria-haspopup="menu"
                                                        aria-expanded={menuOpen}
                                                        onClick={(e) => openRowMenu(preset.id, e.currentTarget)}
                                                        className={cn(
                                                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-hover hover:text-primary cursor-pointer",
                                                            menuOpen
                                                                ? "opacity-100"
                                                                : "opacity-0 group-hover:opacity-100"
                                                        )}
                                                    >
                                                        <i className="fa-sharp fa-solid fa-ellipsis text-[11px]" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    {rowMenu != null && menuPreset != null ? (
                        <div
                            ref={rowMenuRef}
                            role="menu"
                            style={{ position: "fixed", top: rowMenu.top, left: rowMenu.left, width: RowMenuWidth }}
                            className="z-[60] overflow-hidden rounded-lg border border-border/70 bg-modalbg shadow-xl"
                        >
                            <MenuItem
                                icon="fa-pen"
                                label="Rename"
                                onClick={() => {
                                    setRenamingId(menuPreset.id);
                                    setRenameDraft(menuPreset.name);
                                    setRowMenu(null);
                                }}
                            />
                            <MenuItem
                                icon="fa-floppy-disk"
                                label="Overwrite with current"
                                disabled={!canSave}
                                onClick={() => {
                                    onOverwrite(menuPreset.id);
                                    setRowMenu(null);
                                }}
                            />
                            <MenuItem
                                icon="fa-trash"
                                label="Delete"
                                tone="danger"
                                onClick={() => {
                                    onDelete(menuPreset.id);
                                    setRowMenu(null);
                                }}
                            />
                        </div>
                    ) : null}
                </FloatingPortal>
            ) : null}
        </>
    );
}

function MenuItem({
    icon,
    label,
    onClick,
    disabled,
    tone,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "danger";
}) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
                disabled
                    ? "cursor-not-allowed text-secondary/40"
                    : tone === "danger"
                      ? "text-secondary hover:bg-error/10 hover:text-error cursor-pointer"
                      : "text-secondary hover:bg-hover hover:text-primary cursor-pointer"
            )}
        >
            <i className={cn("fa-sharp w-3 text-center text-[10px]", icon)} />
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
}
