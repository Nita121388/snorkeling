// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 跨面契约测试：同一个 AgentStatus + 同一份已读 map，四个消费入口必须得出同一个 read 结论。
//
// 这层测试存在的理由：本次改动的原始 bug 就是"agent 卡片上的 Done 不跟随 seen"——
// 因为 7 个展示面各算各的 read。现在它们都走 deriveAgentStatusView，本文件把这条
// 契约钉死在测试里，防止以后有人给某个面加一份"自己的未读判定"。

import { buildAgentStatusDot } from "@/app/block/inlinetab-agent-status";
import { presentAgentStateFromView } from "@/app/tab/tab-info-card-model";
import { describe, expect, it } from "vitest";
import { agentStatusViewLabel, deriveAgentStatusView } from "./agent-status-view";
import { statusFingerprint } from "./agent-status-unread";
import type { AgentStatus } from "./agent-status-types";

const now = 1_790_000_000_000;
const doneAt = now - 180_000;

function doneStatus(): AgentStatus {
    return {
        blockId: "block-agent",
        provider: "codex",
        sessionId: "session-1",
        state: "done",
        prevState: "working",
        phase: "none",
        source: "hook",
        confidence: "high",
        completedAt: doneAt,
        updatedAt: doneAt,
    };
}

function workingStatus(): AgentStatus {
    return {
        blockId: "block-agent",
        provider: "codex",
        sessionId: "session-1",
        state: "working",
        phase: "tool",
        toolName: "bash",
        source: "hook",
        confidence: "high",
        updatedAt: now,
    };
}

type SurfaceRead = { view: string; dot: boolean | "none"; pill: string };

function readEverywhere(
    status: AgentStatus,
    ackedFp: string | null,
    doneAckedAt: number
): SurfaceRead {
    const view = deriveAgentStatusView({
        status,
        blockId: status.blockId,
        ackedFp,
        doneAckedAt,
        nowMs: now,
    });
    const dot = buildAgentStatusDot(status, status.blockId, { [status.blockId]: ackedFp ?? "" }, {
        [status.blockId]: doneAckedAt,
    }, now);
    const pill = presentAgentStateFromView(view);
    return {
        view: view?.read ?? "null",
        dot: dot == null ? "none" : dot.doneUnread || dot.unread,
        pill: pill.read,
    };
}

describe("cross-surface read contract", () => {
    it("finished and unread: header badge, tab dot and agent card all say unread", () => {
        const status = doneStatus();
        const surfaces = readEverywhere(status, null, 0);
        expect(surfaces.view).toBe("unread");
        expect(surfaces.dot).toBe(true);
        expect(surfaces.pill).toBe("unread");
    });

    it("after the user acks (any surface), every surface flips to seen in the same frame", () => {
        const status = doneStatus();
        const surfaces = readEverywhere(status, statusFingerprint(status), now - 30_000);
        expect(surfaces.view).toBe("seen");
        expect(surfaces.dot).toBe(false);
        expect(surfaces.pill).toBe("seen");
    });

    it("a 'looked at it' write (block-focus) has exactly the same effect as clicking", () => {
        const status = doneStatus();
        // markAgentSeen 与 ackAgentStatus 写的是同一条 doneAckedAt 通道。
        expect(readEverywhere(status, null, now - 30_000).view).toBe("seen");
    });

    it("R-class working stays unread until its fingerprint is acked", () => {
        const status = workingStatus();
        expect(readEverywhere(status, null, 0).view).toBe("unread");
        expect(readEverywhere(status, statusFingerprint(status), 0).view).toBe("seen");
    });

    it("idle without a completion transition is silent everywhere", () => {
        const idle: AgentStatus = { ...doneStatus(), state: "idle", prevState: undefined, completedAt: undefined };
        const surfaces = readEverywhere(idle, null, 0);
        expect(surfaces.view).toBe("seen");
        expect(surfaces.dot).toBe("none");
        expect(surfaces.pill).toBe("seen");
    });

    it("labels agree: unread Done carries elapsed text, seen Done does not", () => {
        const status = doneStatus();
        const unread = deriveAgentStatusView({ status, blockId: status.blockId, nowMs: now })!;
        const seen = deriveAgentStatusView({
            status,
            blockId: status.blockId,
            doneAckedAt: now - 30_000,
            nowMs: now,
        })!;
        expect(agentStatusViewLabel(unread)).toBe("Done 3m");
        expect(agentStatusViewLabel(seen)).toBe("Done");
        expect(presentAgentStateFromView(unread).label).toBe("Done 3m");
        expect(presentAgentStateFromView(seen).label).toBe("Done");
    });

    it("a fresh completion after a look re-lights every surface", () => {
        // 上一轮看过（doneAckedAt 落在上一轮完成之后），这一轮完成时间更新 → 重新未读。
        const next = { ...doneStatus(), completedAt: now - 1_000, updatedAt: now - 1_000 };
        const surfaces = readEverywhere(next, null, now - 60_000);
        expect(surfaces.view).toBe("unread");
        expect(surfaces.pill).toBe("unread");
    });
});
