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

describe("projectSessionRunning", () => {
    it("marks a session running when its single block is running", () => {
        const blocks = [{ blockId: "b1", sessionId: "s1" }];
        const statuses = { b1: statusOf("b1", "running") };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toBe("running");
        expect(map.size).toBe(1);
    });

    it("marks a session running when any one of its blocks is running", () => {
        const blocks = [
            { blockId: "b1", sessionId: "s1" },
            { blockId: "b2", sessionId: "s1" },
            { blockId: "b3", sessionId: "s1" },
        ];
        const statuses = {
            b1: statusOf("b1", "done"),
            b2: statusOf("b2", "running"),
            b3: statusOf("b3", "init"),
        };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toBe("running");
        expect(map.size).toBe(1);
    });

    it("omits sessions whose blocks are all done or init", () => {
        const blocks = [
            { blockId: "b1", sessionId: "s1" },
            { blockId: "b2", sessionId: "s2" },
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
            { blockId: "b1", sessionId: "s1" },
            { blockId: "b2", sessionId: "s2" },
        ];
        const statuses = { b1: null, b2: statusOf("b2", "running") };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.has("s1")).toBe(false);
        expect(map.get("s2")).toBe("running");
    });

    it("omits blocks whose status is missing from the map entirely", () => {
        const blocks = [{ blockId: "b1", sessionId: "s1" }];

        const map = projectSessionRunning(blocks, {});

        expect(map.size).toBe(0);
    });

    it("tracks multiple independent sessions in one pass", () => {
        const blocks = [
            { blockId: "b1", sessionId: "s1" },
            { blockId: "b2", sessionId: "s1" },
            { blockId: "b3", sessionId: "s2" },
            { blockId: "b4", sessionId: "s3" },
        ];
        const statuses = {
            b1: statusOf("b1", "done"),
            b2: statusOf("b2", "running"),
            b3: statusOf("b3", "running"),
            b4: statusOf("b4", "done"),
        };

        const map = projectSessionRunning(blocks, statuses);

        expect(map.get("s1")).toBe("running");
        expect(map.get("s2")).toBe("running");
        expect(map.has("s3")).toBe(false);
        expect(map.size).toBe(2);
    });

    it("ignores the empty block list", () => {
        expect(projectSessionRunning([], { b1: statusOf("b1", "running") }).size).toBe(0);
    });
});
