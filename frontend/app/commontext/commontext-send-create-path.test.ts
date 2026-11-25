// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText create 路径的锁：必须走**有提交确认**的后端 agentsend。
//
// 为什么值得锁（2026-11-23 真机事故）：create 路径原先只把文本塞进前端 pending-input，
// 由 term 视图 paste + 固定延迟回车，没有任何提交确认。pi 冷启动会跑 `npm view`（40s+）并
// 在启动期吞掉回车 —— 文字留在输入框、UI 却报"已发送"，消息静默丢失。
// existing 路径早已改走后端（就绪门 + confirmSubmit 补回车），create 路径漏了。
// 这个文件锁两件事：① create 走 AgentSendCommand 且带 wait/waitms；② 不再登记 pending-input。

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock 工厂被 hoist 到文件顶部执行，spies 必须用 vi.hoisted 才能在工厂里引用。
const spies = vi.hoisted(() => ({
    registerPendingInput: vi.fn(),
    mountPendingInputTab: vi.fn(),
    agentSendCommand: vi.fn(async (_client: unknown, _req: unknown) => ({
        ok: true,
        submitconfirmed: true,
        injected: true,
        submitted: true,
    })),
    createBlockInNewTab: vi.fn(async () => ({ blockid: "blk-new", tabid: "tab-new" })),
    createAgentBlockDefForProfile: vi.fn((..._args: unknown[]) => ({ meta: { view: "term" } })),
    createBlockInTab: vi.fn(async () => "blk-existing-tab"),
    setActiveTab: vi.fn(),
    onStatus: vi.fn(),
}));

vi.mock("@/app/store/global", () => ({
    atoms: {
        workspace: { __kind: "workspace" },
        settingsAtom: { __kind: "settings" },
        staticTabId: { __kind: "staticTabId" },
    },
    createBlock: vi.fn(async () => "blk-current-tab"),
    createBlockSplitHorizontally: vi.fn(),
    getApi: () => ({ getHomeDir: () => "", setActiveTab: spies.setActiveTab }),
    getFocusedBlockId: () => null,
}));

vi.mock("@/app/store/jotaiStore", () => ({
    // 任何 atom 都返回带 oid 的对象：workspace 需要 oid，settings 只被透传给被 mock 的建块函数。
    globalStore: { get: () => ({ oid: "ws-1" }) },
}));

vi.mock("@/app/store/services", () => ({
    ObjectService: {
        CreateBlockInNewTab: spies.createBlockInNewTab,
        CreateBlockInTab: spies.createBlockInTab,
    },
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { AgentSendCommand: spies.agentSendCommand },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({
    getWaveObjectAtom: () => ({}),
    makeORef: (type: string, id: string) => `${type}:${id}`,
}));
vi.mock("@/app/view/aisessions/session-tags", () => ({
    stripSessionTagHashes: (text: string) => text,
}));
vi.mock("@/app/workspace/use-agent-profile-options", () => ({
    useDetectedAgentProfileOptions: () => ({ options: [] }),
}));
vi.mock("@/app/workspace/agent-launch", () => ({
    createAgentBlockDefForProfile: spies.createAgentBlockDefForProfile,
    getCurrentWorkspaceContextMeta: () => null,
    collectAgentLaunchTargetsInTab: () => [],
}));
vi.mock("@/app/agent-persona/use-agent-personas", () => ({ useAgentPersonas: () => ({}) }));
vi.mock("@/app/view/term/agent-logo", () => ({ getAgentIcon: () => ({}) }));
vi.mock("@/app/element/button", () => ({ Button: () => null }));
vi.mock("@/app/element/splitbutton", () => ({ SplitButton: () => null }));
vi.mock("@/app/session-overview/session-overview-model", () => ({
    filterSessionOverviewTabIds: (ids: string[]) => ids,
}));
vi.mock("@/layout/index", () => ({ getLayoutModelForStaticTab: () => null }));
vi.mock("@/layout/lib/inlineTabs", () => ({
    getLayoutDataActiveBlockId: () => null,
    default: () => null,
}));
vi.mock("@/app/commontext/commontext-insert", () => ({ sendTextToFocusedTerm: () => null }));
vi.mock("@/i18n/config", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("./pending-input", () => ({
    registerPendingInput: spies.registerPendingInput,
    mountPendingInputTab: spies.mountPendingInputTab,
}));
vi.mock("./commontext-send-target", () => ({
    resolveSendTarget: () => ({ kind: "create", label: "new agent" }),
    defaultSendFolder: () => "",
    planSendActivation: () => ({ frontActivateTab: false, backendActivateExisting: false }),
    extractAgentBlockInfo: () => null,
    collectFolderCandidatesForTab: () => [],
    resolveFolderScopeTabId: () => "",
}));

import { executeCommonTextSend } from "./commontext-send-button";

function createConfig(model: string | null = null) {
    return {
        mode: "create",
        background: true,
        profile: "pi",
        tab: { kind: "new" },
        folder: null,
        model,
    } as any;
}

const profiles = [{ name: "pi", label: "pi", isDefault: true } as any];

beforeEach(() => {
    Object.values(spies).forEach((spy: any) => spy.mockClear?.());
    spies.agentSendCommand.mockResolvedValue({ ok: true, submitconfirmed: true } as any);
});

describe("CommonText create 发送路径", () => {
    it.each([
        { model: "gpt-5.2-codex", expected: "gpt-5.2-codex" },
        { model: null, expected: undefined },
    ])("模型 $model 作为第 7 个参数透传（null → undefined）", async ({ model, expected }) => {
        const ok = await executeCommonTextSend({
            text: "hello with model",
            config: createConfig(model),
            focusedAgent: null,
            profiles,
            onStatus: spies.onStatus,
        });
        expect(ok).toBe(true);
        expect(spies.createAgentBlockDefForProfile).toHaveBeenCalledTimes(1);
        const args = spies.createAgentBlockDefForProfile.mock.calls[0];
        expect(args[6]).toBe(expected);
        expect(args).toHaveLength(7);
        expect(args[0]).toBe("pi");
    });

    it("走 AgentSendCommand（submit/async/wait/waitms≥120s，文本走 text64）", async () => {
        const ok = await executeCommonTextSend({
            text: "hello world",
            config: createConfig(),
            focusedAgent: null,
            profiles,
            onStatus: spies.onStatus,
        });
        expect(ok).toBe(true);
        // fireAndForget：等微任务让 RPC 发出
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(spies.createBlockInNewTab).toHaveBeenCalledTimes(1);
        expect(spies.agentSendCommand).toHaveBeenCalledTimes(1);
        const req: any = spies.agentSendCommand.mock.calls[0][1];
        expect(req.blockid).toBe("blk-new");
        expect(req.submit).toBe(true);
        expect(req.async).toBe(true);
        expect(req.wait).toBe(true);
        expect(req.waitms).toBeGreaterThanOrEqual(120_000);
        expect(req.text).toBeUndefined();
        expect(Buffer.from(req.text64, "base64").toString("utf8")).toBe("hello world");
    });

    it("不再登记 pending-input（前端 paste+固定延迟回车整条链退役）", async () => {
        await executeCommonTextSend({
            text: "hello",
            config: createConfig(),
            focusedAgent: null,
            profiles,
            onStatus: spies.onStatus,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(spies.registerPendingInput).not.toHaveBeenCalled();
        expect(spies.mountPendingInputTab).not.toHaveBeenCalled();
    });

    it("发送失败 → onStatus(err)，但块已建好（不回滚）", async () => {
        spies.agentSendCommand.mockRejectedValueOnce(new Error("E_AGENT_NOT_READY: not ready") as any);
        const ok = await executeCommonTextSend({
            text: "hello",
            config: createConfig(),
            focusedAgent: null,
            profiles,
            onStatus: spies.onStatus,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ok).toBe(true);
        expect(spies.onStatus).toHaveBeenCalledWith(expect.stringContaining("E_AGENT_NOT_READY"), "err");
    });
});
