// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 终端失败复制契约：
//   1. 三态判定：失败显示，成功（exit 0）/ 运行中 / 非 cmd 块不显示；
//   2. ANSI 剥离（颜色码 / 清屏 / OSC 标题）；
//   3. 截断：>N 行时保留末 N 行 + 头部标注总行数，N 钳制到 200；
//   4. payload 三段式 + 证据字段（command / cwd / exit code / 输出行）。

import { describe, expect, it } from "vitest";
import {
    buildTermFailurePayload,
    shouldShowTermFailureCopy,
    stripAnsi,
    tailOutputLines,
    TERM_FAILURE_MAX_LINES,
} from "./agent-failure-copy";

const failedStatus = (exitCode: number): BlockControllerRuntimeStatus =>
    ({ shellprocstatus: "done", shellprocexitcode: exitCode }) as BlockControllerRuntimeStatus;
const runningStatus: BlockControllerRuntimeStatus = {
    shellprocstatus: "running",
    shellprocexitcode: 0,
} as BlockControllerRuntimeStatus;
const cmdMeta = { controller: "cmd", "cmd:args": ["npm", "test"], "cmd:cwd": "/repo" };

describe("shouldShowTermFailureCopy", () => {
    it("shows only for a finished cmd block with a non-zero exit code", () => {
        expect(shouldShowTermFailureCopy(cmdMeta, failedStatus(1))).toBe(true);
        expect(shouldShowTermFailureCopy(cmdMeta, failedStatus(127))).toBe(true);
    });

    it("hides for success, running, and non-cmd blocks", () => {
        expect(shouldShowTermFailureCopy(cmdMeta, failedStatus(0))).toBe(false);
        expect(shouldShowTermFailureCopy(cmdMeta, runningStatus)).toBe(false);
        expect(shouldShowTermFailureCopy(cmdMeta, null)).toBe(false);
        expect(shouldShowTermFailureCopy({ controller: "ssh" }, failedStatus(1))).toBe(false);
        expect(shouldShowTermFailureCopy(undefined, failedStatus(1))).toBe(false);
    });
});

describe("stripAnsi", () => {
    it("removes SGR color codes", () => {
        expect(stripAnsi("\x1b[31mERROR\x1b[0m: boom")).toBe("ERROR: boom");
        expect(stripAnsi("\x1b[1;38;2;255;0;0mbold red\x1b[0m")).toBe("bold red");
    });

    it("removes clear-screen and cursor sequences, and OSC titles", () => {
        expect(stripAnsi("\x1b[2J\x1b[Hclean")).toBe("clean");
        expect(stripAnsi("\x1b[5Bdown then text")).toBe("down then text");
        expect(stripAnsi("\x1b]0;title\x07after")).toBe("after");
        expect(stripAnsi("\x1b]0;title\x1b\\after")).toBe("after");
    });
});

describe("tailOutputLines", () => {
    it("keeps the last N lines and reports the total", () => {
        const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
        const tail = tailOutputLines(text, 40);
        expect(tail.lines.length).toBe(40);
        expect(tail.total).toBe(100);
        expect(tail.truncated).toBe(true);
        expect(tail.lines[0]).toBe("line 60");
        expect(tail.lines[39]).toBe("line 99");
    });

    it("clamps N to the hard cap", () => {
        const text = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
        const tail = tailOutputLines(text, 5000);
        expect(tail.lines.length).toBe(TERM_FAILURE_MAX_LINES);
        expect(tail.truncated).toBe(true);
    });

    it("does not truncate when output fits", () => {
        const tail = tailOutputLines("a\nb\nc", 40);
        expect(tail.truncated).toBe(false);
        expect(tail.lines).toEqual(["a", "b", "c"]);
    });
});

describe("buildTermFailurePayload", () => {
    it("carries command, cwd, exit code, output, Task, and the output contract", () => {
        const payload = buildTermFailurePayload({
            command: "npm run build",
            cwd: "/repo/app",
            exitCode: 1,
            output: "\x1b[31merror\x1b[0m TS2304: cannot find name",
        });
        expect(payload).toContain("command: npm run build");
        expect(payload).toContain("cwd: /repo/app");
        expect(payload).toContain("exit code: 1");
        expect(payload).toContain("error TS2304: cannot find name");
        expect(payload).toContain("### Task");
        expect(payload).toContain("### Output contract");
        expect(payload).toContain("Diagnose why this command failed");
        expect(payload).toContain("exact command(s) to run");
    });

    it("annotates truncation with the full scrollback size and keeps only the tail", () => {
        const lines = Array.from({ length: 60 }, (_, i) => `out ${i}`).join("\n");
        const payload = buildTermFailurePayload({
            command: "make",
            cwd: "/src",
            exitCode: 2,
            output: lines,
            maxLines: 10,
        });
        expect(payload).toContain("… (truncated, full scrollback: 60 lines)");
        expect(payload).toContain("out 59");
        expect(payload).not.toContain("out 5\n");
    });

    it("falls back to explicit unknowns instead of empty fields", () => {
        const payload = buildTermFailurePayload({ command: "", cwd: "", exitCode: 1, output: "" });
        expect(payload).toContain("command: (unknown)");
        expect(payload).toContain("cwd: (unknown)");
    });
});
