// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const popModalMock = vi.fn();
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { popModal: () => popModalMock() },
}));

import { ConfirmModal } from "./confirmmodal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderModal(props: Partial<React.ComponentProps<typeof ConfirmModal>>) {
    const container = document.createElement("div");
    container.id = "main";
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <ConfirmModal
                title="Delete AI provider"
                message="Delete &quot;My AI&quot;?"
                onResolve={() => {}}
                {...props}
            />
        );
    });
    const unmount = () => {
        act(() => root.unmount());
        container.id = "";
        container.remove();
    };
    return { container, unmount };
}

function findButton(label: string): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>("button")).find(
        (btn) => btn.textContent?.trim() === label
    );
}

describe("ConfirmModal", () => {
    beforeEach(() => {
        popModalMock.mockClear();
        document.body.innerHTML = "";
    });

    it("renders the title, message and both actions", () => {
        const { unmount } = renderModal({ confirmLabel: "Delete", cancelLabel: "Cancel" });
        expect(document.body.textContent).toContain("Delete AI provider");
        expect(document.body.textContent).toContain("Delete \"My AI\"?");
        expect(findButton("Delete")).toBeTruthy();
        expect(findButton("Cancel")).toBeTruthy();
        unmount();
    });

    it("resolves true and pops the modal when confirmed", () => {
        const onResolve = vi.fn();
        const { unmount } = renderModal({ confirmLabel: "Delete", onResolve });
        act(() => findButton("Delete")?.click());
        expect(onResolve).toHaveBeenCalledWith(true);
        expect(popModalMock).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("resolves false when cancelled", () => {
        const onResolve = vi.fn();
        const { unmount } = renderModal({ onResolve });
        act(() => findButton("Cancel")?.click());
        expect(onResolve).toHaveBeenCalledWith(false);
        expect(popModalMock).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("only resolves once even on repeated clicks", () => {
        const onResolve = vi.fn();
        const { unmount } = renderModal({ confirmLabel: "Delete", onResolve });
        const confirmBtn = findButton("Delete");
        act(() => {
            confirmBtn?.click();
            confirmBtn?.click();
            findButton("Cancel")?.click();
        });
        expect(onResolve).toHaveBeenCalledTimes(1);
        expect(onResolve).toHaveBeenCalledWith(true);
        unmount();
    });

    it("renders explicit actions and resolves the selected action value", () => {
        const onAction = vi.fn();
        const { unmount } = renderModal({
            cancelLabel: "Cancel",
            actions: [
                { label: "移到回收站", value: "recycle", tone: "secondary" },
                { label: "彻底删除", value: "delete-permanently", tone: "destructive" },
            ],
            onAction,
        });
        expect(findButton("移到回收站")).toBeTruthy();
        expect(findButton("彻底删除")).toBeTruthy();
        act(() => findButton("彻底删除")?.click());
        expect(onAction).toHaveBeenCalledWith("delete-permanently");
        expect(popModalMock).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("resolves cancel as empty action when actions are provided", () => {
        const onAction = vi.fn();
        const onResolve = vi.fn();
        const { unmount } = renderModal({
            cancelLabel: "Cancel",
            actions: [{ label: "彻底删除", value: "delete-permanently", tone: "destructive" }],
            onAction,
            onResolve,
        });
        act(() => findButton("Cancel")?.click());
        expect(onAction).toHaveBeenCalledWith("");
        expect(onResolve).toHaveBeenCalledWith(false);
        unmount();
    });
});