// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Self-check for the "more tabs" dropdown (inline-tab-block-more-btn) delete affordance.
// Covers: hover-revealed × rendering, close-without-activating, and Delete/Backspace key path.
// Run: npx vitest run frontend/app/block/inlinetab-dropdown.test.tsx

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { InlineTabStatusDot } from "./inlinetab-agent-status";
import { InlineTabDropdownMenu } from "./inlinetab-dropdown";

// react-dom's act() support is opt-in; without this flag every act() call warns.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handle = { container: HTMLElement; unmount: () => void };

function renderMenu(props: Partial<React.ComponentProps<typeof InlineTabDropdownMenu>>): Handle {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const root = createRoot(container);
    act(() => {
        root.render(
            <InlineTabDropdownMenu
                tabs={[
                    { id: "b1", title: "alpha", icon: "terminal", isActive: false },
                    { id: "b2", title: "beta", icon: "terminal", isActive: true },
                ]}
                activeTabId="b2"
                anchorRef={{ current: anchor }}
                isOpen={true}
                onOpenChange={() => {}}
                onSelect={() => {}}
                {...props}
            />
        );
    });
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
            anchor.remove();
        },
    };
}

function items(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".inline-tab-block-dropdown-item"));
}

describe("InlineTabDropdownMenu delete affordance", () => {
    beforeEach(() => {
        // floating-ui measures geometry; jsdom returns zeroes but must not throw.
        Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 100, 24);
    });

    afterEach(() => {
        document.querySelectorAll(".inline-tab-block-dropdown-menu").forEach((el) => el.remove());
    });

    test("renders one close button per row only when onClose is provided", () => {
        const onClose = vi.fn();
        const h = renderMenu({ onClose });
        expect(items().length).toBe(2);
        expect(document.querySelectorAll(".dropdown-item-close").length).toBe(2);
        // rows carry the block id so the key handler can resolve the delete target
        expect(items()[1].getAttribute("data-blockid")).toBe("b2");
        h.unmount();

        const h2 = renderMenu({ onClose: undefined });
        expect(items().length).toBe(2);
        expect(document.querySelectorAll(".dropdown-item-close").length).toBe(0);
        h2.unmount();
    });

    test("clicking × closes the row and does NOT activate the tab", () => {
        const onClose = vi.fn();
        const onSelect = vi.fn();
        const onOpenChange = vi.fn();
        const h = renderMenu({ onClose, onSelect, onOpenChange });
        const btn = document.querySelectorAll<HTMLButtonElement>(".dropdown-item-close")[0];
        act(() => {
            btn.click();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledWith("b1");
        expect(onSelect).not.toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
        h.unmount();
    });

    test("Delete / Backspace on a focused row closes that row", () => {
        const onClose = vi.fn();
        const onOpenChange = vi.fn();
        const h = renderMenu({ onClose, onOpenChange });
        const target = items()[0];
        act(() => {
            target.focus();
        });
        act(() => {
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
        });
        expect(onClose).toHaveBeenCalledWith("b1");
        expect(onOpenChange).toHaveBeenCalledWith(false);
        h.unmount();

        const onClose2 = vi.fn();
        const h2 = renderMenu({ onClose: onClose2 });
        const target2 = items()[1];
        act(() => {
            target2.focus();
        });
        act(() => {
            target2.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
        });
        expect(onClose2).toHaveBeenCalledWith("b2");
        h2.unmount();
    });

    test("arrow navigation still walks rows only (close buttons are not in the item set)", () => {
        const h = renderMenu({ onClose: vi.fn() });
        const rows = items();
        act(() => {
            rows[0].focus();
        });
        act(() => {
            rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        });
        expect(document.activeElement).toBe(rows[1]);
        act(() => {
            rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        });
        expect(document.activeElement).toBe(rows[0]);
        // close buttons stay out of the tab order
        expect(document.querySelectorAll<HTMLButtonElement>(".dropdown-item-close")[0].tabIndex).toBe(-1);
        h.unmount();
    });
});

describe("InlineTabDropdownMenu remote badge + agent status", () => {
    function makeDot(overrides: Partial<InlineTabStatusDot>): InlineTabStatusDot {
        return {
            state: "working",
            inferred: false,
            unread: true,
            doneUnread: false,
            doneElapsedText: "",
            title: "Working — click to mark as read",
            ...overrides,
        };
    }

    test("remote rows show the remote dot badge and carry the connection in its label", () => {
        const h = renderMenu({
            tabs: [
                { id: "b1", title: "alpha", icon: "terminal", isActive: false, isRemote: true, connection: "ssh:box" },
                { id: "b2", title: "beta", icon: "terminal", isActive: true },
            ],
        });
        const dots = document.querySelectorAll(".inline-tab-block-dropdown-remote-dot");
        expect(dots.length).toBe(1);
        expect(dots[0].getAttribute("title")).toBe("Remote: ssh:box");
        expect(dots[0].getAttribute("aria-label")).toBe("Remote connection");
        h.unmount();
    });

    test("row tooltip prefers the full path + connection over the short title", () => {
        const h = renderMenu({
            tabs: [
                {
                    id: "b1",
                    title: "main.go",
                    tooltip: "/home/u/proj/main.go · ssh:box",
                    icon: "eye",
                    isActive: false,
                },
            ],
        });
        expect(items()[0].getAttribute("title")).toBe("/home/u/proj/main.go · ssh:box");
        // aria-label stays short for screen readers
        expect(items()[0].getAttribute("aria-label")).toBe("main.go");
        h.unmount();
    });

    test("status dot carries state classes, renders the done check, and is ackable", () => {
        const onStatusAck = vi.fn();
        const h = renderMenu({
            tabs: [
                {
                    id: "b1",
                    title: "alpha",
                    icon: "terminal",
                    isActive: false,
                    statusDot: makeDot({}),
                },
                {
                    id: "b2",
                    title: "beta",
                    icon: "terminal",
                    isActive: true,
                    statusDot: makeDot({
                        state: "done",
                        unread: false,
                        doneUnread: true,
                        doneElapsedText: "1m",
                        title: "Idle — done 1m ago, switch to block to dismiss",
                    }),
                },
            ],
            onStatusAck,
        });
        const [working, done] = Array.from(document.querySelectorAll<HTMLElement>(".dropdown-item-status"));
        expect(working.className).toContain("is-working");
        expect(working.className).toContain("is-unread");
        expect(done.className).toContain("is-done");
        expect(done.className).toContain("is-done-unread");
        expect(done.querySelector("i.fa-check")).not.toBeNull();

        // Clicking an ackable dot acks it WITHOUT switching tabs
        act(() => {
            done.click();
        });
        expect(onStatusAck).toHaveBeenCalledTimes(1);
        expect(onStatusAck).toHaveBeenCalledWith("b2");
        h.unmount();
    });

    test("an acked (non-unread) dot is not clickable", () => {
        const onStatusAck = vi.fn();
        const h = renderMenu({
            tabs: [
                {
                    id: "b1",
                    title: "alpha",
                    icon: "terminal",
                    isActive: false,
                    statusDot: makeDot({ unread: false, title: "Working — up to date" }),
                },
            ],
            onStatusAck,
        });
        const dot = document.querySelector<HTMLElement>(".dropdown-item-status");
        expect(dot.getAttribute("role")).toBeNull();
        act(() => {
            dot.click();
        });
        expect(onStatusAck).not.toHaveBeenCalled();
        h.unmount();
    });
});
