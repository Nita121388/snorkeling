// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TabInfoCard 数据新鲜度（jsdom）。
//
// Run: npx vitest run frontend/app/tab/tab-info-card.dom.test.tsx
//
// 锁定的回归点（来源：design/plans/tab-info-card-stale-20261120.md）：
//  1. block meta 从 term 变成 agent（`waveobj:update` 抵达）→ 卡片自动出现 agent 行。
//  2. 卡片打开时 block 对象还没进 WOS（首读 null → 被判 other），数据到位后自动修正。
//  3. inline-tab 子块（父 block `subblockids` 挂 agent 块）→ 卡片出现 agent 行，
//     且父块不再被重复计成 agent（集合口径 = 顶层 + 子块，与顶部状态点/「更多」菜单一致）。
//  4. 基线：mount 时数据齐全 → 直接渲染正确（防止把响应式改造做成"只在更新后才对"）。
//
// 这些都是「快照读 vs 订阅」的差异用例：快照读版本第 1/2 条必红。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { atom, createStore, PrimitiveAtom, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── 假 WOS：map 保存值 + 每个 oref 一个 atom（模拟 waveobj:update 抵达时的 set） ──

const objMap = new Map<string, any>();
const atomMap = new Map<string, PrimitiveAtom<any>>();
const jotaiStore = createStore();
const nullStatusAtom = atom(null);

function orefAtom(oref: string): PrimitiveAtom<any> {
    let cached = atomMap.get(oref);
    if (cached == null) {
        cached = atom<any>(objMap.get(oref) ?? null) as PrimitiveAtom<any>;
        atomMap.set(oref, cached);
    }
    return cached;
}

/** 模拟一条后端 waveobj:update 抵达：atom set + map 更新。 */
function pushWaveObjUpdate(oref: string, obj: any) {
    objMap.set(oref, obj);
    jotaiStore.set(orefAtom(oref), obj);
}

vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    getObjectValue: (oref: string) => objMap.get(oref) ?? null,
    getWaveObjectAtom: (oref: string) => orefAtom(oref),
    // 重对账入口：模拟“服务端回包落地”——把回包写进 atom（就相当于 WOS 的 version-guarded set）
    reloadWaveObject: async (oref: string) => {
        const fresh = reloadResponses.get(oref);
        if (fresh != null) {
            pushWaveObjUpdate(oref, fresh);
            return fresh;
        }
        return objMap.get(oref) ?? null;
    },
    primeWaveObjects: async (orefs: string[]) => {
        primedOrefs.push(...orefs);
    },
}));

// 单例必须是稳定引用：每次 getInstance() 返回新对象会让 TabAgentRow 的
// useEffect([store, blockId]) 每渲染都重跑 → setStatusAtom → 再渲染 → 同步死循环。
const fakeStatusStore = {
    acquire: () => nullStatusAtom,
    release: () => {},
    peekPresentedStatusAtom: () => null,
    peekStatusAtom: () => null,
};
vi.mock("@/app/agent-status/agent-status-store", () => ({
    AgentStatusStore: { getInstance: () => fakeStatusStore },
}));
vi.mock("@/app/agent-status/use-agent-status-view", () => ({
    useAgentStatusView: () => null,
    useAgentChipNow: () => 0,
    useAgentReadContext: () => ({ ackedFp: null, doneAckedAt: 0, read: "seen" }),
}));
vi.mock("@/app/agent-status/agent-status-chip-view", () => ({
    buildAgentStatusChipView: () => null,
}));
vi.mock("@/app/agent-persona/use-agent-personas", () => ({
    useAgentPersonas: () => ({}),
}));
vi.mock("@/app/agent-persona/use-session-personas", () => ({
    useSessionEmojis: () => ({}),
}));
vi.mock("@/app/view/term/agent-logo", () => ({
    getAgentIcon: () => null,
}));

// 文案只用 key 表达，断言直接对 key 做（不依赖 i18n 资源加载）。
// 工厂函数必须自包含（vi.mock 会被提升到文件顶部，不能引用模块级变量）。
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string, opts?: any) => (opts == null ? key : `${key}(${JSON.stringify(opts)})`) }),
}));
vi.mock("@/i18n/config", () => ({
    i18n: { t: (key: string, opts?: any) => (opts == null ? key : `${key}(${JSON.stringify(opts)})`) },
}));

import { TabInfoCard, __resetTabCardDataAtomCacheForTests } from "./tab-info-card";
import { __resetTabCardReconcileForTests } from "./tab-card-reconcile";

const tab = (blockids: string[], name = "T1") => ({
    otype: "tab",
    oid: "t1",
    version: 1,
    name,
    blockids,
    meta: {},
});
const workspace = { otype: "workspace", oid: "w1", version: 1, name: "W1", icon: "fa-database", color: "#fff" };
const agentBlock = (oid: string, provider = "pi", version = 2) => ({
    otype: "block",
    oid,
    version,
    meta: { "agent:sessionid": `sess-${oid}`, "agent:provider": provider },
});
const plainTermBlock = (oid: string) => ({ otype: "block", oid, version: 1, meta: { view: "term" } });
/** inline-tab 组父块：自身不是 agent，子块列在 subblockids。 */
const groupBlock = (oid: string, subblockids: string[]) => ({
    otype: "block",
    oid,
    version: 1,
    subblockids,
    meta: {},
});

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

/** 重对账 reload 的服务端回包（oref → 新鲜对象）。未设置的 oref 返回当前缓存值。 */
const reloadResponses = new Map<string, any>();
/** 重对账 prime 发出的块 oref（断言“陈旧块也会重拉”）。 */
const primedOrefs: string[] = [];

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(
            <Provider store={jotaiStore}>
                <TabInfoCard tabId="t1" workspaceId="w1" />
            </Provider>
        );
    });
}

const cardText = () => container?.textContent ?? "";
const agentRows = () => container?.querySelectorAll(".tab-card-agent-row").length ?? 0;

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    objMap.clear();
    atomMap.clear();
    reloadResponses.clear();
    primedOrefs.length = 0;
    __resetTabCardDataAtomCacheForTests();
    __resetTabCardReconcileForTests();
});

describe("TabInfoCard 数据新鲜度", () => {
    it("基线：mount 时数据齐全 → 直接渲染 agent 行与计数", () => {
        objMap.set("tab:t1", tab(["b1"]));
        objMap.set("workspace:w1", workspace);
        objMap.set("block:b1", agentBlock("b1"));
        mount();
        expect(agentRows()).toBe(1);
        expect(cardText()).toContain("tab:infoCard.agentGroupWithProvider");
        expect(cardText()).toContain("tab:infoCard.agentCount");
    });

    it("block meta 从 term 变成 agent（waveobj:update 抵达）→ 卡片自动出现 agent 行", () => {
        objMap.set("tab:t1", tab(["b1"]));
        objMap.set("workspace:w1", workspace);
        objMap.set("block:b1", plainTermBlock("b1"));
        mount();
        expect(cardText()).toContain("tab:infoCard.chipTerm");
        expect(agentRows()).toBe(0);

        act(() => pushWaveObjUpdate("block:b1", agentBlock("b1")));

        expect(agentRows()).toBe(1);
        expect(cardText()).toContain("tab:infoCard.agentGroupWithProvider");
        expect(cardText()).not.toContain("tab:infoCard.chipTerm");
    });

    it("卡片打开时 block 尚未进 WOS（首读 null → other），数据到位后自动修正", () => {
        objMap.set("tab:t1", tab(["b1"]));
        objMap.set("workspace:w1", workspace);
        // block:b1 故意不预置：非激活 Tab 的块从未挂载过时的真实状态
        mount();
        expect(cardText()).toContain("tab:infoCard.chipOther");
        expect(agentRows()).toBe(0);

        act(() => pushWaveObjUpdate("block:b1", agentBlock("b1")));

        expect(agentRows()).toBe(1);
        expect(cardText()).toContain("tab:infoCard.agentGroupWithProvider");
        expect(cardText()).not.toContain("tab:infoCard.chipOther");
    });

    it("inline 子块（父 block subblockids 挂 agent）→ agent 行出现且不被父块重复计数", () => {
        objMap.set("tab:t1", tab(["g1"]));
        objMap.set("workspace:w1", workspace);
        objMap.set("block:g1", groupBlock("g1", ["b1", "b2"]));
        objMap.set("block:b1", agentBlock("b1", "codex"));
        objMap.set("block:b2", agentBlock("b2", "pi"));
        mount();

        expect(agentRows()).toBe(2);
        // 两个 provider 不同 → 分组标题不带 provider（行内各自显示）
        expect(cardText()).toContain("tab:infoCard.agentGroup");
        // 分组标题 provider 计数与行数一致
        const countMatch = cardText().match(/agentCount\((\{.*?\})\)/);
        expect(countMatch?.[1]).toBe('{"count":2}');
    });

    it("子块是后到的（父块先在）→ 子 block 抵达后 agent 行自动补齐", () => {
        objMap.set("tab:t1", tab(["g1"]));
        objMap.set("workspace:w1", workspace);
        objMap.set("block:g1", groupBlock("g1", []));
        mount();
        expect(agentRows()).toBe(0);

        // 先到子块对象，再把子块挂进父块的 subblockids（与后端两次 write 的真实顺序一致）
        act(() => {
            pushWaveObjUpdate("block:b1", agentBlock("b1"));
            pushWaveObjUpdate("block:g1", groupBlock("g1", ["b1"]));
        });

        expect(agentRows()).toBe(1);
        expect(cardText()).toContain("tab:infoCard.agentGroupWithProvider");
    });

    it("本 renderer 缓存的 tab 对象陈旧（缺 agent blockid）→ 打开时重对账拉回最新 → agent 行出现", async () => {
        // 用户症状（11-24）：在 Tab b 新建 agent → 从 Tab c 悬浮有 agent，
        // 切回 Tab a 再悬浮就没了。每个 Tab 一个 renderer，各自一份 WOS；
        // 广播漏掉时旧 renderer 的 tab.blockids 停在旧快照，响应式订阅也救不了。
        objMap.set("workspace:w1", workspace);
        objMap.set("tab:t1", tab([], "T1")); // 本 renderer 的旧快照：还没有 agent 块
        reloadResponses.set("tab:t1", { otype: "tab", oid: "t1", version: 9, name: "T1", blockids: ["b1"], meta: {} });
        objMap.set("block:b1", agentBlock("b1"));

        mount();
        // mount == 打开：对账异步落地后 tab atom 推到 version 9，派生 atom 重算 → agent 行
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });

        expect(agentRows()).toBe(1);
        expect(cardText()).toContain("tab:infoCard.agentGroupWithProvider");
        expect(cardText()).not.toContain("tab:infoCard.emptyTab");
        expect(primedOrefs).toContain("block:b1");
    });
});
