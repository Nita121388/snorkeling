// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// React 19 requires the act() environment flag in jsdom.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { modalsModel } from "@/app/store/modalmodel";
import { HeroCreateWizard } from "@/app/view/hero/hero-create-wizard";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression for the modal-close bug (2026-11-13, user report): the modal
// registry does NOT inject onClose (ModalsRenderer spreads only the pushed
// props), so closing must fall back to modalsModel.popModal() instead of
// calling an undefined onClose.
describe("HeroCreateWizard close contract", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        // Modal portals into #main (modal.tsx), which jsdom bodies don't have.
        const main = document.createElement("div");
        main.id = "main";
        document.body.appendChild(main);
        container = document.createElement("div");
        main.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById("main")?.remove();
        vi.restoreAllMocks();
    });

    it("closes via modalsModel.popModal() when no onClose prop is passed (registry path)", () => {
        const popSpy = vi.spyOn(modalsModel, "popModal").mockImplementation(() => {});
        act(() => {
            root.render(<HeroCreateWizard source="hero-picker" />);
        });
        const closeBtn = document.querySelector<HTMLButtonElement>('[aria-label="Close"]');
        expect(closeBtn).toBeTruthy();
        act(() => {
            closeBtn!.click();
        });
        expect(popSpy).toHaveBeenCalledTimes(1);
    });

    it("prefers a directly passed onClose (direct-render path)", () => {
        const popSpy = vi.spyOn(modalsModel, "popModal").mockImplementation(() => {});
        const onClose = vi.fn();
        act(() => {
            root.render(<HeroCreateWizard source="hero-picker" onClose={onClose} />);
        });
        const closeBtn = document.querySelector<HTMLButtonElement>('[aria-label="Close"]');
        act(() => {
            closeBtn!.click();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(popSpy).not.toHaveBeenCalled();
    });

    it("Escape closes via popModal() without throwing", () => {
        const popSpy = vi.spyOn(modalsModel, "popModal").mockImplementation(() => {});
        act(() => {
            root.render(<HeroCreateWizard source="hero-picker" />);
        });
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(popSpy).toHaveBeenCalledTimes(1);
    });

    it("renders step 1 identity fields with the prefilled name", () => {
        act(() => {
            root.render(<HeroCreateWizard source="hero-picker" sessionTitle="Backup Guard" />);
        });
        const text = document.body.textContent ?? "";
        expect(text).toContain("Step 1 of 2 · Identity");
        expect(text).toContain("id preview");
        const nameInput = document.querySelector<HTMLInputElement>('input[type="text"]');
        expect(nameInput?.value).toBe("Backup Guard");
    });
});
