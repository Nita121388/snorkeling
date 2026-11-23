// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 定时任务管理面弹窗的契约测试（jsdom，任务 11-23-schedtask-modal）。
//
// 锁定的回归点：
//  1. 打开后 atoms.modalOpen === true，卸载后复位（Modal 壳的 modal-open-registry 仲裁）；
//  2. 列表渲染 N 条 → 删除后 N-1 → 新建后 N+1（局部 state 即时 ±1，不重挂整块）；
//  3. 启停只更新同一条，不改变条数；
//  4. Esc 关闭弹窗；
//  5. 「新建 / 编辑」都复用 ScheduledTaskEditorModal（不复制表单）。

// @vitest-environment jsdom

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { initI18n } from "@/i18n/config";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bindModalOpenSink, resetModalOpenRegistryForTest } from "./modal-open-registry";

// global-atoms 的 `atoms` 只在 initGlobalAtoms()（需要 getApi/WOS 全套）后才存在；
// 单测里把它换成真实的 jotai atom，断言口径与 app.tsx 的绑定一致：
//   bindModalOpenSink((open) => globalStore.set(atoms.modalOpen, open))
vi.mock("@/app/store/global-atoms", async () => {
    const jotai = await import("jotai");
    return { atoms: { modalOpen: jotai.atom(false) } };
});

vi.mock("@/store/global-atoms", async () => {
    const jotai = await import("jotai");
    return { atoms: { modalOpen: jotai.atom(false) } };
});

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ScheduledTaskListCommand: vi.fn(),
        ScheduledTaskCreateCommand: vi.fn(),
        ScheduledTaskUpdateCommand: vi.fn(),
        ScheduledTaskDeleteCommand: vi.fn(),
        ScheduledTaskRunNowCommand: vi.fn(),
        ScheduledTaskHistoryCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/hero-roster", () => ({
    loadHeroRoster: vi.fn(async () => ({
        root: "",
        heroes: [{ id: "nita", name: "Nita", emoji: "🧭" }],
    })),
}));

import { ScheduledTaskManagerModal } from "./scheduledtask-manager-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Task = ScheduledTaskType;

function task(over: Partial<Task> = {}): Task {
    return {
        id: "t1",
        name: "nightly-notes",
        enabled: true,
        agentProfile: "pi",
        model: "gpt-5",
        prompt: "summarize",
        workdir: "",
        schedule: { type: "daily", timeOfDay: "09:00" },
        lastRunStatus: "success",
        createdBy: "user",
        ...over,
    } as Task;
}

const SEED: Task[] = [task({ id: "t1", name: "nightly-notes", hero: "nita" }), task({ id: "t2", name: "hourly-scan" })];

let container: HTMLDivElement;
let portalTarget: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

async function mount(props: { onClose?: () => void } = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(<ScheduledTaskManagerModal onClose={props.onClose} />);
    });
    await flush();
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-schedtask-row]"));

async function click(el: Element | null) {
    expect(el).not.toBeNull();
    await act(async () => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();
}

beforeAll(async () => {
    // 调度描述走 i18n（scheduledtasks 命名空间）；不初始化会渲染出空串。
    await initI18n("en");
});

beforeEach(() => {
    portalTarget = document.createElement("div");
    portalTarget.id = "main";
    document.body.appendChild(portalTarget);

    resetModalOpenRegistryForTest();
    bindModalOpenSink((open) => globalStore.set(atoms.modalOpen, open));

    while (modalsModel.hasOpenModals()) {
        modalsModel.popModal();
    }

    vi.mocked(RpcApi.ScheduledTaskListCommand).mockResolvedValue(structuredClone(SEED) as any);
    vi.mocked(RpcApi.ScheduledTaskCreateCommand).mockResolvedValue(undefined as any);
    vi.mocked(RpcApi.ScheduledTaskUpdateCommand).mockResolvedValue(undefined as any);
    vi.mocked(RpcApi.ScheduledTaskDeleteCommand).mockResolvedValue(undefined as any);
    vi.mocked(RpcApi.ScheduledTaskRunNowCommand).mockResolvedValue(undefined as any);
    vi.mocked(RpcApi.ScheduledTaskHistoryCommand).mockResolvedValue([] as any);
});

afterEach(() => {
    if (root != null) {
        act(() => root!.unmount());
        root = null;
    }
    container?.remove();
    portalTarget.remove();
    bindModalOpenSink(null);
    resetModalOpenRegistryForTest();
    while (modalsModel.hasOpenModals()) {
        modalsModel.popModal();
    }
    vi.clearAllMocks();
});

describe("ScheduledTaskManagerModal", () => {
    it("打开后 atoms.modalOpen 置位，卸载后复位", async () => {
        expect(globalStore.get(atoms.modalOpen)).toBe(false);
        await mount();
        expect(globalStore.get(atoms.modalOpen)).toBe(true);

        act(() => root!.unmount());
        root = null;
        expect(globalStore.get(atoms.modalOpen)).toBe(false);
    });

    it("渲染列表（名称 / hero emoji / 调度描述 / 上次状态）", async () => {
        await mount();
        const list = rows();
        expect(list).toHaveLength(2);
        expect(list[0].textContent).toContain("nightly-notes");
        // hero emoji 有则显示
        expect(list[0].textContent).toContain("🧭");
        // 调度描述（每天 09:00）与上次状态
        expect(list[0].textContent).toContain("09:00");
        expect(list[0].textContent).toContain("success");
    });

    it("删除（带确认）后条数 -1", async () => {
        await mount();
        const first = rows()[0];
        await click(first.querySelector("[data-schedtask-delete]"));
        // 第一次点击只是进入确认态，不落 RPC
        expect(RpcApi.ScheduledTaskDeleteCommand).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(2);

        await click(first.querySelector("[data-schedtask-delete-confirm]"));
        expect(RpcApi.ScheduledTaskDeleteCommand).toHaveBeenCalledTimes(1);
        expect(vi.mocked(RpcApi.ScheduledTaskDeleteCommand).mock.calls[0][1]).toBe("t1");
        expect(rows()).toHaveLength(1);
    });

    it("新建复用 ScheduledTaskEditorModal，保存成功后条数 +1", async () => {
        await mount();
        await click(document.querySelector("[data-schedtask-new]"));

        const stack = globalStore.get(modalsModel.modalsAtom);
        const editor = stack[stack.length - 1];
        expect(editor.displayName).toBe("ScheduledTaskEditorModal");
        expect(editor.props.isNew).toBe(true);

        const draft = task({ id: "", name: "fresh-task" });
        let err: string | null = "unset";
        await act(async () => {
            err = await editor.props.onSave(draft);
        });
        await flush();

        expect(err).toBeNull();
        expect(RpcApi.ScheduledTaskCreateCommand).toHaveBeenCalledTimes(1);
        expect(rows()).toHaveLength(3);
        expect(document.body.textContent).toContain("fresh-task");
    });

    it("编辑复用 ScheduledTaskEditorModal（isNew=false），保存不改变条数", async () => {
        await mount();
        await click(rows()[0].querySelector("[data-schedtask-edit]"));

        const stack = globalStore.get(modalsModel.modalsAtom);
        const editor = stack[stack.length - 1];
        expect(editor.displayName).toBe("ScheduledTaskEditorModal");
        expect(editor.props.isNew).toBe(false);
        expect(editor.props.task.id).toBe("t1");

        await act(async () => {
            await editor.props.onSave({ ...editor.props.task, name: "renamed" });
        });
        await flush();

        expect(RpcApi.ScheduledTaskUpdateCommand).toHaveBeenCalledTimes(1);
        expect(rows()).toHaveLength(2);
        expect(rows()[0].textContent).toContain("renamed");
    });

    it("启停：只更新同一条，不改变条数", async () => {
        await mount();
        const toggle = rows()[0].querySelector("[data-schedtask-toggle]") as HTMLElement;
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        await click(toggle);
        expect(RpcApi.ScheduledTaskUpdateCommand).toHaveBeenCalledTimes(1);
        expect(rows()).toHaveLength(2);
        expect(rows()[0].querySelector("[data-schedtask-toggle]")!.getAttribute("aria-checked")).toBe("false");
    });

    it("立即运行沿用 ScheduledTaskRunNowCommand", async () => {
        await mount();
        await click(rows()[1].querySelector("[data-schedtask-run]"));
        expect(RpcApi.ScheduledTaskRunNowCommand).toHaveBeenCalledTimes(1);
        expect(vi.mocked(RpcApi.ScheduledTaskRunNowCommand).mock.calls[0][1]).toBe("t2");
    });

    it("Esc 关闭弹窗", async () => {
        const onClose = vi.fn();
        await mount({ onClose });
        const shell = document.querySelector<HTMLElement>(".schedtask-manager")!;
        expect(shell).not.toBeNull();

        await act(async () => {
            shell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点 ✕ 关闭", async () => {
        const onClose = vi.fn();
        await mount({ onClose });
        await click(document.querySelector(".modal-close--inline"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("空列表时给出空态与新建入口", async () => {
        vi.mocked(RpcApi.ScheduledTaskListCommand).mockResolvedValue([] as any);
        await mount();
        expect(rows()).toHaveLength(0);
        expect(document.querySelector("[data-schedtask-empty]")).not.toBeNull();
        expect(document.querySelector("[data-schedtask-new]")).not.toBeNull();
    });
});
