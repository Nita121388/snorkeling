// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunningDot } from "./session-row";

type ElementProps = {
    className?: string;
    children?: ReactNode;
    "aria-label"?: string;
    onClick?: (event: { stopPropagation: () => void }) => void;
};

type TooltipProps = {
    children?: ReactNode;
    content?: ReactNode;
    divClassName?: string;
    hideOnClick?: boolean;
    openDelay?: number;
    placement?: string;
};

function childSpanClasses(node: ReactElement<ElementProps>): string[] {
    const children = node.props.children;
    if (!Array.isArray(children)) return [];
    return children
        .filter((c): c is ReactElement<{ className?: string }> => isValidElement<{ className?: string }>(c))
        .map((c) => c.props.className ?? "");
}

describe("RunningDot", () => {
    it("renders four CSS dots in a spinning box when the session is running", () => {
        const onJumpToBlock = vi.fn();
        const dot = RunningDot({
            runningState: { status: "running", blockId: "block-1", tabId: "tab-1" },
            onJumpToBlock,
        });

        expect(dot).not.toBeNull();
        if (!isValidElement<TooltipProps>(dot)) return;
        expect(dot.props.placement).toBe("top");
        expect(dot.props.openDelay).toBe(200);
        expect(dot.props.hideOnClick).toBe(true);
        expect(dot.props.divClassName?.split(/\s+/)).toContain("inline-flex");
        expect(dot.props.divClassName?.split(/\s+/)).not.toContain("block");
        const tooltipMarkup = renderToStaticMarkup(dot.props.content);
        expect(tooltipMarkup).toContain("This session has a live block in the app.");
        expect(tooltipMarkup).toContain("Click to jump to block");

        const button = dot.props.children;
        expect(isValidElement<ElementProps>(button)).toBe(true);
        if (!isValidElement<ElementProps>(button)) return;
        expect(button.props.className).toContain("animate-spin");
        expect(button.props.className).toContain("h-4");
        expect(button.props.className).toContain("w-4");
        expect(button.props["aria-label"]).toBe("Jump to live block");

        const dots = childSpanClasses(button);
        expect(dots).toHaveLength(4);
        for (const cls of dots) {
            expect(cls).toContain("rounded-full");
            expect(cls).toContain("bg-success");
            expect(cls).toContain("absolute");
        }

        const stopPropagation = vi.fn();
        button.props.onClick?.({ stopPropagation });
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onJumpToBlock).toHaveBeenCalledWith({ status: "running", blockId: "block-1", tabId: "tab-1" });
    });

    it("renders nothing when the session is not running", () => {
        expect(RunningDot({ runningState: null, onJumpToBlock: () => {} })).toBeNull();
    });
});
