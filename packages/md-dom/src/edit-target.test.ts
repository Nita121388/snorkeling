// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * `md-dom` 目标定位 + 手势判定层的独立测试面。
 *
 * 这两件事各自对应一类**沉默的**用户可见 bug：
 *   - 定位错 → 用户点了 A，编辑的是 B（或"编辑了个空气"：锚在 detached 节点上）
 *   - 手势判错 → 拖选文本一开头就被打断
 * 所以用例按「用户会看到什么」来写。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { fallbackSelector, isSelectingRange, resolveInlineEditTarget } from "./edit-target";

let viewport: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    viewport = document.createElement("div");
    viewport.className = "markdown-render-root";
    document.body.appendChild(viewport);
});

function addBlock(line: number, text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "paragraph";
    el.setAttribute("data-source-line", String(line));
    el.textContent = text;
    viewport.appendChild(el);
    return el;
}

describe("resolveInlineEditTarget：锚点还活着就用它，死了就按行号回退", () => {
    it("锚点在 viewport 内且 connected → 原样返回", () => {
        const el = addBlock(3, "alpha");
        expect(resolveInlineEditTarget(viewport, { blockKind: "p", startLine: 3, targetEl: el })).toBe(el);
    });

    it("锚点已 detached（重渲染换掉了节点）→ 按行号在 viewport 里重新定位", () => {
        const stale = document.createElement("div");
        stale.setAttribute("data-source-line", "3");
        stale.textContent = "旧节点";
        const fresh = addBlock(3, "alpha");
        expect(resolveInlineEditTarget(viewport, { blockKind: "p", startLine: 3, targetEl: stale })).toBe(fresh);
    });

    it("锚点存在于别的地方（不在本 viewport）→ 同样按行号回退", () => {
        const other = document.createElement("div");
        other.setAttribute("data-source-line", "3");
        other.textContent = "别的根里的块";
        document.body.appendChild(other);
        const fresh = addBlock(3, "alpha");
        expect(resolveInlineEditTarget(viewport, { blockKind: "p", startLine: 3, targetEl: other })).toBe(fresh);
    });

    it("找不到 → null（调用方据此放弃开编辑，而不是锚到空气上）", () => {
        expect(resolveInlineEditTarget(viewport, { blockKind: "p", startLine: 99, targetEl: document.createElement("div") })).toBeNull();
    });
});

describe("fallbackSelector：与块类型无关", () => {
    it("对任意块类型都只靠 data-source-line（后加的块型不需要 per-kind 映射表）", () => {
        expect(fallbackSelector(7)).toBe('.markdown-render-root [data-source-line="7"]');
        expect(fallbackSelector(7)).not.toContain("paragraph");
        expect(fallbackSelector(7)).not.toContain("heading");
    });
});

describe("isSelectingRange：拖选时不得劫持手势", () => {
    it("Range 型选区（正在拖选）→ true", () => {
        expect(isSelectingRange({ type: "Range", rangeCount: 1 })).toBe(true);
    });

    it("Caret 型（只是光标落着）→ false", () => {
        expect(isSelectingRange({ type: "Caret", rangeCount: 1 })).toBe(false);
    });

    it("无选区 / null → false", () => {
        expect(isSelectingRange({ type: "None", rangeCount: 0 })).toBe(false);
        expect(isSelectingRange(null)).toBe(false);
    });
});
