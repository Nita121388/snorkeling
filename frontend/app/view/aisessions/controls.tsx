// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { Tooltip } from "@/app/element/tooltip";
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
                "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent text-xs transition-colors",
                iconOnly ? "w-8 px-1" : "px-2.5",
                active
                    ? "bg-accent/10 text-primary"
                    : "text-secondary hover:bg-hoverbg hover:text-primary"
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

export function GeminiLogo() {
    return (
        <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81z" />
        </svg>
    );
}

export function OpencodeLogo() {
    return (
        <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />
        </svg>
    );
}

// Official Pi mark from https://pi.dev/logo-auto.svg (P shape + i dot),
// rendered in currentColor so it adapts to light/dark themes like the source does.
export function PiLogo() {
    return (
        <svg
            className="h-4 w-4"
            viewBox="0 0 800 800"
            fill="currentColor"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                fillRule="evenodd"
                d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
            />
            <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
        </svg>
    );
}

export function SortButton({ descending, onToggle }: { descending: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs transition-colors",
                descending
                    ? "bg-background text-primary shadow-sm"
                    : "bg-surface text-secondary hover:bg-hover hover:text-primary"
            )}
            onClick={onToggle}
            title={descending ? "Newest first" : "Oldest first"}
            aria-label={descending ? "Newest first" : "Oldest first"}
        >
            <i
                className={cn(
                    "fa-sharp fa-solid text-[11px]",
                    descending ? "fa-arrow-down-wide-short" : "fa-arrow-up-short-wide"
                )}
            />
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
                "shrink-0 rounded text-secondary hover:bg-hover hover:text-primary",
                size === "xs" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs",
                disabled && "cursor-default opacity-60 hover:bg-transparent hover:text-secondary",
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

type CopyStatus = "idle" | "copied" | "failed";

function useCopyStatus(text: string, label: string) {
    const [status, setStatus] = useState<CopyStatus>("idle");

    useEffect(() => {
        if (status === "idle") return;
        const handle = window.setTimeout(() => setStatus("idle"), status === "copied" ? 1200 : 1600);
        return () => window.clearTimeout(handle);
    }, [status]);

    const statusLabel = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label;
    const handleCopy = () =>
        copyText(text)
            .then(() => setStatus("copied"))
            .catch(() => setStatus("failed"));

    return { status, statusLabel, handleCopy };
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
    const { status, statusLabel, handleCopy } = useCopyStatus(text, label);
    return (
        <IconButton
            icon={status === "copied" ? "fa-check" : status === "failed" ? "fa-triangle-exclamation" : "fa-copy"}
            label={statusLabel}
            size={size}
            className={cn(
                status === "copied" && "border-accent bg-accent/10 text-accent",
                status === "failed" && "border-error bg-error/10 text-error",
                className,
                status !== "idle" && "opacity-100"
            )}
            onClick={(e) => {
                e.stopPropagation();
                void handleCopy();
            }}
        />
    );
}

export function CopyTextButton({
    text,
    label,
    displayText,
    tooltipText,
    wrapperClassName,
    className,
    textClassName,
}: {
    text: string;
    label: string;
    displayText?: ReactNode;
    tooltipText?: string;
    wrapperClassName?: string;
    className?: string;
    textClassName?: string;
}) {
    const { status, statusLabel, handleCopy } = useCopyStatus(text, label);
    const actionText = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Click to copy";

    return (
        <Tooltip
            placement="top"
            forceOpen={status !== "idle"}
            openDelay={200}
            divClassName={wrapperClassName}
            content={
                <div className="max-w-[420px] whitespace-pre-wrap break-words text-[11px] leading-4">
                    <div className={cn(status === "failed" ? "text-error" : "text-secondary")}>{tooltipText || text}</div>
                    <div
                        className={cn(
                            "mt-1 inline-flex items-center gap-1 text-[10px] uppercase",
                            status === "copied" && "text-accent",
                            status === "failed" && "text-error",
                            status === "idle" && "text-secondary"
                        )}
                    >
                        {status === "copied" ? (
                            <i className="fa-sharp fa-solid fa-check text-[9px] ly-pop" />
                        ) : status === "failed" ? (
                            <i className="fa-sharp fa-solid fa-triangle-exclamation text-[9px] ly-pop" />
                        ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent/90 ring-2 ring-accent/20" />
                        )}
                        <span>{actionText}</span>
                    </div>
                </div>
            }
        >
            <button
                type="button"
                className={cn(
                    "flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                    status === "copied" && "bg-accent/10 text-accent",
                    status === "failed" && "bg-error/10 text-error",
                    className
                )}
                title={statusLabel}
                aria-label={statusLabel}
                onClick={(e) => {
                    e.stopPropagation();
                    void handleCopy();
                }}
            >
                <span
                    className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-accent",
                        status === "copied" && "bg-accent/10 text-accent",
                        status === "failed" && "bg-error/10 text-error"
                    )}
                >
                    {status === "copied" ? (
                        <i className="fa-sharp fa-solid fa-check text-[9px]" />
                    ) : status === "failed" ? (
                        <i className="fa-sharp fa-solid fa-triangle-exclamation text-[9px]" />
                    ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
                    )}
                </span>
                <span className={cn("min-w-0", textClassName)}>{displayText || text}</span>
                <span className="sr-only" aria-live="polite">
                    {status === "copied" ? `${label} copied` : status === "failed" ? `${label} copy failed` : ""}
                </span>
            </button>
        </Tooltip>
    );
}
