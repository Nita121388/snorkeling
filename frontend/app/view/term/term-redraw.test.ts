// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const redrawMock = vi.fn().mockResolvedValue(undefined);
const destroyMock = vi.fn().mockResolvedValue(undefined);
const resyncMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ControllerRedrawCommand: (...args: unknown[]) => redrawMock(...args),
        ControllerDestroyCommand: (...args: unknown[]) => destroyMock(...args),
        ControllerResyncCommand: (...args: unknown[]) => resyncMock(...args),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
    DefaultRouter: { registerRoute: vi.fn() },
}));

import { TermViewModel } from "./term-model";

// Construct a minimal TermViewModel-shaped instance without running the heavy
// constructor (RPC subscriptions, jotai stores, router registration).
function makeViewModel() {
    const vm = Object.create(TermViewModel.prototype);
    vm.blockId = "block:test-redraw";
    vm.termRef = { current: null };
    return vm;
}

describe("TermViewModel.redrawTUI", () => {
    beforeEach(() => {
        redrawMock.mockClear();
        destroyMock.mockClear();
        resyncMock.mockClear();
    });

    it("sends an xterm refresh when a terminal is attached", async () => {
        const refresh = vi.fn();
        const vm = makeViewModel();
        vm.termRef = {
            current: { terminal: { rows: 24, refresh } },
        };
        vm.redrawTUI();
        await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
        expect(refresh).toHaveBeenCalledWith(0, 23);
    });

    it("still fires the RPC when no terminal is attached (frontend repaint is optional)", async () => {
        const vm = makeViewModel();
        vm.redrawTUI();
        await vi.waitFor(() => expect(redrawMock).toHaveBeenCalled());
        expect(redrawMock).toHaveBeenCalledWith({}, "block:test-redraw");
    });

    it("never calls ControllerDestroyCommand or ControllerResyncCommand", async () => {
        const vm = makeViewModel();
        vm.redrawTUI();
        await vi.waitFor(() => expect(redrawMock).toHaveBeenCalled());
        expect(destroyMock).not.toHaveBeenCalled();
        expect(resyncMock).not.toHaveBeenCalled();
    });

    it("does not throw when refresh fails (e.g. rows are 0 on an unrendered terminal)", () => {
        const refresh = vi.fn().mockImplementation(() => {
            throw new Error("boom");
        });
        const vm = makeViewModel();
        vm.termRef = { current: { terminal: { rows: 0, refresh } } };
        expect(() => vm.redrawTUI()).not.toThrow();
    });
});
describe("TermViewModel.redrawTUI webgl handling", () => {
    it("clears the webgl texture atlas when the term renderer is webgl", async () => {
        const clearTextureAtlas = vi.fn();
        const vm = makeViewModel();
        vm.termRef = {
            current: {
                getTermRenderer: () => "webgl",
                terminal: { rows: 24, refresh: vi.fn(), clearTextureAtlas },
            },
        };
        vm.redrawTUI();
        expect(clearTextureAtlas).toHaveBeenCalled();
    });

    it("does not touch the atlas for the dom renderer", () => {
        const clearTextureAtlas = vi.fn();
        const vm = makeViewModel();
        vm.termRef = {
            current: {
                getTermRenderer: () => "dom",
                terminal: { rows: 24, refresh: vi.fn(), clearTextureAtlas },
            },
        };
        vm.redrawTUI();
        expect(clearTextureAtlas).not.toHaveBeenCalled();
    });
});
