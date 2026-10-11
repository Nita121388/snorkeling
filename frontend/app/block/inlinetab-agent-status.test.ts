// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Self-check for the shared inline-tab agent status dot + remote-locality helpers.
// These back BOTH the strip label and the "more tabs" dropdown, so the R/D
// noise-reduction rules and the local/remote split live here under test.
// Run: npx vitest run frontend/app/block/inlinetab-agent-status.test.ts

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { statusFingerprint } from "@/app/agent-status/agent-status-unread";
import { describe, expect, test } from "vitest";
import { blockPathLocality, buildAgentStatusDot } from "./inlinetab-agent-status";

// 时间戳语义: normalizeTimeMs 把 < 1e12 的值当「秒」×1000, 所以夹具必须用
// 真实 epoch 毫秒 (1.7e12), 否则 completedAt 会被解释成 1970 年的时间。
const NOW = 1_700_000_000_000;
const DONE_AT = NOW - 60_000;

function makeStatus(overrides: Partial<AgentStatus>): AgentStatus {
    return {
        blockId: "b1",
        provider: "claude",
        state: "working",
        phase: "thinking",
        source: "hook",
        confidence: "high",
        updatedAt: NOW,
        ...overrides,
    };
}

describe("blockPathLocality", () => {
    test("blank / local / local:* are local", () => {
        for (const conn of ["", "  ", null, undefined, "local", "local:gitbash", "local:zsh"]) {
            expect(blockPathLocality(conn).isRemote, String(conn)).toBe(false);
        }
    });

    test("ssh and wsl connections are remote", () => {
        expect(blockPathLocality("ssh:box").isRemote).toBe(true);
        expect(blockPathLocality("wsl://ubuntu").isRemote).toBe(true);
        expect(blockPathLocality("user@host").isRemote).toBe(true);
    });

    test("trims whitespace and echoes the connection", () => {
        expect(blockPathLocality("  ssh:box  ")).toEqual({ isRemote: true, connection: "ssh:box" });
        expect(blockPathLocality("local")).toEqual({ isRemote: false, connection: "local" });
    });

    test("non-string connection meta is treated as local", () => {
        expect(blockPathLocality(123 as unknown).isRemote).toBe(false);
    });
});

describe("buildAgentStatusDot", () => {
    test("null status renders nothing", () => {
        expect(buildAgentStatusDot(null, "b1", null, null)).toBeNull();
    });

    test("idle/unknown without a done transition is suppressed (noise reduction)", () => {
        expect(buildAgentStatusDot(makeStatus({ state: "idle" }), "b1", null, null)).toBeNull();
        expect(buildAgentStatusDot(makeStatus({ state: "unknown" }), "b1", null, null)).toBeNull();
    });

    test("working is unread until its fingerprint is acked, then becomes acked", () => {
        const status = makeStatus({ state: "working" });
        const fresh = buildAgentStatusDot(status, "b1", {}, {}, NOW);
        expect(fresh).not.toBeNull();
        expect(fresh.unread).toBe(true);
        expect(fresh.title).toContain("mark as read");

        // Ack with the exact fingerprint of this status → unread drops, dot stays (working is R-class).
        const acked = buildAgentStatusDot(status, "b1", { b1: statusFingerprint(status) }, {}, NOW);
        expect(acked.unread).toBe(false);
        expect(acked.title).toContain("up to date");
    });

    test("D-class done-unread lights up even while state is idle, and carries elapsed text", () => {
        const status = makeStatus({ state: "idle", prevState: "working", completedAt: DONE_AT, updatedAt: DONE_AT });
        // R 指纹已读 + D 未读 → title 走 done 分支 (unread 优先于 doneUnread, 见下方用例)
        const dot = buildAgentStatusDot(status, "b1", { b1: statusFingerprint(status) }, {}, NOW);
        expect(dot).not.toBeNull();
        expect(dot.doneUnread).toBe(true);
        expect(dot.doneElapsedText).not.toBe("");
        expect(dot.title).toContain("switch to block to dismiss");
    });

    test("unread wording wins over done wording when both apply (既有优先级)", () => {
        const status = makeStatus({ state: "idle", prevState: "working", completedAt: DONE_AT, updatedAt: DONE_AT });
        const dot = buildAgentStatusDot(status, "b1", {}, {}, NOW);
        expect(dot.unread).toBe(true);
        expect(dot.doneUnread).toBe(true);
        expect(dot.title).toContain("mark as read");
    });

    test("D-class suppressed once done-acked", () => {
        const status = makeStatus({ state: "idle", prevState: "working", completedAt: DONE_AT, updatedAt: DONE_AT });
        expect(buildAgentStatusDot(status, "b1", {}, { b1: NOW - 30_000 }, NOW)).toBeNull();
    });

    test("title marks inferred statuses", () => {
        // 推断态由 source 决定 (controller/session/shell-integration), 与 confidence 无关.
        const status = makeStatus({ state: "working", source: "session", confidence: "low" });
        const dot = buildAgentStatusDot(status, "b1", {}, {}, NOW);
        expect(dot.inferred).toBe(true);
        expect(dot.title).toContain("(inferred)");
    });

    test("explicitly reported statuses are not marked inferred", () => {
        const dot = buildAgentStatusDot(makeStatus({ state: "working", source: "hook" }), "b1", {}, {}, NOW);
        expect(dot.inferred).toBe(false);
    });
});
