// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MessageQueueStore, type QueuedMessage } from "./message-queue-store";

function makeBody(msg: string) {
    return { source: "pi", message: msg };
}

describe("MessageQueueStore", () => {
    it("enqueues and reports queuedCount/highCount", () => {
        const store = new MessageQueueStore();
        store.enqueue(makeBody("a"));
        store.enqueue(makeBody("b"), "high");
        const snap = store.getSnapshot();
        expect(snap.queuedCount).toBe(2);
        expect(snap.highCount).toBe(1);
        expect(snap.active).toBeNull();
    });

    it("dequeues high lane before normal lane", () => {
        const store = new MessageQueueStore();
        store.enqueue(makeBody("normal-a"));
        store.enqueue(makeBody("normal-b"));
        store.enqueue(makeBody("high-a"), "high");
        const first = store.takeNext();
        expect(first?.body.message).toBe("high-a");
        store.completeActive();
        const second = store.takeNext();
        expect(second?.body.message).toBe("normal-a");
        store.completeActive();
        const third = store.takeNext();
        expect(third?.body.message).toBe("normal-b");
        store.completeActive();
        expect(store.takeNext()).toBeNull();
    });

    it("takeNext moves item to active; completeActive clears it", () => {
        const store = new MessageQueueStore();
        store.enqueue(makeBody("a"));
        const item = store.takeNext();
        expect(item?.body.message).toBe("a");
        expect(store.getSnapshot().active?.body.message).toBe("a");
        expect(store.getSnapshot().queuedCount).toBe(0);
        store.completeActive();
        expect(store.getSnapshot().active).toBeNull();
    });

    it("cannot takeNext while an item is active (one at a time)", () => {
        const store = new MessageQueueStore();
        store.enqueue(makeBody("a"));
        store.enqueue(makeBody("b"));
        store.takeNext();
        expect(store.takeNext()).toBeNull();
        store.completeActive();
        expect(store.takeNext()?.body.message).toBe("b");
    });

    it("cancel marks a queued item cancelled", () => {
        const store = new MessageQueueStore();
        const a = store.enqueue(makeBody("a"));
        store.enqueue(makeBody("b"));
        store.cancel(a.id);
        const snap = store.getSnapshot();
        expect(snap.queuedCount).toBe(1);
        expect(snap.items.find((i) => i.id === a.id)?.status).toBe("cancelled");
    });

    it("promote toggles between high and normal", () => {
        const store = new MessageQueueStore();
        const a = store.enqueue(makeBody("a"));
        store.promote(a.id);
        expect(store.getSnapshot().highCount).toBe(1);
        store.promote(a.id);
        expect(store.getSnapshot().highCount).toBe(0);
    });

    it("reorder moves an item within the queued list", () => {
        const store = new MessageQueueStore();
        const a = store.enqueue(makeBody("a"));
        const b = store.enqueue(makeBody("b"));
        const c = store.enqueue(makeBody("c"));
        store.reorder(a.id, 2);
        const order = store.getSnapshot().items.map((i) => i.body.message);
        expect(order).toEqual(["b", "c", "a"]);
        void b;
        void c;
    });

    it("clearQueued drops pending but keeps active", () => {
        const store = new MessageQueueStore();
        store.enqueue(makeBody("a"));
        store.takeNext();
        store.enqueue(makeBody("b"));
        store.clearQueued();
        const snap = store.getSnapshot();
        expect(snap.queuedCount).toBe(0);
        expect(snap.active?.body.message).toBe("a");
    });

    it("notifies subscribers on mutation", () => {
        const store = new MessageQueueStore();
        const seen: number[] = [];
        store.subscribe(() => seen.push(store.getSnapshot().queuedCount));
        store.enqueue(makeBody("a"));
        store.enqueue(makeBody("b"));
        store.cancel(store.getSnapshot().items[0].id);
        expect(seen).toEqual([1, 2, 1]);
    });

    it("subscribe returns an unsubscribe that stops notifications", () => {
        const store = new MessageQueueStore();
        let count = 0;
        const unsubscribe = store.subscribe(() => {
            count += 1;
        });
        store.enqueue(makeBody("a"));
        expect(count).toBe(1);
        unsubscribe();
        store.enqueue(makeBody("b"));
        expect(count).toBe(1);
    });

    it("pruneCancelled removes cancelled items", () => {
        const store = new MessageQueueStore();
        const a = store.enqueue(makeBody("a"));
        store.cancel(a.id);
        store.pruneCancelled();
        expect(store.getSnapshot().items.find((i) => i.id === a.id)).toBeUndefined();
    });
});

describe("MessageQueueStore reorder + priority interplay", () => {
    it("reorder target index is relative to the raw items array", () => {
        const store = new MessageQueueStore();
        const a = store.enqueue(makeBody("a"));
        const b = store.enqueue(makeBody("b"));
        const c = store.enqueue(makeBody("c"));
        // raw order: [a,b,c]; move a to index 2 => [b,c,a]
        store.reorder(a.id, 2);
        const raw = store.getSnapshot().items.map((i) => i.body.message);
        expect(raw).toEqual(["b", "c", "a"]);
        void b;
        void c;
    });
});
