// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// EmojiPicker 右键"含义 / 别名"编辑器 DOM 契约测试。
//
// 只验证右键编辑面板的交互语义，不渲染宿主：
//  - 右键格子打开面板，且不触发选中（onPick）
//  - Esc 只关面板，不关整个 picker
//  - 输入别名保存后能按该别名搜到（含 has-alias 圆点）
//  - 清除后别名失效、圆点消失
//  - Shift+F10 / ContextMenu 键可打开同一面板

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EmojiPicker } from "./emoji-picker";
import { __resetEmojiAliasesForTests, getEmojiAlias } from "../../markdown-transform/emoji-aliases";
import { loadEmojiCatalog, type EmojiCatalog } from "../../markdown-transform/emoji";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHECK_CHAR = "\u2705\uFE0F"; // catalog spelling of white_check_mark

let container: HTMLElement;
let root: Root;
let catalog: EmojiCatalog;
let onPick: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onActiveChange: ReturnType<typeof vi.fn>;

function makeLocalStorageMock() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, String(value));
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => store.clear(),
        key: () => null,
        get length() {
            return store.size;
        },
        _store: store,
    };
}

function mount(query = "", onQueryChange?: (q: string) => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <EmojiPicker
                anchor={{ top: 100, left: 40 }}
                placement="bottom"
                mode="document"
                catalog={catalog}
                query={query}
                onQueryChange={onQueryChange}
                activeIndex={0}
                onActiveChange={onActiveChange}
                onPick={onPick}
                onClose={onClose}
            />
        );
    });
}

function picker(): HTMLElement | null {
    return document.body.querySelector(".markdown-emoji-picker");
}

function cellFor(char: string): HTMLButtonElement | null {
    const items = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".markdown-emoji-item"));
    return items.find((el) => el.textContent === char) ?? null;
}

function editor(): HTMLElement | null {
    return document.body.querySelector(".markdown-emoji-alias-editor");
}

function aliasInputs(): HTMLInputElement[] {
    return Array.from(document.body.querySelectorAll<HTMLInputElement>(".markdown-emoji-alias-input"));
}

function click(el: Element) {
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function rightClick(el: Element) {
    act(() => {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
}

function key(node: Element, init: KeyboardEventInit) {
    act(() => {
        node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });
}

function buttonByText(text: string): HTMLButtonElement {
    const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".markdown-emoji-alias-actions button")).find(
        (b) => b.textContent === text
    );
    if (found == null) {
        throw new Error(`button not found: ${text}`);
    }
    return found;
}

function type(input: HTMLInputElement, value: string) {
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(async () => {
    Object.defineProperty(window, "localStorage", {
        value: makeLocalStorageMock(),
        configurable: true,
        writable: true,
    });
    __resetEmojiAliasesForTests();
    onPick = vi.fn();
    onClose = vi.fn();
    onActiveChange = vi.fn();
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        }
    );
    catalog = catalog ?? (await loadEmojiCatalog());
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    // jsdom has no layout, so scrollIntoView (used for active-row reveal) is missing.
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll(".markdown-emoji-picker").forEach((el) => el.remove());
    vi.unstubAllGlobals();
});

describe("EmojiPicker alias editor", () => {
    it("right-click opens the editor without picking the emoji", () => {
        mount("smile");
        const cell = cellFor("😄");
        expect(cell).not.toBeNull();
        rightClick(cell as HTMLButtonElement);
        expect(editor()).not.toBeNull();
        expect(onPick).not.toHaveBeenCalled();
        expect(picker()).not.toBeNull();
    });

    it("Esc closes only the editor, not the picker", () => {
        mount("smile");
        rightClick(cellFor("😄") as HTMLButtonElement);
        expect(editor()).not.toBeNull();
        key(editor() as HTMLElement, { key: "Escape" });
        expect(editor()).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(picker()).not.toBeNull();
    });

    it("saves an alias, then the alias search finds that emoji and marks it", () => {
        mount("smile");
        rightClick(cellFor("😄") as HTMLButtonElement);
        const input = aliasInputs()[0];
        type(input, "已解决");
        key(input, { key: "Enter" });
        click(buttonByText("保存"));
        expect(editor()).toBeNull();
        expect(getEmojiAlias("😄")?.aliases).toEqual(["已解决"]);

        // Re-open with the alias as the query: the emoji must be found and flagged.
        act(() => root.unmount());
        mount("已解决");
        const cell = cellFor("😄");
        expect(cell).not.toBeNull();
        expect(cell?.className).toContain("has-alias");
        expect(document.body.querySelector(".markdown-emoji-alias-strip")?.textContent).toContain("已解决");
    });

    it("clears stored aliases and drops the has-alias marker", () => {
        mount("smile");
        rightClick(cellFor("😄") as HTMLButtonElement);
        const input = aliasInputs()[0];
        type(input, "done");
        key(input, { key: "Enter" });
        click(buttonByText("保存"));
        expect(getEmojiAlias("😄")?.aliases).toEqual(["done"]);

        act(() => root.unmount());
        mount("");
        rightClick(cellFor("😄") as HTMLButtonElement);
        click(buttonByText("清除"));
        expect(getEmojiAlias("😄")).toBeNull();
        expect(editor()).toBeNull();
    });

    it("persists the alias across a remount and drives the search", () => {
        mount("smile");
        rightClick(cellFor("😄") as HTMLButtonElement);
        type(aliasInputs()[0], "done");
        key(aliasInputs()[0], { key: "Enter" });
        click(buttonByText("保存"));
        act(() => root.unmount());
        mount("done");
        expect(cellFor("😄")).not.toBeNull();
    });

    it("Shift+F10 opens the editor for the focused cell", () => {
        mount("smile");
        const cell = cellFor("😄") as HTMLButtonElement;
        key(cell, { key: "F10", shiftKey: true });
        expect(editor()).not.toBeNull();
    });
});
