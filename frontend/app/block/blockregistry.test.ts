// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

describe("block registry", () => {
    // 模块图里挂着整个 view registry，冷启动实测 2—3s；并行跑整目录时超过默认 5s
    // 阈值而误红（pre-existing flake，2026-11-18 复现于 main HEAD）。放宽到 20s。
    it(
        "loads without evaluating circular view dependencies",
        async () => {
            const registry = await import("./blockregistry");

            expect(registry.makeViewModel).toBeTypeOf("function");
        },
        20000
    );
});
