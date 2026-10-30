// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions origin 切换器：左上角 icon 锚点 + 下拉弹层（仿终端的主机切换）。
//
// - 列表列出本机 + 已配置的外部 dump；当前项打勾；
// - 行尾 ✎ 悬停出现，编辑单条外部 origin（暂未接编辑面板，P3 补）；
// - 底部 ⚙ Edit origins… 打开外部根管理（P3）；
// - 只读 origin 显示锁标，提示 imported / read-only。

import { FloatingPortal, autoUpdate, flip, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { cn } from "@/util/util";
import { useState } from "react";

export interface OriginSwitcherProps {
    origins: AISessionsOrigin[];
    /** 当前选中的 origin id（"" / "local" 表示本机）。 */
    selectedId: string;
    onSelect: (id: string) => void;
    /** 编辑外部 origin（P3 接入完整面板）。 */
    onEdit?: (origin: AISessionsOrigin) => void;
    /** 打开外部根管理（P3）。 */
    onManage?: () => void;
}

function originIconClass(origin: AISessionsOrigin): string {
    if (origin.kind === "local") return "fa-solid fa-computer";
    return "fa-solid fa-hard-drive";
}

function OriginRow({
    origin,
    selected,
    onSelect,
    onEdit,
}: {
    origin: AISessionsOrigin;
    selected: boolean;
    onSelect: (id: string) => void;
    onEdit?: (origin: AISessionsOrigin) => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(origin.id)}
            className={cn(
                "group flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                selected ? "bg-accent/15 text-primary" : "text-secondary hover:bg-hover hover:text-primary"
            )}
        >
            <i className={cn("w-4 text-center text-[12px]", originIconClass(origin))} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-tight">{origin.label}</span>
                {origin.path ? (
                    <span className="block truncate text-[10px] leading-tight text-secondary/70" title={origin.path}>
                        {origin.path}
                    </span>
                ) : null}
            </span>
            {origin.readOnly ? (
                <i className="fa-solid fa-lock text-[10px] text-secondary/60" title="read-only (imported dump)" />
            ) : null}
            {origin.count > 0 ? (
                <span className="shrink-0 rounded-full bg-surface px-1.5 text-[10px] font-semibold leading-4 text-secondary">
                    {origin.count}
                </span>
            ) : null}
            {selected ? <i className="fa-solid fa-check w-3 text-[11px] text-accent" /> : <span className="w-3" />}
            {onEdit && origin.kind !== "local" ? (
                <i
                    role="button"
                    aria-label={`Edit ${origin.label}`}
                    title={`Edit ${origin.label}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit(origin);
                    }}
                    className="fa-solid fa-pencil hidden w-3 cursor-pointer text-[11px] text-secondary group-hover:inline-block hover:text-primary"
                />
            ) : null}
        </button>
    );
}

export function OriginSwitcher({ origins, selectedId, onSelect, onEdit, onManage }: OriginSwitcherProps) {
    const [open, setOpen] = useState(false);
    const [reference, setReference] = useState<HTMLButtonElement | null>(null);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-start",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    const active = origins.find((o) => o.id === selectedId) ?? origins.find((o) => o.kind === "local") ?? origins[0];
    const iconClass = active ? originIconClass(active) : "fa-solid fa-computer";

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Switch AI session origin: ${active?.label ?? "This Mac"}`}
                title={`Origin: ${active?.label ?? "This Mac"}`}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                    "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/70 px-2 text-xs transition-colors",
                    open ? "bg-background text-primary" : "bg-surface text-secondary hover:bg-hover hover:text-primary"
                )}
            >
                <i className={cn("text-[12px]", iconClass)} />
                <i className="fa-sharp fa-solid fa-chevron-down text-[8px] opacity-60" />
            </button>
            {open ? (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        className="z-50 flex w-64 flex-col overflow-hidden rounded-lg border border-border bg-modalbg shadow-xl"
                    >
                        <div className="border-b border-border/40 px-2.5 py-1.5 text-[12px] text-secondary">Origins</div>
                        <div className="max-h-72 overflow-y-auto p-1.5">
                            {origins.map((origin) => (
                                <OriginRow
                                    key={origin.id}
                                    origin={origin}
                                    selected={origin.id === selectedId}
                                    onSelect={(id) => {
                                        onSelect(id);
                                        setOpen(false);
                                    }}
                                    onEdit={onEdit}
                                />
                            ))}
                        </div>
                        {onManage ? (
                            <>
                                <div className="border-t border-border/40" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        onManage();
                                        setOpen(false);
                                    }}
                                    className="flex items-center gap-2 px-3 py-2 text-[12px] text-secondary transition-colors hover:bg-hover hover:text-primary"
                                >
                                    <i className="fa-solid fa-gear text-[11px]" />
                                    Edit origins…
                                </button>
                            </>
                        ) : null}
                    </div>
                </FloatingPortal>
            ) : null}
        </>
    );
}
