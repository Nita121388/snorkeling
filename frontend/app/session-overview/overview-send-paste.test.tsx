// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 发送框粘贴图片（11-24 R9）的 DOM 契约：
//   · 图片粘贴 → 落盘 overview-send-images（writePasteImage 带 subdir）→ 光标处插 markdown 引用；
//   · 纯文本粘贴零变化（不 preventDefault、不打落盘）；
//   · 超限（>10MB）→ 内联提示，草稿不插半截引用；
//   · 落盘失败 → 内联提示，草稿不变（不留半截引用）；
//   · 远端块（connection 非空）→ 不落盘，内联「远端暂不支持」提示。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePasteImage } from "@/app/commontext/commontext-paste-image";
import { RpcApi } from "@/app/store/wshclientapi";
import { initI18n } from "@/i18n/config";
import { CardSendContext, CardSendPanel, useCardSendState, type CardSendState } from "./overview-card-send-panel";

vi.mock("@/app/commontext/commontext-paste-image", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/commontext/commontext-paste-image")>();
    return {
        ...actual,
        writePasteImage: vi.fn(async (blob: Blob) => `/data/overview-send-images/clip.${blob.type.split("/")[1]}`),
    };
});
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { AgentSendCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stateRef: CardSendState;
const reload = vi.fn();

function PanelHarness(props: { blockId: string; connection?: string | null }) {
    const state = useCardSendState(reload);
    stateRef = state;
    return (
        <CardSendContext.Provider value={state}>
            <CardSendPanel
                blockId={props.blockId}
                sessionId="s-1"
                variant="inline"
                connection={props.connection}
            />
        </CardSendContext.Provider>
    );
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

function mountPanel(blockId: string, connection?: string | null): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(<PanelHarness blockId={blockId} connection={connection} />);
    });
    return container;
}

function pasteEvent(container: HTMLElement, items: Array<{ kind?: string; type?: string; getAsFile?: () => Blob | null }>) {
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-overview-card-send-input]")!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    (event as unknown as { clipboardData: unknown }).clipboardData = { items };
    return { textarea, event };
}

function imageItem(size = 64, type = "image/png") {
    const blob = new Blob([new Uint8Array(size)], { type });
    return { kind: "file", type, getAsFile: () => blob };
}

beforeEach(async () => {
    window.localStorage.clear();
    await initI18n("en");
    vi.mocked(writePasteImage).mockClear();
});

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    window.localStorage.clear();
});

describe("CardSendPanel 粘贴图片（11-24 R9）", () => {
    it("图片粘贴：落盘 overview-send-images 子目录并在光标处插入 markdown", async () => {
        const container = mountPanel("b-paste");
        const { textarea, event } = pasteEvent(container, [imageItem()]);
        act(() => {
            textarea.dispatchEvent(event);
        });
        expect(writePasteImage).toHaveBeenCalledTimes(1);
        expect(vi.mocked(writePasteImage).mock.calls[0][1]).toMatchObject({ subdir: "overview-send-images" });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(stateRef.draftByBlock["b-paste"]).toContain("![pasted image](/data/overview-send-images/clip.png)");
        expect(container.querySelector("[data-overview-card-send-paste-warning]")).toBeNull();
    });

    it("纯文本粘贴零变化：不落盘、不 preventDefault、草稿不变", () => {
        const container = mountPanel("b-text");
        const { textarea, event } = pasteEvent(container, [
            { kind: "string", type: "text/plain", getAsFile: () => new Blob(["hello"], { type: "text/plain" }) },
        ]);
        act(() => {
            textarea.dispatchEvent(event);
        });
        expect(writePasteImage).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
        expect(stateRef.draftByBlock["b-text"]).toBeUndefined();
    });

    it("超限图片：内联提示且不插半截引用", async () => {
        const container = mountPanel("b-big");
        const { textarea, event } = pasteEvent(container, [imageItem(11 * 1024 * 1024)]);
        act(() => {
            textarea.dispatchEvent(event);
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(event.defaultPrevented).toBe(true);
        expect(writePasteImage).not.toHaveBeenCalled();
        expect(stateRef.draftByBlock["b-big"]).toBeUndefined();
        const warning = container.querySelector<HTMLElement>("[data-overview-card-send-paste-warning]");
        expect(warning).not.toBeNull();
        expect(warning!.textContent).toContain("limit is 10.0 MB");
    });

    it("落盘失败：内联提示，草稿不变（不留半截引用）", async () => {
        vi.mocked(writePasteImage).mockRejectedValueOnce(new Error("disk full"));
        const container = mountPanel("b-fail");
        const { textarea, event } = pasteEvent(container, [imageItem()]);
        act(() => {
            textarea.dispatchEvent(event);
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(stateRef.draftByBlock["b-fail"]).toBeUndefined();
        const warning = container.querySelector<HTMLElement>("[data-overview-card-send-paste-warning]");
        expect(warning).not.toBeNull();
        expect(warning!.textContent).toContain("disk full");
    });

    it("远端块：不落盘，内联「远端暂不支持」提示", async () => {
        const container = mountPanel("b-remote", "ssh-host");
        const { textarea, event } = pasteEvent(container, [imageItem()]);
        act(() => {
            textarea.dispatchEvent(event);
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(event.defaultPrevented).toBe(true);
        expect(writePasteImage).not.toHaveBeenCalled();
        expect(stateRef.draftByBlock["b-remote"]).toBeUndefined();
        const warning = container.querySelector<HTMLElement>("[data-overview-card-send-paste-warning]");
        expect(warning).not.toBeNull();
        expect(warning!.textContent).toContain("remote");
    });
});
