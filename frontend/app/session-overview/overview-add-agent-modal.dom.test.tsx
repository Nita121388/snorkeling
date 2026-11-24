// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「＋ 新建 Agent」弹窗 DOM 回归（F-1120-overview-add-agent-card，v2）。
//
// 只测结构与提交请求体；profile 探测（FindCommand RPC）、模型目录（agentprofilelist RPC）
// 与建块/发送（CreateBlockInTab + AgentSendCommand）都在组件外 —— 探测与目录 mock 掉，
// 建块与发送由 onSubmit 回传的 AddAgentSubmitRequest 锁定：
//   - tabId/tabName = 入口所属 Tab
//   - cwd = 弹窗里选中的路径（默认随 Tab），connection 仅远端行
//   - message = 输入框 trim 后非空才算（null = 只建块不发送；远端行恒 null）
//   - modelOverride = 模型下拉显式切换才有（默认项 = 跟随 profile 配置 → null）
//   - sendFailure 回执：块已建但消息没送到 → 弹窗保持打开、内联报错、footer 只留「关闭」
// 真实建块/发送链路（context.inheritWorkspaceContext=false / activateTargetTab=false /
// text64 + submit=true）由 session-overview.tsx 的 submitAddAgent 保证，纯函数在 overview-add-agent.test.ts。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchTarget } from "@/app/workspace/agent-launch";
import { initI18n } from "@/i18n/config";
import { OverviewAddAgentModal, type AddAgentSubmitRequest } from "./overview-add-agent-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FindCommand 探测 mock：不触发 RPC，返回固定两个 profile。
vi.mock("@/app/workspace/use-agent-profile-options", () => ({
    useDetectedAgentProfileOptions: () => [
        { name: "pi", label: "Pi", cmd: "pi", isDefault: true },
        { name: "claude", label: "Claude", cmd: "claude", isDefault: false },
    ],
}));

// 模型目录 mock：不触发 RPC（agentprofilelist），每组模型都带默认值，验证「点 agent 看到模型」。
vi.mock("@/app/workspace/agent-catalog", () => {
    const profiles = [
        {
            name: "pi",
            label: "Pi",
            cmd: "pi",
            defaultModel: "deepseek-v4.1-flash",
            models: [
                { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1", source: "discovery" },
                { id: "gpt-5.2", label: "GPT-5.2", source: "discovery" },
            ],
        },
        {
            name: "claude",
            label: "Claude",
            cmd: "claude",
            defaultModel: "claude-sonnet-4.5",
            models: [
                { id: "claude-sonnet-4.5", label: "Sonnet 4.5", source: "discovery" },
                { id: "claude-opus-4.5", label: "Opus 4.5", source: "discovery" },
            ],
        },
    ];
    return {
        loadAgentCatalog: async () => profiles,
        findAgentProfile: (list: any[], name: string | undefined) => list.find((p) => p.name === name) ?? null,
        pickDefaultModel: (profile: any) =>
            profile == null ? "" : (profile.defaultModel ?? "") || (profile.models?.[0]?.id ?? ""),
        modelOptionsFor: (profile: any, current: string | undefined) => {
            if (profile == null) return [];
            const options = [...(profile.models ?? [])];
            const value = typeof current === "string" ? current.trim() : "";
            if (value !== "" && !options.some((m) => m.id === value)) {
                options.push({ id: value, label: value, source: "task" });
            }
            return options;
        },
    };
});

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

beforeEach(async () => {
    // 文案断言需要真翻译（未 init 的 i18next 返回空串）：与 blockframe-header.menu.test 同款
    await initI18n("en");
    // 11-24 R3 起弹窗记忆走 localStorage：用例间必须清，否则「记住上次 agent」会串台。
    window.localStorage.clear();
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
    onSubmit?: (request: AddAgentSubmitRequest) => Promise<void> | void;
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

/** 等模型目录（loadAgentCatalog 的 promise）落到 state 里。 */
async function flushCatalog() {
    await act(async () => {
        await Promise.resolve();
    });
}

function rows(modalEl: HTMLElement) {
    return [...modalEl.querySelectorAll(".session-overview-add-agent-path")];
}

function modalButtons(modalEl: HTMLElement) {
    const footer = modalEl.querySelector(".modal-footer") as HTMLElement;
    const buttons = [...footer.querySelectorAll("button")];
    // 正常态 [取消, 创建]；发送失败态 [关闭]
    return { cancel: buttons.length > 1 ? buttons[0] : null, create: buttons[buttons.length - 1] };
}

async function clickCreate(modalEl: HTMLElement) {
    const { create } = modalButtons(modalEl);
    await act(async () => {
        (create as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("OverviewAddAgentModal 结构", () => {
    it("全局 Modal 居中壳 + 三段内容（发送内容 / agent+模型 / 路径）", async () => {
        mountModal();
        await flushCatalog();
        const modalEl = mainDiv?.querySelector(".session-overview-add-agent-modal") as HTMLElement;
        expect(modalEl).not.toBeNull();
        expect(modalEl.closest(".modal-wrapper")).not.toBeNull();
        expect(modalEl.querySelectorAll(".session-overview-add-agent-section")).toHaveLength(3);
        // ① 发送内容（多行输入）
        expect(modalEl.querySelector(".session-overview-add-agent-message")).not.toBeNull();
        // ② 模型选择器随 agent 展开
        expect(modalEl.querySelector(".session-overview-add-agent-model")).not.toBeNull();
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

describe("OverviewAddAgentModal 模型选择（v2：点 agent 展示对应模型，支持切换）", () => {
    it("默认展示该 agent 的默认模型；选项 = 默认项 + 目录模型", async () => {
        mountModal();
        await flushCatalog();
        const select = mainDiv.querySelector(".session-overview-add-agent-model-select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.value).toBe("");
        const options = [...select.querySelectorAll("option")].map((o) => o.textContent ?? "");
        expect(options[0]).toContain("deepseek-v4.1-flash");
        expect(options).toHaveLength(3); // 默认 + 2 个目录模型
    });

    it("切 agent 时模型选择回位到新 agent 的默认项", async () => {
        const { modalEl } = mountModal();
        await flushCatalog();
        const chips = modalEl.querySelectorAll(".session-overview-add-agent-chip-btn");
        act(() => {
            (chips[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        const select = modalEl.querySelector(".session-overview-add-agent-model-select") as HTMLSelectElement;
        expect(select.value).toBe("");
        const options = [...select.querySelectorAll("option")].map((o) => o.textContent ?? "");
        expect(options[0]).toContain("claude-sonnet-4.5");
    });

    it("切模型 → 提交请求带 modelOverride；不切则 null", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({ onSubmit });
        await flushCatalog();
        const select = modalEl.querySelector(".session-overview-add-agent-model-select") as HTMLSelectElement;
        act(() => {
            select.value = "gpt-5.2";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await clickCreate(modalEl);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modelOverride: "gpt-5.2" }));
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

describe("OverviewAddAgentModal 发送内容（v2）", () => {
    it("默认（未填）：message=null，只建块不发送", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({ onSubmit });
        await flushCatalog();
        await clickCreate(modalEl);
        expect(onSubmit).toHaveBeenCalledWith({
            tabId: "tab-1",
            tabName: "snorkel-dev",
            profileName: "pi",
            connection: null,
            cwd: "E:/code/snorkeling",
            message: null,
            modelOverride: null,
        });
    });

    it("填写内容：trim 后随请求下发", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({ onSubmit });
        await flushCatalog();
        const textarea = modalEl.querySelector(".session-overview-add-agent-message") as HTMLTextAreaElement;
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        act(() => {
            // 走原生 value setter：直接赋 textarea.value 不会触发 React 的 onChange
            valueSetter?.call(textarea, "  帮我跑一遍 frontend 单测  ");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await clickCreate(modalEl);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ message: "帮我跑一遍 frontend 单测" }));
    });

    it("远端路径：可输入但给出提示；消息为空时只建块（message=null）", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({
            targets: [RemoteTarget("b1", "/Users/nita/work")],
            defaultPath: "/Users/nita/work",
            onSubmit,
        });
        await flushCatalog();
        const textarea = modalEl.querySelector(".session-overview-add-agent-message") as HTMLTextAreaElement;
        // 不再禁用输入（禁用会让用户看不到自己已写的内容，也无从清理）
        expect(textarea.disabled).toBe(false);
        expect(modalEl.querySelector(".session-overview-add-agent-hint")).not.toBeNull();
        await clickCreate(modalEl);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ cwd: "/Users/nita/work", connection: "ssh://mac", message: null })
        );
    });

    it("远端路径 + 已写消息：显式拦下（不建块、不静默丢消息）", async () => {
        const onSubmit = vi.fn();
        const { modalEl } = mountModal({
            targets: [LocalTarget("b1", "E:/code/snorkeling"), RemoteTarget("b2", "/Users/nita/work")],
            defaultPath: "E:/code/snorkeling",
            onSubmit,
        });
        await flushCatalog();
        const textarea = modalEl.querySelector(".session-overview-add-agent-message") as HTMLTextAreaElement;
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        act(() => {
            valueSetter?.call(textarea, "这条消息不该被丢掉");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // 切到远端行：本地行 → 远端行
        act(() => {
            (rows(modalEl)[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        const hint = modalEl.querySelector(".session-overview-add-agent-hint");
        expect(hint?.classList.contains("is-error")).toBe(true);
        const { create } = modalButtons(modalEl);
        expect((create as HTMLButtonElement).disabled).toBe(true);
        await clickCreate(modalEl);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("建块失败：内联报错 + 保留取消/创建（可重试，失败时块没有建成功）", async () => {
        const onSubmit = vi.fn(async (): Promise<void> => {
            throw new Error("E_NOT_FOUND: tab gone");
        });
        const { modalEl } = mountModal({ onSubmit });
        await flushCatalog();
        await clickCreate(modalEl);
        const errorEl = modalEl.querySelector(".session-overview-add-agent-error");
        expect(errorEl).not.toBeNull();
        expect(errorEl?.textContent).toContain("E_NOT_FOUND");
        const { cancel, create } = modalButtons(modalEl);
        expect(cancel).not.toBeNull();
        expect((create as HTMLButtonElement).disabled).toBe(false);
        // 重试（不再是「只能关闭」的终态）
        await clickCreate(modalEl);
        expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it("派发不等待：onSubmit resolve 后弹窗结束（不因消息投递卡住）", async () => {
        const onSubmit = vi.fn(async (): Promise<void> => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        const { modalEl } = mountModal({ onSubmit });
        await flushCatalog();
        const t0 = Date.now();
        await clickCreate(modalEl);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ message: null, modelOverride: null })
        );
    });
});
