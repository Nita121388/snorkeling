// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 重启恢复时持有孤儿 aisessions:sessionid 绑定的降级行为：
// - session not found → 清 block meta 绑定 + 回落 New Chat，不把内部错误留给用户
// - 其他失败（网络/连接）→ 保持既有报错行为，不清绑定

import type { AISessionsServiceType } from "@/app/store/services";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { globalStore } from "@/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentViewModel } from "./agent";
import { NewSessionKey } from "./types";

const { RpcApiMock } = vi.hoisted(() => {
    return { RpcApiMock: { SetMetaCommand: vi.fn().mockResolvedValue({}) } };
});

vi.mock("@/app/store/wshclientapi", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/store/wshclientapi")>();
    return {
        ...actual,
        RpcApi: {
            ...actual.RpcApi,
            SetMetaCommand: RpcApiMock.SetMetaCommand,
        },
    };
});

const BlockId = "agent-restore-test-block";
const LostSessionId = "01a1c45f-4e67-7849-a887-87852146b4d6";
const NotFoundMessage = `call aisessions.Detail error: session not found: ${LostSessionId}`;

function makeModel(detailImpl: (request: any) => Promise<any>): AgentViewModel {
    const env = makeMockWaveEnv({
        mockWaveObjs: {
            [`block:${BlockId}`]: {
                otype: "block",
                oid: BlockId,
                version: 1,
                meta: {
                    view: "agent",
                    "aisessions:sessionid": LostSessionId,
                },
            } as Block,
        },
        services: {
            aisessions: {
                Detail: detailImpl,
            },
        },
    });
    const model = new AgentViewModel({
        blockId: BlockId,
        nodeModel: {} as any,
        tabModel: {} as any,
        waveEnv: env,
    });
    // 防御：模型构造后再兜底 mock，避免 service 走到真实 WOS 路径
    (model as any).service = { Detail: detailImpl } as AISessionsServiceType;
    return model;
}

describe("AgentViewModel.restoreBoundSession", () => {
    beforeEach(() => {
        RpcApiMock.SetMetaCommand.mockClear();
    });

    it("clears the stale binding and falls back to New Chat on session not found", async () => {
        const detailImpl = vi.fn().mockRejectedValue(new Error(NotFoundMessage));
        const model = makeModel(detailImpl);

        await model.restoreBoundSession();

        expect(detailImpl).toHaveBeenCalled();
        const setMetaCall = RpcApiMock.SetMetaCommand.mock.calls[0];
        expect(setMetaCall?.[1]).toEqual(
            expect.objectContaining({
                oref: `block:${BlockId}`,
                meta: expect.objectContaining({
                    "aisessions:sessionid": null,
                    "agent:sessionid": null,
                }),
            })
        );
        expect(globalStore.get(model.selectedKeyAtom)).toBe(NewSessionKey);
        expect(globalStore.get(model.errorAtom)).toBe("");
        expect(globalStore.get(model.detailAtom)).toBeNull();
        expect(globalStore.get(model.detailLoadingAtom)).toBe(false);
    });

    it("keeps the error and the binding for non-not-found failures", async () => {
        const detailImpl = vi.fn().mockRejectedValue(new Error("failed to fetch"));
        const model = makeModel(detailImpl);

        await model.restoreBoundSession();

        expect(RpcApiMock.SetMetaCommand).not.toHaveBeenCalled();
        expect(globalStore.get(model.selectedKeyAtom)).toBe(LostSessionId);
        expect(globalStore.get(model.errorAtom)).toContain("failed to fetch");
    });

    it("keeps the loaded detail when the bound session resolves", async () => {
        const detailImpl = vi.fn().mockResolvedValue({
            summary: { key: `pi:${LostSessionId}:/tmp/s.jsonl`, id: LostSessionId },
            messages: [],
        });
        const model = makeModel(detailImpl);

        await model.restoreBoundSession();

        expect(RpcApiMock.SetMetaCommand).not.toHaveBeenCalled();
        expect(globalStore.get(model.selectedKeyAtom)).toBe(`pi:${LostSessionId}:/tmp/s.jsonl`);
        expect(globalStore.get(model.errorAtom)).toBe("");
    });

    it("starts a new chat directly when no session is bound", async () => {
        const env = makeMockWaveEnv({
            mockWaveObjs: {
                [`block:${BlockId}`]: {
                    otype: "block",
                    oid: BlockId,
                    version: 1,
                    meta: { view: "agent" },
                } as Block,
            },
        });
        const model = new AgentViewModel({
            blockId: BlockId,
            nodeModel: {} as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        await model.restoreBoundSession();

        expect(globalStore.get(model.selectedKeyAtom)).toBe(NewSessionKey);
        expect(RpcApiMock.SetMetaCommand).not.toHaveBeenCalled();
    });
});
