// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    MaxSubagentDepth,
    canExpandSubagent,
    subagentRowStatus,
    subagentSummary,
} from "./subagent-card";

function matched(): SubagentMatch {
    return {
        call: { agent: "reviewer", task: "check the diff", itemKey: "e1:t0" },
        status: "matched",
        sessionKey: "k1",
    };
}

describe("subagentSummary", () => {
    it("combines the agent name and the task", () => {
        expect(subagentSummary(matched())).toBe("reviewer · check the diff");
    });

    it("falls back to the agent name when there is no task", () => {
        const match = matched();
        match.call.task = "   ";
        expect(subagentSummary(match)).toBe("reviewer");
    });

    it("flattens multi-line tasks into one line", () => {
        const match = matched();
        match.call.task = "line one\nline two";
        expect(subagentSummary(match)).toBe("reviewer · line one line two");
    });
});

describe("canExpandSubagent", () => {
    it("allows a matched dispatch", () => {
        expect(canExpandSubagent(matched(), 0)).toBe(true);
    });

    it("allows an ambiguous dispatch so the user can pick a candidate", () => {
        const match = matched();
        match.status = "ambiguous";
        expect(canExpandSubagent(match, 0)).toBe(true);
    });

    it("does not expand a missing dispatch", () => {
        const match = matched();
        match.status = "missing";
        expect(canExpandSubagent(match, 0)).toBe(false);
    });

    it("stops expanding past the nesting depth limit", () => {
        expect(canExpandSubagent(matched(), MaxSubagentDepth - 1)).toBe(true);
        expect(canExpandSubagent(matched(), MaxSubagentDepth)).toBe(false);
        expect(canExpandSubagent(matched(), MaxSubagentDepth + 1)).toBe(false);
    });
});

describe("subagentRowStatus", () => {
    it("marks a missing dispatch as failed so it reads as a problem", () => {
        const match = matched();
        match.status = "missing";
        expect(subagentRowStatus(match)).toBe("failed");
    });

    it("marks matched and ambiguous dispatches as completed", () => {
        expect(subagentRowStatus(matched())).toBe("completed");
        const ambiguous = matched();
        ambiguous.status = "ambiguous";
        expect(subagentRowStatus(ambiguous)).toBe("completed");
    });
});
