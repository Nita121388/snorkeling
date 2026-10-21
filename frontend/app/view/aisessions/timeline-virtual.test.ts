// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    VirtualizeThreshold,
    activeSeqFromVirtualItems,
    buildSeqToIndex,
    isNearBottom,
    outlineProbeOffset,
    scrollTargetForSeq,
    shouldVirtualize,
    timelineItemKey,
} from "./timeline-virtual";
import type { SessionDetailTimelineItem } from "./utils";

function messageItem(seq: number): SessionDetailTimelineItem {
    return { kind: "message", message: { seq, role: "user", text: `m${seq}`, charCount: 1 } };
}

function toolItem(seq: number): SessionDetailTimelineItem {
    return { kind: "tool", toolCall: { seq, name: "bash" }, anchorSeq: seq };
}

describe("shouldVirtualize", () => {
    it("keeps small sessions on the original full-render path", () => {
        expect(shouldVirtualize(0)).toBe(false);
        expect(shouldVirtualize(VirtualizeThreshold)).toBe(false);
    });

    it("switches to virtualization only above the threshold", () => {
        expect(shouldVirtualize(VirtualizeThreshold + 1)).toBe(true);
        expect(shouldVirtualize(5000)).toBe(true);
    });
});

describe("buildSeqToIndex", () => {
    it("maps message rows to their timeline index", () => {
        const items = [messageItem(1), toolItem(2), messageItem(3)];
        const map = buildSeqToIndex(items);
        expect(map.get(1)).toBe(0);
        expect(map.get(3)).toBe(2);
    });

    it("does not map tool rows (they are not scroll targets)", () => {
        const items = [toolItem(7), messageItem(8)];
        const map = buildSeqToIndex(items);
        expect(map.has(7)).toBe(false);
        expect(map.get(8)).toBe(1);
    });

    it("keeps the first row when a seq appears twice", () => {
        const items = [messageItem(4), messageItem(4)];
        expect(buildSeqToIndex(items).get(4)).toBe(0);
    });

    it("returns an empty map for an empty timeline", () => {
        expect(buildSeqToIndex([]).size).toBe(0);
    });
});

describe("activeSeqFromVirtualItems", () => {
    const itemSeqs = [10, null, 20, 30];

    it("picks the last message row at or above the probe", () => {
        const virtual = [
            { index: 0, start: 0 },
            { index: 1, start: 100 },
            { index: 2, start: 200 },
            { index: 3, start: 300 },
        ];
        expect(activeSeqFromVirtualItems(virtual, itemSeqs, 250, 10)).toBe(20);
    });

    it("falls back when every visible row is below the probe", () => {
        const virtual = [
            { index: 2, start: 200 },
            { index: 3, start: 300 },
        ];
        expect(activeSeqFromVirtualItems(virtual, itemSeqs, 0, 10)).toBe(10);
    });

    it("returns the last message when the probe is past all rows", () => {
        const virtual = [
            { index: 2, start: 200 },
            { index: 3, start: 300 },
        ];
        expect(activeSeqFromVirtualItems(virtual, itemSeqs, 1000, 10)).toBe(30);
    });

    it("skips non-message rows without losing the previous message", () => {
        const virtual = [
            { index: 1, start: 100 },
            { index: 2, start: 200 },
        ];
        // start=100 的工具行被跳过，探针 250 命中 index 2 的消息行
        expect(activeSeqFromVirtualItems(virtual, itemSeqs, 250, null)).toBe(20);
    });

    it("returns the fallback for an empty window", () => {
        expect(activeSeqFromVirtualItems([], itemSeqs, 100, 10)).toBe(10);
        expect(activeSeqFromVirtualItems([], itemSeqs, 100, null)).toBe(null);
    });
});

describe("scrollTargetForSeq", () => {
    it("uses the measured start when available", () => {
        expect(scrollTargetForSeq(1234, 40)).toBe(1234);
    });

    it("falls back to an estimated offset when the row was never measured", () => {
        expect(scrollTargetForSeq(null, 10, 100)).toBe(1000);
    });

    it("never returns a negative offset", () => {
        expect(scrollTargetForSeq(null, -5, 100)).toBe(0);
    });
});

describe("isNearBottom", () => {
    it("treats a fully scrolled container as near the bottom", () => {
        expect(isNearBottom(1000, 900, 100)).toBe(true);
    });

    it("detects a user who scrolled up into history", () => {
        expect(isNearBottom(1000, 100, 100)).toBe(false);
    });

    it("assumes near-bottom when the viewport is not measured yet", () => {
        expect(isNearBottom(0, 0, 0)).toBe(true);
    });
});

describe("timelineItemKey", () => {
    it("keys message rows by seq so anchors stay stable", () => {
        expect(timelineItemKey(messageItem(12), 0)).toBe("message-12");
    });

    it("includes the row index for tool rows under the same anchor", () => {
        expect(timelineItemKey(toolItem(5), 3)).toBe("tool-5-5-3");
        expect(timelineItemKey(toolItem(5), 4)).toBe("tool-5-5-4");
    });
});

describe("outlineProbeOffset", () => {
    it("places the probe a quarter down the viewport", () => {
        expect(outlineProbeOffset(800)).toBe(200);
    });

    it("returns 0 before the viewport is measured", () => {
        expect(outlineProbeOffset(0)).toBe(0);
        expect(outlineProbeOffset(-10)).toBe(0);
    });
});
