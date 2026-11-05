// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// verify 实例默认档位的解析（多 agent 并行跑验证台时靠它错开 profile/端口）。
// 走 node:test（`npm run test:scripts`），不启动 GUI。

import assert from "node:assert/strict";
import test from "node:test";
import { resolveVerifyDefaults } from "./launch.mjs";

test("uses the documented defaults when nothing is set", () => {
  assert.deepEqual(resolveVerifyDefaults({}), { profile: "verify", vitePort: 51799, cdpPort: 9231 });
});

test("honours profile and port overrides from the environment", () => {
  const resolved = resolveVerifyDefaults({
    VERIFY_PROFILE: "verify-b",
    VERIFY_VITE_PORT: "51899",
    VERIFY_CDP_PORT: "9331",
  });
  assert.deepEqual(resolved, { profile: "verify-b", vitePort: 51899, cdpPort: 9331 });
});

test("falls back on blank or non-numeric ports (never yields NaN/0)", () => {
  const resolved = resolveVerifyDefaults({ VERIFY_VITE_PORT: "", VERIFY_CDP_PORT: "abc" });
  assert.equal(resolved.vitePort, 51799);
  assert.equal(resolved.cdpPort, 9231);
  assert.equal(resolveVerifyDefaults({ VERIFY_CDP_PORT: "0" }).cdpPort, 9231);
  assert.equal(resolveVerifyDefaults({ VERIFY_CDP_PORT: "-5" }).cdpPort, 9231);
});

test("trims whitespace around the profile name", () => {
  assert.equal(resolveVerifyDefaults({ VERIFY_PROFILE: "  verify-c  " }).profile, "verify-c");
  // 纯空白视为未设置（否则会得到一个名字是空格的 profile 目录）
  assert.equal(resolveVerifyDefaults({ VERIFY_PROFILE: "   " }).profile, "verify");
});
