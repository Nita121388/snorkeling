// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「＋ 新建 Agent」弹窗 DOM 回归（F-1120-overview-add-agent-card）。
//
// 只测结构与提交请求体；profile 探测（FindCommand RPC）与建块（CreateBlockInTab）
// 都在组件外 —— 探测 mock 掉，建块由 onSubmit 回传的 AddAgentSubmitRequest 锁定：
//   - tabId/tabName = 入口所属 Tab
//   - cwd = 弹窗里选中的路径（默认随 Tab），connection 仅远端行
//   - modelOverride 仅输入框非空时
//   - 未选 agent 时「创建」disabled
// 真实建块链路（context.inheritWorkspaceContext=false / activateTargetTab=false）
// 由 session-overview.tsx 的 submitAddAgent 保证，纯函数部分在 overview-add-agent.test.ts。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchTarget } from "@/app/workspace/agent-launch";
import { OverviewAddAgentModal, type AddAgentSubmitRequest } from "./overview-add-agent-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FindCommand 探测 mock：不触发 RPC，返回固定两个 profile。
vi.mock("@/app/workspace/use-agent-profile-options", () => ({
    useDetectedAgentProfileOptions: () => [
        { name: "pi", label: "Pi", cmd: "pi", isDefault: true },
        { name: "claude", label: "Claude", cmd: "claude", isDefault: false },
    ],
}));

// 全局 store 在 jsdom 里懒加载失败（与 commontext-send-popover-geometry.dom.test.tsx 同一处理）
vi.mock("@/app/store/global", async () => {
    const { atom: jotaiAtom } = await import("jotai");
    return { atoms: { settingsAtom: jotaiAtom<unknown>(null) } };
});

const LocalTarget = (blockId: string, cwd: string): AgentLaunchTarget => ({
    blockId,
    connection: null,
    cwd,
    source: "terminal",
    isLocal: true,
    label: "",
    detail: cwd,
});

const RemoteTarget = (blockId: string, cwd: string): AgentLaunchTarget => ({
    blockId,
    connection: "ssh://mac",
    cwd,
    source: "terminal",
    isLocal: false,
    label: "ssh://mac",
    detail: cwd,
});

const mounted: { container: HTMLDivElement; root: Root }[] = [];

let mainDiv: HTMLDivElement | null = null;

beforeEach(() => {
    // Modal 通过 createPortal 挂到 #main
    mainDiv = document.createElement("div");
    mainDiv.id = "main";
    document.body.appendChild(mainDiv);
});

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    mainDiv?.remove();
    mainDiv = null;
});

type MountOpts = {
    tabId?: string;
    tabName?: string;
    targets?: AgentLaunchTarget[];
    defaultPath?: string | null;
    onSubmit?: (request: AddAgentSubmitRequest) => void;
};

function mountModal(opts: MountOpts = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onSubmit = opts.onSubmit ?? vi.fn();
    act(() => {
        root.render(
            <OverviewAddAgentModal
                tabId={opts.tabId ?? "tab-1"}
                tabName={opts.tabName ?? "snorkel-dev"}
                targets={opts.targets ?? [LocalTarget("b1", "E:/code/snorkeling"), LocalTarget("b2", "E:/code/other")]}
                defaultPath={opts.defaultPath ?? "E:/code/snorkeling"}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />
        );
    });
    return { modalEl: mainDiv?.querySelector(".session-overview-add-agent-modal") as HTMLElement, onSubmit };
}

function modalButtons(modalEl: HTMLElement) {
    const footer = modalEl.querySelector(".modal-footer") as HTMLElement;
    const buttons = [...footer.querySelectorAll("button")];
    // [取消, 创建]
    return { cancel: buttons[0], create: buttons[buttons.length - 1] };
}

describe("OverviewAddAgentModal 结构", () => {
    it("全局 Modal 居中壳 + 两段内容（agent/模型 + 路径）", () => {
        const { modalEl } = mountModal();
        expect(modalEl).not.toBeNull();
        expect(modalEl.closest(".modal-wrapper")).not.toBeNull();
        expect(modalEl.querySelectorAll(".session-overview-add-agent-section")).toHaveLength(2);
    });

    it("头部右侧显示 Tab 名（只出现一次）", () => {
        const { modalEl } = mountModal({ tabName: "snorkel-dev" });
        expect(modalEl.querySelector(".session-overview-add-agent-tabname")?.textContent).toBe("snorkel-dev");
    });

    it("agent chips = 探测到的 profiles；默认预选第一个（与 New Agent 弹窗一致，创建立即可用）", () => {
        const { modalEl } = mountModal();
        const chips = modalEl.querySelectorAll(".session-overview-add-agent-chip-btn");
        expect(chips).toHaveLength(2);
        const selected = () =>
            modalEl.querySelector(".session-overview-add-agent-chip.is-selected .session-overview-add-agent-chip-btn")
                ?.textContent ?? "";
        expect(selected()).toContain("Pi");
        const { create } = modalButtons(modalEl);
        expect((create as HTMLButtonElement).disabled).toBe(false);
        act(() => {
            (chips[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(selected()).toContain("Claude");
        expect((create as HTMLButtonElement).disabled).toBe(false);
    });
});

describe("OverviewAddAgentModal 路径列表", () => {
    it("默认项（随 Tab）排最前并选中；本地行无第二行", () => {
        const { modalEl } = mountModal();
        const rows = modalEl.querySelectorAll(".session-overview-add-agent-path");
        expect(rows).toHaveLength(2);
        expect(rows[0].classList.contains("is-selected")).toBe(true);
        expect(rows[0].querySelector(".session-overview-add-agent-path-detail")?.textContent).toBe(
            "E:/code/snorkeling"
        );
        expect(rows[0].querySelector(".session-overview-add-agent-path-sub")).toBeNull();
    });

    it("模型输入框不带占位文案（只保留 aria-label），本地 connection=local 行无第二行", () => {
        const { modalEl } = mountModal({
            targets: [
                {
                    blockId: "b1",
                    connection: "local",
                    cwd: "E:/code/snorkeling",
                    source: "terminal",
                    isLocal: false,
                    label: "local",
                    detail: "E:/code/snorkeling",
                },
            ],
            defaultPath: "E:/code/snorkeling",
        });
        const model = modalEl.querySelector(".session-overview-add-agent-model") as HTMLInputElement;
        expect(model.getAttribute("placeholder")).toBeNull();
        expect(model.getAttribute("aria-label")).not.toBeNull();
        expect(modalEl.querySelector(".session-overview-add-agent-path-sub")).toBeNull();
    });

    it("远端行第二行显示 connection", () => {
        const { modalEl } = mountModal({
            targets: [RemoteTarget("b1", "/Users/nita/work")],
            defaultPath: "/Users/nita/work",
        });
        expect(modalEl.querySelector(".session-overview-add-agent-path-sub")?.textContent).toBe("ssh://mac");
    });

    it("点行切换选中", () => {
        const { modalEl } = mountModal();
        const rows = modalEl.querySelectorAll(".session-overview-add-agent-path");
        act(() => {
            (rows[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(rows[1].classList.contains("is-selected")).toBe(true);
        expect(rows[0].classList.contains("is-selected")).toBe(false);
    });
});

describe("OverviewAddAgentModal 提交请求体", () => {
    it("默认：选中第一个 profile + 随 Tab 路径；modelOverride=null；connection=null", () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({ onSubmit });
        const { create } = modalButtons(modalEl);
        // 未显式选 agent 时默认第一个 profile（pi）
        act(() => {
            (create as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onSubmit).toHaveBeenCalledWith({
            tabId: "tab-1",
            tabName: "snorkel-dev",
            profileName: "pi",
            connection: null,
            cwd: "E:/code/snorkeling",
            modelOverride: null,
        });
    });

    it("切路径 + 手填模型 → cwd/modelOverride 跟随", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({ onSubmit });
        const rows = modalEl.querySelectorAll(".session-overview-add-agent-path");
        act(() => {
            (rows[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        const model = modalEl.querySelector(".session-overview-add-agent-model") as HTMLInputElement;
        // React 受控输入：必须走原型 setter 才能触发 onChange（直接赋 value 不触发）
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        act(() => {
            valueSetter?.call(model, "deepseek-v4");
            model.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const { create } = modalButtons(modalEl);
        await act(async () => {
            (create as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onSubmit).toHaveBeenCalledWith({
            tabId: "tab-1",
            tabName: "snorkel-dev",
            profileName: "pi",
            connection: null,
            cwd: "E:/code/other",
            modelOverride: "deepseek-v4",
        });
    });

    it("远端路径：connection 跟随该行", () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({
            targets: [RemoteTarget("b1", "/Users/nita/work")],
            defaultPath: "/Users/nita/work",
            onSubmit,
        });
        const { create } = modalButtons(modalEl);
        act(() => {
            (create as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ cwd: "/Users/nita/work", connection: "ssh://mac" })
        );
    });
});
