// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// executeCommonTextSend 的 existing 路径单测（11-18 包 R10 + 派发不等待）。
//
// 契约（2026-11-21 定稿）：
//   1. 本地块 → 立即返回 true（状态先给「已发送」），发送**后台投递**给 RpcApi.AgentSendCommand；
//      绝不在 UI 关键路径上等待就绪/确认（agent 启动可能几十秒到几分钟）。
//   2. 本地块绝不走前端 terminal.paste（粘贴 + 150ms 回车是启发式竞态，实测会丢回车）。
//   3. 远端块（connection 非空非 local）→ 不调后端，走原前端 paste 链。
//
// create 路径（建块 + pending input）不在本测试范围（行为未变，由 verify 台
// scripts/verify/commontext-send-agent-block 覆盖）。

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { executeCommonTextSend, type CommontextSendConfig } from "./commontext-send-button";
import type { AgentBlockInfo } from "./commontext-send-target";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { AgentSendCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { __test: true } }));

// 前端 paste 链（远端回退路径）：断言「本地块绝不能再走它」
vi.mock("./commontext-insert", () => ({
    sendTextToFocusedTerm: vi.fn(),
}));

// 全局 store 在 jsdom 里懒加载失败（与 compose-modal.dom.test 同款处理）
vi.mock("@/app/store/global", async () => {
    const { atom: jotaiAtom } = await import("jotai");
    return {
        atoms: { settingsAtom: jotaiAtom<unknown>(null) },
        globalStore: { get: () => null },
        createBlock: vi.fn(),
        getApi: () => ({}),
        getFocusedBlockId: () => null,
    };
});
vi.mock("@/app/store/jotaiStore", () => ({ globalStore: { get: () => null } }));
vi.mock("@/app/store/services", () => ({ ObjectService: {} }));

import { RpcApi } from "@/app/store/wshclientapi";
import { sendTextToFocusedTerm } from "./commontext-insert";

const agentSend = RpcApi.AgentSendCommand as unknown as ReturnType<typeof vi.fn>;
const pasteSend = sendTextToFocusedTerm as unknown as ReturnType<typeof vi.fn>;

const LocalAgent: AgentBlockInfo = {
    blockId: "b1",
    provider: "pi",
    model: null,
    cwd: "E:/code/snorkeling",
    connection: null,
    title: null,
};

const RemoteAgent: AgentBlockInfo = { ...LocalAgent, blockId: "b2", connection: "ssh://mac" };

const FocusedConfig: CommontextSendConfig = {
    mode: "focused",
    background: true,
    profile: null,
    tab: { kind: "current" },
    folder: null,
};

const Profiles = [
    { name: "pi", label: "Pi", cmd: "pi", isDefault: true },
    { name: "claude", label: "Claude", cmd: "claude", isDefault: false },
];

function decode64(value: string): string {
    return Buffer.from(value, "base64").toString("utf-8");
}

/** 等 fireAndForget 的后台任务跑到 RPC 调用 */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
    await initI18n("en");
    agentSend.mockReset();
    pasteSend.mockReset();
});

describe("executeCommonTextSend existing 路径（派发不等待）", () => {
    it("本地块：立即返回 true，后台调 AgentSendCommand（blockid/text64/submit），不走前端 paste", async () => {
        agentSend.mockResolvedValue({ ok: true, injected: true, submitted: true, submitconfirmed: true });
        const onStatus = vi.fn();
        const ok = await executeCommonTextSend({
            text: "hello #fix",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus,
        });
        // 关键：不等后端就返回（状态立即给已发送）
        expect(ok).toBe(true);
        expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("Sent"), "ok");
        await flush();
        expect(agentSend).toHaveBeenCalledTimes(1);
        const [client, request] = agentSend.mock.calls[0];
        expect(client).toEqual({ __test: true });
        expect(request.blockid).toBe("b1");
        expect(decode64(request.text64)).toBe("hello"); // #tag 剥离 + 原文送达
        expect(request.submit).toBe(true);
        expect(pasteSend).not.toHaveBeenCalled();
    });

    it("远端块：不调后端，走前端 paste 链", async () => {
        pasteSend.mockReturnValue("b2");
        const ok = await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: RemoteAgent,
            profiles: Profiles,
            onStatus: vi.fn(),
        });
        expect(ok).toBe(true);
        await flush();
        expect(agentSend).not.toHaveBeenCalled();
        expect(pasteSend).toHaveBeenCalledWith("hello", ["b2"]);
    });

    it("后台投递失败不影响返回值（不阻塞用户，只记日志）", async () => {
        agentSend.mockRejectedValue(new Error("E_AGENT_NOT_READY: still starting"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const ok = await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus: vi.fn(),
        });
        expect(ok).toBe(true);
        await flush();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
