// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { i18n, initI18n } from "@/i18n/config";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const popModalMock = vi.fn();
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { popModal: () => popModalMock() },
}));

import { RestartConfirmModal } from "./restartconfirmmodal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderModal(props: Partial<React.ComponentProps<typeof RestartConfirmModal>>) {
    const container = document.createElement("div");
    container.id = "main";
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <RestartConfirmModal blockId="block:test" isAgent={false} onResolve={() => {}} {...props} />
        );
    });
    const unmount = () => {
        act(() => root.unmount());
        container.id = "";
        container.remove();
    };
    return { container, unmount };
}

function findButtons(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("button"));
}

beforeAll(async () => {
    // Pattern I: copy comes from `t()`, so expectations are recomputed through i18n.
    await initI18n("en");
});

describe("RestartConfirmModal", () => {
    beforeEach(() => {
        popModalMock.mockClear();
    });

    it("renders the restart prompt with cancel and restart actions", () => {
        const h = renderModal({});
        const texts = h.container.textContent ?? "";
        expect(texts).toContain(i18n.t("modals:restartConfirm.titleShell"));
        const labels = findButtons().map((b) => b.textContent?.trim());
        expect(labels).toContain(i18n.t("modals:modal.cancel"));
        expect(labels).toContain(i18n.t("modals:restartConfirm.restart"));
        h.unmount();
    });

    it("renders the agent-specific title and wording for agent blocks", () => {
        const h = renderModal({ isAgent: true });
        expect(h.container.textContent ?? "").toContain(i18n.t("modals:restartConfirm.titleAgent"));
        expect(h.container.textContent ?? "").toMatch(/auto-resume/i);
        h.unmount();
    });

    it("does not resolve with restart when cancelled", () => {
        const onResolve = vi.fn();
        const h = renderModal({ onResolve });
        const cancel = findButtons().find((b) => b.textContent?.trim() === i18n.t("modals:modal.cancel"));
        expect(cancel).toBeTruthy();
        act(() => {
            cancel!.click();
        });
        expect(onResolve).toHaveBeenCalledWith(false);
        expect(popModalMock).toHaveBeenCalled();
        h.unmount();
    });

    it("resolves with restart and pops the modal when confirmed", () => {
        const onResolve = vi.fn();
        const h = renderModal({ onResolve });
        const restart = findButtons().find(
            (b) => b.textContent?.trim() === i18n.t("modals:restartConfirm.restart")
        );
        expect(restart).toBeTruthy();
        act(() => {
            restart!.click();
        });
        expect(onResolve).toHaveBeenCalledWith(true);
        expect(popModalMock).toHaveBeenCalled();
        h.unmount();
    });

    it("only resolves once even on repeated clicks", () => {
        const onResolve = vi.fn();
        const h = renderModal({ onResolve });
        const restart = findButtons().find(
            (b) => b.textContent?.trim() === i18n.t("modals:restartConfirm.restart")
        );
        act(() => {
            restart!.click();
            restart!.click();
        });
        expect(onResolve).toHaveBeenCalledTimes(1);
        h.unmount();
    });
});