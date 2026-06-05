// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filterVcsFileStatuses, vcsFileStatusMatchesExtension, vcsFileStatusMatchesType } from "./vcs-filter";

function makeStatus(path: string, code: string, extras?: Partial<VcsFileStatus>): VcsFileStatus {
    return {
        path,
        code,
        ...extras,
    };
}

describe("VCS file filters", () => {
    it("filters by file path and status code", () => {
        const statuses = [
            makeStatus("frontend/app/view/vcs/vcs.tsx", "M"),
            makeStatus("pkg/wshrpc/wshremote/vcs.go", "A", { staged: true }),
            makeStatus("README.md", "D"),
        ];

        expect(filterVcsFileStatuses(statuses, "frontend", "all").map((status) => status.path)).toEqual([
            "frontend/app/view/vcs/vcs.tsx",
        ]);
        expect(filterVcsFileStatuses(statuses, "wshremote", "all").map((status) => status.path)).toEqual([
            "pkg/wshrpc/wshremote/vcs.go",
        ]);
        expect(
            filterVcsFileStatuses(
                [makeStatus("src/one.ts", "M"), makeStatus("src/two.ts", "A"), makeStatus("src/three.ts", "D")],
                "d",
                "all"
            ).map((status) => status.path)
        ).toEqual(["src/three.ts"]);
    });

    it("matches common VCS change types", () => {
        expect(vcsFileStatusMatchesType(makeStatus("src/app.ts", "M"), "modified")).toBe(true);
        expect(vcsFileStatusMatchesType(makeStatus("src/app.ts", "A", { staged: true }), "added")).toBe(true);
        expect(vcsFileStatusMatchesType(makeStatus("src/app.ts", "D"), "deleted")).toBe(true);
        expect(vcsFileStatusMatchesType(makeStatus("src/app.ts", "R"), "renamed")).toBe(true);
        expect(vcsFileStatusMatchesType(makeStatus("src/app.ts", "?", { untracked: true }), "untracked")).toBe(true);
    });

    it("filters by file extension", () => {
        const statuses = [
            makeStatus("frontend/app/view/vcs/vcs.tsx", "M"),
            makeStatus("frontend/app/view/vcs/vcs-filter.test.ts", "M"),
            makeStatus("frontend/app/view/vcs/vcs.scss", "A"),
            makeStatus("README.md", "D"),
            makeStatus("Makefile", "M"),
        ];

        expect(filterVcsFileStatuses(statuses, "", "all", "tsx").map((status) => status.path)).toEqual([
            "frontend/app/view/vcs/vcs.tsx",
        ]);
        expect(filterVcsFileStatuses(statuses, "", "all", ".ts, .scss").map((status) => status.path)).toEqual([
            "frontend/app/view/vcs/vcs-filter.test.ts",
            "frontend/app/view/vcs/vcs.scss",
        ]);
        expect(filterVcsFileStatuses(statuses, "frontend", "all", "scss").map((status) => status.path)).toEqual([
            "frontend/app/view/vcs/vcs.scss",
        ]);
        expect(vcsFileStatusMatchesExtension(makeStatus("Makefile", "M"), "md")).toBe(false);
    });

    it("separates staged, unstaged, and untracked files", () => {
        const staged = makeStatus("src/staged.ts", "M", { staged: true });
        const unstaged = makeStatus("src/unstaged.ts", "M");
        const untracked = makeStatus("src/new.ts", "?", { untracked: true });

        expect(vcsFileStatusMatchesType(staged, "staged")).toBe(true);
        expect(vcsFileStatusMatchesType(unstaged, "unstaged")).toBe(true);
        expect(vcsFileStatusMatchesType(untracked, "unstaged")).toBe(false);
    });
});
