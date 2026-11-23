// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero 折叠组头图标回归（11-23 nita 拍板：Hero 折叠栏只留 emoji）：
// - hero 组（group.heroId != null）：图标位只渲染 hero emoji（heroEmoji 回落 🎭），
//   不再出现 fa-folder / fa-folder-open；
// - 普通项目组：folder 图标行为不变（collapsed=fa-folder / expanded=fa-folder-open）；
// - 未归类组：fa-inbox 不变。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SessionGroup } from "./session-group";
import type { ProjectSessionGroup } from "./utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeGroup(overrides: Partial<ProjectSessionGroup> = {}): ProjectSessionGroup {
    return {
        name: "Demo",
        path: "hero:demo",
        sessions: [{ key: "a" }, { key: "b" }] as ProjectSessionGroup["sessions"],
        tree: [],
        unclassified: false,
        heroId: "demo",
        heroEmoji: "🦊",
        ...overrides,
    };
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
});

function mountGroup(group: ProjectSessionGroup, collapsed = false): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(
            <SessionGroup group={group} collapsed={collapsed} onToggleCollapsed={() => {}}>
                <div>row</div>
            </SessionGroup>
        );
    });
    return container;
}

describe("SessionGroup head icon (hero emoji)", () => {
    it("hero group: renders exactly one emoji node and no folder icons (collapsed)", () => {
        const container = mountGroup(makeGroup(), true);
        expect(container.querySelectorAll("i.fa-folder, i.fa-folder-open")).toHaveLength(0);
        const emojiNodes = container.querySelectorAll("[data-group-head-emoji]");
        expect(emojiNodes).toHaveLength(1);
        expect(emojiNodes[0].textContent).toBe("🦊");
    });

    it("hero group without roster emoji falls back to 🎭 (expanded)", () => {
        const container = mountGroup(makeGroup({ heroEmoji: undefined }), false);
        expect(container.querySelectorAll("i.fa-folder, i.fa-folder-open")).toHaveLength(0);
        const emojiNodes = container.querySelectorAll("[data-group-head-emoji]");
        expect(emojiNodes).toHaveLength(1);
        expect(emojiNodes[0].textContent).toBe("🎭");
    });

    it("regular project group keeps fa-folder(-open): no emoji node", () => {
        const collapsed = mountGroup(
            makeGroup({ heroId: undefined, heroEmoji: undefined, name: "snorkeling", path: "/p/snorkeling" }),
            true
        );
        expect(collapsed.querySelectorAll("i.fa-folder")).toHaveLength(1);
        expect(collapsed.querySelectorAll("[data-group-head-emoji]")).toHaveLength(0);

        const expanded = mountGroup(
            makeGroup({ heroId: undefined, heroEmoji: undefined, name: "snorkeling", path: "/p/snorkeling" }),
            false
        );
        expect(expanded.querySelectorAll("i.fa-folder-open")).toHaveLength(1);
    });

    it("unclassified group keeps fa-inbox", () => {
        const container = mountGroup(
            makeGroup({ heroId: undefined, heroEmoji: undefined, name: "未归类", path: "", unclassified: true }),
            false
        );
        expect(container.querySelectorAll("i.fa-inbox")).toHaveLength(1);
        expect(container.querySelectorAll("[data-group-head-emoji]")).toHaveLength(0);
    });
});
