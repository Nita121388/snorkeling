// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { describeRun, describeToolGroupCompact, describeToolGroupKind } from "./tool-describe";

describe("describeRun", () => {
    it("maps the pi subagent dispatch tool to a readable label", () => {
        // pi 实际派发工具名是 `subagent`，不是 `task`；漏映射会显示成「Use tool」。
        expect(describeRun([{ toolName: "subagent" }])).toBe("Spawn subagent");
    });
});

describe("describeToolGroupCompact", () => {
    it("returns an empty string for an empty group", () => {
        expect(describeToolGroupCompact([])).toBe("");
    });

    it("uses category × count when every tool shares one kind", () => {
        expect(describeToolGroupCompact(["bash", "bash", "bash"])).toBe("Run command ×3");
    });

    it("falls back to Tool × count for mixed kinds", () => {
        expect(describeToolGroupCompact(["bash", "read", "grep"])).toBe("Tool ×3");
    });

    it("labels subagent dispatches consistently", () => {
        expect(describeToolGroupCompact(["subagent", "subagent"])).toBe("Spawn subagent ×2");
    });
});

describe("describeToolGroupKind", () => {
    it("returns an empty string for an empty group", () => {
        expect(describeToolGroupKind([])).toBe("");
    });

    it("returns the shared kind without a count", () => {
        expect(describeToolGroupKind(["bash", "bash", "bash"])).toBe("Run command");
    });

    it("falls back to Tool for mixed kinds", () => {
        expect(describeToolGroupKind(["bash", "read", "grep"])).toBe("Tool");
    });
});
