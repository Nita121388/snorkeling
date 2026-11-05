// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dirUrl = new URL("./", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dirUrl), "utf8");

const panelFiles = readdirSync(dirUrl)
    .filter((name) => name.startsWith("vcs-") && name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .sort();

/** 曾经用「纯文字 + 下划线」表达的 17 处动作按钮。这些 JSX 文本不允许再出现。 */
const LEGACY_TEXT_BUTTONS = [
    "Diff",
    "History",
    "Select All",
    "Select None",
    "Reset",
    "Apply",
    "Prev",
    "Next",
    "View Diff",
    "Refresh",
    "Create & Switch",
    "Update",
    "Pull",
    "Push",
    "Fetch",
];

function jsxChildrenOfButtons(source: string): string[] {
    const out: string[] = [];
    const openTag = /<button\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = openTag.exec(source)) != null) {
        const start = m.index + m[0].length;
        const end = source.indexOf("</button>", start);
        if (end < 0) continue;
        out.push(source.slice(start, end).replace(/<[^>]*>/g, ""));
    }
    return out;
}

describe("VCS 面板文字按钮图标化", () => {
    it("扫到全部面板文件（防止改名后测试空跑）", () => {
        expect(panelFiles.length).toBeGreaterThanOrEqual(5);
        expect(panelFiles).toContain("vcs-icon-button.tsx");
    });

    it("不再用裸文字表达动作按钮", () => {
        for (const file of panelFiles) {
            const source = read(file);
            for (const body of jsxChildrenOfButtons(source)) {
                const text = body.replace(/\{[^}]*\}/g, " ").trim();
                if (text === "") continue;
                for (const legacy of LEGACY_TEXT_BUTTONS) {
                    expect(text, `${file} 的 button 里还有文字 ${JSON.stringify(legacy)}`).not.toBe(legacy);
                }
            }
        }
    });

    it("旧的两套文字按钮样式已清空", () => {
        for (const file of panelFiles) {
            const source = read(file);
            for (const tag of source.match(/<button\b[^>]*>/g) ?? []) {
                expect(tag, `${file} 仍在使用会渲染成下划线链接的按钮样式`).not.toMatch(
                    /text-\[11px\] text-accent hover:underline/
                );
            }
            expect(source, `${file} 仍在使用未定义的 iconbutton class`).not.toMatch(/className="iconbutton/);
        }
    });

    it("每个 VcsIconButton 都带 title（同时用作 aria-label）", () => {
        let checked = 0;
        for (const file of panelFiles) {
            if (file === "vcs-icon-button.tsx") continue;
            const source = read(file);
            const openTag = /<VcsIconButton\b/g;
            let m: RegExpExecArray | null;
            while ((m = openTag.exec(source)) != null) {
                const start = m.index;
                const selfClose = source.indexOf("/>", start);
                expect(selfClose, `${file} 的 VcsIconButton 未自闭合，无法校验`).toBeGreaterThan(0);
                const tag = source.slice(start, selfClose);
                expect(tag, `${file} 的 VcsIconButton 缺少 title`).toMatch(/\btitle=/);
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThanOrEqual(15);
    });

    it("VcsIconButton 只用真实存在的主题 token", () => {
        const source = read("vcs-icon-button.tsx");
        for (const fake of ["text-danger", "text-ok", "text-ink", "text-detail"]) {
            expect(source, `tailwindsetup.css 里没有 ${fake}，写上去是死样式`).not.toMatch(
                new RegExp(`["\\s]${fake}["\\s]`)
            );
        }
        expect(source).toMatch(/aria-label=\{title\}/);
        expect(source).toMatch(/focus-visible:opacity-100/);
    });
});
