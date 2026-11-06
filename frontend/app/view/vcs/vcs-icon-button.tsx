// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

/**
 * VCS 面板统一的图标按钮。
 *
 * 约定（见 .trellis/tasks/11-05-vcs-panel-icon-buttons/design.md）：
 * - `title` 同时写 `title` 与 `aria-label`，icon-only 按钮必须可被读屏描述。
 * - 只用 tailwindsetup.css 里真实存在的 token（text-muted / text-accent / text-error /
 *   text-success / bg-action …）。`text-danger` / `text-ok` / `text-ink` 这些名字在该
 *   文件里没有定义，写上去是死样式。
 * - hover 态一律走 `enabled:hover:*`，避免 disabled 时仍被 hover 着色。
 */
export type VcsIconTone = "normal" | "accent" | "danger";
export type VcsIconSize = "sm" | "md" | "lg";

const SizeClass: Record<VcsIconSize, string> = {
    sm: "h-[18px] w-[18px] rounded",
    md: "h-6 w-6 rounded-md",
    lg: "h-7 w-7 rounded-md",
};

const ToneClass: Record<VcsIconTone, string> = {
    normal: "text-muted enabled:hover:text-secondary enabled:hover:bg-hoverbg/70",
    accent: "text-accent enabled:hover:bg-accent/10",
    danger: "text-error enabled:hover:bg-error/10",
};

const RevealClass = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity";
const AlwaysClass = "opacity-100";

export type VcsIconButtonProps = {
    /** 不带 `fa-` 前缀的 FontAwesome 名，如 `code-compare` */
    icon: string;
    /** tooltip 文案，同时作为 aria-label；必填且非空 */
    title: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    tone?: VcsIconTone;
    /** 实心主操作（bg-action），用于面板里唯一的强调动作 */
    solid?: boolean;
    loading?: boolean;
    size?: VcsIconSize;
    /** `hover` 只在行 hover / 键盘 focus 时浮现，用于行内重复动作 */
    reveal?: "always" | "hover";
    className?: string;
};

export function VcsIconButton({
    icon,
    title,
    onClick,
    disabled,
    tone = "normal",
    solid,
    loading,
    size = "md",
    reveal = "always",
    className,
}: VcsIconButtonProps) {
    if (!title) {
        console.warn("[VcsIconButton] title is required", { icon });
    }
    const isDisabled = disabled || loading;
    const solidClass = solid
        ? "bg-action text-actiontext enabled:hover:bg-actionhover"
        : `${ToneClass[tone] ?? ToneClass.normal}`;
    return (
        <button
            type="button"
            data-vcs-icon-button="1"
            title={title}
            aria-label={title}
            aria-busy={loading ? true : undefined}
            disabled={isDisabled}
            onClick={onClick}
            className={[
                "inline-flex shrink-0 items-center justify-center border-0 bg-transparent p-0 transition-colors",
                "cursor-pointer disabled:cursor-default disabled:opacity-40",
                SizeClass[size] ?? SizeClass.md,
                solidClass,
                reveal === "hover" ? RevealClass : AlwaysClass,
                className ?? "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <i
                className={
                    loading
                        ? "fa-sharp fa-solid fa-spinner animate-spin text-[11px]"
                        : `fa-sharp fa-solid fa-${icon} text-[11px]`
                }
            />
        </button>
    );
}
