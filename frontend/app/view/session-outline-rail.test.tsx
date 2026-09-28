// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Regression test: the message rail must render from the FIRST user message.
// Old threshold (prompts.length < 2) made a freshly-created session with a single
// user message show NO rail, while restored sessions (>=2 messages) always did.
// Fix: render from >=1 prompt so new sessions show the rail consistently.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionOutlineRail, type OutlinePrompt } from "./session-outline-rail";

function renderRail(prompts: OutlinePrompt[]): string {
    return renderToStaticMarkup(
        <SessionOutlineRail prompts={prompts} activeSeq={prompts.length > 0 ? prompts[prompts.length - 1].seq : null} />
    );
}

describe("SessionOutlineRail threshold", () => {
    it("renders the rail with exactly 1 user message (new session)", () => {
        const html = renderRail([{ seq: 1, preview: "first message" }]);
        expect(html).toContain("aria-label=\"1/first message\"");
        // Rail geometry: 36px wide pill slot rendered
        expect(html).toContain("style=\"width:36px\"");
    });

    it("renders 2 ticks for 2 user messages (restored session)", () => {
        const html = renderRail([
            { seq: 1, preview: "first message" },
            { seq: 2, preview: "second message" },
        ]);
        expect(html).toContain("aria-label=\"1/first message\"");
        expect(html).toContain("aria-label=\"2/second message\"");
    });

    it("returns empty output with 0 prompts (brand-new session, nothing to show)", () => {
        const html = renderRail([]);
        expect(html).toBe("");
    });
});
