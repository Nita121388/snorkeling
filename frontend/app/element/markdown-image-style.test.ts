// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 图片块样式契约（10-12 image-block · 切片 1 · 验收第 4 类「样式」+ 第 2 类的 scss 侧）。
 *
 * 图片块的样式只负责**容器 / 控件外观**，四条不变量：
 *   ① **宽度来自语法**，不来自 scss：尺寸是 `![alt|WxH](path)` 的一部分，渲染层写内联
 *      `style="width:300px;height:200px"`（DOM 侧断言见 `packages/md-core/src/render/image.render.test.tsx`）。
 *      scss 里给图片盒子定宽/定高 = 把"用户意图"复制成第二份真源，必然漂移 → 这里禁止。
 *   ② **对齐随正文流**：wrapper 是 `display: inline-block`，不 float、不 margin:auto、不 text-align 覆盖。
 *   ③ **圆角 / 题注字号取自既有 token**（`--markdown-image-*`，值 = 收敛前的字面量，视觉零变化）；
 *      其余字面量必须登记台账（新增未登记 → 失败；台账条目消失 → 也失败）。
 *   ④ **不得新增颜色**：颜色一律取既有 token（允许 `var(--token, fallback)` 回退与
 *      `color-mix(in srgb, var(--token) …)`），出现裸字面色即失败。
 *
 * 另加一条 **parity 门禁**（第 2 类的 scss 侧证据）：`.markdown-img-wrapper.markdown-img-resizable`
 * 只是**编辑态围边**，不得声明任何改变盒子的属性（border / padding / margin / width / height / font-*）。
 * 用 border 会把 wrapper 撑大 2px（编辑态 302px vs 预览态 300px）并在 hover 时抖动 —— 这正是本任务
 * 要守住的「编辑态 ≡ 预览态」不变量。围边只许用 `outline`（不参与布局）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCSS_PATH = fileURLToPath(new URL("./markdown.scss", import.meta.url));
const THEME_PATH = fileURLToPath(new URL("../theme.scss", import.meta.url));

/** 图片块在 markdown.scss 里的边界（前后各是注释锚点，改名即门禁失败——防空转）。 */
const SECTION_START = "// Images in rendered markdown are click-to-zoom";
const SECTION_END = "// Block-edge grip + insert actions";

const IMAGE_SELECTOR_RE = /^\.markdown-img-/;

/** 图片盒子的**尺寸**属性：只允许来自语法（内联 style），scss 一律不得声明。 */
const SIZE_PROPS = new Set(["width", "height", "min-width", "max-width", "min-height", "max-height"]);

/** 盒模型属性（出现在编辑态围边作用域 = 编辑态会推动预览盒子）。 */
const BOX_PROPS = new Set([
    "border",
    "border-top",
    "border-bottom",
    "border-left",
    "border-right",
    "border-width",
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
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "font",
    "font-size",
    "font-family",
    "font-weight",
    "line-height",
    "background",
    "background-color",
    "box-sizing",
    "display",
]);

type Row = { line: number; selector: string; prop: string; value: string; text: string };

function imageSection(): { text: string; startLine: number } {
    const lines = readFileSync(SCSS_PATH, "utf8").split("\n");
    const start = lines.findIndex((l) => l.includes(SECTION_START));
    const end = lines.findIndex((l) => l.includes(SECTION_END));
    expect(start, "图片块注释锚点缺失（选择器改名？门禁会空转）").toBeGreaterThan(-1);
    expect(end, "图片块结束锚点缺失").toBeGreaterThan(start);
    return { text: lines.slice(start, end).join("\n"), startLine: start + 1 };
}

/** 扁平化 section 里的「选择器作用域 → 声明」（`&:hover` 等嵌套按 overlay-style-contract 的写法拼 scaope）。 */
function extractRows(text: string, startLine: number): Row[] {
    const lines = text.split("\n");
    const stack: string[] = [];
    const rows: Row[] = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.endsWith("{") && !t.startsWith("@")) {
            stack.push(t.slice(0, -1).trim() || "(inline)");
            continue;
        }
        if (t.startsWith("}")) {
            // 可能是一行里的多个闭合，逐个 pop
            for (let k = 0; k < (t.match(/\}/g)?.length ?? 0); k++) {
                stack.pop();
            }
            continue;
        }
        const m = /^([a-z-]+)\s*:\s*(.+?);?$/.exec(t);
        if (m == null) {
            continue;
        }
        rows.push({
            line: startLine + i,
            selector: stack.join(" "),
            prop: m[1],
            value: m[2].trim(),
            text: lines[i],
        });
    }
    return rows;
}

const section = imageSection();
const rows = extractRows(section.text, section.startLine);
const imageRows = rows.filter((r) => IMAGE_SELECTOR_RE.test(r.selector) || r.selector.includes("markdown-img-"));
const token = (prop: string, name: string) => imageRows.filter((r) => r.prop === prop && r.value === `var(${name})`);

const theme = readFileSync(THEME_PATH, "utf8");
/** 取 token 定义（`--x: value;`）。 */
function tokenValue(name: string): string | null {
    const m = theme.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    return m == null ? null : m[1].trim();
}

describe("图片块样式契约：扫描面", () => {
    it("扫到的声明足够多，且覆盖图片块的所有关键规则（防空转）", () => {
        expect(imageRows.length).toBeGreaterThan(30);
        for (const selector of [
            ".markdown-img-wrapper",
            ".markdown-img-wrapper.markdown-img-resizable",
            ".markdown-img-resize-handle",
            ".markdown-img-size-badge",
            ".markdown-img-size-clear",
            ".markdown-img-alt-display",
            ".markdown-img-alt-input",
        ]) {
            expect(
                imageRows.some((r) => r.selector === selector),
                `规则 ${selector} 未被扫描到`
            ).toBe(true);
        }
    });
});

describe("① 宽度：尺寸真源是 markdown 语法，不是 scss", () => {
    it("wrapper / 图片本体不声明任何盒尺寸", () => {
        const offenders = imageRows
            .filter(
                (r) =>
                    (r.selector === ".markdown-img-wrapper" ||
                        r.selector === ".markdown-img-clickable" ||
                        r.selector === ".markdown-img-wrapper.markdown-img-resizable") &&
                    SIZE_PROPS.has(r.prop)
            )
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(offenders, `图片盒子的宽高必须来自语法（内联 style），不得在 scss 里定：\n${offenders.join("\n")}`).toEqual(
            []
        );
    });

    it("整个图片区块没有给图片本体写死 px 宽高", () => {
        const offenders = imageRows
            // px 绝对值才是"写死尺寸"；百分比是随容器（正文流）的约束，不是第二份尺寸真源
            .filter((r) => (r.prop === "width" || r.prop === "height") && /^\d+(\.\d+)?px$/.test(r.value))
            .filter((r) => !r.selector.includes("resize-handle") && !r.selector.includes("path-input"))
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(offenders).toEqual([]);
    });
});

describe("② 对齐：随正文流（inline-block），无 float / auto-margin / text-align 覆盖", () => {
    it("wrapper 是 inline-block", () => {
        expect(imageRows.filter((r) => r.selector === ".markdown-img-wrapper" && r.prop === "display")[0]?.value).toBe(
            "inline-block"
        );
    });

    it("图片盒子上没有 float / margin:auto / text-align", () => {
        const offenders = imageRows
            .filter(
                (r) =>
                    (r.selector.startsWith(".markdown-img-wrapper") || r.selector.startsWith(".markdown-img-clickable")) &&
                    (r.prop === "float" || r.prop === "text-align" || /margin-(left|right)/.test(r.prop) || r.prop === "margin")
            )
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(offenders).toEqual([]);
    });
});

describe("③ 圆角 / 题注字号取自既有 token", () => {
    it("token 已定义，且值与收敛前的字面量一致（视觉零变化）", () => {
        expect(tokenValue("--markdown-image-radius")).toBe("4px");
        expect(tokenValue("--markdown-image-control-radius")).toBe("3px");
        expect(tokenValue("--markdown-image-caption-font-size")).toBe("12px");
    });

    it("容器圆角用 --markdown-image-radius", () => {
        for (const selector of [".markdown-img-error", ".markdown-img-alt-display", ".markdown-img-alt-input"]) {
            expect(
                token("border-radius", "--markdown-image-radius").some((r) => r.selector === selector),
                `${selector} 的圆角必须取 var(--markdown-image-radius)`
            ).toBe(true);
        }
    });

    it("控件圆角用 --markdown-image-control-radius", () => {
        for (const selector of [".markdown-img-size-badge", ".markdown-img-size-clear"]) {
            expect(
                token("border-radius", "--markdown-image-control-radius").some((r) => r.selector === selector),
                `${selector} 的圆角必须取 var(--markdown-image-control-radius)`
            ).toBe(true);
        }
    });

    it("题注（显示 + 编辑器）字号用 --markdown-image-caption-font-size", () => {
        for (const selector of [".markdown-img-alt-display", ".markdown-img-alt-input"]) {
            expect(
                token("font-size", "--markdown-image-caption-font-size").some((r) => r.selector === selector),
                `${selector} 的题注字号必须取 var(--markdown-image-caption-font-size)`
            ).toBe(true);
        }
    });
});

/**
 * 字面量台账：token 化之后剩下的字面量，每条都必须写明理由（新增未登记 → 失败；
 * 条目消失 → 也失败，防止台账失真/膨胀）。
 */
const KNOWN_LITERALS: { selector: string; prop: string; value: string; reason: string }[] = [
    {
        selector: ".markdown-img-resize-handle",
        prop: "border-radius",
        value: "2px",
        reason: "拖拽手柄是控件自身的方块形状（12×12）；与徽标/按钮的 3px 不同值，token 化会改视觉 → 保留并登记",
    },
    {
        selector: ".markdown-img-size-badge",
        prop: "font-size",
        value: "10px",
        reason: "尺寸徽标（300×200 数字）字号；与题注 12px 不同值，且不属于验收要求 token 化的「题注字号」→ 保留并登记",
    },
    {
        selector: ".markdown-img-size-clear",
        prop: "font-size",
        value: "12px",
        reason: "重置按钮的 × 字形字号；与题注 12px 同值但语义不同（控件字形），登记而非借题注 token",
    },
    {
        selector: ".markdown-img-copied",
        prop: "font-size",
        value: "12px",
        reason: "「Path copied」瞬时提示条的字号（与题注同值但语义不同：提示条不是题注）→ 登记保留",
    },
    {
        selector: ".markdown-img-path-input",
        prop: "border-radius",
        value: "var(--modal-border-radius)",
        reason: "编辑路径弹出层是 modal 族样式，取既有 --modal-border-radius（6px）= 原字面量",
    },
    {
        selector: ".markdown-img-path-input input",
        prop: "font-size",
        value: "13px",
        reason: "编辑路径输入框是表单控件（与 markdown 正文/题注不同族），沿用弹层内的表单字号；不属于验收要求 token 化的「题注字号」→ 登记保留",
    },
];

describe("④ 样式来源契约：字面量台账 + 不得新增颜色", () => {
    it("圆角 / 字号字面量必须登记台账", () => {
        const key = (r: { selector: string; prop: string; value: string }) => `${r.selector}|${r.prop}|${r.value}`;
        const registered = new Set(KNOWN_LITERALS.map(key));
        const literalRadius = imageRows.filter(
            (r) => r.prop === "border-radius" && !r.value.startsWith("var(")
        );
        const literalFontSize = imageRows.filter(
            // 只抓 px 字面量：em/% 是相对值（派生自既有字号 token），不算"写死的第二份真源"
            (r) => r.prop === "font-size" && /^\d+(\.\d+)?px$/.test(r.value)
        );
        const unregistered = [...literalRadius, ...literalFontSize]
            .filter((r) => !registered.has(key(r)))
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(unregistered, `未登记的字面量（请改用 token 或登记台账）：\n${unregistered.join("\n")}`).toEqual([]);

        // 台账条目必须仍然存在（防失真）：条目所指的声明必须还在 scss 里
        for (const entry of KNOWN_LITERALS) {
            if (entry.value.startsWith("var(")) {
                continue;
            }
            expect(
                imageRows.some((r) => r.selector === entry.selector && r.prop === entry.prop && r.value === entry.value),
                `台账条目已失效（scss 里找不到）：${entry.selector} { ${entry.prop}: ${entry.value} }`
            ).toBe(true);
        }
    });

    it("不得新增颜色：所有颜色都经 var(--token) / color-mix(var(--token))，无裸字面色", () => {
        const COLOR_PROPS = /^(color|background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|fill|stroke)$/;
        const offenders: string[] = [];
        for (const r of imageRows) {
            if (!COLOR_PROPS.test(r.prop)) {
                continue;
            }
            // 去掉 `var(--token, <fallback>)` 的回退值（回退允许是既有色，token 未定义时的兜底）
            const stripped = r.value.replace(/var\(\s*--[a-z0-9-]+\s*,[^)]*\)/gi, "var(--token)");
            // 剩下的裸字面色：hex / rgb() / hsl() / 具名色
            const bare = stripped.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|green|blue|gray|grey)\b/gi);
            if (bare != null) {
                offenders.push(`markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} } → ${bare.join(", ")}`);
            }
        }
        expect(offenders, `图片块不得新增颜色（一律取既有 token）：\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("parity 门禁：编辑态围边不得改变盒子（编辑态 ≡ 预览态）", () => {
    const resizable = ".markdown-img-wrapper.markdown-img-resizable";

    it("围边只用 outline（不参与布局），不得用 border 撑大 wrapper", () => {
        const rowsOfRule = imageRows.filter((r) => r.selector.startsWith(resizable));
        expect(rowsOfRule.some((r) => r.prop === "outline" && r.value.startsWith("1px solid"))).toBe(true);
        expect(rowsOfRule.some((r) => r.prop === "outline-color")).toBe(true);
        // `border-radius` 不是盒模型（不占空间）→ 只拦真正的 border 宽度/样式/颜色声明
        expect(rowsOfRule.some((r) => /^border(-(width|style|top|right|bottom|left|color))?$/.test(r.prop))).toBe(
            false
        );
    });

    it("围边作用域里没有任何盒模型声明（padding/margin/width/height/border/font-*）", () => {
        const offenders = imageRows
            .filter((r) => r.selector.startsWith(resizable) && BOX_PROPS.has(r.prop))
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(offenders, `编辑态围边不得移动盒子：\n${offenders.join("\n")}`).toEqual([]);
    });

    it("hover / resizing 只改颜色与透明度（不引入布局变化）", () => {
        const allowed = new Set(["outline-color", "opacity"]);
        const offenders = imageRows
            .filter((r) => r.selector.startsWith(resizable) && r.selector !== resizable && !allowed.has(r.prop))
            .map((r) => `markdown.scss:${r.line} ${r.selector} { ${r.prop}: ${r.value} }`);
        expect(offenders).toEqual([]);
    });
});
