// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 台账结论文案的回归锁（node:test，`npm run test:scripts`）。
//
// 历史 bug：fatal（起不来）的 run 是 passed=0/total=0，`passed === total` 为真 →
// 台账写成 `✅ 0/0`，环境错误在台账里变成"通过"。这条测试专门盯住它。

import assert from "node:assert/strict";
import test from "node:test";
import { formatLedgerVerdict } from "./report.mjs";

test("all-pass run is green", () => {
    assert.equal(formatLedgerVerdict({ passed: 22, total: 22 }), "✅ 22/22");
});

test("partial failure is red with counts", () => {
    assert.equal(formatLedgerVerdict({ passed: 21, total: 22 }), "❌ 21/22");
});

test("fatal run never shows as green (even with 0/0)", () => {
    assert.equal(formatLedgerVerdict({ passed: 0, total: 0, fatal: "boom" }), "❌ fatal（未跑）");
    assert.equal(formatLedgerVerdict({ passed: 3, total: 5, fatal: "boom" }), "❌ 3/5（fatal）");
});

test("run with no assertions is explicitly flagged, not green", () => {
    assert.equal(formatLedgerVerdict({ passed: 0, total: 0 }), "⚠️ 0/0（无断言）");
});
