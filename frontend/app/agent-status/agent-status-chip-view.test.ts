// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildAgentStatusChipView } from "./agent-status-chip-view";
import type { AgentStatus } from "./agent-status-types";

const Now = 1_700_000_000_000;

function status(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "blk-1",
        provider: "claude",
        state: "working",
        phase: "tool",
        source: "hook",
        confidence: "high",
        toolName: "Bash",
        updatedAt: Now - 5_000,
        activeSince: Now - 65_000,
        ...overrides,
    };
}

describe("buildAgentStatusChipView — chip 收口的锁", () => {
    it("同一 status 在 4 个变体下产出相同 label", () => {
        const variants = ["list", "board", "card", "header"] as const;
        const labels = variants.map((variant) =>
            buildAgentStatusChipView({ variant, status: status(), read: "seen", nowMs: Now })?.label
        );
        expect(labels).toEqual(["Tool: Bash", "Tool: Bash", "Tool: Bash", "Tool: Bash"]);
    });

    it("同一 status 在 4 个变体下产出相同 title", () => {
        const variants = ["list", "board", "card", "header"] as const;
        const titles = variants.map((variant) =>
            buildAgentStatusChipView({ variant, status: status(), read: "seen", nowMs: Now })?.title
        );
        expect(new Set(titles).size).toBe(1);
    });

    it("同一 status 在 4 个变体下产出相同 runtime", () => {
        const variants = ["list", "board", "card", "header"] as const;
        const runtimes = variants.map((variant) =>
            buildAgentStatusChipView({ variant, status: status(), read: "seen", nowMs: Now })?.runtime
        );
        expect(runtimes).toEqual(["1min5s", "1min5s", "1min5s", "1min5s"]);
    });
});

describe("buildAgentStatusChipView — 兼容类名（verify 探针契约）", () => {
    it("card 变体保留 agent-card-status-chip", () => {
        const view = buildAgentStatusChipView({
            variant: "card",
            status: status(),
            read: "seen",
            nowMs: Now,
        });
        expect(view.className).toContain("agent-card-status-chip");
    });

    it("header 变体保留 agent-status-header", () => {
        const view = buildAgentStatusChipView({
            variant: "header",
            status: status(),
            read: "seen",
            nowMs: Now,
        });
        expect(view.className).toContain("agent-status-header");
    });

    it("list 与 board 变体保留 session-overview-agent-status", () => {
        for (const variant of ["list", "board"] as const) {
            const view = buildAgentStatusChipView({ variant, status: status(), read: "seen", nowMs: Now });
            expect(view.className).toContain("session-overview-agent-status");
        }
    });

    it("aggregate 变体保留 session-overview-agent-aggregate", () => {
        const view = buildAgentStatusChipView({
            variant: "aggregate",
            aggregate: { state: "working", phase: "tool", total: 3, count: 2, inferredCount: 0 },
            read: "seen",
            nowMs: Now,
        });
        expect(view.className).toContain("session-overview-agent-aggregate");
    });

    it("每个变体都带自己的 variant 类", () => {
        for (const variant of ["list", "board", "card", "header", "aggregate"] as const) {
            const view = buildAgentStatusChipView({
                variant,
                status: status(),
                aggregate: { state: "working", phase: "tool", total: 1, count: 1, inferredCount: 0 },
                read: "seen",
                nowMs: Now,
            });
            expect(view.className).toContain(`agent-status-chip--${variant}`);
        }
    });
});

describe("buildAgentStatusChipView — 空与聚合", () => {
    it("idle 仍然渲染（只是不产出跑时）", () => {
        const view = buildAgentStatusChipView({ variant: "list", status: status({ state: "idle" }), read: "seen", nowMs: Now });
        expect(view).not.toBeNull();
        expect(view.label).toBe("Idle");
        expect(view.runtime).toBe("");
    });

    it("unknown 仍然渲染（显示 No data）", () => {
        const view = buildAgentStatusChipView({
            variant: "list",
            status: status({ state: "unknown", phase: "unknown" }),
            read: "seen",
            nowMs: Now,
        });
        expect(view).not.toBeNull();
        expect(view.label).toBe("No data");
    });

    it("status 为 null 且非 aggregate 返回 null", () => {
        expect(buildAgentStatusChipView({ variant: "list", status: null, read: "seen", nowMs: Now })).toBeNull();
    });

    it("aggregate 变体在 total=0 时不渲染", () => {
        const view = buildAgentStatusChipView({
            variant: "aggregate",
            aggregate: { state: "unknown", phase: "unknown", total: 0, count: 0, inferredCount: 0 },
            read: "seen",
            nowMs: Now,
        });
        expect(view).toBeNull();
    });

    it("aggregate 变体的 runtime 恒为空", () => {
        const view = buildAgentStatusChipView({
            variant: "aggregate",
            aggregate: { state: "working", phase: "tool", total: 3, count: 2, inferredCount: 0 },
            read: "seen",
            nowMs: Now,
        });
        expect(view.runtime).toBe("");
    });

    it("aggregate 变体的 label 是聚合词", () => {
        const view = buildAgentStatusChipView({
            variant: "aggregate",
            aggregate: { state: "working", phase: "tool", total: 3, count: 2, inferredCount: 0 },
            read: "seen",
            nowMs: Now,
        });
        expect(view.label).toBe("2 working");
    });
});

describe("buildAgentStatusChipView — read 语义", () => {
    it("unread 与 seen 的类名不同", () => {
        const unread = buildAgentStatusChipView({ variant: "card", status: status(), read: "unread", nowMs: Now });
        const seen = buildAgentStatusChipView({ variant: "card", status: status(), read: "seen", nowMs: Now });
        expect(unread.className).toContain("is-unread");
        expect(seen.className).toContain("is-seen");
        expect(unread.className).not.toBe(seen.className);
    });

    it("header 变体 seen 时带 is-acked", () => {
        const view = buildAgentStatusChipView({ variant: "header", status: status(), read: "seen", nowMs: Now });
        expect(view.className).toContain("is-acked");
    });

    it("header 变体 unread 且 done 时带 is-done-unread", () => {
        const view = buildAgentStatusChipView({
            variant: "header",
            status: status({ state: "done", phase: "none" }),
            read: "unread",
            nowMs: Now,
        });
        expect(view.className).toContain("is-done-unread");
    });

    it("inferred 状态带 is-inferred", () => {
        const view = buildAgentStatusChipView({
            variant: "card",
            status: status({ source: "session" }),
            read: "seen",
            nowMs: Now,
        });
        expect(view.className).toContain("is-inferred");
    });
});

describe("buildAgentStatusChipView — 跑时只在活跃态", () => {
    it("working 有 runtime", () => {
        const view = buildAgentStatusChipView({ variant: "list", status: status(), read: "seen", nowMs: Now });
        expect(view.runtime).not.toBe("");
    });

    it("blocked 有 runtime", () => {
        const view = buildAgentStatusChipView({
            variant: "list",
            status: status({ state: "blocked", phase: "approval" }),
            read: "seen",
            nowMs: Now,
        });
        expect(view.runtime).not.toBe("");
    });

    it("done 且已读无 runtime（避免秒级噪音）", () => {
        const view = buildAgentStatusChipView({
            variant: "list",
            status: status({ state: "done", phase: "none" }),
            read: "seen",
            nowMs: Now,
        });
        expect(view.runtime).toBe("");
    });

    it("done 且未读把分钟级 elapsed 拼进 label（沿用 agentStatusViewLabel 语义）", () => {
        const view = buildAgentStatusChipView({
            variant: "list",
            status: status({ state: "done", phase: "none", updatedAt: Now - 3 * 60_000, activeSince: undefined }),
            read: "unread",
            nowMs: Now,
        });
        expect(view.label).toBe("Done 3m");
        expect(view.runtime).toBe("");
    });

    it("stale 态仍有 runtime（卡住的时长是有用信息）", () => {
        const view = buildAgentStatusChipView({
            variant: "list",
            status: status({ state: "stale", phase: "none" }),
            read: "seen",
            nowMs: Now,
        });
        expect(view.runtime).toBe("1min5s");
    });
});
