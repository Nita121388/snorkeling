// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 性能基准（AC7）：可重复记录，不以肉眼判断。
 *
 * 基准项（PRD R6 / implement.md Phase 4）：
 * 1. 小卡片初始化（单卡内容）；
 * 2. 中等 Markdown 文档初始化（200 行）；
 * 3. 连续输入 100 次（每击键一次 dispatch，累计耗时）；
 * 4. 选区和滚动（需要真实 viewport 测量延迟 —— 这里退化为选区更新耗时）；
 * 5. 提交与销毁（getValue + destroy）。
 *
 * 阈值（首次基线，不以苛刻设fail——先记录，超标仅 warn 不 fail，
 * 避免 CI 抖动造成误报；记录值作为后续迭代对比基线）。
 *
 * 输出：console.warn 打一行 JSON，便于事后提取与对比。
 */

import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";

import { createMarkdownEditor } from "./editor";

function smallCard(): string {
    return "### 今日计划\n\n- [ ] 阅读\n- [x] 锻炼\n\n> 饭前吃水果\n\n见 [[目标链接]] 与 [外部](https://example.com)。";
}

function mediumDoc(): string {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
        lines.push(`## 章节 ${i}`, "", `正文段落 ${i} 包含 **强调** 与 [链接](https://a.b/${i})。`, "", `- 条目 ${i}a`, `- 条目 ${i}b`, "", "");
    }
    return lines.join("\n");
}

function timed(fn: () => void): number {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

describe("性能基准（AC7，首次基线，warn not fail）", () => {
    it("baseline run", () => {
        // warmup：首次 createMarkdownEditor 含 CodeMirror 模块全量加载 + 语法解析器初始化，
        // 这是启动一次性成本，不属“输入延迟”。先跑一轮热身后再计其它基准。
        {
            const parent = document.createElement("div");
            const e = createMarkdownEditor({ parent, value: mediumDoc() });
            e.destroy();
        }

        const results: Record<string, number> = {};

        // 1. 小卡片初始化
        {
            const parent = document.createElement("div");
            results["init-small-card"] = timed(() => {
                const e = createMarkdownEditor({ parent, value: smallCard() });
                e.destroy();
            });
        }
        // 2. 中等文档初始化
        {
            const parent = document.createElement("div");
            results["init-medium-doc"] = timed(() => {
                const e = createMarkdownEditor({ parent, value: mediumDoc() });
                e.destroy();
            });
        }
        // 3. 连续输入 100 次（每次一个字符，真实输入路径）
        {
            const parent = document.createElement("div");
            const editor = createMarkdownEditor({ parent, value: "" });
            let pos = 0;
            const t = timed(() => {
                for (let i = 0; i < 100; i++) {
                    editor.view.dispatch({
                        changes: { from: pos, to: pos, insert: String.fromCharCode(97 + (i % 26)) },
                        selection: EditorSelection.cursor(pos + 1),
                        userEvent: "input",
                    });
                    pos++;
                }
            });
            results["type-100-chars"] = t;
            editor.destroy();
        }
        // 4. 选区更新（光标移动 100 次）
        {
            const parent = document.createElement("div");
            const editor = createMarkdownEditor({ parent, value: mediumDoc() });
            const t = timed(() => {
                for (let i = 0; i < 100; i++) {
                    editor.view.dispatch({
                        selection: EditorSelection.cursor(i * 10),
                        userEvent: "select",
                    });
                }
            });
            results["selection-100-moves"] = t;
            editor.destroy();
        }
        // 5. 提交（getValue）+ 销毁
        {
            const parent = document.createElement("div");
            const editor = createMarkdownEditor({ parent, value: mediumDoc() });
            results["get-value-medium"] = timed(() => editor.getValue());
            results["destroy"] = timed(() => editor.destroy());
        }

        // 打点输出（JSON 一行，方便 grep 与对比）
        console.warn(`[md-codemirror-bench] ${JSON.stringify(results)}`);

        // 首次基线阈值（jsdom 环境比真实浏览器慢 3–10 倍；此处记录为主，
        // 真机基准在 Phase 4 记录到 docs/benchmarks）。超标不 fail，仅打印。
        expect(results["init-small-card"]).toBeLessThan(200); // 小卡 < 200ms（jsdom）
        expect(results["init-medium-doc"]).toBeLessThan(300); // 中档 < 300ms（jsdom）
        expect(results["type-100-chars"]).toBeLessThan(600); // 输入 100 次 < 600ms（jsdom）
    });
});