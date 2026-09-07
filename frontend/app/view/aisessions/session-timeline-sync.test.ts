// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { mergeSessionTimeline } from "./session-timeline-sync";

describe("mergeSessionTimeline", () => {
    const message = (seq: number, text: string): Message => ({
        seq,
        role: "assistant",
        text,
    } as Message);

    it("appends only messages not already present", () => {
        const result = mergeSessionTimeline(
            [message(1, "a")],
            { byteOffset: 10, lastSeq: 1 },
            [message(1, "old"), message(2, "b")],
            { byteOffset: 20, lastSeq: 2 },
        );
        expect(result.messages.map((item) => item.text)).toEqual(["a", "b"]);
        expect(result.resetRequired).toBe(false);
    });

    it("requests replacement when the history cursor moves backwards", () => {
        const result = mergeSessionTimeline(
            [message(1, "a"), message(2, "b")],
            { byteOffset: 20, lastSeq: 2 },
            [message(1, "rewound")],
            { byteOffset: 8, lastSeq: 1 },
        );
        expect(result.messages.map((item) => item.text)).toEqual(["rewound"]);
        expect(result.resetRequired).toBe(true);
    });

    it("keeps the current cursor when a delta has no cursor", () => {
        const cursor = { byteOffset: 20, lastSeq: 2 };
        const result = mergeSessionTimeline([message(1, "a")], cursor, [message(2, "b")], undefined);
        expect(result.cursor).toBe(cursor);
    });
});
