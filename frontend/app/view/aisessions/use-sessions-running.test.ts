// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { projectSessionRunning } from "./use-sessions-running";

function statusOf(blockId: string, shellprocstatus: string, version = 1): BlockControllerRuntimeStatus {
    return {
        blockid: blockId,
        version,
        shellprocstatus,
        shellprocexitcode: 0,
    };
}

function block(blockId: string, sessionId: string, tabId = "tab-1") {
    return { blockId, sessionId, tabId };
}

describe("projectSessionRunning", () => {
    it("marks a session running when its single block is running", () => {
        const blocks = [block("b1", "s1")];
        const statuses = { b1: statusOf("b1", "running") };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toEqual({ status: "running", blockId: "b1", tabId: "tab-1" });
        expect(map.size).toBe(1);
    });

    it("marks a session running when any one of its blocks is running", () => {
        const blocks = [
            block("b1", "s1"),
            block("b2", "s1"),
            block("b3", "s1"),
        ];
        const statuses = {
            b1: statusOf("b1", "done"),
            b2: statusOf("b2", "running"),
            b3: statusOf("b3", "init"),
        };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toEqual({ status: "running", blockId: "b2", tabId: "tab-1" });
        expect(map.size).toBe(1);
    });

    it("omits sessions whose blocks are all done or init", () => {
        const blocks = [
            block("b1", "s1"),
            block("b2", "s2"),
        ];
        const statuses = {
            b1: statusOf("b1", "done"),
            b2: statusOf("b2", "init"),
        };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.has("s1")).toBe(false);
        expect(map.has("s2")).toBe(false);
        expect(map.size).toBe(0);
    });

    it("omits blocks with no status yet", () => {
        const blocks = [
            block("b1", "s1"),
            block("b2", "s2"),
        ];
        const statuses = { b1: null, b2: statusOf("b2", "running") };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.has("s1")).toBe(false);
        expect(map.get("s2")).toEqual({ status: "running", blockId: "b2", tabId: "tab-1" });
    });

    it("omits blocks whose status is missing from the map entirely", () => {
        const blocks = [block("b1", "s1")];

        const map = projectSessionRunning(blocks, {});

        expect(map.size).toBe(0);
    });

    it("tracks multiple independent sessions in one pass", () => {
        const blocks = [
            block("b1", "s1"),
            block("b2", "s1"),
            block("b3", "s2"),
            block("b4", "s3"),
        ];
        const statuses = {
            b1: statusOf("b1", "done"),
            b2: statusOf("b2", "running"),
            b3: statusOf("b3", "running"),
            b4: statusOf("b4", "done"),
        };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toEqual({ status: "running", blockId: "b2", tabId: "tab-1" });
        expect(map.get("s2")).toEqual({ status: "running", blockId: "b3", tabId: "tab-1" });
        expect(map.has("s3")).toBe(false);
        expect(map.size).toBe(2);
    });

    it("ignores the empty block list", () => {
        expect(projectSessionRunning([], { b1: statusOf("b1", "running") }).size).toBe(0);
    });
});
