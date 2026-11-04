// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 目录树 VCS 标记纯函数单测：M/U/D 解析、目录祖先聚合、噪音目录、多仓库、
// 路径分隔符、baseDir(~) 对齐、截断标记、缓存 TTL/失效。

import {
    VCS_TREE_STATUS_CACHE_TTL_MS,
    buildVcsTreeStatus,
    classifyVcsFileStatus,
    clearVcsTreeStatusCache,
    getCachedVcsTreeStatus,
    isUnderVcsDir,
    normalizeVcsPath,
    setCachedVcsTreeStatus,
    type VcsTreeStatus,
} from "@/app/view/preview/vcs-tree-status";
import { afterEach, describe, expect, it } from "vitest";

function repo(rootpath: string, status: VcsFileStatus[], repotype = "git"): VcsRepositoryInfo {
    return {
        repoid: `${repotype}:${rootpath}`,
        repotype,
        rootpath,
        name: rootpath.split("/").at(-1) ?? rootpath,
        status,
    };
}

function file(path: string, code: string, untracked = false): VcsFileStatus {
    return { path, code, untracked };
}

function emptyStatus(): VcsTreeStatus {
    return {
        fileMark: new Map(),
        dirCount: new Map(),
        repoRoots: new Set(),
        truncated: false,
    };
}

afterEach(() => {
    clearVcsTreeStatusCache();
});

describe("normalizeVcsPath", () => {
    it("unifies backslashes and drops trailing slashes", () => {
        expect(normalizeVcsPath("C:\\Users\\nita\\repo\\")).toBe("C:/Users/nita/repo");
        expect(normalizeVcsPath("  /home/nita/repo/  ")).toBe("/home/nita/repo");
        expect(normalizeVcsPath("/")).toBe("/");
        expect(normalizeVcsPath("")).toBe("");
        expect(normalizeVcsPath(null)).toBe("");
    });

    it("does not touch interior case or repeated separators", () => {
        expect(normalizeVcsPath("/Home//Nita/A")).toBe("/Home//Nita/A");
    });
});

describe("isUnderVcsDir", () => {
    it("matches self and descendants only", () => {
        expect(isUnderVcsDir("/a/b", "/a/b")).toBe(true);
        expect(isUnderVcsDir("/a/b/c.ts", "/a/b")).toBe(true);
        expect(isUnderVcsDir("/a/bc/c.ts", "/a/b")).toBe(false);
        expect(isUnderVcsDir("/a/b", "")).toBe(false);
    });
});

describe("classifyVcsFileStatus", () => {
    it("maps untracked forms to U", () => {
        expect(classifyVcsFileStatus({ code: "??", untracked: true })).toBe("U");
        expect(classifyVcsFileStatus({ code: "?", untracked: false })).toBe("U");
        expect(classifyVcsFileStatus({ code: "", untracked: true })).toBe("U");
    });

    it("maps any code containing D to D", () => {
        expect(classifyVcsFileStatus({ code: "D" })).toBe("D");
        expect(classifyVcsFileStatus({ code: " D" })).toBe("D");
        expect(classifyVcsFileStatus({ code: "MD" })).toBe("D");
    });

    it("folds M/A/R/C into M", () => {
        expect(classifyVcsFileStatus({ code: " M" })).toBe("M");
        expect(classifyVcsFileStatus({ code: "M" })).toBe("M");
        expect(classifyVcsFileStatus({ code: "A" })).toBe("M");
        expect(classifyVcsFileStatus({ code: "R" })).toBe("M");
        expect(classifyVcsFileStatus({ code: "C" })).toBe("M");
        expect(classifyVcsFileStatus(null)).toBe("M");
    });
});

describe("buildVcsTreeStatus", () => {
    it("indexes M / U / D files and aggregates ancestor dirs", () => {
        const status = buildVcsTreeStatus(
            [repo("/repo", [file("src/a.ts", " M"), file("src/deep/b.ts", "??", true), file("src/deep/gone.ts", "D")])],
            { rootDir: "/repo" }
        );

        expect(status.fileMark.get("/repo/src/a.ts")).toBe("M");
        expect(status.fileMark.get("/repo/src/deep/b.ts")).toBe("U");
        expect(status.fileMark.get("/repo/src/deep/gone.ts")).toBe("D");
        // 祖先聚合：src = 3、src/deep = 2、根 = 3
        expect(status.dirCount.get("/repo/src")).toBe(3);
        expect(status.dirCount.get("/repo/src/deep")).toBe(2);
        expect(status.dirCount.get("/repo")).toBe(3);
        expect(status.repoRoots.has("/repo")).toBe(true);
        expect(status.truncated).toBe(false);
    });

    it("counts additions as M", () => {
        const status = buildVcsTreeStatus([repo("/repo", [file("new.ts", "A")])], { rootDir: "/repo/sub" });
        // rootDir 是 /repo/sub，文件在视图之外 → 不参与
        expect(status.fileMark.size).toBe(0);
        expect(status.dirCount.size).toBe(0);
    });

    it("skips noise directories entirely", () => {
        const status = buildVcsTreeStatus(
            [
                repo("/repo", [
                    file("node_modules/pkg/index.js", "??", true),
                    file("dist/bundle.js", "??", true),
                    file("out/x.js", " M"),
                    file("coverage/lcov.info", " M"),
                    file("frontend/.venv/lib.js", " M"),
                    file("src/keep.ts", " M"),
                ]),
            ],
            { rootDir: "/repo" }
        );
        expect(status.fileMark.size).toBe(1);
        expect(status.fileMark.has("/repo/src/keep.ts")).toBe(true);
        expect(status.dirCount.get("/repo")).toBe(1);
        expect(status.dirCount.get("/repo/frontend")).toBeUndefined();
        expect(status.dirCount.get("/repo/node_modules")).toBeUndefined();
    });

    it("merges multiple repositories under one root", () => {
        const status = buildVcsTreeStatus(
            [
                repo("/projects/alpha", [file("a.ts", " M")]),
                repo("/projects/beta", [file("b.ts", "??", true), file("c.ts", " M")]),
                repo("/projects/gamma", []),
            ],
            { rootDir: "/projects" }
        );
        expect(status.dirCount.get("/projects/alpha")).toBe(1);
        expect(status.dirCount.get("/projects/beta")).toBe(2);
        // 干净仓库：有根无标记（静默）
        expect(status.repoRoots.has("/projects/gamma")).toBe(true);
        expect(status.dirCount.get("/projects/gamma")).toBeUndefined();
        expect(status.fileMark.size).toBe(3);
    });

    it("maps absolute repo paths onto the view's ~ form via baseDir", () => {
        const status = buildVcsTreeStatus(
            [repo("/Users/nita/Primary/projects/snorkeling", [file("pkg/app.go", " M"), file("docs/x.md", "D")])],
            {
                rootDir: "~/Primary/projects/snorkeling",
                baseDir: "/Users/nita/Primary/projects/snorkeling",
            }
        );
        expect(status.fileMark.get("~/Primary/projects/snorkeling/pkg/app.go")).toBe("M");
        expect(status.fileMark.get("~/Primary/projects/snorkeling/docs/x.md")).toBe("D");
        expect(status.dirCount.get("~/Primary/projects/snorkeling/pkg")).toBe(1);
        expect(status.dirCount.get("~/Primary/projects/snorkeling")).toBe(2);
        expect(status.repoRoots.has("~/Primary/projects/snorkeling")).toBe(true);
    });

    it("ignores changes outside the viewed directory (parent repo case)", () => {
        const status = buildVcsTreeStatus(
            [
                repo("/Users/nita/parent", [
                    file("inside/root/a.ts", " M"),
                    file("somewhere/else/b.ts", " M"),
                    file("node_modules/c.js", "??", true),
                ]),
            ],
            { rootDir: "~/parent/inside/root", baseDir: "/Users/nita/parent/inside/root" }
        );
        expect(status.fileMark.size).toBe(1);
        expect(status.fileMark.get("~/parent/inside/root/a.ts")).toBe("M");
        expect(status.dirCount.get("~/parent/inside/root")).toBe(1);
        // 父仓库根本身不在 baseDir 之下，保留绝对形态
        expect(status.repoRoots.has("/Users/nita/parent")).toBe(true);
    });

    it("aligns macOS symlink spellings (/tmp vs /private/tmp)", () => {
        // 真机回归：RPC basepath 保留输入拼写，VCS rootpath 是 realpath。
        const status = buildVcsTreeStatus(
            [
                repo("/private/tmp/vcs-fixture", [
                    file("modified.txt", " M"),
                    file("untracked.txt", "??", true),
                    file("sub/inner2.txt", " M"),
                ]),
            ],
            { rootDir: "/tmp/vcs-fixture", baseDir: "/tmp/vcs-fixture" }
        );
        expect(status.fileMark.get("/tmp/vcs-fixture/modified.txt")).toBe("M");
        expect(status.fileMark.get("/tmp/vcs-fixture/untracked.txt")).toBe("U");
        expect(status.fileMark.get("/tmp/vcs-fixture/sub/inner2.txt")).toBe("M");
        expect(status.dirCount.get("/tmp/vcs-fixture/sub")).toBe(1);
        expect(status.dirCount.get("/tmp/vcs-fixture")).toBe(3);
        expect(status.repoRoots.has("/tmp/vcs-fixture")).toBe(true);
    });

    it("aligns symlink spellings when the repo lives below the viewed dir", () => {
        const status = buildVcsTreeStatus([repo("/private/tmp/workspace/alpha", [file("a.txt", " M")])], {
            rootDir: "/tmp/workspace",
            baseDir: "/tmp/workspace",
        });
        expect(status.fileMark.get("/tmp/workspace/alpha/a.txt")).toBe("M");
        expect(status.dirCount.get("/tmp/workspace/alpha")).toBe(1);
        expect(status.dirCount.get("/tmp/workspace")).toBe(1);
        expect(status.repoRoots.has("/tmp/workspace/alpha")).toBe(true);
    });

    it("does not invent a mapping for unrelated repo roots", () => {
        // 不共享尾部组件的仓库不应被错映射到视图里（否则会产生假标记）
        const status = buildVcsTreeStatus([repo("/private/opt/other", [file("x.txt", " M")])], {
            rootDir: "/tmp/vcs-fixture",
            baseDir: "/tmp/vcs-fixture",
        });
        expect(status.fileMark.size).toBe(0);
        expect(status.dirCount.size).toBe(0);
        expect(status.repoRoots.has("/private/opt/other")).toBe(true);
    });

    it("normalizes windows separators on both sides", () => {
        const status = buildVcsTreeStatus([repo("C:\\Users\\nita\\repo", [file("src\\main.go", " M")])], {
            rootDir: "C:/Users/nita/repo",
        });
        expect(status.fileMark.get("C:/Users/nita/repo/src/main.go")).toBe("M");
        expect(status.dirCount.get("C:/Users/nita/repo/src")).toBe(1);
        expect(status.dirCount.get("C:/Users/nita/repo")).toBe(1);
    });

    it("flags truncation when a repo reaches the status limit", () => {
        const many = [file("a.ts", " M"), file("b.ts", " M")];
        const status = buildVcsTreeStatus([repo("/repo", many)], { rootDir: "/repo", statusLimit: 2 });
        expect(status.truncated).toBe(true);

        const notTruncated = buildVcsTreeStatus([repo("/repo", many)], { rootDir: "/repo", statusLimit: 3 });
        expect(notTruncated.truncated).toBe(false);
    });

    it("handles empty / null input", () => {
        expect(buildVcsTreeStatus(null, { rootDir: "/repo" })).toEqual(emptyStatus());
        expect(buildVcsTreeStatus([], { rootDir: "/repo" })).toEqual(emptyStatus());
        expect(buildVcsTreeStatus([repo("/repo", [])], { rootDir: "/repo" }).dirCount.size).toBe(0);
    });

    it("skips repos without rootpath and entries without path", () => {
        const status = buildVcsTreeStatus(
            [repo("", [file("a.ts", " M")]), repo("/repo", [file("", " M"), file(".", " M")])],
            { rootDir: "/repo" }
        );
        expect(status.fileMark.size).toBe(0);
        expect(status.repoRoots.size).toBe(1);
    });
});

describe("vcsTreeStatusCache", () => {
    const sample: VcsTreeStatus = {
        fileMark: new Map([["/repo/a.ts", "M"]]),
        dirCount: new Map([["/repo", 1]]),
        repoRoots: new Set(["/repo"]),
        truncated: false,
    };

    it("returns cached value within TTL and expires after it", () => {
        setCachedVcsTreeStatus("conn1", "/repo", sample, { now: 1_000 });
        expect(getCachedVcsTreeStatus("conn1", "/repo", { now: 1_000 + 5_000 })).toBe(sample);
        expect(getCachedVcsTreeStatus("conn1", "/repo", { now: 1_000 + VCS_TREE_STATUS_CACHE_TTL_MS + 1 })).toBeNull();
    });

    it("keys by connection and normalizes the dir", () => {
        setCachedVcsTreeStatus("conn1", "/repo/", sample, { now: 1_000 });
        expect(getCachedVcsTreeStatus("conn1", "/repo", { now: 1_001 })).toBe(sample);
        expect(getCachedVcsTreeStatus("conn2", "/repo", { now: 1_001 })).toBeNull();
    });

    it("invalidates when refreshVersion changes", () => {
        setCachedVcsTreeStatus("conn1", "/repo", sample, { now: 1_000, refreshVersion: 1 });
        expect(getCachedVcsTreeStatus("conn1", "/repo", { now: 1_001, refreshVersion: 1 })).toBe(sample);
        expect(getCachedVcsTreeStatus("conn1", "/repo", { now: 1_002, refreshVersion: 2 })).toBeNull();
    });

    it("clears by dir, by conn, or wholesale", () => {
        setCachedVcsTreeStatus("conn1", "/a", sample);
        setCachedVcsTreeStatus("conn1", "/b", sample);
        setCachedVcsTreeStatus("conn2", "/a", sample);

        clearVcsTreeStatusCache("conn1", "/a");
        expect(getCachedVcsTreeStatus("conn1", "/a")).toBeNull();
        expect(getCachedVcsTreeStatus("conn1", "/b")).toBe(sample);

        clearVcsTreeStatusCache("conn2");
        expect(getCachedVcsTreeStatus("conn2", "/a")).toBeNull();

        clearVcsTreeStatusCache();
        expect(getCachedVcsTreeStatus("conn1", "/b")).toBeNull();
    });
});
