// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { findInlineTabDedupeMatch, type InlineTabCandidate } from "./preview-inline-tab";

function candidates(): InlineTabCandidate[] {
    return [
        { blockId: "files", meta: { view: "preview", connection: "local", file: "/repo/src" } },
        { blockId: "vcs-a", meta: { view: "vcs", connection: "local", "vcs:path": "/repo" } },
        { blockId: "vcs-b", meta: { view: "vcs", connection: "local", "vcs:path": "/other" } },
        {
            blockId: "diff-a",
            meta: {
                view: "vcsdiff",
                connection: "local",
                "vcsdiff:repopath": "/repo",
                "vcsdiff:filepath": "/repo/src/index.ts",
                "vcsdiff:revision": "",
            },
        },
    ];
}

describe("findInlineTabDedupeMatch", () => {
    it("matches the same vcs path in the same group", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            { view: "vcs", connection: "local", "vcs:path": "/repo" },
            ["vcs:path"]
        );
        expect(match).toBe("vcs-a");
    });

    it("ignores blocks with a different vcs path", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            { view: "vcs", connection: "local", "vcs:path": "/third" },
            ["vcs:path"]
        );
        expect(match).toBeNull();
    });

    it("normalizes path separators and duplicate slashes", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            { view: "vcs", connection: "local", "vcs:path": "\\repo\\" },
            ["vcs:path"]
        );
        expect(match).toBe("vcs-a");
    });

    it("requires every non-blank dedupe key to match", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            {
                view: "vcsdiff",
                connection: "local",
                "vcsdiff:repopath": "/repo",
                "vcsdiff:filepath": "/repo/src/other.ts",
            },
            ["vcsdiff:repopath", "vcsdiff:filepath"]
        );
        expect(match).toBeNull();
    });

    it("skips blank dedupe keys instead of requiring them", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            {
                view: "vcsdiff",
                connection: "local",
                "vcsdiff:repopath": "/repo",
                "vcsdiff:filepath": "/repo/src/index.ts",
                "vcsdiff:revision": "",
            },
            ["vcsdiff:repopath", "vcsdiff:filepath", "vcsdiff:revision"]
        );
        expect(match).toBe("diff-a");
    });

    it("returns null when no dedupe key carries a value", () => {
        const match = findInlineTabDedupeMatch(candidates(), { view: "vcs", connection: "local" }, ["vcs:path"]);
        expect(match).toBeNull();
    });

    it("treats local connection names as interchangeable", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            { view: "vcs", connection: "local:remote-1", "vcs:path": "/repo" },
            ["vcs:path"]
        );
        expect(match).toBe("vcs-a");
    });

    it("does not match across different views", () => {
        const match = findInlineTabDedupeMatch(
            candidates(),
            { view: "vcshistory", connection: "local", "vcs:path": "/repo" },
            ["vcs:path"]
        );
        expect(match).toBeNull();
    });
});
