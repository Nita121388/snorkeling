// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 「发送」语义回归锁：Send 不是「粘贴」。
//
// 锁定的历史 bug（2026-11-11，用户实测）：CommonText Send 的两条注入路径
// （聚焦块 sendTextToFocusedTerm / 新建 pending-input 注入）都只 terminal.paste(text)，
// 没有回车提交——文字粘进 TUI 输入框但 agent 永远收不到。
// 这里锁 submitTermInput 的结构事实：走 ControllerInputCommand（PTY 按键通道），
// 且载荷是 "\r"（回车），不是粘贴内容本身。
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ControllerInputCommand: vi.fn(async () => "ok"),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { RpcApi } from "@/app/store/wshclientapi";
import { stringToBase64 } from "@/util/util";
import { submitTermInput } from "./commontext-insert";

const controllerInputCommand = vi.mocked(RpcApi.ControllerInputCommand);

beforeEach(() => {
    controllerInputCommand.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("submitTermInput", () => {
    it("sends a real Enter (CR) through the PTY input command, not the pasted text", () => {
        submitTermInput("b1");
        expect(controllerInputCommand).toHaveBeenCalledTimes(1);
        const arg = controllerInputCommand.mock.calls[0][1];
        expect(arg.blockid).toBe("b1");
        // 载荷必须是 "\r" 的 base64（回车），不是别的
        expect(arg.inputdata64).toBe(stringToBase64("\r"));
    });

    it("is a no-op without a blockId", () => {
        submitTermInput("");
        submitTermInput(null as unknown as string);
        expect(controllerInputCommand).not.toHaveBeenCalled();
    });
});
