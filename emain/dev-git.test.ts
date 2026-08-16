// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "vitest";
import fs from "fs";
import os from "os";
import * as path from "path";
import { resolveGitBranch } from "./dev-git";

const tmpDirs: string[] = [];

function makeTmpDir(prefix = "dev-git-test-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

function writeHead(repo: string, head: string): void {
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), head);
}

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("resolveGitBranch", () => {
    test("reads the branch from a plain repo, walking up from a nested dir", () => {
        const repo = makeTmpDir();
        writeHead(repo, "ref: refs/heads/feat/agent-inputbox-composer\n");
        const nested = path.join(repo, "sub", "dir");
        fs.mkdirSync(nested, { recursive: true });
        expect(resolveGitBranch(nested)).toBe("feat/agent-inputbox-composer");
    });

    test("reads the branch from a worktree .git file", () => {
        const main = makeTmpDir();
        writeHead(main, "ref: refs/heads/main\n");
        const wtGitDir = path.join(main, ".git", "worktrees", "wt1");
        fs.mkdirSync(wtGitDir, { recursive: true });
        fs.writeFileSync(path.join(wtGitDir, "HEAD"), "ref: refs/heads/worktree-agent-card-term-tail\n");
        const worktree = makeTmpDir();
        fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${wtGitDir}\n`);
        expect(resolveGitBranch(worktree)).toBe("worktree-agent-card-term-tail");
    });

    test("returns a short hash for a detached HEAD", () => {
        const repo = makeTmpDir();
        writeHead(repo, "8bef3e66a1109604a5a918300000000000000000\n");
        expect(resolveGitBranch(repo)).toBe("8bef3e66a110");
    });

    test("returns null outside a git repo", () => {
        expect(resolveGitBranch(makeTmpDir("dev-git-test-norepo-"))).toBe(null);
    });

    test("returns null when HEAD is unreadable", () => {
        const repo = makeTmpDir();
        fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
        expect(resolveGitBranch(repo)).toBe(null);
    });

    test("returns null when a .git file has no gitdir line", () => {
        const repo = makeTmpDir();
        fs.writeFileSync(path.join(repo, ".git"), "not a gitdir line\n");
        expect(resolveGitBranch(repo)).toBe(null);
    });
});
