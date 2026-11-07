// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// FlyoutMenu 子菜单渲染回归锁。
//
// 锁定的历史 bug：`SubMenu` 的 JSX 里残留了 `hoverHandlers={hoverHandlers}` / `hoverMode={hoverMode}`，
// 但这两个名字在 `SubMenuComponent` 作用域里并不存在（它们是顶层 `MenuProps` 的东西）。
// 结果：只要某个菜单项**有 subItems 且被 hover**，渲染 `SubMenu` 时就抛
// `ReferenceError: hoverHandlers is not defined` —— 整个右键/更多菜单炸掉，而且只在"有子菜单"时复现，
// 平时点开一级菜单看不出来。
//
// 这里用最小 props 直接把"一级菜单打开 → hover 带子菜单的项"这条路径走一遍，断言：
//  1. 不抛异常；
//  2. 子菜单项真的渲染出来了（防止"静默不渲染"被当成修好）。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlyoutMenu } from "./flyoutmenu";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
});

function clickAnchor(): void {
    const anchor = container.querySelector(".menu-anchor") as HTMLDivElement | null;
    expect(anchor).not.toBeNull();
    act(() => {
        anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("FlyoutMenu submenu", () => {
    it("renders a submenu on hover without throwing (hoverHandlers regression)", () => {
        act(() => {
            root.render(
                <FlyoutMenu
                    items={[
                        {
                            label: "More",
                            // 三级菜单才是历史崩溃点：`SubMenu` 里再渲染 `SubMenu` 的那处 JSX
                            // 曾经带着作用域外的 hoverHandlers/hoverMode。
                            subItems: [
                                {
                                    label: "Deeper",
                                    subItems: [{ label: "Deepest", onClick: () => {} }],
                                },
                            ],
                        },
                    ]}
                >
                    <button type="button">open</button>
                </FlyoutMenu>
            );
        });

        clickAnchor();

        const menu = document.querySelector(".menu");
        expect(menu).not.toBeNull();

        const firstItem = menu!.querySelector(".menu-item") as HTMLDivElement;
        expect(firstItem).not.toBeNull();

        // 这里就是历史崩溃点：hover 带 subItems 的菜单项会渲染 SubMenu。
        // 注意 React 的 onMouseEnter 是 mouseover/mouseout 合成出来的，
        // 直接派发 "mouseenter" 不会触发它 —— 必须发 mouseover（bubbles）。
        expect(() => {
            act(() => {
                firstItem.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            });
        }).not.toThrow();

        // 二级子菜单出现后再 hover 它 —— 这一步会渲染第三级 SubMenu（历史崩溃点）。
        const subItem = document.querySelector(".sub-menu .menu-item") as HTMLDivElement | null;
        expect(subItem).not.toBeNull();
        expect(() => {
            act(() => {
                subItem!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            });
        }).not.toThrow();

        const labels = Array.from(document.querySelectorAll(".sub-menu .menu-item .label")).map((node) =>
            (node.textContent ?? "").trim()
        );
        expect(labels).toContain("Deeper");
        expect(labels).toContain("Deepest");
    });
});
