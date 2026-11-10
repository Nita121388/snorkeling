// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// VCS/冲突域 Copy for Agent 契约：
//   1. buildConflictCopyText —— 双 diff 结构保留，但收口到三段式（含 Task / Output contract）；
//   2. buildVcsOperationFailurePayload —— stderr 截断 200 行 + 证据字段；
//   3. buildMergeConflictsPayload —— 冲突标记片段 ±3 行、多文件分段、无标记时 throw；
//   4. isUnmergedCode —— git porcelain unmerged 状态码。

import { describe, expect, it } from "vitest";
import {
    buildConflictCopyText,
    buildMergeConflictsPayload,
    buildVcsOperationFailurePayload,
    extractConflictSegments,
    isUnmergedCode,
    MERGE_SEGMENT_MAX_LINES,
    VCS_STDERR_MAX_LINES,
} from "./conflict-copy";

function expectPayloadShape(text: string): void {
    expect(text).toContain("### Context");
    expect(text).toContain("### Task");
    expect(text).toContain("### Output contract");
}

describe("buildConflictCopyText (migrated to the shared contract)", () => {
    it("keeps both diff hunks and now carries Task + Output contract", () => {
        const base = "# Hello\n- first\n- second";
        const mine = "# Hello\n- first\n- second\n- third";
        const theirs = "# Hello\n- first\n- agent second";
        const text = buildConflictCopyText("test.md", base, mine, theirs);
        expectPayloadShape(text);
        expect(text).toContain("File conflict: test.md");
        expect(text).toContain("== Your unsaved changes (base → your draft) ==");
        expect(text).toContain("== External changes (base → current disk) ==");
        expect(text).toContain("+- third");
        expect(text).toContain("+- agent second");
        expect(text).toContain("Reply with the merged content only");
    });
});

describe("isUnmergedCode", () => {
    it("recognises git porcelain unmerged codes", () => {
        for (const code of ["UU", "AA", "DD", "AU", "UA", "DU", "UD"]) {
            expect(isUnmergedCode(code)).toBe(true);
        }
    });

    it("does not mistake ordinary changes for conflicts", () => {
        for (const code of ["M", "A", "D", "??", "R", ""]) {
            expect(isUnmergedCode(code)).toBe(false);
        }
    });
});

describe("buildVcsOperationFailurePayload", () => {
    it("carries action, repo, error and the stderr body", () => {
        const text = buildVcsOperationFailurePayload({
            action: "push",
            repoPath: "/repo",
            message: "Push failed.",
            details: "remote: error: GH006: Protected branch update failed\n! [remote rejected] main -> main",
        });
        expectPayloadShape(text);
        expect(text).toContain("action: push");
        expect(text).toContain("repo: /repo");
        expect(text).toContain("error: Push failed.");
        expect(text).toContain("remote: error: GH006");
        expect(text).toContain("Diagnose why the git operation failed");
    });

    it("truncates stderr at 200 lines and keeps the tail", () => {
        const details = Array.from({ length: 300 }, (_, i) => `err line ${i}`).join("\n");
        const text = buildVcsOperationFailurePayload({ action: "commit", repoPath: "/r", message: "failed", details });
        expect(text).toContain(`full output: 300 lines`);
        expect(text).toContain(`err line 299`);
        expect(text).not.toContain("err line 0\n");
        const kept = text.split("\n").filter((line) => line.startsWith("  err line"));
        expect(kept.length).toBe(VCS_STDERR_MAX_LINES);
    });
});

describe("extractConflictSegments", () => {
    const conflicted = [
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "<<<<<<< HEAD",
        "ours line",
        "=======",
        "theirs line",
        ">>>>>>> feature",
        "tail 1",
        "tail 2",
        "tail 3",
        "tail 4",
    ].join("\n");

    it("keeps the conflict block with three lines of context on both sides", () => {
        const out = extractConflictSegments(conflicted);
        expect(out).toContain("<<<<<<< HEAD");
        expect(out).toContain("ours line");
        expect(out).toContain("=======");
        expect(out).toContain("theirs line");
        expect(out).toContain(">>>>>>> feature");
        // 3 行上下文：line 2/3/4 与 tail 1/2/3
        expect(out).toContain("line 2");
        expect(out).toContain("tail 3");
        expect(out).not.toContain("line 1\n");
        expect(out).not.toContain("tail 4");
    });

    it("returns empty when there are no conflict markers", () => {
        expect(extractConflictSegments("no conflicts here")).toBe("");
    });
});

describe("buildMergeConflictsPayload", () => {
    const fileA = [
        "header",
        "<<<<<<< HEAD",
        "a ours",
        "=======",
        "a theirs",
        ">>>>>>> main",
    ].join("\n");

    it("renders one section per file with the unresolved marker content", () => {
        const text = buildMergeConflictsPayload([
            { path: "src/a.ts", content: fileA },
            {
                path: "src/b.ts",
                content: "<<<<<<< HEAD\nb ours\n=======\nb theirs\n>>>>>>> main",
            },
        ]);
        expectPayloadShape(text);
        expect(text).toContain("=== src/a.ts ===");
        expect(text).toContain("=== src/b.ts ===");
        expect(text).toContain("<<<<<<< HEAD");
        expect(text).toContain(">>>>>>> main");
        expect(text).toContain("2 file(s) with unresolved merge conflicts");
        expect(text).toContain("Reply with the merged content only");
    });

    it("caps a single file's segment length", () => {
        const big =
            "<<<<<<< HEAD\n" +
            Array.from({ length: MERGE_SEGMENT_MAX_LINES + 20 }, (_, i) => `line ${i}`).join("\n") +
            "\n=======\ntheirs\n>>>>>>> main";
        const text = buildMergeConflictsPayload([{ path: "big.ts", content: big }]);
        expect(text).toContain("… (truncated, this file has");
    });

    it("throws instead of producing a payload with no evidence", () => {
        expect(() => buildMergeConflictsPayload([{ path: "clean.ts", content: "no markers" }])).toThrow(
            /no conflict markers/
        );
    });
});
