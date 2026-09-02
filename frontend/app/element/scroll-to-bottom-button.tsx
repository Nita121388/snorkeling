// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { cn } from "@/util/util";

type ScrollToBottomButtonProps = {
    isAtBottom: boolean;
    onClick: () => void;
    bottomOffset?: string;
};

export const ScrollToBottomButton = memo(({ isAtBottom, onClick, bottomOffset = "1rem" }: ScrollToBottomButtonProps) => {
    return (
        <button
            type="button"
            className={cn(
                "absolute left-1/2 z-20 -translate-x-1/2",
                "flex h-9 w-9 items-center justify-center rounded-full",
                "border border-border/50 bg-modalbg/90 shadow-lg backdrop-blur-sm",
                "text-secondary transition-all duration-200 ease-in-out",
                "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isAtBottom ? "pointer-events-none scale-75 opacity-0" : "scale-100 opacity-100"
            )}
            style={{ bottom: bottomOffset }}
            onClick={onClick}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
        >
            <i className="fa-sharp fa-solid fa-arrow-down text-sm" />
        </button>
    );
});

ScrollToBottomButton.displayName = "ScrollToBottomButton";
