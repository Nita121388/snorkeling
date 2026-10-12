// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * overlay 样式契约（parity-harness 切片 1）。
 *
 * 不变量（R3 编辑态 ≡ 预览态）：`.inline-edit-overlay` 作用域**只允许加供能性样式**
 * （caret / selection / hover / focus-visible / cursor / 布局包裹），
 * **不得**声明结构性样式（padding / border / background / font-\* / margin / line-height 等）。
 *
 * 为什么需要这条门禁：编辑态曾经"手工镜像"了一份渲染器样式
 * （`&[data-block-kind="code"] pre.codeblock { padding…border-radius… }`，连 hljs 配色都抄了一份），
 * 于是渲染器一改，编辑态就跟不上 —— 这正是 10-08 `callout` 标题竖排修复"实际没生效"的同类漂移。
 *
 * 本测试把现存的 B 类（结构性镜像）**逐条登记为台账**（带 reason 与 todo）：
 * 新增未登记的结构性声明 → 直接失败；台账条目消失 → 也失败（防止台账膨胀或失真）。
 * 台账里 todo="parity-2" 的条目 = 切片 2 要**移除**的对象（移除后同步删台账条目）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCSS_PATH = fileURLToPath(new URL("./markdown.scss", import.meta.url));
const OVERLAY_ROOT_SELECTOR = /^\.inline-edit-overlay\s*\{/;

/** 结构性属性：出现在 overlay 作用域即视为「镜像预览样式」，必须登记。 */
const STRUCTURAL_PROPS = new Set([
    "padding",
    "padding-top",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "margin",
    "margin-top",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "border",
    "border-top",
    "border-bottom",
    "border-left",
    "border-right",
    "border-radius",
    "border-color",
    "border-width",
    "background",
    "background-color",
    "color",
    "font",
    "font-size",
    "font-family",
    "font-weight",
    "font-variant-ligatures",
    "font-variant-numeric",
    "line-height",
    "height",
    "min-height",
    "max-height",
    "width",
    "min-width",
    "max-width",
    "box-sizing",
    "display",
    "overflow",
    "overflow-wrap",
    "word-break",
    "resize",
    "tab-size",
]);

/** 供能性属性：caret / 选区 / hover / 焦点可视 / 指针 —— 编辑态**应当**加的东西。 */
const AFFORDANCE_PROPS = new Set([
    "caret-color",
    "outline",
    "outline-offset",
    "cursor",
    "user-select",
    "accent-color",
    "pointer-events",
    "position",
    "top",
    "left",
    "right",
    "bottom",
    "z-index",
    "transition",
    "visibility",
    "white-space",
    "text-align",
    "opacity",
]);

type Row = { line: number; prop: string; scope: string; text: string; cls: "A" | "B" | "C" };

function extractOverlayRows(src: string): Row[] {
    const lines = src.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (OVERLAY_ROOT_SELECTOR.test(lines[i].trim())) {
            start = i;
            break;
        }
    }
    if (start < 0) {
        return [];
    }
    let depth = 0;
    let end = lines.length - 1;
    for (let i = start; i < lines.length; i++) {
        depth += (lines[i].match(/\{/g)?.length ?? 0) - (lines[i].match(/\}/g)?.length ?? 0);
        if (depth === 0 && i > start) {
            end = i;
            break;
        }
    }
    const stack: string[] = [];
    const rows: Row[] = [];
    for (let i = start; i <= end; i++) {
        const text = lines[i].trim();
        if (text.endsWith("{") && !text.startsWith("@")) {
            stack.push(text.slice(0, -1).trim() || "(inline)");
            continue;
        }
        if (text === "}") {
            stack.pop();
            continue;
        }
        const m = /^([a-z-]+)\s*:/.exec(text);
        if (!m) {
            continue;
        }
        const prop = m[1];
        const scope = stack.join(" ");
        let cls: Row["cls"];
        if (scope.includes("inline-edit-textarea")) {
            cls = "C"; // textarea 回退路径：天然无法与预览像素一致，单独成组
        } else if (/(:hover|:focus-visible|:focus|:active|::selection)/.test(scope)) {
            cls = "A";
        } else if (STRUCTURAL_PROPS.has(prop)) {
            cls = "B";
        } else {
            cls = "A";
        }
        rows.push({ line: i + 1, prop, scope, text, cls });
    }
    return rows;
}

/**
 * B 类台账（现存的结构性镜像）。每条必须有 reason；todo="parity-2" 表示切片 2 移除。
 * 由 `research/overlay-structural-inventory.json` 生成，人工复核后维护。
 */
const KNOWN_STRUCTURAL_MIRRORS: { scope: string; prop: string; reason: string; todo: "keep" | "parity-2" }[] = [
    { scope: ".inline-edit-overlay", prop: "box-sizing", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "min-width", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "max-width", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "overflow", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"wysiwyg\"]", prop: "background", reason: "WYSIWYG 编辑态背景覆盖（背景应由渲染器/宿主决定）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "width", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "min-width", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "max-width", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "box-sizing", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "margin-left", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "margin-right", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "overflow-wrap", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "word-break", reason: "编辑容器内元素 margin/宽度归零（抑制预览排版）→ 待移除或收敛为编辑期必要项", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "box-sizing", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "width", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "height", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "margin", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "padding", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "border-radius", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "background-color", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "overflow", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "display", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "min-height", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "padding", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "background", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "font-family", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "font-size", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "line-height", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "overflow", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "font-variant-ligatures", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "tab-size", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-header", prop: "height", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-header", prop: "display", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "height", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "padding", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "border", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "border-radius", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "background", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "color", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "font", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-ops", prop: "display", reason: "code 块编辑态镜像了渲染器样式（padding/radius/bg/字体）→ 待移除", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-quote", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-doctag", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-meta .hljs-string", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-bullet", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-name", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-template-variable", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-class .hljs-title", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .hljs-deletion", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.language-diff .hljs-addition *", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.language-diff .hljs-addition *", prop: "background-color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.language-diff .hljs-deletion *", prop: "color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.language-diff .hljs-deletion *", prop: "background-color", reason: "code 块编辑态逐个抄了 hljs 语法高亮配色 → 待移除（让渲染器样式自然生效）", todo: "parity-2" },
];

function toKey(scope: string, prop: string): string {
    return `${scope}::${prop}`;
}

describe("overlay 样式契约：编辑态只允许加供能性样式", () => {
    const rows = extractOverlayRows(readFileSync(SCSS_PATH, "utf8"));

    it("扫描面非空（防止选择器改名后门禁空转）", () => {
        expect(rows.length).toBeGreaterThan(50);
        expect(rows.some((r) => r.cls === "B")).toBe(true);
    });

    it("新增的结构性声明必须登记台账（未登记即失败 = 拦住未来漂移）", () => {
        const registered = new Set(KNOWN_STRUCTURAL_MIRRORS.map((e) => toKey(e.scope, e.prop)));
        const unregistered = rows
            .filter((r) => r.cls === "B" && !registered.has(toKey(r.scope, r.prop)))
            .map((r) => `markdown.scss:${r.line} ${r.prop} ← ${r.scope}\n    ${r.text}`);
        expect(
            unregistered,
            `overlay 里出现未登记的结构性样式（编辑态不得镜像预览样式）：\n${unregistered.join("\n")}`
        ).toEqual([]);
    });

    it("台账每条都有 reason 与 todo（keep | parity-2）", () => {
        const bad = KNOWN_STRUCTURAL_MIRRORS.filter(
            (e) => !e.reason || e.reason.trim().length < 8 || !["keep", "parity-2"].includes(e.todo)
        ).map((e) => toKey(e.scope, e.prop));
        expect(bad, `台账条目缺少 reason/todo：${bad.join(", ")}`).toEqual([]);
    });

    it("台账不得残留已消失的条目（保持台账 = 真实清单）", () => {
        const found = new Set(rows.filter((r) => r.cls === "B").map((r) => toKey(r.scope, r.prop)));
        const stale = KNOWN_STRUCTURAL_MIRRORS.filter((e) => !found.has(toKey(e.scope, e.prop))).map((e) =>
            toKey(e.scope, e.prop)
        );
        expect(stale, `台账里这些条目在 scss 中已不存在，请删除：${stale.join(", ")}`).toEqual([]);
    });

    it("textarea 回退路径单独成组（不与块编辑态混算）", () => {
        const c = rows.filter((r) => r.cls === "C");
        expect(c.length).toBeGreaterThan(5);
        // textarea 的样式不得泄漏到非 textarea 作用域
        const leaked = rows.filter((r) => r.cls !== "C" && r.scope.includes("textarea"));
        expect(leaked).toEqual([]);
    });
});
