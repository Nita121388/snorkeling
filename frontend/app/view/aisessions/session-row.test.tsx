// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { RunningBadge } from "./session-row";

type SpanProps = { className?: string; title?: string; children?: ReactNode };

function spanText(node: ReactElement<SpanProps>): string {
    const children = node.props.children;
    if (Array.isArray(children)) {
        return children
            .map((child) => {
                if (typeof child === "string") return child;
                if (isValidElement<SpanProps>(child) && typeof child.props.children === "string") {
                    return child.props.children as string;
                }
                return "";
            })
            .join("");
    }
    if (typeof children === "string") return children;
    return "";
}

describe("RunningBadge", () => {
    it("renders the working badge span when the session is running", () => {
        const badge = RunningBadge({ runningState: "running" });

        expect(badge).not.toBeNull();
        if (!isValidElement<SpanProps>(badge)) return;
        expect(badge.props.className).toBe("session-overview-agent-status is-working shrink-0");
        expect(badge.props.title).toBe("This session has a live block in the app");
        expect(spanText(badge)).toBe("running");
    });

    it("renders nothing when the session is not running", () => {
        expect(RunningBadge({ runningState: null })).toBeNull();
    });
});


