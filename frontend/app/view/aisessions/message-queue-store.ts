// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// MessageQueueStore — reactive FIFO + priority message queue for the AI
// Sessions composer. Replaces the bare `useRef<ChatRequestBody[]>` push/shift
// queue with a structured, observable store that supports per-item cancel,
// promote (high priority), reorder, and priority-aware dequeuing.
//
// Priority model mirrors Paseo's GitProcessScheduler: a "high" lane dequeues
// before any "normal" message. promote() toggles an item between lanes.
//
// Consumption is driven externally: session-detail subscribes, and on each
// turn_end calls takeNext() to pull the next message (respecting priority),
// hands its body to handleChatSend, then complete() when that turn ends.

import type { ChatRequestBody } from "./use-chat-stream";
import { useSyncExternalStore } from "react";

export type QueuedMessagePriority = "high" | "normal";
export type QueuedMessageStatus = "queued" | "cancelled";

export interface QueuedMessage {
    id: string;
    body: ChatRequestBody;
    enqueuedAt: number;
    priority: QueuedMessagePriority;
    status: QueuedMessageStatus;
}

export interface MessageQueueSnapshot {
    /** Pending + cancelled items, ordered for dequeue (high lane first). */
    items: QueuedMessage[];
    /** Count of items still waiting to be sent (status === "queued"). */
    queuedCount: number;
    /** Count of queued items in the high lane. */
    highCount: number;
    /** The item currently being sent, if any (held outside `items`). */
    active: QueuedMessage | null;
}

let queueSeq = 0;

function nextId(): string {
    queueSeq += 1;
    return `qm-${Date.now()}-${queueSeq}`;
}

export class MessageQueueStore {
    private items: QueuedMessage[] = [];
    private activeItem: QueuedMessage | null = null;
    private listeners = new Set<() => void>();
    private snapshot: MessageQueueSnapshot = this.buildSnapshot();

    // ---- external store contract (useSyncExternalStore) ----
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): MessageQueueSnapshot => this.snapshot;

    // ---- mutations ----
    enqueue(body: ChatRequestBody, priority: QueuedMessagePriority = "normal"): QueuedMessage {
        const item: QueuedMessage = {
            id: nextId(),
            body,
            enqueuedAt: Date.now(),
            priority,
            status: "queued",
        };
        this.items.push(item);
        this.emit();
        return item;
    }

    /**
     * Pull the next message to send (high lane first, then normal FIFO),
     * remove it from the pending list, and mark it as the active item.
     * Returns null when nothing is queued.
     */
    takeNext(): QueuedMessage | null {
        if (this.activeItem != null) return null; // one at a time
        // High lane first (FIFO within each lane)
        const highIdx = this.items.findIndex((m) => m.status === "queued" && m.priority === "high");
        const targetIdx = highIdx >= 0 ? highIdx : this.items.findIndex((m) => m.status === "queued");
        if (targetIdx < 0) return null;
        const [item] = this.items.splice(targetIdx, 1);
        this.activeItem = item;
        this.emit();
        return item;
    }

    /** Complete the active item (turn ended). Returns true if one was active. */
    completeActive(): boolean {
        if (this.activeItem == null) return false;
        this.activeItem = null;
        this.emit();
        return true;
    }

    /** Abort the active item (user pressed stop). */
    clearActive(): void {
        if (this.activeItem == null) return;
        this.activeItem = null;
        this.emit();
    }

    /** Cancel a queued (not active) item. */
    cancel(id: string): void {
        const item = this.items.find((m) => m.id === id);
        if (item == null || item.status !== "queued") return;
        item.status = "cancelled";
        this.emit();
    }

    /** Toggle an item's priority lane (high <-> normal). */
    promote(id: string): void {
        const item = this.items.find((m) => m.id === id);
        if (item == null || item.status !== "queued") return;
        item.priority = item.priority === "high" ? "normal" : "high";
        this.emit();
    }

    /** Move a queued item to a target display index (priority-ordered lane). */
    reorder(id: string, displayTargetIdx: number): void {
        const item = this.items.find((m) => m.id === id);
        if (item == null || item.status !== "queued") return;
        const highLane = this.items.filter((m) => m.status === "queued" && m.priority === "high");
        const normalLane = this.items.filter((m) => m.status === "queued" && m.priority === "normal");
        const lane = item.priority === "high" ? highLane : normalLane;
        const srcIdx = lane.indexOf(item);
        if (srcIdx < 0) return;
        lane.splice(srcIdx, 1);
        if (item.priority === "high") {
            // displayTargetIdx is absolute in the high lane (0-based)
            const target = Math.max(0, Math.min(lane.length, displayTargetIdx));
            lane.splice(target, 0, item);
        } else {
            // displayTargetIdx is absolute; offset by highCount to get normal-lane index
            const target = Math.max(0, Math.min(lane.length, displayTargetIdx - highLane.length));
            lane.splice(target, 0, item);
        }
        const cancelled = this.items.filter((m) => m.status === "cancelled");
        this.items = [...highLane, ...normalLane, ...cancelled];
        this.emit();
    }

    /** Drop cancelled items permanently (used to clear the list after animating). */
    pruneCancelled(): void {
        const before = this.items.length;
        this.items = this.items.filter((m) => m.status !== "cancelled");
        if (this.items.length !== before) this.emit();
    }

    /** Drop all pending items (keep active). Used by abort — "discard". */
    clearQueued(): void {
        const before = this.items.length;
        this.items = [];
        if (this.items.length !== before) this.emit();
    }

    /** Remove everything (used when abandoning a session). */
    clearAll(): void {
        if (this.items.length === 0 && this.activeItem == null) return;
        this.items = [];
        this.activeItem = null;
        this.emit();
    }

    // ---- snapshot ----
    private buildSnapshot(): MessageQueueSnapshot {
        const high = this.items.filter((m) => m.status === "queued" && m.priority === "high");
        const normal = this.items.filter((m) => m.status === "queued" && m.priority === "normal");
        const cancelled = this.items.filter((m) => m.status === "cancelled");
        const queuedCount = high.length + normal.length;
        return {
            items: [...high, ...normal, ...cancelled],
            queuedCount,
            highCount: high.length,
            active: this.activeItem,
        };
    }

    private emit(): void {
        this.snapshot = this.buildSnapshot();
        for (const listener of this.listeners) listener();
    }
}

// ---- React hook ----

export function useMessageQueueStore(store: MessageQueueStore): MessageQueueSnapshot {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
