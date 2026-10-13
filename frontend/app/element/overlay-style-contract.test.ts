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
 *
 * 切片 3（code 簇合并）之后台账里只剩两类条目：
 *  - todo="keep"：**不是镜像**，而是 overlay 盒子的差异项 / 编辑期专属控件 —— 每条都写明理由。
 *  - todo="parity-2"：仍是待消除的镜像（已由 design.md 「真源组合选择器」方案接管，见 markdown.scss 与 implement.md）。
 * code 块的镜像已删：.markdown .content pre.codeblock 与其 token/diff 配色改成一条
 * `真源X, .inline-edit-overlay[data-block-kind="code"] X` 的组合选择器，编辑态不再持有第二份。
 *
 * 切片 4（WYSIWYG prose 簇）把最后 9 条 parity-2 逐条判定完毕，台账里已无 parity-2：
 *  - **删 3 条**：`.wysiwyg-editor…h6` 组的 box-sizing / margin-left / margin-right。它们的真源是全局 reset
 *    （reset.scss 的 `@layer base { * { box-sizing: border-box; margin: 0 } }`，由 app.scss @use 全局加载）；
 *    overlay 经 createPortal 渲染到 document.body，**同样匹配那条 `*` 规则** → 同值、不丢样式，
 *    留着只是第二份可漂移的副本（同切片 3 删 `.codeblock-ops` 的依据）。
 *  - **留 6 条 keep**：`[data-block-kind="wysiwyg"]` 的 background（防穿透）＋ 该组的
 *    width / min-width / max-width（固定宽 portal 盒的盒尺寸兜底）＋ overflow-wrap / word-break
 *    （编辑期折行比预览更激进，**已知与预览 computed 漂移** → 改正需 CDP 沙箱实测换行位置，留给后续切片）。
 * "parity-2" 仍是合法 todo：后续切片（table / quote / heading 簇）还会登记新的待消除镜像。
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
 * B 类台账（现存的结构性声明）。每条必须有 reason；todo="keep" = 已判定为 overlay 自带需求（非镜像），
 * todo="parity-2" = 待消除的镜像。切片 3 删掉了 code 簇的 24 条镜像条目（真源改为组合选择器后的必然结果）；
 * 切片 4 删掉了 wysiwyg 簇的 3 条 reset 重复声明（box-sizing / margin-left / margin-right）。
 * 由 `research/overlay-structural-inventory.json` 生成，人工复核后维护。
 */
const KNOWN_STRUCTURAL_MIRRORS: { scope: string; prop: string; reason: string; todo: "keep" | "parity-2" }[] = [
    { scope: ".inline-edit-overlay", prop: "box-sizing", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "min-width", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "max-width", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay", prop: "overflow", reason: "overlay 容器自身布局（编辑期包裹层，非块内容）→ 允许但登记", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"wysiwyg\"]", prop: "background", reason: "overlay 独有（不是镜像）：预览块底下是宿主底色——.markdown/.content 都不画背景，markdown.scss 里没有可合并的声明体；锚定块 visibility:hidden 后 overlay 变高时必须遮住下方块的真实文本 → 保留。已知小瑕疵：--content-bg-color 全仓未定义（token 测试已豁免），实际解析到 --main-bg-color", todo: "keep" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "width", reason: "overlay 独有盒尺寸兜底（不是镜像）：portal 盒宽是 inline 固定值 + overflowX:hidden，子树撑宽即被裁；预览侧块宽来自正常流 block fill，markdown.scss 无等价声明体可合并", todo: "keep" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "min-width", reason: "同上（width 那条）：固定宽盒内的收缩保护；预览侧无对应声明（reset 只给 margin/padding/box-sizing）", todo: "keep" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "max-width", reason: "同上（width 那条）：固定宽 portal 盒的宽度上限；预览侧块宽由正常流决定，无对应声明可合并", todo: "keep" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "overflow-wrap", reason: "overlay 独有且**已知与预览漂移**：预览取 .content 的 overflow-wrap: break-word，编辑期故意用 anywhere（固定宽盒 + 长 URL 兜底）。改正要 CDP 沙箱实测换行位置 → 留给后续切片，本切片不偷改数值", todo: "keep" },
    { scope: ".inline-edit-overlay .wysiwyg-editor h6", prop: "word-break", reason: "overlay 独有且**已知与预览漂移**：预览 computed 是 word-break: normal（.content 不声明），编辑期用 break-word 兜长串。同 overflow-wrap 那条，改正需沙箱实测 → 留给后续切片", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "box-sizing", reason: "overlay 容器是预览块的 border-box，容器自身负责定位/宽度，pre 只负责填满它 → 保留（overlay 独有，不是镜像）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "width", reason: "overlay 容器是预览块的 border-box，容器自身负责定位/宽度，pre 只负责填满它 → 保留（预览态是 .content 的 100%）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "height", reason: "pre 高度由 overlay 容器的 min-height/内容决定（父级 height:auto）→ 保留，避免与预览块 height 语义混淆", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "margin", reason: "覆盖真源的 margin: 0.5em 0.75em —— overlay 已按预览块 border-box 定位，再叠一次会整体偏移 → 保留（同特异性靠源序在后覆盖）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock", prop: "overflow", reason: "overlay 内滚动由容器 overflowY:auto 负责，pre 必须裁剪，否则 pre-wrap 内容溢出到容器外 → 保留", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "display", reason: "与 vendor github-dark-dimmed 的 pre code.hljs{display:block} 一致；显式保留以免依赖 @import 的加载结果", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "min-height", reason: "空代码块仍需可点击/可落 caret 的目标（预览态由 13px 行高撑出）→ overlay 独有", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "font-family", reason: "真源给 code 的字体来自 .content code 的 --fixed-font，不在本切片合并的那条规则里 → 显式声明（值与 --fixed-font 同源：--mono-font）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "font-variant-ligatures", reason: "编辑期必须关闭连字，否则 contenteditable 的 caret 会跳连字 → overlay 独有（预览侧无对应声明）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock > code.hljs", prop: "tab-size", reason: "与 --markdown-tab-size 对齐编辑期 tab 显示宽度 → overlay 独有（预览侧无对应声明）", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "height", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "padding", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留；且与预览 badge 已有数值漂移（padding 0 5px vs 0 6px、background 不透明 vs transparent），属独立问题，交给后续切片", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "border", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "border-radius", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "background", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留；且与预览 badge 已有数值漂移（padding 0 5px vs 0 6px、background 不透明 vs transparent），属独立问题，交给后续切片", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "color", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留", todo: "keep" },
    { scope: ".inline-edit-overlay &[data-block-kind=\"code\"] pre.codeblock .codeblock-edit-header .codeblock-lang-select", prop: "font", reason: "编辑态专属控件：预览态语言标签是 button.codeblock-lang-badge（.codeblock 作用域），这里却是原生 <select> —— 元素类型不同，无法做「同一声明体+组合选择器」的合并 → 保留", todo: "keep" },
];

function toKey(scope: string, prop: string): string {
    return `${scope}::${prop}`;
}

describe("overlay 样式契约：编辑态只允许加供能性样式", () => {
    const rows = extractOverlayRows(readFileSync(SCSS_PATH, "utf8"));

    it("扫描面非空（防止选择器改名后门禁空转）", () => {
        // 该断言只防“扫不到东西”（选择器改名 → rows 归零）；精确清单由下面两条台账断言强制。
        // 切片 3 合并 code 镜像后本作用域声明数 101 → 61，后续切片（table/quote/heading）还会继续降。
        expect(rows.length).toBeGreaterThan(40);
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
