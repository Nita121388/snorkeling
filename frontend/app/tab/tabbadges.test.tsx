// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabAgentStatusEntry } from "@/app/agent-status/agent-status-tab-aggregate";
import type { AgentStatus, AgentDisplayState } from "@/app/agent-status/agent-status-types";
import type { AgentStatusView } from "@/app/agent-status/agent-status-view";
import { TabBadges } from "./tabbadges";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/agent-persona/use-agent-personas", () => ({ useAgentPersonas: () => ({}) }));
vi.mock("@/app/agent-persona/use-session-personas", () => ({ useSessionEmojis: () => ({}) }));
vi.mock("@/app/view/term/agent-logo", () => ({
    getAgentIcon: (provider: string) => ({ kind: "emoji", emoji: provider === "pi" ? "🦊" : "🐼" }),
}));

function entry(blockId: string, state: AgentDisplayState, read: "seen" | "unread" = "unread"): TabAgentStatusEntry {
    const status: AgentStatus = {
        blockId,
        provider: blockId.endsWith("1") ? "pi" : "codex",
        state,
        phase: state === "working" ? "thinking" : "none",
        source: "hook",
        confidence: "high",
        updatedAt: Date.now(),
    };
    const view: AgentStatusView = {
        state,
        phase: status.phase,
        label: state,
        tone: state,
        read,
        elapsedText: "",
        title: `${state} — ${status.provider}`,
        ackable: read === "unread",
        inferred: false,
    };
    return { blockId, status, view, provider: status.provider, meta: null };
}

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function mount(props: ComponentProps<typeof TabBadges>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<TabBadges {...props} />));
}

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
});

describe("TabBadges B / C / G", () => {
    const entries = [
        entry("b1", "working"),
        entry("b2", "done", "seen"),
        entry("b3", "blocked"),
        entry("b4", "idle", "seen"),
        entry("b5", "stale"),
    ];

    it("B: renders a bounded avatar stack and +N overflow", () => {
        mount({ agentStatuses: entries, agentStatusMode: "avatars", maxAgentTokens: 2 });
        expect(container?.querySelectorAll(".tab-agent-avatar")).toHaveLength(2);
        expect(container?.querySelector(".tab-agent-overflow")?.textContent).toBe("+3");
        expect(container?.querySelector(".tab-agent-avatars")?.getAttribute("data-agent-hidden")).toBe("3");
        expect(container?.querySelector(".tab-agent-rail")).toBeNull();
    });

    it("C: renders one rail segment per Agent and no avatars", () => {
        mount({ agentStatuses: entries, agentStatusMode: "rail", maxAgentTokens: 2 });
        expect(container?.querySelectorAll(".tab-agent-rail-segment")).toHaveLength(5);
        expect(container?.querySelector(".tab-agent-rail")?.getAttribute("data-agent-total")).toBe("5");
        expect(container?.querySelector(".tab-agent-avatars")).toBeNull();
    });

    it("G: renders both the avatar stack and the complete rail", () => {
        mount({ agentStatuses: entries, agentStatusMode: "hybrid", maxAgentTokens: 2 });
        expect(container?.querySelectorAll(".tab-agent-avatar")).toHaveLength(2);
        expect(container?.querySelector(".tab-agent-overflow")?.textContent).toBe("+3");
        expect(container?.querySelectorAll(".tab-agent-rail-segment")).toHaveLength(5);
        expect(container?.querySelector("[data-agent-status-mode]")?.getAttribute("data-agent-status-mode")).toBe("hybrid");
    });

    it("seen stays visible but is de-emphasized; working keeps a motion hook", () => {
        mount({ agentStatuses: entries, agentStatusMode: "avatars", maxAgentTokens: 2 });
        const avatars = [...(container?.querySelectorAll(".tab-agent-avatar") ?? [])];
        expect(avatars[0].classList.contains("is-working")).toBe(true);
        expect(avatars[0].getAttribute("data-agent-read")).toBe("unread");
        expect(avatars[1].classList.contains("is-seen")).toBe(true);
        expect(avatars[1].getAttribute("data-agent-read")).toBe("seen");
        expect(avatars[1].getAttribute("aria-label")).toContain("done");
    });

    it("legacy badges and flag color still render beside the new status surface", () => {
        mount({
            badges: [{ icon: "bell", color: "#fff", priority: 10, badgeid: "bell-1" }],
            flagColor: "#f00",
            agentStatuses: entries,
            agentStatusMode: "rail",
        });
        expect(container?.querySelectorAll(".tab-legacy-badges i")).toHaveLength(1);
        expect(container?.querySelectorAll(".tab-legacy-badges .rounded-full")).toHaveLength(1);
        expect(container?.querySelectorAll(".tab-agent-rail-segment")).toHaveLength(5);
    });

    it("empty Agent list keeps legacy badges but does not revive old unread dots", () => {
        mount({
            badges: [{ icon: "bell", color: "#fff", priority: 10, badgeid: "bell-1" }],
            agentDots: [{ blockId: "old", kind: "D", state: "done", color: "#0f0", elapsedText: "", title: "old" }],
            agentStatuses: [],
            agentStatusMode: "hybrid",
        });
        expect(container?.querySelectorAll(".tab-legacy-badges i")).toHaveLength(1);
        expect(container?.querySelector(".tab-agent-rail")).toBeNull();
        expect(container?.querySelector(".tab-agent-avatars")).toBeNull();
    });
});
