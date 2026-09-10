// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { encodeFilePathsBplist, encodeFileUrlsBplist } from "./encode-clipboard";

// This module encodes macOS clipboard file lists (NSFilenamesPboardType /
// public.file-url) and depends on the macOS-only `/usr/bin/plutil` binary,
// both in the source and in these tests. On other platforms the tests cannot
// run, so they are skipped entirely.
const isDarwin = process.platform === "darwin";

describe.skipIf(!isDarwin)("encodeFilePathsBplist", () => {
    it("produces a valid bplist00 header", () => {
        const buf = encodeFilePathsBplist(["/repo/a.txt"]);
        expect(buf.subarray(0, 8).toString()).toBe("bplist00");
    });

    it("produces a bplist accepted by plutil", () => {
        const paths = ["/repo/a.md", "/repo/b.md"];
        const buf = encodeFilePathsBplist(paths);
        const res = spawnSync("/usr/bin/plutil", ["-lint", "-"], { input: buf });
        expect(res.status).toBe(0);
    });

    it("round-trips through plutil as XML", () => {
        const paths = ["/repo/a.md", "/repo/pkg/package.json"];
        const bplist = encodeFilePathsBplist(paths);
        const toXml = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "-"], { input: bplist });
        expect(toXml.status).toBe(0);
        const xml = (toXml.stdout as Buffer).toString();
        expect(xml).toContain("<string>/repo/a.md</string>");
        expect(xml).toContain("<string>/repo/pkg/package.json</string>");
    });
});

describe.skipIf(!isDarwin)("encodeFileUrlsBplist", () => {
    it("converts absolute paths to file:// URLs", () => {
        const buf = encodeFileUrlsBplist(["/repo/a.md"]);
        const toXml = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "-"], { input: buf });
        expect(toXml.status).toBe(0);
        const xml = (toXml.stdout as Buffer).toString();
        expect(xml).toContain("<string>file:///repo/a.md</string>");
    });

    it("normalizes double slashes in paths", () => {
        const buf = encodeFileUrlsBplist(["/repo//src//index.ts"]);
        const toXml = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "-"], { input: buf });
        expect(toXml.status).toBe(0);
        const xml = (toXml.stdout as Buffer).toString();
        expect(xml).toContain("<string>file:///repo/src/index.ts</string>");
    });

    it("handles multiple paths", () => {
        const paths = ["/repo/a.md", "/repo/b.md"];
        const buf = encodeFileUrlsBplist(paths);
        const toXml = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "-"], { input: buf });
        expect(toXml.status).toBe(0);
        const xml = (toXml.stdout as Buffer).toString();
        expect(xml).toContain("<string>file:///repo/a.md</string>");
        expect(xml).toContain("<string>file:///repo/b.md</string>");
    });
});
