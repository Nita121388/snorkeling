// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-3 源码契约（性能）：WPS 事件订阅合批。
//
// 现状（HEAD）：每次 waveEventSubscribeSingle / waveEventUnsubscribe 立即发一条
// EventSubCommand —— N 块同帧挂载 = O(N²) scope 传输。
//
// 红证：HEAD 上 wps.ts 无 queueMicrotask 合批 → 本文件红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "wps.ts"), "utf8");

describe("WPS 订阅合批（W2-3）", () => {
    it("updateWaveEventSub 走 queueMicrotask 合批（同 tick 多次订阅合并为一次 EventSubCommand）", () => {
        expect(source).toMatch(/queueMicrotask/);
    });

    it("scopes 用 Set 去重（同一 eventType 重复订阅不重复传输）", () => {
        expect(source).toMatch(/new Set\s*\(/);
    });
});
