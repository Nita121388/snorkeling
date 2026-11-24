// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// composer footer「存到 Common Text」（11-24 R5）+ 草稿持久化（R4）的 DOM 契约：
//   · 草稿为空 → 按钮 disabled；
//   · 点击 → upsertCommonTextItem({ title:"", text: draft })，**不发送、不清草稿**；
//   · 成功 → 内联「已存到」反馈（3s 消失），草稿仍在输入框；
//   · 重复 → 内联「已存在」提示，不弹窗、不抛红错；
//   · 草稿持久化：setDraft 防抖 400ms 落 localStorage，重挂载后草稿仍在；发送成功清除。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertCommonTextItem } from "@/app/commontext/commontext-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { initI18n } from "@/i18n/config";
import { OverviewSendDraftStorageKey } from "./overview-input-memory";
import { CardSendContext, CardSendPanel, useCardSendState, type CardSendState } from "./overview-card-send-panel";

vi.mock("@/app/commontext/commontext-model", () => ({
    upsertCommonTextItem: vi.fn(),
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { AgentSendCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stateRef: CardSendState;
const reload = vi.fn();

function PanelHarness(props: { blockId: string }) {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <CardSendPanel blockId={props.blockId} sessionId="s-1" variant="inline" />
        </CardSendContext.Provider>
    );
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

function mountPanel(blockId: string): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(<PanelHarness blockId={blockId} />);
    });
    return container;
}

function textareaOf(container: HTMLElement): HTMLTextAreaElement {
    const node = container.querySelector<HTMLTextAreaElement>("[data-overview-card-send-input]");
    expect(node).not.toBeNull();
    return node!;
}

function saveButton(container: HTMLElement): HTMLButtonElement {
    const node = container.querySelector<HTMLButtonElement>("[data-overview-card-send-save-commontext]");
    expect(node).not.toBeNull();
    return node!;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeEach(async () => {
    window.localStorage.clear();
    await initI18n("en");
    vi.mocked(upsertCommonTextItem).mockReset();
    vi.mocked(RpcApi.AgentSendCommand).mockReset();
});

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    window.localStorage.clear();
    vi.useRealTimers();
});

describe("CardSendPanel 存到 CommonText + 草稿持久化（11-24 R4/R5）", () => {
    it("草稿为空 → 存 CommonText 按钮 disabled", () => {
        const container = mountPanel("b-empty");
        expect(saveButton(container).disabled).toBe(true);
    });

    it("点击存 CommonText：调用 upsert、不发送、不清草稿、成功内联反馈", async () => {
        vi.mocked(upsertCommonTextItem).mockResolvedValue({} as never);
        const container = mountPanel("b-save");
        act(() => {
            stateRef.setDraft("b-save", "hello draft");
        });
        expect(saveButton(container).disabled).toBe(false);

        await act(async () => {
            saveButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(upsertCommonTextItem).toHaveBeenCalledWith({ title: "", text: "hello draft" });
        // 不发送、不清草稿。
        expect(RpcApi.AgentSendCommand).not.toHaveBeenCalled();
        expect(stateRef.draftByBlock["b-save"]).toBe("hello draft");
        const feedback = container.querySelector<HTMLElement>("[data-overview-card-send-save-feedback]");
        expect(feedback).not.toBeNull();
        expect(feedback!.getAttribute("data-overview-card-send-save-feedback")).toBe("saved");
    });

    it("重复内容 → 内联「已存在」提示，不抛错", async () => {
        vi.mocked(upsertCommonTextItem).mockRejectedValue(new Error("Common text already exists: x"));
        const container = mountPanel("b-dup");
        act(() => {
            stateRef.setDraft("b-dup", "dup text");
        });
        await act(async () => {
            saveButton(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        const feedback = container.querySelector<HTMLElement>("[data-overview-card-send-save-feedback]");
        expect(feedback).not.toBeNull();
        expect(feedback!.getAttribute("data-overview-card-send-save-feedback")).toBe("duplicate");
        expect(stateRef.draftByBlock["b-dup"]).toBe("dup text");
    });

    it("草稿防抖 400ms 落 localStorage，重挂载后仍在", async () => {
        vi.useFakeTimers();
        try {
            const container = mountPanel("b-persist");
            const node = textareaOf(container);
            act(() => {
                // React 的 value tracker 会吞掉直接赋值：先走原生 setter 再派发 input。
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,
                    "value"
                )!.set!;
                nativeSetter.call(node, "persistent draft");
                node.dispatchEvent(new Event("input", { bubbles: true }));
            });
            // 防抖窗口内还没落盘。
            expect(window.localStorage.getItem(OverviewSendDraftStorageKey)).toBeNull();
            act(() => {
                vi.advanceTimersByTime(500);
            });
            const stored = JSON.parse(window.localStorage.getItem(OverviewSendDraftStorageKey)!);
            expect(stored["b-persist"].text).toBe("persistent draft");

            // 重挂载（等价重开面板/重启应用）：新 hook 实例从 storage 恢复。
            act(() => {
                const { root } = mounted[0];
                root.unmount();
                mounted.splice(0);
            });
            const container2 = mountPanel("b-persist");
            expect(textareaOf(container2).value).toBe("persistent draft");
        } finally {
            vi.useRealTimers();
        }
    });

    it("unknown 态（客户端超时）：不渲染 [重试]（防重复投递）", async () => {
        vi.mocked(RpcApi.AgentSendCommand).mockRejectedValue(new Error("EC-TIME: timeout waiting for response"));
        const container = mountPanel("b-unknown");
        act(() => {
            stateRef.setDraft("b-unknown", "may or may not have been sent");
        });
        act(() => {
            stateRef.submit({ blockId: "b-unknown", sessionId: "s-1" }, "may or may not have been sent", {
                waitReply: true,
            });
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        // 结果未知徽章存在；绝不给 [重试]。
        expect(container.querySelector("[data-overview-card-send-unknown]")).not.toBeNull();
        expect(container.querySelectorAll("[data-overview-card-send-retry]")).toHaveLength(0);
        // unknown 保留草稿（用户核实后再处置）。
        expect(stateRef.draftByBlock["b-unknown"]).toBe("may or may not have been sent");
    });

    it("发送成功后草稿清除（storage 同步清）", async () => {
        vi.mocked(RpcApi.AgentSendCommand).mockResolvedValue({ ok: true, submitconfirmed: true } as never);
        vi.useFakeTimers();
        try {
            const container = mountPanel("b-clear");
            act(() => {
                stateRef.setDraft("b-clear", "to be sent");
            });
            act(() => {
                vi.advanceTimersByTime(500); // 落盘
            });
            expect(JSON.parse(window.localStorage.getItem(OverviewSendDraftStorageKey)!)["b-clear"]).toBeTruthy();
            act(() => {
                stateRef.submit({ blockId: "b-clear", sessionId: "s-1" }, "to be sent", { waitReply: true });
            });
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(stateRef.draftByBlock["b-clear"]).toBeUndefined();
            expect(
                JSON.parse(window.localStorage.getItem(OverviewSendDraftStorageKey) ?? "{}")["b-clear"]
            ).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
