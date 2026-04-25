// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    groupContentSearchMatches,
    matchesFileNameSearchQuery,
    shouldFallbackFileNameSearch,
    sortFileNameMatches,
} from "@/app/view/preview/preview-search";
import { describe, expect, it } from "vitest";

describe("preview search helpers", () => {
    it("groups content matches by file path", () => {
        const groups = groupContentSearchMatches([
            { path: "/tmp/a.ts", relpath: "a.ts", linenumber: 2, linetext: "alpha" },
            { path: "/tmp/b.ts", relpath: "b.ts", linenumber: 4, linetext: "beta" },
            { path: "/tmp/a.ts", relpath: "a.ts", linenumber: 7, linetext: "gamma" },
        ]);

        expect(groups).toHaveLength(2);
        expect(groups[0]).toMatchObject({ path: "/tmp/a.ts", relPath: "a.ts" });
        expect(groups[0].matches).toHaveLength(2);
        expect(groups[1]).toMatchObject({ path: "/tmp/b.ts", relPath: "b.ts" });
    });

    it("sorts filename matches with directories first", () => {
        const sorted = sortFileNameMatches([
            { path: "/tmp/src/zeta.ts", relpath: "src/zeta.ts", isdir: false },
            { path: "/tmp/docs", relpath: "docs", isdir: true },
            { path: "/tmp/src", relpath: "src", isdir: true },
            { path: "/tmp/alpha.ts", relpath: "alpha.ts", isdir: false },
        ]);

        expect(sorted.map((match) => match.relpath)).toEqual(["docs", "src", "alpha.ts", "src/zeta.ts"]);
    });

    it("sorts filename matches naturally", () => {
        const sorted = sortFileNameMatches([
            { path: "/tmp/S26", relpath: "S26", isdir: true },
            { path: "/tmp/S3", relpath: "S3", isdir: true },
            { path: "/tmp/S1", relpath: "S1", isdir: true },
        ]);

        expect(sorted.map((match) => match.relpath)).toEqual(["S1", "S3", "S26"]);
    });

    it("uses smart-case matching for filename queries", () => {
        expect(matchesFileNameSearchQuery("ConfigMap.yaml", "Config")).toBe(true);
        expect(matchesFileNameSearchQuery("config-map.yaml", "Config")).toBe(false);
        expect(matchesFileNameSearchQuery("ConfigMap.yaml", "config")).toBe(true);
    });

    it("falls back when the filename-search command is unavailable", () => {
        expect(shouldFallbackFileNameSearch('Error: command "remotefilenamesearchstream" not found')).toBe(true);
        expect(shouldFallbackFileNameSearch('Error: command not implemented "remotefilenamesearchstream"')).toBe(true);
        expect(shouldFallbackFileNameSearch("Error: permission denied")).toBe(false);
    });
});
