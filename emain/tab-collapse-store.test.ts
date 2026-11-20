// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    createTabCollapseFileStore,
    normalizeCollapsedTabIds,
    parseCollapsedTabIds,
    serializeCollapsedTabIds,
} from "./tab-collapse-store";

let tempDir: string | null = null;

function makeStore(): { store: ReturnType<typeof createTabCollapseFileStore>; filePath: string } {
    if (tempDir == null) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tab-collapse-store-"));
    }
    const filePath = path.join(tempDir, "tab-collapse.json");
    return { store: createTabCollapseFileStore(filePath), filePath };
}

afterEach(() => {
    if (tempDir != null) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

describe("normalizeCollapsedTabIds", () => {
    it("keeps string ids in first-seen order and drops blanks / duplicates / non-strings", () => {
        expect(normalizeCollapsedTabIds(["t2", " t1 ", "", "t2", 3, null, "t1"])).toEqual(["t2", "t1"]);
    });

    it("treats non-array input as empty", () => {
        expect(normalizeCollapsedTabIds(undefined)).toEqual([]);
        expect(normalizeCollapsedTabIds({ t1: true })).toEqual([]);
        expect(normalizeCollapsedTabIds("t1")).toEqual([]);
    });
});

describe("parseCollapsedTabIds", () => {
    it("parses a JSON array", () => {
        expect(parseCollapsedTabIds('["t1","t2"]')).toEqual(["t1", "t2"]);
    });

    it("degrades to empty on empty / corrupt / non-array payloads", () => {
        expect(parseCollapsedTabIds("")).toEqual([]);
        expect(parseCollapsedTabIds("   ")).toEqual([]);
        expect(parseCollapsedTabIds("{not json")).toEqual([]);
        expect(parseCollapsedTabIds('{"t1":true}')).toEqual([]);
    });
});

describe("serializeCollapsedTabIds", () => {
    it("round-trips through parse", () => {
        const text = serializeCollapsedTabIds(["t2", "t1", "t2"]);
        expect(text).toBe('["t2","t1"]');
        expect(parseCollapsedTabIds(text)).toEqual(["t2", "t1"]);
    });
});

describe("createTabCollapseFileStore", () => {
    it("returns an empty set when the file does not exist", () => {
        const { store } = makeStore();
        expect(store.read()).toEqual([]);
    });

    it("writes then reads back the same ids (creates the parent dir)", () => {
        const { store, filePath } = makeStore();
        const nested = path.join(path.dirname(filePath), "nested", "tab-collapse.json");
        const nestedStore = createTabCollapseFileStore(nested);
        nestedStore.write(["t1", "t2"]);
        expect(nestedStore.read()).toEqual(["t1", "t2"]);
        expect(store.read()).toEqual([]);
    });

    it("overwrites with the latest set and does not leave the temp file behind", () => {
        const { store, filePath } = makeStore();
        store.write(["t1", "t2"]);
        store.write(["t2"]);
        expect(store.read()).toEqual(["t2"]);
        expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    });

    it("degrades to empty when the file holds corrupt content", () => {
        const { store, filePath } = makeStore();
        fs.writeFileSync(filePath, "{oops", "utf-8");
        expect(store.read()).toEqual([]);
    });
});
