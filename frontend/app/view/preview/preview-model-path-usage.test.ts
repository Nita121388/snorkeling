// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AC15 wiring: the PreviewModel constructor records the *initial* path through the per-block
// gate (`recordInitialPathUsage`) while later `meta.file` changes (real navigation) go through
// the ungated `recordPathUsage`. Kept in its own file so the shared `preview-model.test.ts`
// environment is untouched.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./preview", () => ({
    PreviewView: vi.fn(),
}));

vi.mock("@/layout/index", () => ({
    NavigateDirection: {
        Left: "left",
        Right: "right",
        Up: "up",
        Down: "down",
    },
    getLayoutModelForStaticTab: () => ({
        findBlockIdsInDirection: () => [],
        getNodeModel: () => null,
    }),
}));

vi.mock("./path-usage-store", () => ({
    recordPathUsage: vi.fn(() => true),
    recordInitialPathUsage: vi.fn(),
}));

import { recordInitialPathUsage, recordPathUsage } from "./path-usage-store";
import { PreviewModel } from "./preview-model";

const BlockId = "block-gate-test";
const StartPath = "E:\\vault\\note.md";
const NavPath = "E:\\vault\\nested\\deep.md";

// The blockAtom stays writable so the case can flip `meta.file` and let the model's
// `metaFilePath` subscription fire.
function makeTrackablePreviewModel() {
    const blockAtom = atom({
        meta: { file: StartPath, connection: "local" },
    } as Block);
    const model = new PreviewModel({
        blockId: BlockId,
        nodeModel: {} as any,
        tabModel: { tabAtom: atom({ blockids: [] }) } as any,
        waveEnv: {
            getSettingsKeyAtom: () => atom(true),
            wos: {
                getWaveObjectAtom: () => blockAtom,
            },
            getConnStatusAtom: () => atom({ status: "connected" }),
            // 构造时会订阅 fullFile（内部走 FileReadCommand），给它一个不 reject 的 stub，
            // 避免测试里出现与本用例无关的 unhandled rejection。
            rpc: {
                ConnEnsureCommand: async () => null,
                FileInfoCommand: async () => null,
                FileReadCommand: async () => null,
            },
        } as any,
    });
    return { model, blockAtom };
}

describe("PreviewModel path-usage recording split", () => {
    beforeEach(() => {
        vi.mocked(recordInitialPathUsage).mockClear();
        vi.mocked(recordPathUsage).mockClear();
    });

    it("gates the initial record and leaves later navigation ungated", async () => {
        const { model, blockAtom } = makeTrackablePreviewModel();

        await vi.waitFor(() => expect(recordInitialPathUsage).toHaveBeenCalledTimes(1));
        expect(recordInitialPathUsage).toHaveBeenCalledWith(BlockId, StartPath, "file", "local");
        // the constructor must not bypass the gate with a plain (ungated) record
        expect(recordPathUsage).not.toHaveBeenCalled();

        // a real navigation (meta.file change → metaFilePath subscription) stays ungated
        globalStore.set(blockAtom, {
            meta: { file: NavPath, connection: "local" },
        } as Block);
        await vi.waitFor(() => expect(recordPathUsage).toHaveBeenCalledTimes(1));
        expect(recordPathUsage).toHaveBeenCalledWith(NavPath, "file", "local");
        expect(recordInitialPathUsage).toHaveBeenCalledTimes(1);
        expect(model.blockId).toBe(BlockId);
    });

    it("does not record when meta.file is blank", async () => {
        const model = new PreviewModel({
            blockId: BlockId,
            nodeModel: {} as any,
            tabModel: { tabAtom: atom({ blockids: [] }) } as any,
            waveEnv: {
                getSettingsKeyAtom: () => atom(true),
                wos: {
                    getWaveObjectAtom: () => atom({ meta: { file: "", connection: "local" } } as Block),
                },
                getConnStatusAtom: () => atom({ status: "connected" }),
                rpc: {
                    ConnEnsureCommand: async () => null,
                    FileInfoCommand: async () => null,
                    FileReadCommand: async () => null,
                },
            } as any,
        });

        // drain the microtask queue so a fireAndForget record would have landed
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(model.blockId).toBe(BlockId);
        expect(recordInitialPathUsage).not.toHaveBeenCalled();
        expect(recordPathUsage).not.toHaveBeenCalled();
    });
});
