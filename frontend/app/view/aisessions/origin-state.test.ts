// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import {
    buildOriginMeta,
    clearOriginCache,
    parseOriginMeta,
    recallOrigin,
    rememberOrigin,
    resolveRestoredOriginId,
} from "./origin-state";

describe("origin-state meta round-trip", () => {
    it("round-trips an id", () => {
        expect(parseOriginMeta(buildOriginMeta("dump-abc"))).toBe("dump-abc");
    });

    it("returns null for corrupt / missing payloads", () => {
        expect(parseOriginMeta("not json")).toBeNull();
        expect(parseOriginMeta("")).toBeNull();
        expect(parseOriginMeta(null)).toBeNull();
        expect(parseOriginMeta(JSON.stringify([1, 2]))).toBeNull();
        expect(parseOriginMeta(JSON.stringify({ id: "  " }))).toBeNull();
        expect(parseOriginMeta(JSON.stringify({ id: 123 }))).toBeNull();
    });

    it("accepts an already-parsed object (meta may pre-parse)", () => {
        expect(parseOriginMeta({ id: "dump-x" })).toBe("dump-x");
    });
});

describe("resolveRestoredOriginId", () => {
    it("defaults to local when nothing saved", () => {
        expect(resolveRestoredOriginId(null, ["local"])).toBe("local");
        expect(resolveRestoredOriginId("", ["local"])).toBe("local");
    });

    it("keeps a saved id that still exists", () => {
        expect(resolveRestoredOriginId("dump-a", ["local", "dump-a"])).toBe("dump-a");
    });

    it("falls back to local when the saved origin was removed", () => {
        expect(resolveRestoredOriginId("dump-gone", ["local", "dump-a"])).toBe("local");
    });
});

describe("origin hot cache", () => {
    afterEach(() => clearOriginCache());

    it("remembers and recalls per block", () => {
        rememberOrigin("block-1", "dump-a");
        expect(recallOrigin("block-1")).toBe("dump-a");
        expect(recallOrigin("block-2")).toBeNull();
    });

    it("ignores empty block ids", () => {
        rememberOrigin("", "dump-a");
        expect(recallOrigin("")).toBeNull();
    });

    it("updates the value for the same block", () => {
        rememberOrigin("block-1", "dump-a");
        rememberOrigin("block-1", "local");
        expect(recallOrigin("block-1")).toBe("local");
    });
});
