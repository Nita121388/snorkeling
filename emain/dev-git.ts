// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import * as path from "path";

/**
 * Resolve the current git branch starting from `startDir`, walking up until a
 * `.git` entry is found. Handles worktrees where `.git` is a file whose
 * `gitdir:` line points at the worktree's gitdir (which holds its own HEAD).
 *
 * Returns the branch name for a normal checkout, a short hash for a detached
 * HEAD, or null when no git repo is found or HEAD cannot be read.
 */
export function resolveGitBranch(startDir: string): string | null {
    const gitPath = findGitDir(startDir);
    if (gitPath == null) {
        return null;
    }
    try {
        const stat = fs.statSync(gitPath);
        let headDir = gitPath;
        if (stat.isFile()) {
            const content = fs.readFileSync(gitPath, "utf8");
            const m = content.match(/^gitdir:\s*(.+?)\s*$/m);
            if (m == null) {
                return null;
            }
            headDir = path.resolve(path.dirname(gitPath), m[1].trim());
        }
        const head = fs.readFileSync(path.join(headDir, "HEAD"), "utf8").trim();
        const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        if (refMatch != null) {
            return refMatch[1];
        }
        return head.length > 0 ? head.slice(0, 12) : null;
    } catch {
        return null;
    }
}

function findGitDir(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (;;) {
        if (fs.existsSync(path.join(dir, ".git"))) {
            return path.join(dir, ".git");
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}
