// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「离开去向」判据的单测（需要 DOM）。
//
// 守住的回归点：溢出菜单 portal 到 body 与 header 互为兄弟，实测 header 的
// pointerleave 先于 menu 的 pointerenter 触发，所以必须靠 relatedTarget 判定
// 而不是靠菜单自己先 FREEZE。graceMs=0 时更是只有这条路径有效。
//
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isLeavingToAttachedLayer } from "./header-attached-layer";

describe("isLeavingToAttachedLayer", () => {
    it("relatedTarget 在菜单内 → 算「去附属层」", () => {
        const menu = document.createElement("div");
        const item = document.createElement("button");
        menu.appendChild(item);
        document.body.appendChild(menu);
        expect(isLeavingToAttachedLayer(item, [menu])).toBe(true);
        menu.remove();
    });

    it("relatedTarget 是菜单本身 → 算", () => {
        const menu = document.createElement("div");
        document.body.appendChild(menu);
        expect(isLeavingToAttachedLayer(menu, [menu])).toBe(true);
        menu.remove();
    });

    it("relatedTarget 在菜单外 → 不算", () => {
        const menu = document.createElement("div");
        const outside = document.createElement("div");
        document.body.append(menu, outside);
        expect(isLeavingToAttachedLayer(outside, [menu])).toBe(false);
        menu.remove();
        outside.remove();
    });

    it("relatedTarget 为 null → 不算（真离开窗口）", () => {
        const menu = document.createElement("div");
        expect(isLeavingToAttachedLayer(null, [menu])).toBe(false);
    });

    it("relatedTarget 不是 Node（例如 window）→ 不算", () => {
        const menu = document.createElement("div");
        expect(isLeavingToAttachedLayer(window, [menu])).toBe(false);
    });

    it("附属层为 null/undefined 时安全", () => {
        expect(isLeavingToAttachedLayer(document.createElement("div"), [null, undefined])).toBe(false);
    });

    it("多个附属层：命中任意一个即可", () => {
        const menu = document.createElement("div");
        const flyout = document.createElement("div");
        const item = document.createElement("span");
        flyout.appendChild(item);
        document.body.append(menu, flyout);
        expect(isLeavingToAttachedLayer(item, [menu, flyout])).toBe(true);
        menu.remove();
        flyout.remove();
    });
});
