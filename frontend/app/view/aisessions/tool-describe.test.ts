// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { describeRun, describeToolGroupCompact } from "./tool-describe";

describe("describeRun", () => {
    it("maps the pi subagent dispatch tool to a readable label", () => {
        // pi 实际派发工具名是 `subagent`，不是 `task`；漏映射会显示成「使用工具」。
        expect(describeRun([{ toolName: "subagent" }])).toBe("派发子任务");
    });
});

describe("describeToolGroupCompact", () => {
    it("returns an empty string for an empty group", () => {
        expect(describeToolGroupCompact([])).toBe("");
    });

    it("uses category × count when every tool shares one kind", () => {
        expect(describeToolGroupCompact(["bash", "bash", "bash"])).toBe("执行命令 ×3");
    });

    it("falls back to 工具 × count for mixed kinds", () => {
        expect(describeToolGroupCompact(["bash", "read", "grep"])).toBe("工具 ×3");
    });

    it("labels subagent dispatches consistently", () => {
        expect(describeToolGroupCompact(["subagent", "subagent"])).toBe("派发子任务 ×2");
    });
});
