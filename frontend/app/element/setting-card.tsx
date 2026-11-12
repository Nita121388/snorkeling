// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings panel primitives — the "de-densify" typography proposed in
 * `design/prototypes/settings-density`.
 *
 * The problem these solve is rhythm, not font size: the old panels rendered rows as
 * `divide-y` hairlines inside `max-w-2xl`, so settings read like a table. Here a group is a
 * title OUTSIDE a surface card, rows inside the card have no divider at all, and the vertical
 * rhythm (58px row) plus 32px group gap carries the separation instead.
 *
 * Everything in this file is presentation-only: no atoms, no RPC, no internal state. Panels own
 * their state and pass `selected` / `open` / `dirty` down. Free-form `attrs` exist so a panel can
 * keep the `data-*` hooks its verification harness relies on without the primitive knowing what
 * the panel is about.
 */

import { cn } from "@/util/util";
import React from "react";

type DataAttrs = Record<string, string | undefined>;

function spreadAttrs(attrs?: DataAttrs): Record<string, string> {
    const out: Record<string, string> = {};
    if (attrs == null) return out;
    for (const [key, value] of Object.entries(attrs)) {
        if (value == null) continue;
        out[key] = value;
    }
    return out;
}

/** A settings group: title above, one surface card below, 32px breathing room after. */
export function SettingGroup({
    title,
    extra,
    className,
    cardClassName,
    children,
}: {
    title: React.ReactNode;
    /** Rendered to the right of the title (counts, LIVE chip, badges). */
    extra?: React.ReactNode;
    className?: string;
    cardClassName?: string;
    children: React.ReactNode;
}) {
    return (
        <section className={cn("mb-8 last:mb-0", className)} data-setting-group="">
            <h2 className="m-0 flex items-baseline gap-2 px-0.5 pb-2 text-xs font-medium text-secondary">
                <span className="flex items-baseline gap-2">{title}</span>
                {extra != null && <span className="flex items-baseline gap-2">{extra}</span>}
            </h2>
            <SettingCard className={cardClassName}>{children}</SettingCard>
        </section>
    );
}

/** The surface card a group renders into: 1px border, 10px radius, 10/20 padding. */
export function SettingCard({
    children,
    className,
    wide,
}: {
    children: React.ReactNode;
    className?: string;
    /** 880px reading column (card grids) instead of the 700px form column. */
    wide?: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-[10px] border border-border bg-surface px-4 py-1",
                wide === true && "max-w-[880px]",
                className
            )}
        >
            {children}
        </div>
    );
}

/**
 * One settings row: text column (title + description) on the left, controls on the right.
 * 58px minimum height; **no divider between rows** — that is the whole point of the redesign.
 */
export function SettingRow({
    title,
    description,
    badge,
    disabled,
    className,
    attrs,
    children,
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    /** Small pill after the title (recommended / OFF / live). */
    badge?: React.ReactNode;
    disabled?: boolean;
    className?: string;
    attrs?: DataAttrs;
    children?: React.ReactNode;
}) {
    return (
        <div
            {...spreadAttrs(attrs)}
            className={cn(
                "flex min-h-[58px] items-center gap-5 px-1 py-[15px]",
                disabled === true && "opacity-45",
                className
            )}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <span className="min-w-0">{title}</span>
                    {badge}
                </div>
                {description != null && description !== "" && (
                    <div className="mt-[3px] max-w-[520px] text-[12.5px] leading-[1.5] text-muted-foreground">
                        {description}
                    </div>
                )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
        </div>
    );
}

/** Card grid for exclusive choices. Auto-fits to one column when the panel is narrow. */
export function RadioCardGroup({
    name,
    className,
    children,
}: {
    name: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={name}
            className={cn("grid max-w-[680px] grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3", className)}
        >
            {children}
        </div>
    );
}

/**
 * HeroUI-style radio card: the whole card is the hit target, the real `<input type="radio">` is
 * visually hidden inside the label so keyboard/screen-reader semantics stay intact.
 *
 * Selectability is deliberately separate from "can this actually run": a blocked card stays
 * clickable (picking it is how the user reaches that transport's fields), the reason renders as a
 * warning line inside the card.
 */
export function RadioCard({
    name,
    value,
    selected,
    onSelect,
    title,
    description,
    flag,
    warn,
    disabled,
    attrs,
}: {
    name: string;
    value: string;
    selected: boolean;
    onSelect: (value: string) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    /** Corner pill above the card (e.g. `recommended`). */
    flag?: React.ReactNode;
    /** Warning line appended under the description (e.g. why it cannot start yet). */
    warn?: React.ReactNode;
    disabled?: boolean;
    attrs?: DataAttrs;
}) {
    return (
        <label
            {...spreadAttrs(attrs)}
            className={cn(
                "group relative block rounded-[10px] border bg-surface transition-colors",
                selected === true
                    ? "border-2 border-accent bg-actionsoft p-[13px]"
                    : "border-border p-[14px] hover:border-actionsoftborder",
                disabled === true ? "cursor-default opacity-55" : "cursor-pointer"
            )}
        >
            <input
                type="radio"
                className="absolute h-px w-px opacity-0"
                name={name}
                value={value}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(value)}
            />
            {flag != null && (
                <span className="absolute -top-2 left-3 rounded-full border border-actionsoftborder bg-modalbg px-2 py-px text-[11px] font-medium text-actionsofttext">
                    {flag}
                </span>
            )}
            <span
                aria-hidden="true"
                className={cn(
                    "absolute right-2.5 top-2.5 h-4 w-4 rounded-full",
                    selected === true
                        ? "border-[1.5px] border-accent bg-accent shadow-[inset_0_0_0_3px_var(--surface-color)]"
                        : "hidden border-[1.5px] border-border group-hover:block group-hover:border-accent"
                )}
            />
            <div className="flex items-center gap-2 pr-6 text-[13.5px] font-medium text-primary">{title}</div>
            {description != null && description !== "" && (
                <div className="mt-[5px] text-xs leading-[1.45] text-muted-foreground">{description}</div>
            )}
            {warn != null && warn !== "" && <div className="mt-1 text-xs leading-[1.45] text-warning">{warn}</div>}
        </label>
    );
}

/** Container for whole-row radios (conflict policy). */
export function RadioRowGroup({
    name,
    className,
    children,
}: {
    name: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div role="radiogroup" aria-label={name} className={cn("flex flex-col", className)}>
            {children}
        </div>
    );
}

/** A radio whose entire row is the hit target — used where the choice needs an explanation. */
export function RadioRow({
    name,
    value,
    selected,
    onSelect,
    title,
    description,
    badge,
    attrs,
}: {
    name: string;
    value: string;
    selected: boolean;
    onSelect: (value: string) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    badge?: React.ReactNode;
    attrs?: DataAttrs;
}) {
    return (
        <label {...spreadAttrs(attrs)} className="group relative flex cursor-pointer items-start gap-3 px-1 py-[13px]">
            <input
                type="radio"
                className="absolute h-px w-px opacity-0"
                name={name}
                value={value}
                checked={selected}
                onChange={() => onSelect(value)}
            />
            <span
                aria-hidden="true"
                className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px] transition-colors",
                    selected === true
                        ? "border-accent bg-accent shadow-[inset_0_0_0_4.5px_var(--accent-color)]"
                        : "border-border bg-surface group-hover:border-accent"
                )}
            />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-primary">
                    {title}
                    {badge}
                </span>
                {description != null && description !== "" && (
                    <span className="mt-[3px] block max-w-[520px] text-[12.5px] leading-[1.5] text-muted-foreground">
                        {description}
                    </span>
                )}
            </span>
        </label>
    );
}

/**
 * Low-frequency settings folded away by default. Open state is owned by the caller so panels can
 * persist it (Sync keeps it in localStorage; it is a view preference, not a setting).
 */
export function AdvancedSection({
    title,
    subtitle,
    open,
    onToggle,
    attrs,
    children,
}: {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    open: boolean;
    onToggle: () => void;
    attrs?: DataAttrs;
    children: React.ReactNode;
}) {
    return (
        <section className="mb-8 last:mb-0" data-setting-advanced="">
            <div className="overflow-hidden rounded-[10px] border border-border">
                <button
                    type="button"
                    {...spreadAttrs(attrs)}
                    aria-expanded={open}
                    onClick={onToggle}
                    className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-3 text-[13px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                    <i
                        className={cn(
                            "fa-solid fa-chevron-right text-[10px] transition-transform",
                            open && "rotate-90"
                        )}
                    />
                    <span>{title}</span>
                    {subtitle != null && subtitle !== "" && (
                        <span className="ml-auto text-[11.5px] font-normal text-secondary">{subtitle}</span>
                    )}
                </button>
                {open && <div className="px-4 pb-4 pt-1">{children}</div>}
            </div>
        </section>
    );
}

/**
 * The single save location for a draft-style panel. Keeping ONE save affordance (instead of a
 * header button, a footer button and per-row stamps) is the contract: a draft panel writes only
 * here.
 */
export function SaveBar({
    hint,
    dirty,
    saving,
    onSave,
    onDiscard,
    saveLabel,
    className,
    attrs,
}: {
    hint?: React.ReactNode;
    dirty: boolean;
    saving?: boolean;
    onSave: () => void;
    onDiscard?: () => void;
    saveLabel?: string;
    className?: string;
    attrs?: DataAttrs;
}) {
    const disabled = !dirty || saving === true;
    return (
        <div
            {...spreadAttrs(attrs)}
            className={cn(
                "sticky bottom-0 mt-6 flex max-w-[880px] items-center justify-end gap-3 border-t border-border bg-background/95 px-1 pb-2 pt-4 backdrop-blur-sm",
                className
            )}
        >
            {hint != null && hint !== "" && <span className="mr-auto text-xs text-secondary">{hint}</span>}
            {onDiscard != null && (
                <button
                    type="button"
                    onClick={onDiscard}
                    disabled={saving === true}
                    className="h-[30px] cursor-pointer rounded-[7px] border border-border px-4 text-[13px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary disabled:cursor-default disabled:opacity-45"
                >
                    Discard
                </button>
            )}
            <button
                type="button"
                onClick={onSave}
                disabled={disabled}
                className={cn(
                    "h-[30px] rounded-[7px] px-4 text-[13px] font-medium transition-colors",
                    disabled
                        ? "cursor-default border border-border text-muted-foreground opacity-45"
                        : "cursor-pointer border border-action bg-action text-actiontext hover:brightness-110"
                )}
            >
                {saving === true ? "Saving…" : (saveLabel ?? "Save")}
            </button>
        </div>
    );
}

export type SignalLevel = -1 | 0 | 2 | 3 | 4;

const SignalBarHeights = ["4px", "6.5px", "9px", "12px"] as const;

/**
 * Server health as signal bars — the same vocabulary `connectionbutton.tsx` already uses
 * (4 = strong, 2 = degraded, 0 = unreachable, -1 = probing).
 */
export function SignalBars({ level, label }: { level: SignalLevel; label: string }) {
    const active = level === -1 ? 0 : level;
    const activeColor =
        level === 4 || level === 3 ? "bg-success" : level === 2 ? "bg-warning" : level === -1 ? "bg-secondary" : "";
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            data-signal-level={level}
            className="relative inline-flex h-3 items-end gap-0.5 align-[1px]"
        >
            {SignalBarHeights.map((height, index) => {
                const lit = index < active;
                return (
                    <span
                        key={index}
                        style={{ height }}
                        className={cn(
                            "w-[3px] rounded-[1px] transition-colors",
                            lit ? activeColor : "bg-border",
                            level === -1 && "animate-pulse bg-secondary"
                        )}
                    />
                );
            })}
            {level === 0 && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-y-0.5 -inset-x-px bg-[linear-gradient(to_top_right,transparent_46%,var(--warning-color)_46%,var(--warning-color)_54%,transparent_54%)]"
                />
            )}
        </span>
    );
}

/** Compact text input used inside rows (h-8, optional monospace). */
export function SettingInput({
    value,
    onChange,
    placeholder,
    ariaLabel,
    mono,
    disabled,
    width = "w-64",
    attrs,
}: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    ariaLabel: string;
    mono?: boolean;
    disabled?: boolean;
    width?: string;
    attrs?: DataAttrs;
}) {
    return (
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            aria-label={ariaLabel}
            disabled={disabled}
            spellCheck={false}
            {...spreadAttrs(attrs)}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                "h-8 min-w-0 max-w-full rounded-md border border-border bg-panel px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-50",
                mono === true && "font-mono",
                width
            )}
        />
    );
}

/** Small right-aligned value pill (numbers, timestamps, states). */
export function SettingValue({
    children,
    tone,
    mono,
    attrs,
    title,
}: {
    children: React.ReactNode;
    tone?: "default" | "ok" | "warn";
    mono?: boolean;
    attrs?: DataAttrs;
    title?: string;
}) {
    return (
        <span
            {...spreadAttrs(attrs)}
            title={title}
            className={cn(
                "text-xs tabular-nums",
                mono === true && "font-mono",
                tone === "ok" && "text-success",
                tone === "warn" && "text-warning",
                (tone == null || tone === "default") && "text-secondary"
            )}
        >
            {children}
        </span>
    );
}

/** Secondary/bordered action button used in rows. */
export function SettingButton({
    children,
    onClick,
    disabled,
    tone,
    attrs,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    tone?: "default" | "danger";
    attrs?: DataAttrs;
}) {
    return (
        <button
            type="button"
            {...spreadAttrs(attrs)}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "h-7 rounded-[7px] border border-border bg-transparent px-3 text-xs font-medium transition-colors",
                tone === "danger" ? "text-error hover:bg-hover" : "text-primary hover:bg-hover",
                disabled === true ? "cursor-default opacity-50" : "cursor-pointer"
            )}
        >
            {children}
        </button>
    );
}

/** Two-to-four segment control (e.g. push mode realtime / on-save). */
export function SettingSegmented<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: { id: T; label: string }[];
    onChange: (next: T) => void;
    ariaLabel: string;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="inline-flex items-center gap-0.5 rounded-[7px] bg-surface-strong p-0.5"
        >
            {options.map((opt) => {
                const active = opt.id === value;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(opt.id)}
                        className={cn(
                            "h-6 cursor-pointer rounded-[5px] px-2.5 text-[11.5px] transition-colors",
                            active
                                ? "bg-surface text-primary shadow-[0_0_0_1px_var(--border-color)]"
                                : "text-secondary hover:text-primary"
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
