// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// executeCommonTextSend 的 existing 路径单测（11-18 包 R10：收口到后端 agentsend）。
//
// R10 契约：
//   1. 本地块 → RpcApi.AgentSendCommand（blockid + text64 + submit=true），绝不走前端 terminal.paste；
//   2. 远端块（connection 非空非 local）→ 不调后端，走原前端 paste 链；
//   3. 后端报错（E_AGENT_NOT_READY 等非「确定没写入」错误）→ sendFailed 状态可见、返回 false，不回退（避免双发）；
//   4. 后端报 E_UNSUPPORTED / E_NOT_FOUND（确定没写入）→ 回退前端 paste 链。
//
// create 路径（建块 + pending input）不在本测试范围（行为未变，由 verify 台
// scripts/verify/commontext-send-agent-block 覆盖）。

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { executeCommonTextSend, type CommontextSendConfig } from "./commontext-send-button";
import type { AgentBlockInfo } from "./commontext-send-target";

// 后端 agentsend RPC：断言调用参数 / 注入错误
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

/** base64 解码（断言 text64 原文） */
function decode64(value: string): string {
    return Buffer.from(value, "base64").toString("utf-8");
}

beforeEach(async () => {
    await initI18n("en");
    agentSend.mockReset();
    pasteSend.mockReset();
});

describe("executeCommonTextSend existing 路径（R10：本地块走后端 agentsend）", () => {
    it("本地块：调 AgentSendCommand（blockid/text64/submit），不走前端 paste", async () => {
        agentSend.mockResolvedValue({ ok: true, injected: true, submitted: true });
        const onStatus = vi.fn();
        const ok = await executeCommonTextSend({
            text: "hello #fix",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus,
        });
        expect(ok).toBe(true);
        expect(agentSend).toHaveBeenCalledTimes(1);
        const [client, request] = agentSend.mock.calls[0];
        expect(client).toEqual({ __test: true });
        expect(request.blockid).toBe("b1");
        expect(decode64(request.text64)).toBe("hello"); // #tag 剥离 + 原文送达
        expect(request.submit).toBe(true);
        expect(pasteSend).not.toHaveBeenCalled();
        expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("Sent"), "ok");
    });

    it("远端块：不调后端，回退前端 paste 链", async () => {
        pasteSend.mockReturnValue("b2");
        const onStatus = vi.fn();
        const ok = await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: RemoteAgent,
            profiles: Profiles,
            onStatus,
        });
        expect(ok).toBe(true);
        expect(agentSend).not.toHaveBeenCalled();
        expect(pasteSend).toHaveBeenCalledWith("hello", ["b2"]);
    });

    it("后端就绪超时（E_AGENT_NOT_READY）：sendFailed 可见 + 返回 false，不回退 paste（防双发）", async () => {
        agentSend.mockRejectedValue(new Error("E_AGENT_NOT_READY: block b1 not ready"));
        pasteSend.mockReturnValue("b1");
        const onStatus = vi.fn();
        const ok = await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus,
        });
        expect(ok).toBe(false);
        expect(pasteSend).not.toHaveBeenCalled();
        expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("E_AGENT_NOT_READY"), "err");
    });

    it("后端 E_UNSUPPORTED（确定没写入，如连接元数据异常）：回退前端 paste 链", async () => {
        agentSend.mockRejectedValue(new Error("E_UNSUPPORTED: remote"));
        pasteSend.mockReturnValue("b1");
        const onStatus = vi.fn();
        const ok = await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus,
        });
        expect(ok).toBe(true);
        expect(pasteSend).toHaveBeenCalledWith("hello", ["b1"]);
    });

    it("发送前先给 sending 状态（后端等待期间界面有反馈）", async () => {
        agentSend.mockResolvedValue({ ok: true });
        const onStatus = vi.fn();
        await executeCommonTextSend({
            text: "hello",
            config: FocusedConfig,
            focusedAgent: LocalAgent,
            profiles: Profiles,
            onStatus,
        });
        const kinds = onStatus.mock.calls.map(([, kind]) => kind);
        expect(kinds[0]).toBe("info"); // Sending…
    });
});
