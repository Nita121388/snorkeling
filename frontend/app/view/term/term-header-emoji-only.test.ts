// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// agent Block 头部「仅显示 Emoji」的回归判据。
//
// 场景：agent card 的 emoji picker 里勾上「仅显示 Emoji」后，内联 Tab 标题隐藏了，
// 但 **agent Block 自己的 header 仍然显示项目路径**（cwd 折叠后的 folderName）。
// 锁三件事：
//   1. 这个开关是**会话语义**（key = session id），不是全局设置——别的会话不受影响；
//   2. 开启后头部不再产出 cwd 的 copytext 元素（路径消失）；
//   3. viewText 的接线没被改回去（真的用会话级 atom 决定要不要 cwd 元素）。

import * as jotai from "jotai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
    DefaultRouter: { registerRoute: vi.fn() },
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ControllerRedrawCommand: vi.fn(),
        ControllerDestroyCommand: vi.fn(),
        ControllerResyncCommand: vi.fn(),
    },
}));

import { getTabDisplayMode, setTabDisplayMode } from "@/app/agent-persona/tab-display-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { buildCmdCwdHeaderElem, makeAgentHeaderEmojiOnlyAtom, TermViewModel } from "./term-model";

const SessionId = "sess-emoji-header";
const Cwd = "/home/user/work/snorkeling";

function makeBlockAtom(meta: Record<string, unknown>): jotai.Atom<Block> {
    return jotai.atom({
        otype: "block",
        oid: "block-emoji-header",
        version: 0,
        meta: meta as MetaType,
    });
}

afterEach(() => {
    setTabDisplayMode(SessionId, "full");
    setTabDisplayMode("another-session", "full");
});

describe("makeAgentHeaderEmojiOnlyAtom (session-scoped, not global)", () => {
    it("is false until this exact session turns emoji-only on", () => {
        const agentStatusAtom = jotai.atom<AgentStatus | null>(null);
        const atom = makeAgentHeaderEmojiOnlyAtom(makeBlockAtom({ "agent:sessionid": SessionId }), agentStatusAtom);
        expect(jotai.createStore().get(atom)).toBe(false);
    });

    it("turns true for this session", () => {
        setTabDisplayMode(SessionId, "emoji-only");
        const agentStatusAtom = jotai.atom<AgentStatus | null>(null);
        const atom = makeAgentHeaderEmojiOnlyAtom(makeBlockAtom({ "agent:sessionid": SessionId }), agentStatusAtom);
        expect(jotai.createStore().get(atom)).toBe(true);
    });

    it("stays false when only another session is emoji-only", () => {
        setTabDisplayMode("another-session", "emoji-only");
        const agentStatusAtom = jotai.atom<AgentStatus | null>(null);
        const atom = makeAgentHeaderEmojiOnlyAtom(makeBlockAtom({ "agent:sessionid": SessionId }), agentStatusAtom);
        expect(jotai.createStore().get(atom)).toBe(false);
    });

    it("resolves the session from agentStatus when meta has no explicit id", () => {
        setTabDisplayMode(SessionId, "emoji-only");
        const agentStatusAtom = jotai.atom<AgentStatus | null>({
            blockId: "block-emoji-header",
            provider: "claude",
            state: "working",
            source: "hook",
            confidence: "high",
            updatedAt: 0,
            sessionId: SessionId,
        } as AgentStatus);
        const atom = makeAgentHeaderEmojiOnlyAtom(makeBlockAtom({}), agentStatusAtom);
        expect(jotai.createStore().get(atom)).toBe(true);
    });
});

describe("buildCmdCwdHeaderElem", () => {
    it("renders the folder name of the cwd in full mode", () => {
        const elem = buildCmdCwdHeaderElem(Cwd, false);
        expect(elem).toMatchObject({ elemtype: "copytext", text: Cwd, displayText: "snorkeling" });
    });

    it("renders nothing in emoji-only mode", () => {
        expect(buildCmdCwdHeaderElem(Cwd, true)).toBe(null);
    });

    it("renders nothing without a cwd", () => {
        expect(buildCmdCwdHeaderElem("", false)).toBe(null);
        expect(buildCmdCwdHeaderElem(undefined, false)).toBe(null);
    });

    // Hero 登场块：据点目录名是 hero-<hash8>（磁盘不变量，目录名 == id），显示身份
    // （hero:name）而非哈希目录名；emoji 只在左上角图标出现一次。
    it("shows the plain hero name instead of the home-base directory hash", () => {
        const homeBase = String.raw`E:\primary\heros` + "/hero-feaa3f86";
        const elem = buildCmdCwdHeaderElem(homeBase, false, "状态维护Hero");
        expect(elem).toMatchObject({ elemtype: "copytext", text: homeBase, displayText: "状态维护Hero" });
    });

    it("falls back to the directory basename when no hero identity is given", () => {
        const elem = buildCmdCwdHeaderElem(Cwd, false, "");
        expect(elem).toMatchObject({ text: Cwd, displayText: "snorkeling" });
    });
});

describe("viewText wiring", () => {
    it("asks the session-scoped atom before pushing the cwd element", () => {
        // 接线断言：把 `get(this.emojiOnlyHeaderAtom)` 从 viewText 里删掉会让上面两个
        // 测试仍然通过，但界面会退回「路径照旧显示」。源码锚点锁住这一点。
        const source = readFileSync(path.resolve(__dirname, "term-model.ts"), "utf8");
        expect(source).toContain("buildCmdCwdHeaderElem(cmdCwd, get(this.emojiOnlyHeaderAtom), heroName)");
        // header 必须复用同一个去重函数，不许再裸读 hero:name 把 emoji 带进胶囊。
        expect(source).toContain("heroHeaderName(blockMeta)");
        expect(source).not.toContain('typeof blockMeta?.["hero:name"]');
        // 且 emojiOnlyHeaderAtom 必须由会话感知的工厂产出（不是直接恒 false / 全局设置）。
        expect(source).toContain("makeAgentHeaderEmojiOnlyAtom(this.blockAtom, this.agentStatusAtom)");
    });
});

describe("getTabDisplayMode baseline", () => {
    it("defaults to full for unknown sessions", () => {
        expect(getTabDisplayMode("never-seen-session")).toBe("full");
    });

    it("keeps TermViewModel exporting the atoms the header depends on", () => {
        expect(typeof TermViewModel).toBe("function");
    });
});
