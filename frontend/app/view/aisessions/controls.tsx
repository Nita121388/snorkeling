// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { cn } from "@/util/util";
import type { MouseEventHandler, ReactNode } from "react";
import { useEffect, useState } from "react";
import { copyText } from "./utils";

export function SourceButton({
    label,
    icon,
    active,
    busy,
    onClick,
}: {
    label: string;
    icon?: ReactNode;
    active: boolean;
    busy?: boolean;
    onClick: () => void;
}) {
    const iconOnly = icon != null;
    return (
        <button
            className={cn(
                "flex h-7 items-center justify-center gap-1 rounded border text-xs transition-colors",
                iconOnly ? "w-8 px-1" : "px-2",
                active
                    ? "border-accent bg-accent/10 text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "border-border text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onClick}
            title={label}
            aria-label={label}
        >
            {busy ? <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px] text-accent" /> : null}
            {!busy && icon ? icon : null}
            {!iconOnly ? label : null}
        </button>
    );
}

export function OpenAILogo() {
    return (
        <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729Zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944Zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464ZM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872Zm16.5963 3.8558-5.8333-3.3874L15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667Zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66ZM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813Zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </svg>
    );
}

export function ClaudeLogo() {
    return (
        <span className="[&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            <ClaudeColorSvg />
        </span>
    );
}

export function SortButton({ descending, onToggle }: { descending: boolean; onToggle: () => void }) {
    return (
        <button
            className={cn(
                "h-7 shrink-0 rounded border px-2 text-xs",
                descending
                    ? "border-accent bg-accent/10 text-primary"
                    : "border-border text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onToggle}
            title={descending ? "Newest first" : "Oldest first"}
        >
            <i
                className={cn(
                    "fa-sharp fa-solid mr-1",
                    descending ? "fa-arrow-down-wide-short" : "fa-arrow-up-short-wide"
                )}
            />
            {descending ? "Newest" : "Oldest"}
        </button>
    );
}

export function IconButton({
    icon,
    label,
    onClick,
    className,
    size = "sm",
    disabled = false,
}: {
    icon: string;
    label: string;
    onClick: MouseEventHandler<HTMLButtonElement>;
    className?: string;
    size?: "xs" | "sm";
    disabled?: boolean;
}) {
    return (
        <button
            className={cn(
                "shrink-0 rounded border border-border text-secondary hover:bg-hover hover:text-primary",
                size === "xs" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs",
                disabled && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-secondary",
                className
            )}
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
        >
            <i className={cn("fa-sharp fa-solid", icon)} />
        </button>
    );
}

export function CopyIconButton({
    text,
    label,
    className,
    size = "sm",
}: {
    text: string;
    label: string;
    className?: string;
    size?: "xs" | "sm";
}) {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

    useEffect(() => {
        if (status === "idle") return;
        const handle = window.setTimeout(() => setStatus("idle"), status === "copied" ? 1200 : 1600);
        return () => window.clearTimeout(handle);
    }, [status]);

    const statusLabel = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
    return (
        <IconButton
            icon={status === "copied" ? "fa-check" : status === "failed" ? "fa-triangle-exclamation" : "fa-copy"}
            label={statusLabel}
            size={size}
            className={cn(
                status === "copied" && "border-accent bg-accent/10 text-accent",
                status === "failed" && "border-error bg-error/10 text-error",
                className
            )}
            onClick={(e) => {
                e.stopPropagation();
                void copyText(text)
                    .then(() => setStatus("copied"))
                    .catch(() => setStatus("failed"));
            }}
        />
    );
}
