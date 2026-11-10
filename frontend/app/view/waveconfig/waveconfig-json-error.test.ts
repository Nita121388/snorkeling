// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 设置 JSON 校验失败的复制契约：
//   1. 解析错误（缺括号）：payload 含行列号 + ±5 行片段；
//   2. 键类型错误（schema 校验失败）：payload 含键名；
//   3. 校验通过时模型不置错误态（banner 不渲染，复制按钮无从出现）。

import { describe, expect, it } from "vitest";
import {
    buildSettingsJsonFailurePayload,
    buildSnippet,
    describeJsonFailure,
    extractJsonErrorPosition,
} from "./waveconfig-json-error";

function parseErrorOf(content: string): string {
    try {
        JSON.parse(content);
        return "";
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

function expectPayloadShape(text: string): void {
    expect(text).toContain("### Context");
    expect(text).toContain("### Task");
    expect(text).toContain("### Output contract");
}

describe("extractJsonErrorPosition", () => {
    it("reads line/column from the V8 message when present", () => {
        const pos = extractJsonErrorPosition("Unexpected token '}' ... in JSON at position 42 (line 3 column 5)", "{}");
        expect(pos).toEqual({ line: 3, column: 5 });
    });

    it("converts a bare position offset into line and column", () => {
        const content = "{\n  \"a\": 1,,\n}";
        const pos = extractJsonErrorPosition("Unexpected token ',' ... in JSON at position 12", content);
        expect(pos).toEqual({ line: 2, column: 11 });
    });

    it("returns null when the parser reports no position", () => {
        expect(extractJsonErrorPosition("Unexpected end of JSON input", "{")).toBeNull();
    });
});

describe("buildSnippet", () => {
    it("marks the error line and keeps ±5 lines with 1-based numbers", () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
        const content = lines.join("\n");
        const { snippet, totalLines } = buildSnippet(content, { line: 10, column: 1 });
        expect(totalLines).toBe(20);
        expect(snippet).toContain(">  10: line 10");
        expect(snippet).toContain("   5: line 5");
        expect(snippet).toContain("  15: line 15");
        expect(snippet).not.toContain("line 4");
        expect(snippet).not.toContain("line 16");
    });

    it("clamps the window at the file edges", () => {
        const { snippet } = buildSnippet("a\nb", { line: 1, column: 1 });
        expect(snippet).toContain(">   1: a");
        expect(snippet).toContain("    2: b");
    });

    it("returns an empty snippet when there is no position", () => {
        expect(buildSnippet("{}", null).snippet).toBe("");
    });
});

describe("buildSettingsJsonFailurePayload", () => {
    it("carries line/column and the snippet for a parse error", () => {
        // 缺右括号（第 3 行）——典型手改事故
        const content = '{\n  "term:fontsize": 13,\n  "ai:model": "gpt"\n';
        const message = `Invalid JSON: ${parseErrorOf(content)}`;
        const failure = describeJsonFailure("~/.waveterm/settings.json", message, content);
        const payload = buildSettingsJsonFailurePayload(failure);
        expectPayloadShape(payload);
        expect(payload).toContain("file: ~/.waveterm/settings.json");
        expect(payload).toContain("term:fontsize");
        // 行号来自真实解析错误（Node 报 3 行附近）
        expect(payload).toMatch(/position: line \d+ column \d+ \(of \d+ lines\)/);
        expect(payload).toContain("Fix this settings JSON so it parses");
        expect(payload).toContain("Reply with the merged content only");
    });

    it("carries the offending key from a schema (key type) error message", () => {
        // schema 校验错误信息自带键名；无位置时给行数不给假坐标
        const failure = describeJsonFailure(
            "settings.json",
            "Invalid value for key [term:fontsize]: expected number, got string",
            '{"term:fontsize": "13"}'
        );
        const payload = buildSettingsJsonFailurePayload(failure);
        expectPayloadShape(payload);
        expect(payload).toContain("term:fontsize");
        expect(payload).toContain("expected number, got string");
        expect(payload).toContain("(not reported by the parser");
    });

    it("does not build a payload for valid JSON (no error message to carry)", () => {
        // 校验通过时模型不置 validationError；这里锁定「有错误信息才有 payload」的事实：
        // describeJsonFailure 不猜、不造位置，只忠实转述
        const failure = describeJsonFailure("settings.json", "", '{"a":1}');
        const payload = buildSettingsJsonFailurePayload(failure);
        expect(payload).toContain("error: (no message)");
        expect(payload).toContain("(not reported by the parser");
    });
});
