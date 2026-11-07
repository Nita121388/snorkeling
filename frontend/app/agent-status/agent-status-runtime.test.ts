// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatAgentChipRuntime, needsAgentChipRuntime } from "./agent-status-runtime";
import type { AgentStatus } from "./agent-status-types";

describe("formatAgentChipRuntime", () => {
    it("起点缺失返回空串", () => {
        expect(formatAgentChipRuntime(0, 1_700_000_000_000)).toBe("");
        expect(formatAgentChipRuntime(-1, 1_700_000_000_000)).toBe("");
        expect(formatAgentChipRuntime(NaN, 1_700_000_000_000)).toBe("");
    });

    it("起点在未来（时钟回退）返回空串", () => {
        expect(formatAgentChipRuntime(1_700_000_010_000, 1_700_000_000_000)).toBe("");
    });

    it("不足一分钟按秒显示", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_007_000)).toBe("7s");
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_000_000)).toBe("0s");
    });

    it("59 秒边界仍是秒", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_059_000)).toBe("59s");
    });

    it("一分钟以上带 min + s", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_201_000)).toBe("3min21s");
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_060_000)).toBe("1min0s");
    });

    it("恰好一小时按 h + min", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_003_600_000)).toBe("1h0min");
    });

    it("24 小时以内按 h + min", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_000_000 + 5 * 3_600_000 + 7 * 60_000)).toBe("5h7min");
    });

    it("超过一天按 d + h", () => {
        expect(formatAgentChipRuntime(1_700_000_000_000, 1_700_000_000_000 + 25 * 3_600_000)).toBe("1d1h");
    });
});

describe("needsAgentChipRuntime", () => {
    const base: AgentStatus = {
        blockId: "b",
        provider: "claude",
        state: "working",
        phase: "tool",
        source: "hook",
        confidence: "high",
        updatedAt: 1,
    };

    it("working 需要跑时", () => {
        expect(needsAgentChipRuntime(base)).toBe(true);
    });

    it("blocked 需要跑时", () => {
        expect(needsAgentChipRuntime({ ...base, state: "blocked" })).toBe(true);
    });

    it("stale 需要跑时", () => {
        expect(needsAgentChipRuntime({ ...base, state: "stale" })).toBe(true);
    });

    it("done 不需要秒级跑时", () => {
        expect(needsAgentChipRuntime({ ...base, state: "done" })).toBe(false);
    });

    it("idle / unknown / null 不需要", () => {
        expect(needsAgentChipRuntime({ ...base, state: "idle" })).toBe(false);
        expect(needsAgentChipRuntime({ ...base, state: "unknown" })).toBe(false);
        expect(needsAgentChipRuntime(null)).toBe(false);
    });
});
