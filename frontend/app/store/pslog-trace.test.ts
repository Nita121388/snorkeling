// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/util/endpoints", () => ({
    getWebServerEndpoint: () => "http://pslog.test",
}));

vi.mock("@/util/util", () => ({
    fireAndForget: (fn: () => Promise<unknown>) => {
        void fn();
    },
}));

import {
    makeAgentTraceId,
    makePslogSessionRef,
    pslogEvent,
    setPslogEnabledFn,
    type PslogEventInput,
} from "./pslog-trace";

describe("pslog structured events", () => {
    const fetchMock = vi.fn(() => Promise.resolve());

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "log").mockImplementation(() => {});
        setPslogEnabledFn(() => true);
    });

    afterEach(() => {
        setPslogEnabledFn(() => false);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        fetchMock.mockClear();
    });

    it("emits a v1 JSON event without a text trace suffix", () => {
        const input = {
            event: "agent.note.render",
            stage: "visible",
            traceid: "agent:b1:fnv1a64:9f0fe866346bdc9a",
            blockid: "b1",
            sessionref: "fnv1a64:9f0fe866346bdc9a",
            durationms: 32,
            outcome: "ok",
            reason: "summary-present",
        } satisfies PslogEventInput;

        pslogEvent(input);

        const json = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
        expect(JSON.parse(json)).toEqual({
            v: 1,
            ts: "2026-07-19T00:00:00.000Z",
            event: "agent.note.render",
            stage: "visible",
            traceid: "agent:b1:fnv1a64:9f0fe866346bdc9a",
            blockid: "b1",
            sessionref: "fnv1a64:9f0fe866346bdc9a",
            durationms: 32,
            outcome: "ok",
            reason: "summary-present",
        });
        expect(json).not.toContain(" trace=");
        expect(fetchMock).toHaveBeenCalledWith("http://pslog.test/wave/pslog", {
            method: "POST",
            body: `tag=agent.note.render ${json}`,
        });
    });

    it("keeps empty fields out and ignores runtime-only sensitive fields", () => {
        const input = {
            event: "agent.note.render",
            stage: " ",
            traceid: "trace-1",
            blockid: "b1",
            sessionref: "raw-session-id",
            durationms: 0,
            outcome: "ok",
            reason: " ",
            note: "private note text",
            token: "secret-token",
            sessionid: "raw-session-id",
        } as unknown as PslogEventInput;

        pslogEvent(input);

        const json = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
        const record = JSON.parse(json) as Record<string, unknown>;
        expect(record).toEqual({
            v: 1,
            ts: "2026-07-19T00:00:00.000Z",
            event: "agent.note.render",
            traceid: "trace-1",
            blockid: "b1",
            outcome: "ok",
        });
        expect(json).not.toContain("private note text");
        expect(json).not.toContain("secret-token");
        expect(json).not.toContain("raw-session-id");

        pslogEvent({ ...input, sessionref: "fnv1a64:not-a-fixed-width-ref" });
        const invalidRefJson = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls[1][0] as string;
        expect(JSON.parse(invalidRefJson)).not.toHaveProperty("sessionref");

        pslogEvent({ ...input, durationms: 1.5 });
        const decimalDurationJson = (console.log as unknown as { mock: { calls: unknown[][] } }).mock
            .calls[2][0] as string;
        expect(JSON.parse(decimalDurationJson)).not.toHaveProperty("durationms");
    });
});

describe("pslog session references", () => {
    it("matches the Go FNV-1a fixed vector", () => {
        expect(makePslogSessionRef("session-123")).toBe("fnv1a64:9f0fe866346bdc9a");
        expect(makePslogSessionRef("")).toBe("");
    });

    it("builds an agent trace without exposing the session id", () => {
        expect(makeAgentTraceId("b1", "session-123")).toBe("agent:b1:fnv1a64:9f0fe866346bdc9a");
        expect(makeAgentTraceId("b1", "")).toBe("agent:b1:");
        expect(makeAgentTraceId("", "session-123")).toBe("");
    });
});
