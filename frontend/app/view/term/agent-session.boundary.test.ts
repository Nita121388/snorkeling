import { describe, expect, it } from "vitest";
import { extractAgentCommandFromTerminalText, resolveAgentCommandBinding, resolveAgentSessionId } from "./agent-session";

describe("boundary: 手动输入 agent 命令的识别现状", () => {
    it("裸 pi 能识别为绑定", () => {
        expect(resolveAgentCommandBinding("pi")).toEqual({ provider: "pi", sessionId: "" });
    });
    it("pi 带参数能识别", () => {
        expect(resolveAgentCommandBinding("pi --model claude-sonnet-4-5")).toEqual({
            provider: "pi",
            sessionId: "",
        });
    });
    it("路径形式 pi 能识别", () => {
        expect(resolveAgentCommandBinding("/opt/homebrew/bin/pi")).toEqual({
            provider: "pi",
            sessionId: "",
        });
    });
    it("cd && pi 能识别", () => {
        expect(resolveAgentCommandBinding("cd repo && pi")).toEqual({ provider: "pi", sessionId: "" });
    });
    it("sudo pi 目前不能识别（候选 B 缺口）", () => {
        expect(resolveAgentCommandBinding("sudo pi")).toBeNull();
    });
    it("npx pi 目前不能识别（wrapper 缺口，暂不修）", () => {
        expect(resolveAgentCommandBinding("npx pi")).toBeNull();
    });
    it("uvx pi 目前不能识别（wrapper 缺口）", () => {
        expect(resolveAgentCommandBinding("uvx pi")).toBeNull();
    });
    it("gemini 裸命令目前不能识别（候选 B 缺口）", () => {
        expect(resolveAgentCommandBinding("gemini")).toBeNull();
    });
    it("codex/claude/opencode 裸命令能识别", () => {
        expect(resolveAgentCommandBinding("codex")).toEqual({ provider: "codex", sessionId: "" });
        expect(resolveAgentCommandBinding("claude")).toEqual({ provider: "claude", sessionId: "" });
        expect(resolveAgentCommandBinding("opencode")).toEqual({ provider: "opencode", sessionId: "" });
    });
    it("env 前缀 pi 能识别", () => {
        expect(resolveAgentCommandBinding("env PI_HOME=/tmp pi")).toEqual({
            provider: "pi",
            sessionId: "",
        });
    });
    it("extractAgentCommandFromTerminalText 对裸 pi（无 sessionId）找不到命令（兜底绑定缺口）", () => {
        const text = ["nita@host ~/repo", "$ pi", "Welcome to Pi Coding Agent"].join("\n");
        expect(extractAgentCommandFromTerminalText(text)).toBe("");
    });
    it("extractAgentCommandFromTerminalText 对 resume 命令能找到", () => {
        const text = ["nita@host ~/repo", "$ pi resume abc123", "Welcome"].join("\n");
        expect(extractAgentCommandFromTerminalText(text)).toBe("pi resume abc123");
    });
    it("isAgentTerminalMeta 语义：无 meta 的 shell block 不被视为 agent（即使 scrollback 有 pi）", () => {
        // shell block 无 agent meta → resolveAgentSessionId(meta) 全空 → isAgent=false
        const resolution = resolveAgentSessionId({});
        expect(resolution.isAgent).toBe(false);
        expect(resolution.sessionId).toBe("");
    });
});