// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `md-dom` 块语法层的独立测试面。
 *
 * 为什么包内要有自己的测试（而不是只靠宿主转发那套）：本包的存在意义是**能被别的项目
 * 单独依赖并单独验证**。测试跟着代码走，包才真的是一个可交付单元。
 *
 * 重点锁「成对函数不得各自漂移」：`initialContentFor` ↔ `wrapListMarker` / `wrapCodeFence`
 * 是 strip/wrap 的一对。历史上这类「打开编辑剥掉 X、提交时忘了包回来」的漂移直接造成
 * 数据事故（列表从有序变无序、代码块围栏被吞）。所以这里用**往返恒等**做判据，
 * 而不是分别断言两边的字面量。
 */

import { describe, expect, it } from "vitest";
import {
    applyCalloutPrefix,
    captureCalloutPrefix,
    indentListDraft,
    indentListRange,
    initialContentFor,
    inlineKindToTreeKind,
    isEmptyBlockShellDraft,
    isEmptyQuoteShellDraft,
    wrapCodeFence,
    wrapListMarker,
} from "./block-syntax";

describe("initialContentFor：源码切片 → 编辑器初始正文", () => {
    it("p/h/quote/table/blank/hr 原样", () => {
        for (const kind of ["p", "h", "quote", "table", "blank", "hr"] as const) {
            expect(initialContentFor(kind, "任意内容")).toBe("任意内容");
        }
    });

    it("code：合法围栏对 → 去围栏", () => {
        expect(initialContentFor("code", "```js\nconst x = 1;\n```")).toBe("const x = 1;");
        expect(initialContentFor("code", "~~~\nbody\n~~~")).toBe("body");
    });

    it("code：围栏不成对 → 原样（宁可把 ``` 露出来，也不要吞掉内容）", () => {
        expect(initialContentFor("code", "```js\nconst x = 1;")).toBe("```js\nconst x = 1;");
    });

    it("list：去行首 marker 与缩进", () => {
        expect(initialContentFor("list", "- item")).toBe("item");
        expect(initialContentFor("list", "1. item")).toBe("item");
    });
});

describe("strip ↔ wrap 往返恒等（成对函数最容易各自漂移）", () => {
    it("list：**顶层** strip 后再 wrap 回来 = 原文（有序 / 无序 / 任务项）", () => {
        for (const original of ["- item", "1. item", "- [ ] todo", "12) twelve", "* star", "+ plus"]) {
            const stripped = initialContentFor("list", original);
            expect(wrapListMarker(stripped, original)).toBe(original);
        }
    });

    // ⚠ 已知不对称（本测试是**现状钉子**，不是“正确行为”声明）：
    // `initialContentFor` 对列表**保留行首缩进**（`"  - nested"` → `"  nested"`），
    // 而 `wrapListMarker` 又按原文 `match[1]` 再加一次缩进 → 首行多一个空格。
    // 草稿首行确实会多出一个空格 —— 是否成灾取决于调用方还给不给
    // `captureWysiwygInfo` 抓的 listIndent（`indentListDraft` 会再叠一层）。
    // 本层不做“猜测性修复”：改它就要同时看 listIndent 那条链与写盘结果，
    // 否则有把嵌套列表缩进改坏、进而变层的风险。先把现状钉住，防静默漂移。
    it("list：缩进项不对称（已知，已钉住）—— 修前请先查 listIndent 链路", () => {
        const original = "  - nested";
        expect(initialContentFor("list", original)).toBe("  nested");
        expect(wrapListMarker("  nested", original)).toBe("  -   nested");
    });

    it("code：strip 后再 wrap 回来 = 原文", () => {
        for (const original of ["```js\nconst x = 1;\n```", "~~~\nbody\n~~~", "````\n```\n````"]) {
            const stripped = initialContentFor("code", original);
            expect(wrapCodeFence(stripped, original)).toBe(original);
        }
    });

    it("code：原文没有合法围栏对 → 不凭空造一对（那会改变块类型）", () => {
        expect(wrapCodeFence("body", "body")).toBe("body");
    });
});

describe("空壳守卫：区分「用户清空了块」与「编辑器根从未承载内容」", () => {
    it("quote：裸 `>` / 空 → 空壳；有内容 → 不是", () => {
        expect(isEmptyQuoteShellDraft(">")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n>")).toBe(true);
        expect(isEmptyQuoteShellDraft("> 有内容")).toBe(false);
        // "" 是「合法清空的散文块」，不是引用空壳（判据不同，别混）
        expect(isEmptyQuoteShellDraft("")).toBe(false);
    });

    it("h：裸 `###` → 空壳；`### 标题` → 不是", () => {
        expect(isEmptyBlockShellDraft("h", "###")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "### 标题")).toBe(false);
    });

    it("list：裸 marker → 空壳；有内容 → 不是", () => {
        expect(isEmptyBlockShellDraft("list", "- ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- [ ] ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- 内容")).toBe(false);
    });

    it("p/blank/code/table/hr：\"\" → 空壳", () => {
        for (const kind of ["p", "blank", "code", "table", "hr"] as const) {
            expect(isEmptyBlockShellDraft(kind, "")).toBe(true);
            expect(isEmptyBlockShellDraft(kind, "x")).toBe(false);
        }
    });
});

describe("callout 前缀：保大小写、保 emoji、普通引用不新增标记", () => {
    it("捕获 `[!TYPE]` 原文（不规范化大小写）", () => {
        expect(captureCalloutPrefix("> [!Note] 标题")).toContain("[!Note]");
        expect(captureCalloutPrefix("> [!NOTE] 标题")).toContain("[!NOTE]");
    });

    it("普通引用（无标记）→ 空串；回写时原样返回（不凭空加 [!quote]）", () => {
        expect(captureCalloutPrefix("> 普通引用")).toBe("");
        expect(applyCalloutPrefix("> 普通引用", "")).toBe("> 普通引用");
    });

    it("回写：捕获到的前缀插回首行", () => {
        const prefix = captureCalloutPrefix("> [!NOTE] 这是一个 callout");
        expect(applyCalloutPrefix("> 这是一个 callout\n> 正文", prefix)).toBe(
            "> [!NOTE] 这是一个 callout\n> 正文"
        );
    });

    it("回写：空首行不留尾空格（尾空格会被写盘）", () => {
        expect(applyCalloutPrefix(">", "[!NOTE] ")).toBe("> [!NOTE]");
    });
});

describe("列表缩进：Tab / Shift+Tab", () => {
    const text = ["- a", "- b", "  - b1", "非列表行"].join("\n");

    it("Tab 只缩进范围内的**列表项**行，续行/非列表行不动", () => {
        const out = indentListRange(text, 1, 3, 1).split("\n");
        expect(out[0]).toBe("  - a");
        expect(out[1]).toBe("  - b");
        expect(out[2]).toBe("    - b1");
        expect(out[3]).toBe("非列表行"); // 超出范围
    });

    it("Shift+Tab 去掉最多 2 个行首空格；0 缩进不变", () => {
        const out = indentListRange(text, 1, 3, -1).split("\n");
        expect(out[0]).toBe("- a");
        expect(out[2]).toBe("- b1");
    });

    it("indentListDraft：整体套用源缩进，空行不套", () => {
        expect(indentListDraft("- a\n\n- b", "  ")).toBe("  - a\n\n  - b");
        expect(indentListDraft("- a", "")).toBe("- a");
    });
});

describe("inlineKindToTreeKind：wysiwyg kind → 树模型 kind", () => {
    it("h：从 `#` 前缀推断级别", () => {
        expect(inlineKindToTreeKind("h", "## 标题")).toBe("heading2");
        expect(inlineKindToTreeKind("h", "没有井号")).toBe("text");
    });

    it("list：从首行 marker 推断 bulleted / numbered / todo", () => {
        expect(inlineKindToTreeKind("list", "- a")).toBe("bulleted");
        expect(inlineKindToTreeKind("list", "1. a")).toBe("numbered");
        expect(inlineKindToTreeKind("list", "- [x] done")).toBe("todo");
        // 正文里出现 [x] 不算任务项（只认 marker 紧跟的那个）
        expect(inlineKindToTreeKind("list", "- see [x] note")).toBe("bulleted");
    });

    it("p / blank → text；quote → quote", () => {
        expect(inlineKindToTreeKind("p", "x")).toBe("text");
        expect(inlineKindToTreeKind("blank", "")).toBe("text");
        expect(inlineKindToTreeKind("quote", "> x")).toBe("quote");
    });
});
