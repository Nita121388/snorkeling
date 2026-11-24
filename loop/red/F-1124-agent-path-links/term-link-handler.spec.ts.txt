// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { createTerminalLinkHandler, type TerminalLinkHandlerDeps } from "./term-link-handler";

function makeDeps(overrides: Partial<TerminalLinkHandlerDeps> = {}): {
    deps: TerminalLinkHandlerDeps;
    openNativePath: ReturnType<typeof vi.fn>;
    openExternal: ReturnType<typeof vi.fn>;
    openLinkBlock: ReturnType<typeof vi.fn>;
    onHoverChange: ReturnType<typeof vi.fn>;
} {
    const openNativePath = vi.fn();
    const openExternal = vi.fn();
    const openLinkBlock = vi.fn();
    const onHoverChange = vi.fn();
    const deps: TerminalLinkHandlerDeps = {
        isMac: false,
        openNativePath,
        openExternal,
        openLinkBlock,
        onHoverChange,
        ...overrides,
    };
    return { deps, openNativePath, openExternal, openLinkBlock, onHoverChange };
}

const clickEvent = (mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    preventDefault: vi.fn(),
});

describe("createTerminalLinkHandler", () => {
    it("allows non-http protocols so xterm does not drop OSC 8 file links", () => {
        const { deps } = makeDeps();
        expect(createTerminalLinkHandler(deps).allowNonHttpProtocols).toBe(true);
    });

    it("opens a file:// link with the native app on ctrl+click", () => {
        const { deps, openNativePath, openExternal, openLinkBlock } = makeDeps();
        createTerminalLinkHandler(deps).activate(clickEvent({ ctrlKey: true }), "file:///E:/code/a.html");
        expect(openNativePath).toHaveBeenCalledWith("E:/code/a.html");
        expect(openExternal).not.toHaveBeenCalled();
        expect(openLinkBlock).not.toHaveBeenCalled();
    });

    it("does nothing without the modifier key", () => {
        const { deps, openNativePath, openExternal, openLinkBlock } = makeDeps();
        const handler = createTerminalLinkHandler(deps);
        handler.activate(clickEvent(), "file:///E:/code/a.html");
        handler.activate(clickEvent(), "https://example.com/x");
        expect(openNativePath).not.toHaveBeenCalled();
        expect(openExternal).not.toHaveBeenCalled();
        expect(openLinkBlock).not.toHaveBeenCalled();
    });

    it("routes http(s) links to the block opener", () => {
        const { deps, openNativePath, openLinkBlock } = makeDeps();
        createTerminalLinkHandler(deps).activate(clickEvent({ ctrlKey: true }), "https://example.com/x");
        expect(openLinkBlock).toHaveBeenCalledWith("https://example.com/x");
        expect(openNativePath).not.toHaveBeenCalled();
    });

    it("strips the vscode://file prefix and opens the local file", () => {
        const { deps, openNativePath } = makeDeps();
        createTerminalLinkHandler(deps).activate(clickEvent({ ctrlKey: true }), "vscode://file/E:/code/a.ts");
        expect(openNativePath).toHaveBeenCalledWith("E:/code/a.ts");
    });

    it("refuses javascript: and other unsupported schemes", () => {
        const { deps, openNativePath, openExternal, openLinkBlock } = makeDeps();
        const handler = createTerminalLinkHandler(deps);
        handler.activate(clickEvent({ ctrlKey: true }), "javascript:alert(1)");
        handler.activate(clickEvent({ ctrlKey: true }), "hello world");
        expect(openNativePath).not.toHaveBeenCalled();
        expect(openExternal).not.toHaveBeenCalled();
        expect(openLinkBlock).not.toHaveBeenCalled();
    });

    it("uses metaKey as the modifier on macOS and ignores ctrl", () => {
        const { deps, openNativePath } = makeDeps({ isMac: true });
        const handler = createTerminalLinkHandler(deps);
        handler.activate(clickEvent({ ctrlKey: true }), "file:///E:/code/a.html");
        expect(openNativePath).not.toHaveBeenCalled();
        handler.activate(clickEvent({ metaKey: true }), "file:///E:/code/a.html");
        expect(openNativePath).toHaveBeenCalledWith("E:/code/a.html");
    });

    it("reports hover and leave so tooltip + context menu can follow OSC 8 links", () => {
        const { deps, onHoverChange } = makeDeps();
        const handler = createTerminalLinkHandler(deps);
        handler.hover({ clientX: 12, clientY: 34 }, "file:///E:/code/a.html");
        expect(onHoverChange).toHaveBeenLastCalledWith("file:///E:/code/a.html", 12, 34);
        handler.leave();
        expect(onHoverChange).toHaveBeenLastCalledWith(null, 0, 0);
    });
});
