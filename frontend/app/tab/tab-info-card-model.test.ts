// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 悬浮卡纯逻辑层单测（node 环境，无 jsdom）。

import { describe, expect, it } from "vitest";
import {
    agentGroupHidesProvider,
    agentGroupLabel,
    agentPillText,
    classifyTabBlock,
    countTabBlocks,
    nonAgentChips,
    presentAgentState,
} from "./tab-info-card-model";

function makeBlock(meta: Record<string, unknown>): Block {
    return { otype: "block", oid: "b", version: 1, meta } as unknown as Block;
}

describe("classifyTabBlock", () => {
    it("会话详情与 GUI chat 归到 chat，即便同时带 view=term", () => {
        expect(classifyTabBlock(makeBlock({ view: "aisessions", "aisessions:sessionid": "s1" }))).toBe("chat");
        expect(classifyTabBlock(makeBlock({ view: "aisessions", "aisessions:newchat": true }))).toBe("chat");
    });

    it("agent terminal 归到 agent", () => {
        expect(classifyTabBlock(makeBlock({ view: "term", "agent:provider": "pi" }))).toBe("agent");
    });

    it("note / preview / term / other 各自归类", () => {
        expect(classifyTabBlock(makeBlock({ "snorkeling:block-kind": "note" }))).toBe("note");
        expect(classifyTabBlock(makeBlock({ view: "preview" }))).toBe("file");
        expect(classifyTabBlock(makeBlock({ view: "term" }))).toBe("terminal");
        expect(classifyTabBlock(makeBlock({ view: "web" }))).toBe("other");
        expect(classifyTabBlock(null)).toBe("other");
    });
});

describe("countTabBlocks", () => {
    it("混合 block 计数正确", () => {
        const counts = countTabBlocks([
            makeBlock({ view: "term", "agent:provider": "pi" }),
            makeBlock({ view: "term", "agent:provider": "claude" }),
            makeBlock({ view: "aisessions", "aisessions:sessionid": "s1" }),
            makeBlock({ view: "preview" }),
            makeBlock({ view: "preview" }),
            makeBlock({ view: "term" }),
            makeBlock({ view: "web" }),
        ]);
        expect(counts).toEqual({ agent: 2, chat: 1, file: 2, note: 0, terminal: 1, other: 1 });
    });
});

describe("nonAgentChips", () => {
    it("零值不产出，>1 才加复数", () => {
        const chips = nonAgentChips({ agent: 4, chat: 1, file: 12, note: 0, terminal: 2, other: 0 });
        expect(chips.map((c) => c.label)).toEqual(["1 chat", "12 files", "2 terms"]);
    });

    it("全零时为空", () => {
        expect(nonAgentChips({ agent: 0, chat: 0, file: 0, note: 0, terminal: 0, other: 0 })).toEqual([]);
    });
});

describe("presentAgentState", () => {
    it("无状态按 Idle 处理，不再出现 —", () => {
        expect(presentAgentState(null)).toEqual({ kind: "idle", label: "Idle" });
        expect(presentAgentState(undefined)).toEqual({ kind: "idle", label: "Idle" });
        expect(presentAgentState({ state: "unknown" })).toEqual({ kind: "idle", label: "Idle" });
    });

    it("working + tool 带工具名", () => {
        expect(presentAgentState({ state: "working", phase: "tool", toolName: "bash" })).toEqual({
            kind: "working",
            label: "Tool · bash",
        });
    });

    it("working + tool 无工具名退化为 Tools", () => {
        expect(presentAgentState({ state: "working", phase: "tool" })).toEqual({ kind: "working", label: "Tools" });
        expect(presentAgentState({ state: "working", phase: "tool", toolName: "  " })).toEqual({
            kind: "working",
            label: "Tools",
        });
    });

    it("working + thinking", () => {
        expect(presentAgentState({ state: "working", phase: "thinking" })).toEqual({
            kind: "thinking",
            label: "Thinking",
        });
    });

    it("working 其它 phase 显示 Working", () => {
        expect(presentAgentState({ state: "working", phase: "none" })).toEqual({
            kind: "working",
            label: "Working",
        });
    });

    it("其余状态一一映射", () => {
        expect(presentAgentState({ state: "done" })).toEqual({ kind: "done", label: "Done" });
        expect(presentAgentState({ state: "blocked" })).toEqual({ kind: "blocked", label: "Blocked" });
        expect(presentAgentState({ state: "error" })).toEqual({ kind: "error", label: "Error" });
        expect(presentAgentState({ state: "rate-limited" })).toEqual({
            kind: "rate-limited",
            label: "Rate limited",
        });
        expect(presentAgentState({ state: "stale" })).toEqual({ kind: "stale", label: "Stale" });
        expect(presentAgentState({ state: "idle" })).toEqual({ kind: "idle", label: "Idle" });
    });
});

describe("agentGroupLabel", () => {
    it("全相同 provider 并入标题", () => {
        expect(agentGroupLabel(["pi", "pi", "pi", "pi"])).toBe("Agents · pi ×4");
        expect(agentGroupHidesProvider(["pi", "pi"])).toBe(true);
    });

    it("大小写与空白归一后视为同一 provider", () => {
        expect(agentGroupLabel(["pi", "PI", " pi "])).toBe("Agents · pi ×3");
    });

    it("混合 provider 只写 Agents，行内保留各自名称", () => {
        expect(agentGroupLabel(["pi", "claude"])).toBe("Agents");
        expect(agentGroupHidesProvider(["pi", "claude"])).toBe(false);
    });

    it("空 provider 清单", () => {
        expect(agentGroupLabel([])).toBe("Agents");
        expect(agentGroupLabel(["", ""])).toBe("Agents");
    });
});

// ── pill 文案：状态词 + 跑时，必须与块头 / 悬浮卡逐字一致 ──
//
// 历史上 Tab 悬浮卡的 pill 只读 `agentStatusViewLabel`（状态词，Done 未读时带
// 分钟级 elapsed），而跑时 "3min21s" 只由 `buildAgentStatusChipView().runtime` 产出。
// 于是 working / tool 期间 pill 只有 "Tool: Bash"、没有时长 —— 与块头、悬浮卡对不上。
describe("agentPillText", () => {
    it("活跃态把 runtime 拼在状态词之后（与 term-model 头部同一拼法）", () => {
        expect(agentPillText({ label: "Tool: Bash", runtime: "3min21s" }, "Tool: Bash")).toBe("Tool: Bash 3min21s");
    });

    it("无 runtime 时不追加多余空格", () => {
        expect(agentPillText({ label: "Done", runtime: "" }, "Done")).toBe("Done");
    });

    it("拿不到 chipView 时退回状态词（null status 的 idle 行）", () => {
        expect(agentPillText(null, "Idle")).toBe("Idle");
    });

    it("未读 Done：elapsed 已在 label 里，runtime 为空 → 只有一份时间", () => {
        expect(agentPillText({ label: "Done 3m", runtime: "" }, "Done 3m")).toBe("Done 3m");
    });
});
