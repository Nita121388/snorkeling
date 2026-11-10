// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SyncConflictModal 契约（jsdom）：
//
//   1. 冲突列表渲染自 SyncConflicts（含标题 / id / 元信息）；
//   2. 每条冲突旁有 CopyForAgent（单条复制走 SyncConflictCopy，Go 端渲染同一源）；
//   3. 粘回合并文本 → Resolve 走 SyncResolve，成功后列表刷新并回调 onResolved；
//   4. 空文本 / 失败不静默：错误可见、按钮恢复可点。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const popModalMock = vi.fn();
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { popModal: () => popModalMock() },
}));

const syncConflictsMock = vi.fn();
const syncConflictCopyMock = vi.fn();
const syncResolveMock = vi.fn();
vi.mock("@/app/store/services", () => ({
    CommonTextService: {
        SyncConflicts: () => syncConflictsMock(),
        SyncConflictCopy: (req: { id: string }) => syncConflictCopyMock(req),
        SyncResolve: (req: { id: string; text: string }) => syncResolveMock(req),
    },
}));

import { SyncConflictModal } from "./syncconflictmodal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function conflict(id: string, title = "Checklist"): Entry {
    return {
        id,
        fields: ["text"],
        title,
        detectedAt: "2026-11-10T10:00:00Z",
        deviceName: "Work Mac",
        transport: "server",
        local: { id, title, text: "local" },
        remote: { id, title, text: "remote" },
    };
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

function renderModal(onResolved?: () => void) {
    const container = document.createElement("div");
    container.id = "main";
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<SyncConflictModal onResolved={onResolved} />);
    });
    const unmount = () => {
        act(() => root.unmount());
        container.id = "";
        container.remove();
    };
    return { unmount };
}

function byData<T extends Element = HTMLElement>(attr: string): T | undefined {
    return document.querySelector<T>(`[${attr}]`) ?? undefined;
}

describe("SyncConflictModal", () => {
    beforeEach(() => {
        popModalMock.mockClear();
        syncConflictsMock.mockReset();
        syncConflictCopyMock.mockReset();
        syncResolveMock.mockReset();
        document.body.innerHTML = "";
    });

    it("renders one row per unresolved conflict with a copy-for-agent button", async () => {
        syncConflictsMock.mockResolvedValue({ conflicts: [conflict("ct1"), conflict("ct2", "Tasks")] });
        const { unmount } = renderModal();
        await flush();

        expect(byData("data-sync-conflict-row=ct1")).toBeTruthy();
        expect(byData("data-sync-conflict-row=ct2")).toBeTruthy();
        const copyButtons = document.querySelectorAll("[data-copy-for-agent]");
        expect(copyButtons.length).toBe(2);
        expect(document.body.textContent).toContain("Work Mac");
        unmount();
    });

    it("renders the empty state when there is nothing to resolve", async () => {
        syncConflictsMock.mockResolvedValue({ conflicts: [] });
        const { unmount } = renderModal();
        await flush();

        expect(byData("data-sync-conflict-row=ct1")).toBeUndefined();
        expect(document.body.textContent).toContain("Nothing to resolve");
        unmount();
    });

    it("copies a single conflict through the Go renderer", async () => {
        syncConflictsMock.mockResolvedValue({ conflicts: [conflict("ct1")] });
        syncConflictCopyMock.mockResolvedValue({ count: 1, text: "## Sync conflict: Checklist" });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        const { unmount } = renderModal();
        await flush();

        const copyButton = document.querySelector<HTMLElement>("[data-copy-for-agent]");
        await act(async () => {
            copyButton.click();
        });
        expect(syncConflictCopyMock).toHaveBeenCalledWith({ id: "ct1" });
        expect(writeText).toHaveBeenCalledWith("## Sync conflict: Checklist");
        unmount();
    });

    it("resolves with the pasted merged text and refreshes the list", async () => {
        syncConflictsMock
            .mockResolvedValueOnce({ conflicts: [conflict("ct1")] })
            .mockResolvedValueOnce({ conflicts: [] });
        syncResolveMock.mockResolvedValue({ status: { conflicts: 0 } });
        const onResolved = vi.fn();

        const { unmount } = renderModal(onResolved);
        await flush();

        const textarea = byData<HTMLTextAreaElement>("data-sync-merged-input=ct1");
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
            setValue.call(textarea, "merged text");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            byData<HTMLButtonElement>("data-sync-resolve-action=ct1").click();
        });
        await flush();
        await flush();

        expect(syncResolveMock).toHaveBeenCalledWith({ id: "ct1", text: "merged text" });
        expect(onResolved).toHaveBeenCalledTimes(1);
        // Second load returned an empty list: the row is gone.
        expect(byData("data-sync-conflict-row=ct1")).toBeUndefined();
        unmount();
    });

    it("refuses empty text and surfaces resolve failures instead of silently hiding them", async () => {
        syncConflictsMock.mockResolvedValue({ conflicts: [conflict("ct1")] });
        const { unmount } = renderModal();
        await flush();

        // Empty paste: refused locally, no RPC.
        await act(async () => {
            byData<HTMLButtonElement>("data-sync-resolve-action=ct1").click();
        });
        expect(syncResolveMock).not.toHaveBeenCalled();
        expect(byData("data-sync-resolve-error=ct1")?.textContent).toContain("Paste the merged text first");

        // Backend rejection stays visible and the button becomes clickable again.
        syncResolveMock.mockRejectedValue(new Error("no unresolved conflict with id \"ct1\""));
        const textarea = byData<HTMLTextAreaElement>("data-sync-merged-input=ct1");
        await act(async () => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
            setValue.call(textarea, "merged");
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            byData<HTMLButtonElement>("data-sync-resolve-action=ct1").click();
        });
        await flush();
        await flush();

        expect(byData("data-sync-resolve-error=ct1")?.textContent).toContain("no unresolved conflict");
        expect(byData<HTMLButtonElement>("data-sync-resolve-action=ct1").disabled).toBe(false);
        unmount();
    });
});
