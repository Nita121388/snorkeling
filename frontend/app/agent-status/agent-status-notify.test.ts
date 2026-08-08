// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideNotifyKind } from "./agent-status-notify";
import type { AgentStatus, AgentDisplayState } from "./agent-status-types";

function mkStatus(state: AgentDisplayState, blockId = "blk1", provider = "claude"): AgentStatus {
    return {
        blockId,
        provider,
        state,
        phase: "none",
        source: "hook",
        confidence: "high",
        updatedAt: 1,
    };
}

describe("decideNotifyKind", () => {
    it("fires 'done' on working → idle", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBe("done");
    });

    it("fires 'done' on thinking → idle (any non-idle working band)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("thinking");
        expect(decideNotifyKind(next, prev)).toBe("done");
    });

    it("does NOT fire 'done' on blocked → idle (user just resumed)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("blocked");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on idle → idle (wobble)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("idle");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on stale → idle (prior was noise)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("stale");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on unknown → idle (prior was noise)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("unknown");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' when prev is null (no prior working state observed)", () => {
        const next = mkStatus("idle");
        expect(decideNotifyKind(next, null)).toBeNull();
    });

    it("fires 'blocked' on working → blocked", () => {
        const next = mkStatus("blocked");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBe("blocked");
    });

    it("fires 'blocked' on idle → blocked regardless of prev", () => {
        const next = mkStatus("blocked");
        expect(decideNotifyKind(next, null)).toBe("blocked");
        expect(decideNotifyKind(next, mkStatus("idle"))).toBe("blocked");
        expect(decideNotifyKind(next, mkStatus("working"))).toBe("blocked");
    });

    it("does NOT fire 'blocked' on blocked → blocked", () => {
        const next = mkStatus("blocked");
        const prev = mkStatus("blocked");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire on noise-class next (stale / unknown)", () => {
        expect(decideNotifyKind(mkStatus("stale"), mkStatus("working"))).toBeNull();
        expect(decideNotifyKind(mkStatus("unknown"), mkStatus("working"))).toBeNull();
    });

    it("does NOT fire when next is null", () => {
        expect(decideNotifyKind(null, mkStatus("working"))).toBeNull();
        expect(decideNotifyKind(null, null)).toBeNull();
    });

    it("does NOT fire on transitions within the working band (working → working)", () => {
        const next = mkStatus("working");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire on working → thinking (mid-flight phase change, no toast)", () => {
        const next = mkStatus("thinking");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });
});

// ---- fireAgentOsNotification dispatch ----
// Regression guard for the OS-notify routing bug: the notify RPC MUST carry
// route "electron" or the Go router sends it to "wavesrv" (WshServer), which
// has no NotifyCommand handler → `command not implemented "notify"` → the
// notification is silently dropped (FE catch only warns).
const { notifyCommandMock } = vi.hoisted(() => ({ notifyCommandMock: vi.fn(() => Promise.resolve()) }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { NotifyCommand: (...args: unknown[]) => notifyCommandMock(...args) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: { routeId: "tab:test" },
}));

import { fireAgentOsNotification } from "./agent-status-notify";

describe("fireAgentOsNotification dispatch", () => {
    beforeEach(() => {
        notifyCommandMock.mockReset();
    });

    it("dispatches notify with route electron on a 'done' transition", () => {
        fireAgentOsNotification(mkStatus("idle"), mkStatus("working"));
        expect(notifyCommandMock).toHaveBeenCalledTimes(1);
        const [client, opts, rpcOpts] = notifyCommandMock.mock.calls[0];
        expect(opts).toMatchObject({ agentkind: "done", agentblockid: "blk1" });
        expect(rpcOpts).toMatchObject({ route: "electron" });
        expect(client).toBeDefined();
    });

    it("dispatches notify with route electron on a 'blocked' transition", () => {
        fireAgentOsNotification(mkStatus("blocked"), mkStatus("working"));
        const [, opts, rpcOpts] = notifyCommandMock.mock.calls[0];
        expect(opts).toMatchObject({ agentkind: "blocked" });
        expect(rpcOpts).toMatchObject({ route: "electron" });
    });

    it("does not dispatch on a no-fire transition (idle → idle wobble)", () => {
        fireAgentOsNotification(mkStatus("idle"), mkStatus("idle"));
        expect(notifyCommandMock).not.toHaveBeenCalled();
    });
});
