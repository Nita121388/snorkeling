import { describe, expect, it } from "vitest";
import {
    agentStatusPresentation,
    applyStaleness,
    presentCanonicalAgentStatus,
} from "./agent-status-derive";
import { isAgentDoneUnread } from "./agent-status-done-unread";
import { isAgentStatusUnread, statusFingerprint } from "./agent-status-unread";
import type { AgentStatus } from "./agent-status-types";

const Now = 1_800_000_000_000;

function canonical(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "b1",
        provider: "claude",
        sessionId: "s1",
        state: "idle",
        phase: "none",
        source: "hook",
        confidence: "high",
        updatedAt: Now - 30_000,
        seq: 7,
        ...overrides,
    };
}

describe("presentCanonicalAgentStatus", () => {
    it("promotes canonical idle with a completed transition to done", () => {
        const status = presentCanonicalAgentStatus(
            canonical({ prevState: "working", completedAt: Now - 30_000 }),
            Now
        );
        expect(status?.state).toBe("done");
        expect(status?.phase).toBe("none");
        // prevState/completedAt 必须保留：D 未读判定与 elapsed 都靠它们
        expect(status?.prevState).toBe("working");
        expect(status?.completedAt).toBe(Now - 30_000);
    });

    it("keeps plain idle as idle (no transition = no done)", () => {
        expect(presentCanonicalAgentStatus(canonical(), Now)?.state).toBe("idle");
        expect(presentCanonicalAgentStatus(canonical({ prevState: "idle" }), Now)?.state).toBe("idle");
        expect(presentCanonicalAgentStatus(canonical({ prevState: "unknown" }), Now)?.state).toBe("idle");
    });

    it("keeps the stale decay for working statuses", () => {
        const working = canonical({ state: "working", phase: "thinking", updatedAt: Now - 10 * 60_000 });
        expect(applyStaleness(working, Now).state).toBe("stale");
        expect(presentCanonicalAgentStatus(working, Now)?.state).toBe("stale");
    });

    it("returns null for null canonical so every surface renders nothing", () => {
        expect(presentCanonicalAgentStatus(null, Now)).toBeNull();
    });

    it("does not depend on wall-clock/session windows: done never decays", () => {
        const done = presentCanonicalAgentStatus(
            canonical({ prevState: "working", completedAt: Now - 30_000 }),
            Now
        );
        // 16 分钟后（旧实现的 15 分钟悬崖之外）仍是 done
        expect(presentCanonicalAgentStatus(done, Now + 16 * 60_000)?.state).toBe("done");
    });
});

describe("cross-surface parity (agent block header vs Session Overview chip)", () => {
    it("both surfaces derive the same status object shape → same ack fingerprint", () => {
        const raw = canonical({ prevState: "working", completedAt: Now - 30_000 });
        // A 面（store presented atom）与 O 面（Overview chip）现在是同一个函数
        const header = presentCanonicalAgentStatus(raw, Now);
        const overview = presentCanonicalAgentStatus(raw, Now);
        expect(statusFingerprint(header!)).toBe(statusFingerprint(overview!));
        expect(header?.state).toBe("done");
    });

    it("acking one surface clears the other (same fingerprint map entry)", () => {
        const raw = canonical({ prevState: "working", completedAt: Now - 30_000 });
        const presented = presentCanonicalAgentStatus(raw, Now)!;
        const ackFp = statusFingerprint(presented);
        // 任何一面 ack 写入 ackFp 后，两面都不再 unread
        expect(isAgentStatusUnread(presented, ackFp)).toBe(false);
        // ack 前是 unread
        expect(isAgentStatusUnread(presented, null)).toBe(true);
    });

    it("D (done-unread) works on the presented done state, not only on raw idle", () => {
        const raw = canonical({ prevState: "working", completedAt: Now - 30_000 });
        const presented = presentCanonicalAgentStatus(raw, Now)!;
        expect(isAgentDoneUnread(presented, 0)).toBe(true);
        expect(isAgentDoneUnread(presented, Now)).toBe(false);
    });

    it("presents matching Done labels on both surfaces", () => {
        const raw = canonical({ prevState: "working", completedAt: Now - 30_000 });
        const presented = presentCanonicalAgentStatus(raw, Now)!;
        // 头部与 Overview chip 都走 agentStatusPresentation
        expect(agentStatusPresentation(presented).label).toBe("Done");
        // 旧行为产物 "Idle 10m" 的根因：raw idle 直接取 label
        expect(agentStatusPresentation(raw).label).toBe("Idle");
    });
});
