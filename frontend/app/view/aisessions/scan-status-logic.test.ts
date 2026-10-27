// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    InitialScanStatus,
    mergeScanStatus,
    normalizeScanStatusEvent,
    reduceScanStatus,
    shouldNotifyScanDone,
} from "./scan-status-logic";

describe("normalizeScanStatusEvent", () => {
    it("accepts a local-connection payload", () => {
        expect(
            normalizeScanStatusEvent({ scanned: 320, total: 1617, running: true, done: false, partial: true })
        ).toEqual({ scanned: 320, total: 1617, running: true, done: false, partial: true });
    });

    it("ignores remote-connection events so they do not drive the local list", () => {
        expect(
            normalizeScanStatusEvent({
                connection: "user@host",
                scanned: 1,
                total: 2,
                running: true,
                done: false,
            })
        ).toBeNull();
    });

    it("treats an empty connection string as local", () => {
        expect(normalizeScanStatusEvent({ connection: "", scanned: 0, total: 5, running: true, done: false })).not.toBeNull();
    });

    it("returns null for missing or malformed payloads", () => {
        expect(normalizeScanStatusEvent(null)).toBeNull();
        expect(normalizeScanStatusEvent(undefined)).toBeNull();
        expect(normalizeScanStatusEvent("boom" as unknown as null)).toBeNull();
    });

    it("clamps negative and NaN values", () => {
        const status = normalizeScanStatusEvent({
            scanned: -5,
            total: Number.NaN,
            running: undefined,
            done: undefined,
        });
        expect(status).toEqual({ scanned: 0, total: 0, running: false, done: false, partial: false });
    });
});

describe("reduceScanStatus", () => {
    it("advances forward within one cycle", () => {
        const first = { scanned: 100, total: 1000, running: true, done: false, partial: false };
        const second = { scanned: 300, total: 1000, running: true, done: false, partial: false };
        expect(reduceScanStatus(first, second)).toEqual(second);
    });

    it("ignores a late duplicate batch that would move progress backwards", () => {
        const advanced = { scanned: 300, total: 1000, running: true, done: false, partial: false };
        const stale = { scanned: 120, total: 1000, running: true, done: false, partial: false };
        expect(reduceScanStatus(advanced, stale).scanned).toBe(300);
    });

    it("keeps a known total when an intermediate event reports zero", () => {
        const known = { scanned: 320, total: 1617, running: true, done: false, partial: false };
        const totalZero = { scanned: 320, total: 0, running: true, done: false, partial: false };
        expect(reduceScanStatus(known, totalZero).total).toBe(1617);
    });

    it("restarts counting when a new cycle begins after the previous one finished", () => {
        const finished = { scanned: 1617, total: 1617, running: false, done: true, partial: false };
        const restarting = { scanned: 5, total: 1617, running: true, done: false, partial: false };
        expect(reduceScanStatus(finished, restarting)).toEqual(restarting);
    });

    it("keeps the done state on a redundant event in the same batch", () => {
        const finished = { scanned: 1617, total: 1617, running: false, done: true, partial: false };
        const redundant = { scanned: 1617, total: 1617, running: false, done: true, partial: false };
        expect(reduceScanStatus(finished, redundant).done).toBe(true);
    });
});

describe("shouldNotifyScanDone", () => {
    it("fires once per cycle", () => {
        const prev = { scanned: 1617, total: 1617, running: false, done: false, partial: false };
        const done = { scanned: 1617, total: 1617, running: false, done: true, partial: false };
        expect(shouldNotifyScanDone(prev, done)).toBe(true);
        expect(shouldNotifyScanDone(done, done)).toBe(false);
    });

    it("stays silent for progress events and ignored events", () => {
        const prev = InitialScanStatus;
        const progress = { scanned: 10, total: 100, running: true, done: false, partial: false };
        expect(shouldNotifyScanDone(prev, progress)).toBe(false);
        expect(shouldNotifyScanDone(prev, null)).toBe(false);
    });
});

describe("mergeScanStatus", () => {
    it("falls back to the snapshot when the live events are empty", () => {
        const snapshot = { scanned: 120, total: 900, running: true, done: false, partial: true };
        expect(mergeScanStatus(snapshot, InitialScanStatus)).toBe(snapshot);
    });

    it("prefers live progress over a stale snapshot", () => {
        const snapshot = { scanned: 100, total: 900, running: true, done: false, partial: true };
        const live = { scanned: 640, total: 900, running: true, done: false, partial: true };
        expect(mergeScanStatus(snapshot, live)).toBe(live);
    });

    it("keeps the finished live state so the refresh icon stops spinning", () => {
        const snapshot = { scanned: 900, total: 900, running: true, done: false, partial: true };
        const live = { scanned: 900, total: 900, running: false, done: true, partial: false };
        expect(mergeScanStatus(snapshot, live).running).toBe(false);
    });
});

describe("useScanStatus debounce", () => {
    // 防抖行为落在 hook 里，这里只锁定「连续 done 只应触发一次」的判定输入：
    // hook 用 vi.useFakeTimers + 单一 handler 断言，避免重复实现这段规则。
    it("is driven by a single shouldNotifyScanDone per batch", () => {
        const notify = vi.fn();
        let prev = InitialScanStatus;
        for (const scanned of [100, 500, 1617]) {
            const incoming = { scanned, total: 1617, running: scanned < 1617, done: scanned === 1617, partial: false };
            if (shouldNotifyScanDone(prev, incoming)) notify();
            prev = reduceScanStatus(prev, incoming);
        }
        expect(notify).toHaveBeenCalledTimes(1);
    });
});
