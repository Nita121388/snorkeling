// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { RunningDot } from "./session-row";

type SpanProps = { className?: string; title?: string; children?: ReactNode };

function childSpanClasses(node: ReactElement<SpanProps>): string[] {
    const children = node.props.children;
    if (!Array.isArray(children)) return [];
    return children
        .filter((c): c is ReactElement<{ className?: string }> => isValidElement<{ className?: string }>(c))
        .map((c) => c.props.className ?? "");
}

describe("RunningDot", () => {
    it("renders four CSS dots in a spinning box when the session is running", () => {
        const dot = RunningDot({ runningState: "running" });

        expect(dot).not.toBeNull();
        if (!isValidElement<SpanProps>(dot)) return;
        expect(dot.props.className).toContain("animate-spin");
        expect(dot.props.className).toContain("h-4");
        expect(dot.props.className).toContain("w-4");
        expect(dot.props.className.split(/\s+/)).toContain("inline-flex");
        expect(dot.props.className.split(/\s+/)).not.toContain("block");
        expect(dot.props.title).toBe("This session has a live block in the app");

        const dots = childSpanClasses(dot);
        expect(dots).toHaveLength(4);
        for (const cls of dots) {
            expect(cls).toContain("rounded-full");
            expect(cls).toContain("bg-accent");
            expect(cls).toContain("absolute");
        }
    });

    it("renders nothing when the session is not running", () => {
        expect(RunningDot({ runningState: null })).toBeNull();
    });
});
