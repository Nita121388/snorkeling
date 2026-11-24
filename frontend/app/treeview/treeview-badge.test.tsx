// @vitest-environment jsdom
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（N-1124-folder-index-badges-2）— 判据测试：
// 树行徽标渲染（前缀 emoji）与「无 badge = 树零变化」。
// 挂载基建对齐仓库既有 DOM 测试惯例（createRoot + act，不引 @testing-library）。

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TreeNodeBadge } from "@/app/treeview/treeview";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
    if (root != null) {
        act(() => root!.unmount());
        root = null;
    }
    container?.remove();
    container = null;
});

function mount(node: Parameters<typeof TreeNodeBadge>[0]["node"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(<TreeNodeBadge node={node} />);
    });
    return container;
}

describe("TreeNodeBadge（树行徽标渲染）", () => {
    it("node.badge 存在 → 渲染前缀 emoji + title", () => {
        const el = mount({
            id: "a",
            label: "接口设计.md",
            isDirectory: false,
            badge: { emoji: "🧊", title: "已定稿，改动需走流程" },
        });
        const span = el.querySelector(".st-badge");
        expect(span).not.toBeNull();
        expect(span?.textContent).toBe("🧊");
        expect(span?.getAttribute("title")).toBe("已定稿，改动需走流程");
    });

    it("自定义颜色 → 内联 style.color", () => {
        const el = mount({
            id: "b",
            label: "实验笔记.md",
            isDirectory: false,
            badge: { emoji: "⏳", color: "#e0a83a" },
        });
        const span = el.querySelector<HTMLSpanElement>(".st-badge");
        expect(span?.style.color).toBe("rgb(224, 168, 58)");
    });

    it("无 badge → 不渲染任何节点（关闭时树零变化）", () => {
        const el = mount({ id: "c", label: "README.md", isDirectory: false });
        expect(el.querySelector(".st-badge")).toBeNull();
    });
});
