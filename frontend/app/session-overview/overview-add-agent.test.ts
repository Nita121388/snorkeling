// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 「＋ 新建 Agent」纯逻辑测试：分组守卫 + Tab 列 key 解析 + 路径候选行 + 建
// 块上下文组装。UI 层见 overview-add-agent-modal.dom.test.tsx。

import { describe, expect, it } from "vitest";

import {
    buildAddAgentLaunchContext,
    collectAddAgentPathRows,
    parseBoardTabColumnKey,
    shouldShowAddAgent,
} from "./overview-add-agent";
import type { AgentLaunchTarget } from "@/app/workspace/agent-launch";

const tabTargets = (overrides: Partial<AgentLaunchTarget>[] = []): AgentLaunchTarget[] =>
    [
        { blockId: "b1", connection: null, cwd: "E:/code/snorkeling", source: "agent", isLocal: true, label: "", detail: "E:/code/snorkeling" },
        { blockId: "b2", connection: null, cwd: "E:/code/snorkeling/frontend", source: "terminal", isLocal: true, label: "", detail: "E:/code/snorkeling/frontend" },
    ].map((t, i) => ({ ...t, ...overrides[i] }) as AgentLaunchTarget);

describe("shouldShowAddAgent（分组守卫）", () => {
    it("仅容器型分组（tab）显示入口", () => {
        expect(shouldShowAddAgent("tab")).toBe(true);
    });

    it.each(["status", "provider", "project", "tags"] as const)("派生分组 %s 不显示入口", (group) => {
        expect(shouldShowAddAgent(group)).toBe(false);
    });
});

describe("parseBoardTabColumnKey", () => {
    it("tab:<tabId> → tabId", () => {
        expect(parseBoardTabColumnKey("tab:t123")).toBe("t123");
    });

    it("非 tab 列 key → null", () => {
        expect(parseBoardTabColumnKey("status:working")).toBeNull();
        expect(parseBoardTabColumnKey("provider:Claude")).toBeNull();
        expect(parseBoardTabColumnKey("")).toBeNull();
    });
});

describe("collectAddAgentPathRows（路径候选行）", () => {
    it("去重 + 默认随 Tab 项排最前", () => {
        const targets = [
            ...tabTargets(),
            {
                blockId: "b3",
                connection: null,
                cwd: "E:/code/snorkeling",
                source: "terminal" as const,
                isLocal: true,
                label: "",
                detail: "E:/code/snorkeling",
            },
        ] as AgentLaunchTarget[];
        const rows = collectAddAgentPathRows(targets, "E:/code/snorkeling");
        expect(rows.map((r) => r.key)).toEqual(["E:/code/snorkeling", "E:/code/snorkeling/frontend"]);
        expect(rows[0].isDefault).toBe(true);
        expect(rows[1].isDefault).toBe(false);
    });

    it("本地行无第二行", () => {
        const rows = collectAddAgentPathRows(tabTargets(), "E:/code/snorkeling");
        expect(rows[0].sub).toBe("");
        expect(rows[1].sub).toBe("");
    });

    it('connection="local" 视为本地行（不显示 "local" 第二行）', () => {
        const targets = [
            {
                blockId: "b1",
                connection: "local",
                cwd: "E:/code/snorkeling",
                source: "terminal" as const,
                isLocal: false,
                label: "local",
                detail: "E:/code/snorkeling",
            },
        ] as AgentLaunchTarget[];
        const rows = collectAddAgentPathRows(targets, "E:/code/snorkeling");
        expect(rows[0].sub).toBe("");
    });

    it("远端行第二行 = connection", () => {
        const targets = [
            {
                blockId: "b1",
                connection: "ssh://mac",
                cwd: "/Users/nita/work",
                source: "terminal" as const,
                isLocal: false,
                label: "",
                detail: "/Users/nita/work",
            },
        ] as AgentLaunchTarget[];
        const rows = collectAddAgentPathRows(targets, "/Users/nita/work");
        expect(rows[0].sub).toBe("ssh://mac");
    });

    it("默认路径不在候选里时仍然插入为首行", () => {
        const targets = tabTargets();
        const rows = collectAddAgentPathRows(targets, "E:/other");
        expect(rows[0].key).toBe("E:/other");
        expect(rows[0].isDefault).toBe(true);
    });
});

describe("buildAddAgentLaunchContext（建块上下文）", () => {
    it("显式 cwd + inheritWorkspaceContext=false，绝不继承焦点块", () => {
        const context = buildAddAgentLaunchContext({ connection: null, cwd: "E:/code/snorkeling" });
        expect(context).toEqual({ connection: null, cwd: "E:/code/snorkeling", inheritWorkspaceContext: false });
    });

    it("远端 Tab 保留 connection", () => {
        const context = buildAddAgentLaunchContext({ connection: "ssh://mac", cwd: "/Users/nita/work" });
        expect(context.connection).toBe("ssh://mac");
        expect(context.cwd).toBe("/Users/nita/work");
        expect(context.inheritWorkspaceContext).toBe(false);
    });

    it("无 cwd 时不传 cwd（只断 connection），仍不继承", () => {
        const context = buildAddAgentLaunchContext({ connection: null, cwd: null });
        expect(context.cwd).toBeUndefined();
        expect(context.inheritWorkspaceContext).toBe(false);
    });
});
