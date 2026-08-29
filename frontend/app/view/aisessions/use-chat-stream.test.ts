// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseSseDataLine, runChatStream, type ChatEvent } from "./use-chat-stream";

describe("parseSseDataLine", () => {
    it("parses a valid data frame", () => {
        expect(parseSseDataLine('data: {"type":"assistant_delta","text":"Hi "}')).toEqual({ type: "assistant_delta", text: "Hi " });
    });
    it("returns null for blank lines", () => {
        expect(parseSseDataLine("")).toBeNull();
    });
    it("returns null for SSE comments", () => {
        expect(parseSseDataLine(": keepalive")).toBeNull();
    });
    it("returns null for non-data fields", () => {
        expect(parseSseDataLine("event: turn_end")).toBeNull();
    });
    it("returns null for malformed JSON (tolerates)", () => {
        expect(parseSseDataLine("data: {broken")).toBeNull();
    });
    it("tolerates trailing spaces", () => {
        expect(parseSseDataLine('data: {"type":"turn_end"}   ')).toEqual({ type: "turn_end" });
    });
    it("normalizes backend SSE errors into terminal failures", () => {
        expect(parseSseDataLine('data: {"type":"error","errorText":"agent is busy"}')).toEqual({
            type: "turn_failed",
            error: "agent is busy",
        });
    });
});

describe("runChatStream", () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it("calls onEvent in order for each SSE data frame", async () => {
        const events: ChatEvent[] = [];
        const encoder = new TextEncoder();

        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => {
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(encoder.encode('data: {"type":"assistant_delta","text":"Hi "}\n\ndata: {"type":"assistant_delta","text":"there"}\n\ndata: {"type":"turn_end","turnId":"t1"}\n\n'));
                        controller.close();
                    },
                });
                return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: stream });
            })
        );

        const done = new Promise<void>((resolve) => {
            vi.stubGlobal("fetch", (...args: any[]) => {
                const stream = new ReadableStream({
                    start(controller: ReadableStreamDefaultController) {
                        controller.enqueue(encoder.encode('data: {"type":"assistant_delta","text":"Hi "}\n\ndata: {"type":"assistant_delta","text":"there"}\n\ndata: {"type":"turn_end","turnId":"t1"}\n\n'));
                        controller.close();
                    },
                });
                return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: stream });
            });

            void runChatStream(
                "/x",
                { source: "pi", sessionId: "s1", message: "hello" },
                {
                    onEvent: (evt) => events.push(evt),
                    onDone: () => resolve(),
                },
                new AbortController().signal
            );
        });

        await done;

        expect(events).toHaveLength(3);
        expect(events[0]).toEqual({ type: "assistant_delta", text: "Hi " });
        expect(events[1]).toEqual({ type: "assistant_delta", text: "there" });
        expect(events[2]).toMatchObject({ type: "turn_end", turnId: "t1" });
    });

    it("tolerates malformed frames and blank/comment lines", async () => {
        const events: ChatEvent[] = [];

        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => {
                const stream = new ReadableStream({
                    start(controller: ReadableStreamDefaultController) {
                        const enc = new TextEncoder();
                        controller.enqueue(enc.encode(': stream-start\n\ndata: {not json}\n\ndata: {"type":"turn_end"}\n\n'));
                        controller.close();
                    },
                });
                return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: stream });
            })
        );

        const done = new Promise<void>((resolve) => {
            void runChatStream("/x", { source: "pi", sessionId: "s1", message: "hi" }, {
                onEvent: (evt) => events.push(evt),
                onDone: () => resolve(),
            }, new AbortController().signal);
        });
        await done;
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ type: "turn_end" });
    });

    it("rejects on server 500", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" }));
        await expect(
            runChatStream("/x", { source: "pi", sessionId: "s1", message: "hi" }, {}, new AbortController().signal)
        ).rejects.toThrow(/500/);
    });
});
