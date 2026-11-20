// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Run: npx vitest run frontend/app/tab/tab-block-collect.test.ts

import { describe, expect, it } from "vitest";
import { expandBlockIdsWithSubblocks } from "./tab-block-collect";

const block = (subblockids?: string[]) => ({ subblockids }) as unknown as Block;

describe("expandBlockIdsWithSubblocks", () => {
    it("顶层保序返回，无子块时原样", () => {
        const out = expandBlockIdsWithSubblocks(["b1", "b2"], () => block());
        expect(out).toEqual(["b1", "b2"]);
    });

    it("子块紧随其顶层块展开", () => {
        const map = { b1: block(["s1", "s2"]), b2: block(["s3"]) };
        const out = expandBlockIdsWithSubblocks(["b1", "b2"], (id) => map[id] ?? null);
        expect(out).toEqual(["b1", "s1", "s2", "b2", "s3"]);
    });

    it("重复 id（顶层与子块重叠）去重，保留首次出现", () => {
        const map = { b1: block(["s1", "b2"]), b2: block(["s1"]) };
        const out = expandBlockIdsWithSubblocks(["b1", "b2"], (id) => map[id] ?? null);
        expect(out).toEqual(["b1", "s1", "b2"]);
    });

    it("getBlock 返回 null（未加载/已删）不炸，id 仍纳入全集", () => {
        const out = expandBlockIdsWithSubblocks(["b1", "missing"], (id) => (id === "b1" ? block(["s1"]) : null));
        expect(out).toEqual(["b1", "s1", "missing"]);
    });

    it("空列表/空串 id", () => {
        expect(expandBlockIdsWithSubblocks([], () => null)).toEqual([]);
        expect(expandBlockIdsWithSubblocks([""], () => null)).toEqual([]);
    });
});
