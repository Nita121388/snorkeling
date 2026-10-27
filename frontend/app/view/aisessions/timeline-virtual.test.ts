// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    VirtualizeThreshold,
    activeSeqFromVirtualItems,
    buildAnchorKeyToSeq,
    buildSeqToIndex,
    buildTimelineAnnotationAnchors,
    createRafCoalescer,
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

describe("createRafCoalescer", () => {
    /** 极简 rAF 替身：手动 flush，记录 cancel。 */
    function fakeRaf() {
        const queue: Array<() => void> = [];
        return {
            queue,
            request: (cb: () => void) => {
                queue.push(cb);
                return queue.length;
            },
            cancel: (handle: number) => {
                queue[handle - 1] = () => {};
            },
            flush: () => {
                const pending = queue.splice(0, queue.length);
                for (const cb of pending) cb();
            },
        };
    }

    it("runs the callback at most once per frame", () => {
        const raf = fakeRaf();
        const calls: number[] = [];
        const coalescer = createRafCoalescer(() => calls.push(1), raf.request, raf.cancel);
        coalescer.schedule();
        coalescer.schedule();
        coalescer.schedule();
        expect(raf.queue).toHaveLength(1);
        expect(calls).toHaveLength(0);
        raf.flush();
        expect(calls).toHaveLength(1);
    });

    it("allows another run on the next frame", () => {
        const raf = fakeRaf();
        let count = 0;
        const coalescer = createRafCoalescer(() => count++, raf.request, raf.cancel);
        coalescer.schedule();
        raf.flush();
        coalescer.schedule();
        raf.flush();
        expect(count).toBe(2);
    });

    it("drops a queued callback when cancelled (unmount)", () => {
        const raf = fakeRaf();
        let count = 0;
        const coalescer = createRafCoalescer(() => count++, raf.request, raf.cancel);
        coalescer.schedule();
        coalescer.cancel();
        raf.flush();
        expect(count).toBe(0);
    });
});

describe("buildAnchorKeyToSeq", () => {
    const items: SessionDetailTimelineItem[] = [
        { kind: "message", message: { seq: 1, role: "user", itemKey: "e1:m0", text: "hi" } as any },
        // 工具行没有独立 seq：它挂在 anchorSeq 指向的消息行上
        { kind: "tool", toolCall: { seq: 3, itemKey: "e1:t0", name: "bash" } as any, anchorSeq: 2 },
    ];

    it("maps message itemKey to its seq", () => {
        expect(buildAnchorKeyToSeq(items).get("e1:m0")).toBe(1);
    });

    it("maps tool itemKey to the anchoring message seq, not ToolCall.seq", () => {
        expect(buildAnchorKeyToSeq(items).get("e1:t0")).toBe(2);
    });

    it("falls back to the synthetic seq:<n> key when ItemKey is missing", () => {
        // 缓存消息没有 ItemKey；用合成锚点保证 Jump / 手动加批注都还能定位
        const map = buildAnchorKeyToSeq([{ kind: "message", message: { seq: 5, role: "user" } as any }]);
        expect(map.get("seq:5")).toBe(5);
    });
});

describe("buildTimelineAnnotationAnchors", () => {
    // 回归：会话消息从 SQLite 缓存读出时 ItemKey 为空，只有工具行带 itemKey，
    // 且工具行的 anchorSeq 才是真实消息行号（ToolCall.seq 只是加载顺序）。
    const items: SessionDetailTimelineItem[] = [
        { kind: "message", message: { seq: 411, role: "user", text: "hi" } as any },
        {
            kind: "tool",
            toolCall: { seq: 1, itemKey: "e7:t0", name: "bash", summary: "ls" } as any,
            anchorSeq: 411,
        },
    ];

    it("uses the tool row anchorSeq as the anchor seq", () => {
        const anchors = buildTimelineAnnotationAnchors(items);
        const tool = anchors.find((anchor) => anchor.anchorKey === "e7:t0");
        expect(tool?.seq).toBe(411);
        expect(tool?.role).toBe("tool");
    });

    it("emits a synthetic seq:<n> anchor for messages without an ItemKey", () => {
        const anchors = buildTimelineAnnotationAnchors([
            { kind: "message", message: { seq: 411, role: "user" } as any },
        ]);
        expect(anchors).toHaveLength(1);
        expect(anchors[0].anchorKey).toBe("seq:411");
        expect(anchors[0].seq).toBe(411);
    });
});
