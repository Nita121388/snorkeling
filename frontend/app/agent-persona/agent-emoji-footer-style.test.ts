// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Emoji picker footer 样式一致性锁 —— 「三个勾选框样式不一致」这条 bug 的回归判据。
//
// 为什么是读 SCSS 而不是渲染测：footer 里 radio 行（.agent-emoji-scope-option）和
// 「仅显示 Emoji」checkbox 行原本分属两套（甚至一套根本没写 CSS），真机 DOM 测只有
// 打开 picker 才能跑到；而「类名在 JSX 里用了、样式表里没有定义」这种割裂，静态对齐
// 一抓一个准。基准是 agent-persona.scss（footer 样式的唯一真身，见文件头注释）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

function read(rel: string): string {
    return readFileSync(path.join(repoRoot, rel), "utf8");
}

/** 取出包含 `anchor` 的那条规则块（到配平的 `}` 为止），保留原文以便断言。 */
function ruleBlock(scss: string, anchor: string): string {
    const at = scss.indexOf(anchor);
    expect(at, `找不到规则锚点: ${anchor}`).toBeGreaterThanOrEqual(0);
    const open = scss.indexOf("{", at);
    expect(open, `锚点后没有规则块: ${anchor}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = open; i < scss.length; i++) {
        if (scss[i] === "{") depth++;
        else if (scss[i] === "}") {
            depth--;
            if (depth === 0) return scss.slice(open, i + 1);
        }
    }
    throw new Error(`规则块未配平: ${anchor}`);
}

const SCSS = "frontend/app/agent-persona/agent-persona.scss";
const TSX = "frontend/app/view/term/agent-emoji-picker.tsx";

const FOOTER_CLASSES = [
    "agent-emoji-picker-footer",
    "agent-emoji-scope",
    "agent-emoji-scope-option",
    "agent-emoji-scope-note",
    "agent-emoji-display-row",
    "agent-emoji-display-toggle",
    "agent-emoji-display-hint",
    "agent-emoji-reset",
] as const;

describe("agent emoji picker footer style lock", () => {
    it("every class used by the footer has a style definition", () => {
        const scss = read(SCSS);
        for (const cls of FOOTER_CLASSES) {
            expect(
                scss.includes(`.${cls}`),
                `agent-persona.scss 缺少 .${cls} 的样式定义 —— JSX 用了它却没有样式，会退化成浏览器默认外观`
            ).toBe(true);
        }
    });

    it("the emoji-only checkbox row reuses the radio row styling", () => {
        const tsx = read(TSX);
        // checkbox 行必须复用 radio 行的 .agent-emoji-scope-option，否则两行视觉割裂。
        expect(tsx).toContain('className={cn("agent-emoji-scope-option", "agent-emoji-display-toggle")}');
    });

    it("radio and checkbox inputs share one fixed 13px box", () => {
        const block = ruleBlock(read(SCSS), ".agent-emoji-scope-option input");
        expect(block).toContain("width: 13px");
        expect(block).toContain("height: 13px");
        expect(block).toContain("accent-color: var(--accent-color");
    });

    it("the display hint shares the scope-note rule block (same typography)", () => {
        const block = ruleBlock(read(SCSS), ".agent-emoji-scope-note,\n.agent-emoji-display-hint");
        expect(block).toContain("font-size: 10px");
    });

    it("footer rows stack with one shared rhythm", () => {
        const footer = ruleBlock(read(SCSS), ".agent-emoji-picker-footer");
        expect(footer).toContain("flex-direction: column");
    });
});
