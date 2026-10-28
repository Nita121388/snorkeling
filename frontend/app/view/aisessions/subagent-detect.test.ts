// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isSubagentToolName, subagentInfoFromToolCall, synthesizeSubagentMatch } from "./subagent-detect";

describe("isSubagentToolName", () => {
    it("recognizes provider aliases case-insensitively", () => {
        for (const name of ["subagent", "Task", "task", "spawn_agent", "SubagentStart"]) {
            expect(isSubagentToolName(name)).toBe(true);
        }
    });

    it("rejects ordinary tools", () => {
        for (const name of ["bash", "read", "grep", "", undefined]) {
            expect(isSubagentToolName(name)).toBe(false);
        }
    });
});

describe("subagentInfoFromToolCall", () => {
    it("parses pi-style agent/task arguments from the JSON summary", () => {
        const info = subagentInfoFromToolCall({
            name: "subagent",
            summary: JSON.stringify({ agent: "worker", task: "fix the bug" }),
        });
        expect(info).toEqual({ agent: "worker", task: "fix the bug" });
    });

    it("parses claude/opencode subagent_type/prompt arguments", () => {
        const info = subagentInfoFromToolCall({
            name: "Task",
            summary: JSON.stringify({ subagent_type: "Explore", prompt: "find callers" }),
        });
        expect(info).toEqual({ agent: "Explore", task: "find callers" });
    });

    it("falls back to the tool name when the summary is not JSON", () => {
        const info = subagentInfoFromToolCall({ name: "Task", summary: "plain text" });
        expect(info).toEqual({ agent: "Task", task: "" });
    });
});

describe("synthesizeSubagentMatch", () => {
    it("builds a non-expandable dispatched match", () => {
        const match = synthesizeSubagentMatch({
            name: "spawn_agent",
            itemKey: "call_1",
            summary: JSON.stringify({ agent_type: "worker", description: "do work" }),
        });
        expect(match.status).toBe("dispatched");
        expect(match.sessionKey).toBe("");
        expect(match.call.agent).toBe("worker");
        expect(match.call.task).toBe("do work");
        expect(match.call.itemKey).toBe("call_1");
    });
});
