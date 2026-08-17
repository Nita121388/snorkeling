// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { useChatStream } from "./use-chat-stream";
import { renderHook, act, waitFor } from "@testing-library/react";

describe("useChatStream SSE client", () => {
    it("parses data frames and dispatches events in order", async () => {
        // A server that returns one SSE stream with two delta frames + turn_end.
        const events: any[] = [];
        const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
            expect(url).toContain("/api/aisessions-chat");
            expect(init.method).toBe("POST");
            const body = JSON.parse(init.body);
            expect(body.message).toBe("hello");
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            `data: {"type":"assistant_delta","text":"Hi "}\n\ndata: {"type":"assistant_delta","text":"there"}\n\ndata: {"type":"turn_end","turnId":"t1"}\n\n`
                        )
                    );
                    controller.close();
                },
            });
            return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: stream });
        });
        vi.stubGlobal("fetch", fetchMock);

        const { result } = renderHook(() =>
            useChatStream({
                endpoint: "/api/aisessions-chat",
                onEvent: (evt) => events.push(evt),
                onTurnEnd: (evt) => events.push({ ...evt, turnEndCallback: true }),
            })
        );

        await act(async () => {
            result.current.send({ source: "pi", sessionId: "s1", message: "hello" });
        });
        await waitFor(() => expect(result.current.status).toBe("idle"));

        expect(events).toHaveLength(4); // 2 deltas + turn_end + turnEndCallback marker
        expect(events[0]).toEqual({ type: "assistant_delta", text: "Hi " });
        expect(events[1]).toEqual({ type: "assistant_delta", text: "there" });
        expect(events[2]).toMatchObject({ type: "turn_end", turnId: "t1" });
        expect(events[3]).toMatchObject({ type: "turn_end", turnEndCallback: true });
    });

    it("tolerates malformed frames and comments", async () => {
        const events: any[] = [];
        const fetchMock = vi.fn().mockImplementation(() => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            `: stream-start\n\n: keepalive\n\ndata: this is not json\n\ndata: {"type":"turn_end","x":1}\n\n[NOT SSE]\n`
                        )
                    );
                    controller.close();
                },
            });
            return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: stream });
        });
        vi.stubGlobal("fetch", fetchMock);

        const { result } = renderHook(() =>
            useChatStream({ endpoint: "/x", onEvent: (evt) => events.push(evt) })
        );
        await act(async () => {
            result.current.send({ source: "pi", sessionId: "s1", message: "hi" });
        });
        await waitFor(() => expect(result.current.status).toBe("idle"));
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "turn_end", x: 1 });
    });

    it("sets error status when the server responds non-OK", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" })
        );
        const { result } = renderHook(() => useChatStream({ endpoint: "/x" }));
        await act(async () => {
            result.current.send({ source: "pi", sessionId: "s1", message: "hi" });
        });
        await waitFor(() => expect(result.current.status).toBe("error"));
    });
});