// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent card title-source short marker (G2 red).
//
// design/sibling PRD (11-19-agent-card-title-source-marker) requires a
// card-local AgentCardTitleSourceMark:
//   - first_user_message renders a small message mark and carries the full
//     source in tooltip / aria-label;
//   - ai keeps the ✨ sparkles semantics;
//   - user (and source_title / project / id) renders no mark;
//   - the shared TitleSourceBadge must stay unchanged (still null outside "ai")
//     because list rows / detail header / EditableTitle / SessionNoteSection
//     reuse it.
//
// AgentCardTitleSourceMark does not exist yet → this file is red until the fix
// (sibling task) lands. The last case is a contract guard: when the fix is in,
// it prints badge_unchanged PASS.
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { i18n, initI18n } from "@/i18n/config";
import { TitleSourceBadge } from "@/app/view/aisessions/title-source-badge";
import { AgentCardTitleSourceMark } from "./agent-card-title-source-mark";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(node));
    containers.push(container);
    roots.push(root);
    return container;
}

afterEach(() => {
    while (roots.length > 0) {
        const root = roots.pop();
        act(() => root?.unmount());
    }
    while (containers.length > 0) {
        containers.pop()?.remove();
    }
});

function markOf(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>(".agent-card-title-source-mark");
}

describe("AgentCardTitleSourceMark", () => {
    it("first_user_message renders the mark with the full source in the tooltip", () => {
        const container = mount(<AgentCardTitleSourceMark titleSource="first_user_message" />);
        const mark = markOf(container);
        expect(mark).not.toBeNull();
        expect(mark?.getAttribute("data-title-source")).toBe("first_user_message");
        const tooltip = `${mark?.getAttribute("title") ?? ""} ${mark?.getAttribute("aria-label") ?? ""}`;
        expect(tooltip).toMatch(/first[_ ]user[_ ]message/i);
    });

    it("ai keeps the sparkles marker", () => {
        const container = mount(<AgentCardTitleSourceMark titleSource="ai" />);
        const mark = markOf(container);
        expect(mark).not.toBeNull();
        expect(mark?.getAttribute("data-title-source")).toBe("ai");
        expect(mark?.className ?? "").toMatch(/wand-magic-sparkles|fa-sparkles/);
    });

    it("user renders no mark", () => {
        const container = mount(<AgentCardTitleSourceMark titleSource="user" />);
        expect(markOf(container)).toBeNull();
    });

    it("shared TitleSourceBadge stays unchanged for first_user_message (badge_unchanged PASS)", async () => {
        await initI18n("en");
        const container = mount(<TitleSourceBadge titleSource="first_user_message" />);
        const unchanged = container.childElementCount === 0 && container.textContent?.trim() === "";
        // eslint-disable-next-line no-console
        console.log(`badge_unchanged ${unchanged ? "PASS" : "FAIL"}`);
        expect(unchanged).toBe(true);
        // And it still knows how to render the AI sparkle (unchanged behavior).
        const aiContainer = mount(<TitleSourceBadge titleSource="ai" />);
        expect(aiContainer.querySelector("i")).not.toBeNull();
        void i18n;
    });
});
