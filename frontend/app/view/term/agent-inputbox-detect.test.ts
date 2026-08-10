// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { detectAgentInputBox, type AgentInputBoxDetectionInput } from "./agent-inputbox-detect";

function detect(overrides: Partial<AgentInputBoxDetectionInput> = {}): ReturnType<typeof detectAgentInputBox> {
    return detectAgentInputBox({
        isAgentBlock: true,
        bufferType: "alternate",
        lastLines: ["line above 1", "line above 2", "❯ input"],
        cursorX: 3,
        cursorY: 2,
        lastCommand: "codex",
        ...overrides,
    });
}

describe("detectAgentInputBox — composer 识别", () => {
    it("识别 Codex composer（alt-buffer + ❯ 提示符）", () => {
        const hint = detect({
            bufferType: "alternate",
            lastLines: ["  ✦ fix bug in parser", "", "❯ "],
            cursorX: 2,
            cursorY: 2,
            lastCommand: "codex",
        });
        expect(hint.kind).toBe("composer");
        if (hint.kind === "composer") {
            expect(hint.prompt).toBe("❯");
            expect(hint.cursorX).toBe(2);
        }
    });

    it("识别 Gemini composer（alt-buffer + › 提示符）", () => {
        const hint = detect({
            bufferType: "alternate",
            lastLines: ["  ✦ refactor module", "", "› "],
            cursorX: 1,
            cursorY: 2,
            lastCommand: "gemini",
        });
        expect(hint.kind).toBe("composer");
    });

    it("非 agent block 一律不判", () => {
        const hint = detect({ isAgentBlock: false });
        expect(hint.kind).toBe("none");
    });

    it("无 buffer 行时不判", () => {
        const hint = detect({ lastLines: [] });
        expect(hint.kind).toBe("none");
    });
});

describe("detectAgentInputBox — permission 识别", () => {
    it("识别 Claude `?` 权限提问", () => {
        const hint = detect({
            lastLines: ["  let's update the file", "? Allow this command? (y/n)", ""],
            cursorY: 1,
            lastCommand: "claude",
        });
        expect(hint.kind).toBe("permission");
        if (hint.kind === "permission") {
            expect(hint.prompt).toContain("Allow this command");
        }
    });

    it("识别含 permission 关键词的提问行", () => {
        const hint = detect({
            lastLines: ["", "Do you want to proceed? [Y/n]", ""],
            cursorY: 1,
            lastCommand: "codex",
        });
        expect(hint.kind).toBe("permission");
    });
});

describe("detectAgentInputBox — 抑制（防误判）", () => {
    it("less 全屏程序（lastCommand 命中白名单）不判", () => {
        const hint = detect({
            bufferType: "alternate",
            lastLines: ["  some doc content", "(END)", ""],
            cursorY: 1,
            lastCommand: "less",
        });
        expect(hint.kind).toBe("none");
    });

    it("vim 全屏程序不判", () => {
        const hint = detect({
            bufferType: "alternate",
            lastLines: ["~", "~", "  main.ts  1,1  All"],
            cursorY: 2,
            lastCommand: "vim",
        });
        expect(hint.kind).toBe("none");
    });

    it("普通 shell 提示符（$ 结尾）不判", () => {
        const hint = detect({
            bufferType: "normal",
            lastLines: ["cd /tmp", "nita@mac ~ $ ", ""],
            cursorY: 1,
            lastCommand: "zsh",
        });
        expect(hint.kind).toBe("none");
    });

    it("普通 shell 提示符（% 结尾）不判", () => {
        const hint = detect({
            bufferType: "normal",
            lastLines: ["", "nita@mac ~ % ", ""],
            cursorY: 1,
            lastCommand: "zsh",
        });
        expect(hint.kind).toBe("none");
    });

    it("非 alt-buffer 且无明确提示符的普通输出不判", () => {
        const hint = detect({
            bufferType: "normal",
            lastLines: ["  build complete", "  ✓ 42 tests passed", "  next"],
            cursorY: 2,
            lastCommand: "codex",
        });
        expect(hint.kind).toBe("none");
    });
});
