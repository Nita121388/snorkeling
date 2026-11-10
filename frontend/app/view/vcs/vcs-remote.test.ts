// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildCommitRemoteUrl, getRepoOpenUrl } from "./vcs-remote";

function makeRepo(extras?: Partial<VcsRepositoryInfo>): VcsRepositoryInfo {
    return {
        repoid: "repo-1",
        name: "repo",
        repotype: "git",
        rootpath: "/src/repo",
        branch: "main",
        ...extras,
    };
}

describe("getRepoOpenUrl", () => {
    it("prefers browseurl over remoteurl", () => {
        const repo = makeRepo({ browseurl: "https://github.com/user/repo", remoteurl: "git@github.com:user/repo.git" });
        expect(getRepoOpenUrl(repo)).toBe("https://github.com/user/repo");
    });

    it("falls back to remoteurl when browseurl is blank", () => {
        const repo = makeRepo({ browseurl: "", remoteurl: "git@github.com:user/repo.git" });
        expect(getRepoOpenUrl(repo)).toBe("git@github.com:user/repo.git");
    });

    it("returns empty string when both are blank", () => {
        expect(getRepoOpenUrl(makeRepo())).toBe("");
    });

    it("returns empty string for null repo", () => {
        expect(getRepoOpenUrl(null)).toBe("");
    });
});

describe("buildCommitRemoteUrl", () => {
    it("composes commit url from browse url and hash", () => {
        expect(buildCommitRemoteUrl("https://github.com/user/repo", "a1b2c3d4e5")).toBe(
            "https://github.com/user/repo/commit/a1b2c3d4e5"
        );
    });

    it("strips trailing slashes from browse url", () => {
        expect(buildCommitRemoteUrl("https://gitea.example.com/team/repo/", "f6e5d4c3b2")).toBe(
            "https://gitea.example.com/team/repo/commit/f6e5d4c3b2"
        );
    });

    it("returns empty string for blank inputs", () => {
        expect(buildCommitRemoteUrl("", "a1b2c3d4e5")).toBe("");
        expect(buildCommitRemoteUrl("https://github.com/user/repo", "")).toBe("");
        expect(buildCommitRemoteUrl(null, null)).toBe("");
    });
});
