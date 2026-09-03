// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Modal } from "./modal";

function ensureMainContainer(): HTMLDivElement {
    let el = document.getElementById("main");
    if (el == null) {
        el = document.createElement("div");
        el.id = "main";
        document.body.appendChild(el);
    }
    return el as HTMLDivElement;
}

function Harness({ initialFocusRef }: { initialFocusRef: React.RefObject<HTMLTextAreaElement> }) {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button">trigger</button>
            {open ? (
                <button type="button" onClick={() => setOpen(false)}>
                    focus-restore-target
                </button>
            ) : null}
            <Modal initialFocusRef={initialFocusRef}>
                <textarea ref={initialFocusRef} placeholder="note" />
            </Modal>
        </>
    );
}

let root: Root | null = null;

beforeEach(() => {
    ensureMainContainer();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    if (root != null) {
        root.unmount();
        root = null;
    }
    document.getElementById("main")?.replaceChildren();
});

function flushFrames() {
    return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe("Modal focus lifecycle", () => {
    test("focuses the initialFocusRef element after mount", async () => {
        const ref = createRef<HTMLTextAreaElement>();
        const container = ensureMainContainer();
        root = createRoot(container);
        act(() => {
            root!.render(<Harness initialFocusRef={ref} />);
        });
        await flushFrames();
        expect(document.activeElement).toBe(ref.current);
    });

    test("restores focus to the previously focused element on unmount", async () => {
        const ref = createRef<HTMLTextAreaElement>();
        const container = ensureMainContainer();
        const trigger = document.createElement("button");
        trigger.textContent = "before";
        document.body.appendChild(trigger);
        trigger.focus();
        root = createRoot(container);
        act(() => {
            root!.render(<Harness initialFocusRef={ref} />);
        });
        await flushFrames();
        expect(document.activeElement).toBe(ref.current);
        act(() => {
            root!.unmount();
            root = null;
        });
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });
});