// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunningDot, SessionRow, hiddenTagCount, visibleTagsFor } from "./session-row";

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

describe("session tag folding", () => {
    const tags = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

    it("shows only the first four tags while collapsed", () => {
        expect(visibleTagsFor(tags, false)).toEqual(["alpha", "beta", "gamma", "delta"]);
        expect(hiddenTagCount(tags, false)).toBe(2);
    });

    it("shows every tag once expanded and hides the +N control", () => {
        expect(visibleTagsFor(tags, true)).toEqual(tags);
        expect(hiddenTagCount(tags, true)).toBe(0);
    });

    it("does not overflow at exactly the visible limit", () => {
        const four = ["a", "b", "c", "d"];
        expect(visibleTagsFor(four, false)).toEqual(four);
        expect(hiddenTagCount(four, false)).toBe(0);
    });

    it("handles empty and oversized lists", () => {
        expect(visibleTagsFor([], false)).toEqual([]);
        expect(hiddenTagCount([], false)).toBe(0);
        expect(hiddenTagCount(["a"], false)).toBe(0);
    });
});

describe("note / tag row markup", () => {
    /** Find the tag overflow control (+N / 收起) in the rendered row. */
    function findOverflowControl(markup: string): RegExpMatchArray | null {
        return markup.match(/<button[^>]*>(\+\d+|收起)<\/button>/);
    }

    function renderRow(note: string | null, sessionTags: string[]): string {
        const session = { key: "k", id: "k", source: "pi", note, tags: sessionTags } as unknown as SessionSummary;
        // SessionRow owns hooks, so it must be rendered as an element (not called).
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
            />
        );
    }

    it("uses div[role=button] for the note row so the tag button can nest", () => {
        // Six tags → the +N overflow control renders as a real <button> inside the
        // note row, which is why the note row itself must not be a <button>.
        const markup = renderRow("#tag hello", ["a", "b", "c", "d", "e", "f"]);
        expect(markup).toContain('role="button"');
        expect(markup).toContain('tabindex="0"');
        // The nested tag overflow control must be a real button inside it.
        expect(markup).toMatch(/<div[^>]*role="button"[^>]*>[\s\S]*<button/);
    });

    it("renders the +N control when tags exceed the folded limit", () => {
        const markup = renderRow("note", ["a", "b", "c", "d", "e", "f"]);
        expect(findOverflowControl(markup)?.[1]).toBe("+2");
    });

    it("renders no +N control at or below the folded limit", () => {
        const markup = renderRow("note", ["a", "b", "c", "d"]);
        expect(findOverflowControl(markup)).toBeNull();
    });

    it("colors the note text with the same accent as the tag badges", () => {
        const markup = renderRow("plain note body", ["a"]);
        const noteSpan = markup.match(/<span class="[^"]*text-accent[^"]*">plain note body<\/span>/);
        expect(noteSpan).not.toBeNull();
        const tagSpan = markup.match(/<span class="[^"]*text-accent[^"]*">a<\/span>/);
        expect(tagSpan).not.toBeNull();
    });

    it("does not render a note row when there is no note and no tags", () => {
        const markup = renderRow(null, []);
        expect(markup).not.toContain('role="button"');
        expect(markup).not.toContain("Add a note");
    });
});
