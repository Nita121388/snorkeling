#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview / Tab 悬浮卡对**新增** agent block 不刷新（11-23-overview-refresh-1123）诊断台。
//
// 三个症状（同一批用户反馈）：
//   S1 恢复的会话在 Overview 看板没卡
//   S2 Tab 里**新增**的 agent 在 Overview 看不到（列表 + 看板）
//   S3 激活 Tab 的悬浮卡看不到后加的 agent 行
//
// 为什么需要真机台子：数据层（workspace / tab.blockids / block meta）是全局 store + WPS 广播，
// 单测锁不到「本 renderer 的派生 atom / hover 卡片到底有没有跟着走」。台子只建**新**块
// （不碰既有块），逐条量「建块 → DOM 出现」的真实毫秒数，并区分：
//   永不出现（数据已到本 renderer，UI 不更新 → H1/H2 类 atom 失效）
//   迟到但出现（>2s → H2 类懒加载补齐）
//   组行同步了但 hover 卡片不同步（→ H3 类 hover latch）
//   全绿（→ H4：不是 bug，是人眼/视图错位）
//
// 断言（阈值 2s，FAIL 时继续量到 10s 判「迟到 vs 永不」）：
//   1. setup-overview-mounted              Overview 块挂上 + tabA/tabB 播种齐
//   2. baseline-b-seed-block-visible       背景 Tab 新建时（含块）组头计数同步（对照组）
//   3. renderer-of-tabB-found              找到 tabB 自己的 renderer（跨 renderer 断言的发起方）
//   4. s2-cross-renderer-add-block         **主路径**：RPC 从 tabB 的 renderer 发出（Overview renderer 只吃广播）
//                                          → tabB 组内行 +1 且 ≤2s
//   5. s2b-add-while-overview-tab-inactive Overview Tab 后台时新增 → 切回 ≤2s 组头计数正确（+ 展开后行数）
//   6. s2-live-tab-add-block               同 renderer 路径（RPC 回包也会写 cache）→ 行 +1 且 ≤2s
//   7. s3-hover-card-baseline              hover 激活 Tab → 卡片 agent 行数 == 数据层 agent 块数
//   8. s3-hover-card-refresh-live          **鼠标不动**在激活 Tab 加第二个 agent 块 → 卡片行 +1 且 ≤2s
//   9. s3-rehover-consistent               移开再 hover → 行数与数据层一致（对照组）
//  10. s2-background-tab-add-block         背景 Tab 加 agent 块 → 组内行 +1 且 ≤2s
//  11. s1-restored-session-card            近似「恢复会话」（同 shape agent-meta 块，RPC 来自 tabB renderer）
//  12. board-cards-for-added-blocks        切看板视图 → 全部新增 agent 块都有卡片（S1 的看板面）
//
//   node scripts/verify/overview-refresh/verify.mjs              # 干净实例 → 跑 → 自动关
//   node scripts/verify/overview-refresh/verify.mjs --attach     # 复用已起实例（迭代）
//   node scripts/verify/overview-refresh/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/overview-refresh/verify.mjs --dry        # 只解析依赖
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "overview-refresh";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

// 独立 profile + 独占端口（不与并行 agent 抢默认档位）。
const PROFILE = "verify-overview-refresh";
const CDP_PORT = 9263;
const VITE_PORT = 51873;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

// PRD 验收阈值：新增块 → 界面 2s 内出现。
const THRESHOLD_MS = 2000;
// FAIL 时继续量到 10s，区分「迟到」和「永不出现」。
const EXTENDED_POLL_MS = 10000;
const POLL_INTERVAL_MS = 150;

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT, thresholdMs: THRESHOLD_MS },
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;
let client = null;

const createdTabIds = [];
let overviewBlockId = "";
let tabAId = "";
let tabBId = "";
const agentBlockIds = []; // 台子新增的所有 agent 块 id（看板断言用）

// ── 页内工具 ────────────────────────────────────────────────────────────────

/** 页内 global.ts 导入重试器（dev 模式 vite 模块管道偶发抽风，重试兑底，不改断言语义）。 */
const VG_PREAMBLE = `
const __vimp = async (url, required) => {
    let lastErr = null;
    for (let i = 0; i < 12; i++) {
        try {
            const m = await import(url);
            if (required.every((k) => m && m[k] != null)) return m;
            lastErr = new Error(url + " exports missing: " + required.join(","));
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw lastErr;
};
const __vg = () => __vimp("/frontend/app/store/global.ts", ["atoms", "globalStore", "WOS", "createBlock"]);`;

function sleep2(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** 页内探针重试：只吞异常重试（网络/上下文销毁），重试耗尽仍抛。 */
async function evalRetry(expression, { tries = 5, waitMs = 500 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        try {
            return await client.evaluate(expression);
        } catch (err) {
            lastErr = err;
            await sleep2(waitMs);
        }
    }
    throw lastErr;
}

/** 挑一个真工作区的 renderer，带重试（多 renderer + attach 残留场景）。 */
async function pickRenderer({ tries = 40, intervalMs = 1500 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        const pages = await listPageTargets(ENDPOINT).catch(() => []);
        if (pages.length > 0) {
            try {
                return await pickLiveRenderer(pages, connectToTarget, ENDPOINT);
            } catch (err) {
                lastErr = err;
            }
        }
        await sleep2(intervalMs);
    }
    throw new Error(`没有可用的 renderer（${tries} 次尝试后仍失败）：${String(lastErr?.message ?? lastErr ?? "")}`);
}

// ── 页面探针 ────────────────────────────────────────────────────────────────

/** 全量快照：每个组的状态 / 组头计数（tab.blockids 口径）/ 组内行数（DOM 行）/ 展开 / 视图模式。 */
function snapshotProbe(blockId) {
    return `(async () => {
        ${VG_PREAMBLE}
        const g = await __vg();
        const ws = g.globalStore.get(g.atoms.workspace);
        const tabIds = (ws && ws.tabids) ? ws.tabids.slice() : [];
        const activeTabId = g.globalStore.get(g.atoms.staticTabId) ?? null;
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { found: false, tabIds, activeTabId, groups: [] };
        const groups = [...blk.querySelectorAll("[data-overview-tab-group]")].map((el) => ({
            tabId: el.getAttribute("data-overview-tab-group"),
            status: el.getAttribute("data-overview-tab-status"),
            headerCount: Number((el.querySelector(".session-overview-tab-title strong")?.textContent || "").trim()) || 0,
            rows: el.querySelectorAll(".session-overview-block-row").length,
            expanded: el.querySelector(".session-overview-tab-toggle")?.getAttribute("aria-expanded") ?? null,
        }));
        const viewModes = [...blk.querySelectorAll("[data-overview-view]")].map((b) => ({
            mode: b.getAttribute("data-overview-view"),
            pressed: b.getAttribute("aria-pressed"),
        }));
        return { found: true, tabIds, activeTabId, groups, viewModes };
    })()`;
}

/** 单组轻量探针（轮询用）：组头计数 + 组内行数 + 数据层 blockids + agent 块数。 */
function groupProbe(blockId, tabId) {
    return `(async () => {
        ${VG_PREAMBLE}
        const out = { group: null, tabBlockIds: null, dataAgentCount: 0 };
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk != null) {
            const grp = blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
            if (grp != null) {
                out.group = {
                    status: grp.getAttribute("data-overview-tab-status"),
                    headerCount: Number((grp.querySelector(".session-overview-tab-title strong")?.textContent || "").trim()) || 0,
                    rows: grp.querySelectorAll(".session-overview-block-row").length,
                    expanded: grp.querySelector(".session-overview-tab-toggle")?.getAttribute("aria-expanded") ?? null,
                };
            }
        }
        try {
            const g = await __vg();
            const tab = g.WOS.getObjectValue("tab:" + ${JSON.stringify(tabId)});
            if (tab != null) {
                out.tabBlockIds = (tab.blockids ?? []).slice();
                for (const blockId of tab.blockids ?? []) {
                    const block = g.WOS.getObjectValue("block:" + blockId);
                    const meta = (block?.meta ?? {});
                    if (meta["agent:provider"] || meta["agent:sessionid"]) out.dataAgentCount += 1;
                }
            }
        } catch (err) {
            out.tabBlockIds = null;
        }
        return out;
    })()`;
}

/** 折叠/展开某个组（组头常驻后 unopened / empty 组默认折叠，量行数要先展开）。 */
function clickGroupToggleProbe(blockId, tabId) {
    return `(() => {
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { ok: false, reason: "no-block" };
        const group = blk.querySelector('[data-overview-tab-group="' + ${JSON.stringify(tabId)} + '"]');
        if (group == null) return { ok: false, reason: "no-group" };
        const toggle = group.querySelector(".session-overview-tab-toggle");
        if (toggle == null) return { ok: false, reason: "no-toggle" };
        toggle.click();
        return { ok: true, before: toggle.getAttribute("aria-expanded") };
    })()`;
}

/** 在 Tab 里建一个 agent 块（同 Overview「＋ 新建 Agent」口径：activateTargetTab=false）。 */
function addAgentBlockProbe(tabId, sessionid, provider) {
    return `(async () => {
        ${VG_PREAMBLE}
        const t0 = performance.now();
        try {
            const services = await __vimp("/frontend/app/store/services.ts", ["ObjectService"]);
            const blockId = await services.ObjectService.CreateBlockInTab(
                ${JSON.stringify(tabId)},
                {
                    meta: {
                        view: "term",
                        "agent:provider": ${JSON.stringify(provider)},
                        "agent:sessionid": ${JSON.stringify(sessionid)},
                        "cmd:cwd": "/tmp/verify-overview-refresh",
                    },
                },
                { termsize: { rows: 25, cols: 80 } },
                false,
                false
            );
            return { ok: true, blockId, rpcMs: Math.round(performance.now() - t0) };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err), rpcMs: Math.round(performance.now() - t0) };
        }
    })()`;
}

/** 在 Tab 里建一个普通（非 agent）块：背景 Tab 的底块。 */
function addPlainBlockProbe(tabId) {
    return `(async () => {
        ${VG_PREAMBLE}
        try {
            const services = await __vimp("/frontend/app/store/services.ts", ["ObjectService"]);
            const blockId = await services.ObjectService.CreateBlockInTab(
                ${JSON.stringify(tabId)},
                { meta: { view: "term", "frame:title": "verify-bg" } },
                { termsize: { rows: 25, cols: 80 } },
                false,
                false
            );
            return { ok: true, blockId };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`;
}

/** 建 Overview 块（照 SnorkelingBlockKindOverview 写入点）。 */
const createOverviewBlockProbe = `(async () => {
    try {
        ${VG_PREAMBLE}
        const mod = await __vg();
        const blockId = await mod.createBlock(
            {
                meta: {
                    view: "sessionoverview",
                    "snorkeling:block-kind": "overview",
                    "frame:title": "Overview",
                    icon: "list-tree",
                },
            },
            false,
            false
        );
        return { ok: true, blockId };
    } catch (err) {
        return { ok: false, err: String(err && err.message ? err.message : err) };
    }
})()`;

/** 新建背景 Tab（activateTab=false，不抢焦点）。 */
const createTabBProbe = `(async () => {
    ${VG_PREAMBLE}
    const out = { ok: false, err: "", tabId: "", workspaceId: "" };
    try {
        const g = await __vg();
        const services = await __vimp("/frontend/app/store/services.ts", ["WorkspaceService"]);
        const ws = g.globalStore.get(g.atoms.workspace);
        if (ws == null || !ws.oid) throw new Error("workspace 未就绪");
        out.workspaceId = ws.oid;
        out.tabId = await services.WorkspaceService.CreateEmptyTab(ws.oid, "verify-refresh-b-" + Date.now().toString(36), false);
        out.ok = true;
    } catch (err) {
        out.err = String(err && err.message ? err.message : err);
    }
    return out;
})()`;

/** 悬浮卡探针：卡片是否打开 / agent 行数 / 计数文案 / 全文。 */
const hoverCardProbe = `(() => {
    const card = document.querySelector(".info-card-portal .tab-card");
    if (card == null) return { open: false };
    return {
        open: true,
        agentRows: card.querySelectorAll(".tab-card-agent-row").length,
        countText: (card.querySelector(".tab-card-count")?.textContent || "").trim(),
        text: (card.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
    };
})()`;

/** Tab 中心点（真实指针 hover 用，语言无关：只靠 data-tab-id）。 */
function tabCenterProbe(tabId) {
    return `(() => {
        const el = document.querySelector('.tab-bar .tab[data-tab-id="' + ${JSON.stringify(tabId)} + '"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`;
}

/** JS 点击某个 Tab（切换激活 Tab 用：renderer 在后台时真实指针点不了，JS click 走同一 setActiveTab）。 */
function clickTabProbe(tabId) {
    return `(() => {
        const el = document.querySelector('.tab-bar .tab[data-tab-id="' + ${JSON.stringify(tabId)} + '"]');
        if (el == null) return { ok: false, reason: "no-tab" };
        el.click();
        return { ok: true };
    })()`;
}

/** 本 renderer 绑定的 Tab id（每个 Tab 一个 WebContentsView renderer）。 */
const rendererTabProbe = `(async () => {
    ${VG_PREAMBLE}
    try {
        const g = await __vg();
        return { tabId: g.globalStore.get(g.atoms.staticTabId) ?? null, width: innerWidth, height: innerHeight };
    } catch (err) {
        return { tabId: null, width: innerWidth, height: innerHeight };
    }
})()`;

/** 遍历所有 page target，报出每个 renderer 绑定的 Tab。 */
async function mapRenderers() {
    const pages = await listPageTargets(ENDPOINT);
    const out = [];
    for (const page of pages) {
        const c = await connectToTarget(ENDPOINT, page).catch(() => null);
        if (c == null) continue;
        const info = await c.evaluate(rendererTabProbe).catch(() => null);
        out.push({ client: c, info });
    }
    return out;
}

/** 找绑定指定 Tab 的 renderer（带重试：新 Tab 的 renderer 起动要几秒）。 */
async function findRendererForTab(tabId, { tries = 20, intervalMs = 800 } = {}) {
    for (let i = 0; i < tries; i++) {
        const map = await mapRenderers();
        const hit = map.find((m) => m?.info?.tabId === tabId);
        for (const m of map) if (m !== hit) m.client.close();
        if (hit != null) {
            return { hit, map: map.map((m) => ({ tabId: m.info?.tabId ?? null, width: m.info?.width, height: m.info?.height })) };
        }
        await sleep2(intervalMs);
    }
    return { hit: null, map: [] };
}

/** 切 Overview 视图模式（按钮按 data-overview-view 定位，语言无关）。 */
function clickViewModeProbe(blockId, mode) {
    return `(() => {
        const blk = document.querySelector('[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
        if (blk == null) return { ok: false, reason: "no-block" };
        const btn = blk.querySelector('[data-overview-view="' + ${JSON.stringify(mode)} + '"]');
        if (btn == null) return { ok: false, reason: "no-button" };
        btn.click();
        return { ok: true, before: btn.getAttribute("aria-pressed") };
    })()`;
}

/** 看板卡片探针：所有 agent 块的卡片是否都在。 */
function boardCardsProbe(blockIds) {
    return `(() => {
        const ids = ${JSON.stringify(blockIds)};
        const out = { present: [], missing: [] };
        for (const id of ids) {
            const el = document.querySelector('.session-overview-board-card[data-block-id="' + id + '"]');
            if (el != null) out.present.push(id);
            else out.missing.push(id);
        }
        out.totalCards = document.querySelectorAll(".session-overview-board-card").length;
        return out;
    })()`;
}

/** 清 localStorage 里会污染起点视图的偏好。 */
const cleanseStorageProbe = `(() => {
    const keys = [
        "snorkeling.overview.viewMode",
        "snorkeling.overview.boardGroup",
        "snorkeling:session-overview:agents-only",
        "snorkeling:session-overview:hide-unopened-tabs",
    ];
    const removed = [];
    for (const key of keys) {
        if (localStorage.getItem(key) != null) {
            localStorage.removeItem(key);
            removed.push(key);
        }
    }
    return removed;
})()`;

// ── 计时器 ──────────────────────────────────────────────────────────────────

/**
 * 轮询直到 predicate 成立，量「从现在起多久 DOM 出现」。
 * @returns {appearedAt} 出现耗时（ms）；null = 到 maxMs 都没出现。
 */
async function measureAppear(probeExpr, predicate, { thresholdMs = THRESHOLD_MS, maxMs = EXTENDED_POLL_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
    const t0 = Date.now();
    let appearedAt = null;
    let last = null;
    let atThreshold = null;
    while (Date.now() - t0 < maxMs) {
        last = await evalRetry(probeExpr).catch(() => null);
        if (last != null && predicate(last)) {
            appearedAt = Date.now() - t0;
            break;
        }
        if (atThreshold == null && Date.now() - t0 >= thresholdMs) {
            atThreshold = JSON.parse(JSON.stringify(last));
        }
        await sleep2(intervalMs);
    }
    return { appearedAt, withinThreshold: appearedAt != null && appearedAt <= thresholdMs, atThreshold, last };
}

/** 面板里某个 tab 的组。 */
function groupOf(snapshot, tabId) {
    return (snapshot?.groups ?? []).find((g) => g.tabId === tabId) ?? null;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
    if (dry) {
        const syntax = await import("node:child_process").then(
            ({ execFileSync }) =>
                new Promise((resolve) => {
                    try {
                        execFileSync(process.execPath, ["--check", path.join(path.dirname(fileURLToPath(import.meta.url)), "verify.mjs")], {
                            stdio: "pipe",
                            timeout: 30000,
                        });
                        resolve(0);
                    } catch (err) {
                        resolve(err.status ?? 1);
                    }
                })
        );
        check("dry-deps-resolve", syntax === 0, `node --check verify.mjs exit=${syntax}；lib = cdp/launch/report/probes`);
        reporter.finish({ skipped: ["dry run 不起 GUI"], ledger: false });
        return;
    }

    // ── 起实例 ──────────────────────────────────────────────────────────────
    instance = await ensureInstance({ attach, cdpPort: CDP_PORT, vitePort: VITE_PORT, profile: PROFILE, resetProfile: !attach });
    const picked = await pickRenderer();
    client = picked.client;
    if (instance?.client != null && instance.client !== client) {
        instance.client.close?.();
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"}) → ${client.targetUrl}`);

    await dismissOnboarding(client, { log });
    const appReady = await client.evaluate(`(() => document.querySelectorAll(".block").length)()`);
    if (!(appReady > 0)) throw new Error("实例里没有任何 .block（工作区没起来）");

    // 干净起点：视图回 list、过滤器回关，再 reload（attach 模式下残留偏好会污染计数）。
    const removedKeys = await client.evaluate(cleanseStorageProbe).catch(() => []);
    if (removedKeys.length > 0) log(`cleansed localStorage: ${removedKeys.join(", ")}`);
    if (removedKeys.length > 0) {
        await client.reload();
        await sleep(1500);
        await dismissOnboarding(client, { log }).catch(() => null);
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        if (!(await client.evaluate(`(() => document.querySelectorAll(".block").length)()`) > 0)) {
            throw new Error("reload 后工作区没起来");
        }
    }

    // ── 建 Overview 块（当前 Tab = tabA，不切激活 Tab）──────────────────────
    const overviewCreated = await evalRetry(createOverviewBlockProbe);
    if (overviewCreated?.ok !== true) throw new Error(`建 Overview 块失败: ${JSON.stringify(overviewCreated)}`);
    overviewBlockId = overviewCreated.blockId;
    log(`overview block: ${overviewBlockId}`);

    let snap = null;
    const mountedDeadline = Date.now() + 45000;
    while (Date.now() < mountedDeadline) {
        snap = await evalRetry(snapshotProbe(overviewBlockId)).catch(() => null);
        if (snap?.found === true && snap.groups.length > 0) break;
        await sleep2(500);
    }
    if (snap?.found !== true) throw new Error("Overview 面板没挂上（找不到 data-blockid 容器）");
    tabAId = snap.activeTabId ?? "";
    if (tabAId === "") throw new Error("拿不到激活 Tab id（atoms.staticTabId）");

    // ── 建 tabB（背景 Tab）+ 底块 ───────────────────────────────────────────
    const tabBCreated = await evalRetry(createTabBProbe);
    if (tabBCreated?.ok !== true) throw new Error(`建 tabB 失败: ${tabBCreated?.err}`);
    tabBId = tabBCreated.tabId;
    createdTabIds.push(tabBId);
    const seedB = await evalRetry(addPlainBlockProbe(tabBId));
    if (seedB?.ok !== true) throw new Error(`给 tabB 建底块失败: ${seedB?.err}`);
    log(`tabA=${tabAId} tabB=${tabBId} seedB=${seedB.blockId}`);

    // 等 tabB 组头出现（新 Tab 路径：workspace.tabids +1）
    let tabBGroupReady = null;
    const seedDeadline = Date.now() + 20000;
    while (Date.now() < seedDeadline) {
        tabBGroupReady = await evalRetry(groupProbe(overviewBlockId, tabBId)).catch(() => null);
        if (tabBGroupReady?.group != null && tabBGroupReady.group.headerCount >= 1) break;
        await sleep2(300);
    }
    check(
        "setup-overview-mounted",
        tabBGroupReady?.group != null && tabBGroupReady.group.headerCount >= 1 && (tabBGroupReady.group.expanded === "false"),
        {
            overviewBlockId,
            tabAId,
            tabBId,
            tabBGroup: tabBGroupReady?.group,
            dataAgentCount: tabBGroupReady?.dataAgentCount,
            note: "Overview 面板挂上 + tabA/tabB 播种齐（tabB 新建含块，组头计数 = 1）",
        }
    );

    // 展开 tabB 组（unopened 默认折叠，量行数前必须展开）
    await evalRetry(clickGroupToggleProbe(overviewBlockId, tabBId));
    let expanded = null;
    const expDeadline = Date.now() + 8000;
    while (Date.now() < expDeadline) {
        expanded = await evalRetry(groupProbe(overviewBlockId, tabBId)).catch(() => null);
        if (expanded?.group?.expanded === "true") break;
        await sleep2(250);
    }
    check(
        "baseline-b-seed-block-visible",
        expanded?.group?.expanded === "true" && expanded?.group?.rows === 1 && expanded?.group?.headerCount === 1,
        {
            tabBGroup: expanded?.group,
            note: "对照组：背景 Tab 在**新建**时（含块）组头计数与组内行同步（1/1）",
        }
    );

    // ── 跨 renderer 播种：找到 tabB 自己的 renderer（= 用户「在那个 Tab 里点新建」的发起方）──
    // 保真度关键：同一 renderer 里发 RPC 时，HTTP 响应自带的 updates 会直接写本 renderer 的
    // wov cache（callBackendService → updateWaveObjects）——面板可能只是被 RPC 回包喂饱，
    // 而不是被 WPS 广播喂饱。用户场景里 Overview renderer 从不发这条 RPC，只吃广播。
    // 所以 S1/S2 的主断言必须把 RPC 发在 **另一个 renderer** 里。
    const rendererForB = await findRendererForTab(tabBId);
    let clientB = rendererForB.hit?.client ?? null;
    check(
        "renderer-of-tabB-found",
        clientB != null && rendererForB.hit?.info?.tabId === tabBId,
        {
            renderers: rendererForB.map,
            tabAId,
            tabBId,
            note: "每个 Tab 一个 renderer；tabB 的 renderer 必须独立于 Overview 所在 renderer 才能发跨 renderer 断言",
        }
    );
    if (clientB == null) {
        skipped.push("找不到 tabB 自己的 renderer → 跨 renderer 断言记 skipped（同 renderer 断言仍有效）");
    }

    // ── 断言 2（主路径）：跨 renderer 新增 agent 块 → Overview 组行 +1 且 ≤2s ──
    let crossDetail = { skipped: clientB == null };
    let crossOk = false;
    if (clientB != null) {
        const rowsBX0 = (await evalRetry(groupProbe(overviewBlockId, tabBId)))?.group?.rows ?? -1;
        const headerBX0 = (await evalRetry(groupProbe(overviewBlockId, tabBId)))?.group?.headerCount ?? -1;
        const addBX = await clientB.evaluate(addAgentBlockProbe(tabBId, "verify-refresh-cross", "claude"));
        if (addBX?.ok !== true) throw new Error(`tabB（renderer B）建 agent 块失败: ${JSON.stringify(addBX)}`);
        agentBlockIds.push(addBX.blockId);
        log(`tabB +agent（跨 renderer，从 tabB 自己的 renderer 发 RPC）: ${JSON.stringify(addBX)}`);
        const bxMeasure = await measureAppear(
            groupProbe(overviewBlockId, tabBId),
            (st) => st?.group?.rows != null && st.group.rows > rowsBX0
        );
        const bxAfter = bxMeasure.last ?? (await evalRetry(groupProbe(overviewBlockId, tabBId)));
        crossOk = bxMeasure.withinThreshold;
        crossDetail = {
            blockId: addBX.blockId,
            rpcMs: addBX.rpcMs,
            rowsBefore: rowsBX0,
            rowsAfter: bxAfter?.group?.rows ?? null,
            headerBefore: headerBX0,
            headerAfter: bxAfter?.group?.headerCount ?? null,
            appearedAtMs: bxMeasure.appearedAt,
            withinThreshold: bxMeasure.withinThreshold,
            tabBlockIdsContainsBlock: (bxAfter?.tabBlockIds ?? []).includes(addBX.blockId),
        };
        await shot(client, "02-cross-renderer-add-block");
    }
    check(
        "s2-cross-renderer-add-block",
        crossDetail.skipped ? false : crossOk,
        {
            ...crossDetail,
            fidelity: "RPC 从 tabB 自己的 renderer 发出（Overview renderer 只吃 WPS 广播）= 用户真实路径",
            verdict: crossDetail.skipped
                ? "skipped（找不到 tabB renderer）"
                : crossOk
                  ? "跨 renderer 新增 ≤2s 入组（广播链路有效）"
                  : crossDetail.appearedAtMs != null
                    ? `迟到（${crossDetail.appearedAtMs}ms）→ H2 类`
                    : crossDetail.tabBlockIdsContainsBlock
                      ? "永不出现（数据已到 Overview renderer，UI 不更新）→ H1 类 atom 失效"
                      : "永不出现（数据层也没到 Overview renderer）→ 广播问题（排除 H4）",
        }
    );

    // ── 断言 2b：Overview 所在 Tab 处于后台时新增 → 切回后 ≤2s 能看到 ──
    // S1 用户路径：在 sessions Tab 建块/恢复会话 → 切到 OverView Tab 看。Overview 面板
    // 在后台时可能被卸载（react 不渲染），所以「后台期间是否更新」记为证据，不作硬断言；
    // 硬断言是「切回来之后 ≤2s 行数正确」。
    let bgDetail = { skipped: clientB == null };
    let bgOk = false;
    if (clientB != null) {
        await evalRetry(clickTabProbe(tabBId)); // 切激活 Tab 到 tabB（Overview 变后台）
        await sleep2(1500);
        const aSnapBg = await evalRetry(snapshotProbe(overviewBlockId)).catch(() => null);
        const overviewMountedWhileInactive = aSnapBg?.found === true;
        const bgData = await evalRetry(groupProbe(overviewBlockId, tabBId));
        const rowsBg0 = overviewMountedWhileInactive ? (bgData?.group?.rows ?? -1) : -1;
        const expectedRowsAfter = (bgData?.tabBlockIds ?? []).length;
        const addBG = await clientB.evaluate(addAgentBlockProbe(tabBId, "verify-refresh-bg", "pi"));
        if (addBG?.ok !== true) throw new Error(`tabB（后台期间）建 agent 块失败: ${JSON.stringify(addBG)}`);
        agentBlockIds.push(addBG.blockId);
        log(`tabB +agent（Overview 后台期间）: ${JSON.stringify(addBG)}`);
        let appearedWhileInactive = null;
        if (overviewMountedWhileInactive) {
            const mBg = await measureAppear(
                groupProbe(overviewBlockId, tabBId),
                (st) => st?.group?.rows != null && st.group.rows > rowsBg0
            );
            appearedWhileInactive = mBg.appearedAt;
        }
        await evalRetry(clickTabProbe(tabAId)); // 切回 Overview Tab
        // 面板重挂（后台期间若被卸载）会重置折叠态：先量组头计数（数据口径，折叠也更新），
        // 再补展开量行数（展开 = 用户「切回来看」的动作）。
        const backHeaderMeasure = await measureAppear(
            groupProbe(overviewBlockId, tabBId),
            (st) => st?.group != null && st.group.headerCount >= expectedRowsAfter + 1
        );
        const backGroupNow = backHeaderMeasure.last ?? (await evalRetry(groupProbe(overviewBlockId, tabBId)));
        if (backGroupNow?.group?.expanded === "false") {
            await evalRetry(clickGroupToggleProbe(overviewBlockId, tabBId));
        }
        const backRows = await evalRetry(groupProbe(overviewBlockId, tabBId));
        bgOk = backHeaderMeasure.withinThreshold && (backRows?.group?.rows ?? -1) >= expectedRowsAfter + 1;
        bgDetail = {
            blockId: addBG.blockId,
            rpcMs: addBG.rpcMs,
            overviewMountedWhileInactive,
            appearedWhileInactiveAtMs: appearedWhileInactive,
            headerExpected: expectedRowsAfter + 1,
            headerAppearedAfterBackAtMs: backHeaderMeasure.appearedAt,
            headerAfterBack: backRows?.group?.headerCount ?? null,
            rowsAfterBack: backRows?.group?.rows ?? null,
            expandedAfterBack: backRows?.group?.expanded ?? null,
            withinThresholdAfterBack: backHeaderMeasure.withinThreshold,
        };
        await shot(client, "02b-add-while-overview-inactive");
    }
    check(
        "s2b-add-while-overview-tab-inactive",
        bgDetail.skipped ? false : bgOk,
        {
            ...bgDetail,
            note: "Overview Tab 后台期间在 tabB renderer 里建块；硬断言=切回后 ≤2s 行数正确",
        }
    );

    // ── 断言 3：激活 Tab 加 agent 块 → 组内行 +1 且 ≤2s ─────────────────────
    // tabA 此时只有 Overview 块 → status=empty → 组默认折叠；先展开，量行数才有效。
    const tabABefore = await evalRetry(groupProbe(overviewBlockId, tabAId));
    if (tabABefore?.group?.expanded !== "true") {
        await evalRetry(clickGroupToggleProbe(overviewBlockId, tabAId));
        const expA = await evalRetry(groupProbe(overviewBlockId, tabAId));
        log(`tabA group expanded: ${JSON.stringify(expA?.group)}`);
    }
    const tabABaseline = await evalRetry(groupProbe(overviewBlockId, tabAId));
    const rowsA0 = tabABaseline?.group?.rows ?? -1;
    const headerA0 = tabABaseline?.group?.headerCount ?? -1;
    const addA1 = await evalRetry(addAgentBlockProbe(tabAId, "verify-refresh-a1", "claude"));
    if (addA1?.ok !== true) throw new Error(`tabA 建 agent 块失败: ${JSON.stringify(addA1)}`);
    agentBlockIds.push(addA1.blockId);
    log(`tabA +agent#1: ${JSON.stringify(addA1)}`);
    const a1Measure = await measureAppear(
        groupProbe(overviewBlockId, tabAId),
        (st) => st?.group?.rows != null && st.group.rows > rowsA0
    );
    const a1After = a1Measure.last ?? (await evalRetry(groupProbe(overviewBlockId, tabAId)));
    const classification = {
        blockId: addA1.blockId,
        rpcMs: addA1.rpcMs,
        rowsBefore: rowsA0,
        rowsAfter: a1After?.group?.rows ?? null,
        headerBefore: headerA0,
        headerAfter: a1After?.group?.headerCount ?? null,
        appearedAtMs: a1Measure.appearedAt,
        withinThreshold: a1Measure.withinThreshold,
        statusBefore: tabABaseline?.group?.status ?? null,
        statusAfter: a1After?.group?.status ?? null,
        tabBlockIdsContainsBlock: (a1After?.tabBlockIds ?? []).includes(addA1.blockId),
        dataAgentCount: a1After?.dataAgentCount ?? null,
    };
    check(
        "s2-live-tab-add-block",
        a1Measure.withinThreshold,
        {
            ...classification,
            verdict: a1Measure.withinThreshold
                ? "live add block 出现在阈值内"
                : a1Measure.appearedAt != null
                  ? `迟到（${a1Measure.appearedAt}ms > ${THRESHOLD_MS}ms）→ H2 类`
                  : "永不出现（组内行数未 +1）→ 若数据层已到本 renderer 则 H1 类 atom 失效",
        }
    );
    await shot(client, "03-live-tab-add-block");

    // ── 断言 4-6：hover 激活 Tab 的悬浮卡 ───────────────────────────────────
    const tabPoint = await evalRetry(tabCenterProbe(tabAId));
    if (tabPoint == null) throw new Error("找不到 tabA 的 Tab 元素（.tab-bar .tab[data-tab-id]）");
    await client.move(tabPoint.x, tabPoint.y);
    let cardOpen = null;
    const cardDeadline = Date.now() + 15000;
    while (Date.now() < cardDeadline) {
        cardOpen = await client.evaluate(hoverCardProbe).catch(() => null);
        if (cardOpen?.open === true) break;
        await sleep2(300);
        await client.move(tabPoint.x, tabPoint.y);
    }
    // 对照组：hover 后显示的 agent 行数 = 数据层 agent 块数（证明不是 hover 打开期间 latch 的旧值）
    const expectedAgents = a1After?.dataAgentCount ?? 0;
    check(
        "s3-hover-card-baseline",
        cardOpen?.open === true && cardOpen.agentRows === expectedAgents && expectedAgents >= 1,
        {
            card: cardOpen,
            dataAgentCount: expectedAgents,
            note: "对照组：hover 前已建的 agent 块（1 个）必须先正确显示在卡上",
        }
    );
    await shot(client, "04-hover-card-baseline");

    // 鼠标**不动**，在激活 Tab 再加一个 agent 块 → 卡片行 +1 且 ≤2s
    const rowsCard0 = cardOpen?.agentRows ?? 0;
    const addA2 = await evalRetry(addAgentBlockProbe(tabAId, "verify-refresh-a2", "pi"));
    if (addA2?.ok !== true) throw new Error(`tabA 建 agent#2 失败: ${JSON.stringify(addA2)}`);
    agentBlockIds.push(addA2.blockId);
    log(`tabA +agent#2（hover 期间，鼠标未动）: ${JSON.stringify(addA2)}`);
    const cardMeasure = await measureAppear(
        hoverCardProbe,
        (st) => st?.open === true && st.agentRows > rowsCard0
    );
    const cardAfter = cardMeasure.last ?? (await client.evaluate(hoverCardProbe));
    const tabAGroupDuringCard = await evalRetry(groupProbe(overviewBlockId, tabAId));
    check(
        "s3-hover-card-refresh-live",
        cardMeasure.withinThreshold,
        {
            blockId: addA2.blockId,
            rpcMs: addA2.rpcMs,
            cardRowsBefore: rowsCard0,
            cardRowsAfter: cardAfter?.agentRows ?? null,
            cardOpenAfter: cardAfter?.open ?? null,
            overviewRowsAfter: tabAGroupDuringCard?.group?.rows ?? null,
            overviewHeaderAfter: tabAGroupDuringCard?.group?.headerCount ?? null,
            appearedAtMs: cardMeasure.appearedAt,
            withinThreshold: cardMeasure.withinThreshold,
            verdict: cardMeasure.withinThreshold
                ? "hover 期间新增块 ≤2s 上卡"
                : cardMeasure.appearedAt != null
                  ? `迟到（${cardMeasure.appearedAt}ms）`
                  : (tabAGroupDuringCard?.group?.rows ?? 0) > rowsCard0
                    ? "Overview 组已更新但 hover 卡片不动 → H3 类 hover latch"
                    : "卡片与 Overview 都未更新",
        }
    );
    await shot(client, "05-hover-card-refresh-live");

    // 对照组：移开再 hover 一次 → 行数与数据层一致
    await client.move(4, 4);
    await sleep2(700);
    const tabPoint2 = await evalRetry(tabCenterProbe(tabAId));
    await client.move(tabPoint2.x, tabPoint2.y);
    let rehover = null;
    const rehoverDeadline = Date.now() + 15000;
    while (Date.now() < rehoverDeadline) {
        rehover = await client.evaluate(hoverCardProbe).catch(() => null);
        if (rehover?.open === true) break;
        await sleep2(300);
        await client.move(tabPoint2.x, tabPoint2.y);
    }
    const expectedAgents2 = (await evalRetry(groupProbe(overviewBlockId, tabAId)))?.dataAgentCount ?? 0;
    check(
        "s3-rehover-consistent",
        rehover?.open === true && rehover.agentRows === expectedAgents2,
        {
            card: rehover,
            dataAgentCount: expectedAgents2,
            note: "对照组：移开再 hover 后行数与数据层一致（区分「latch」与「首次渲染就没拿到新值」）",
        }
    );
    await shot(client, "06-hover-card-rehover");
    await client.move(4, 4);
    await sleep2(600);

    // ── 断言 7：背景 Tab 加 agent 块 → 组内行 +1 且 ≤2s ─────────────────────
    const tabBBaseline = await evalRetry(groupProbe(overviewBlockId, tabBId));
    const rowsB0 = tabBBaseline?.group?.rows ?? -1;
    const headerB0 = tabBBaseline?.group?.headerCount ?? -1;
    const addB1 = await evalRetry(addAgentBlockProbe(tabBId, "verify-refresh-b2", "claude"));
    if (addB1?.ok !== true) throw new Error(`tabB 建 agent 块失败: ${JSON.stringify(addB1)}`);
    agentBlockIds.push(addB1.blockId);
    log(`tabB +agent#1（背景 Tab）: ${JSON.stringify(addB1)}`);
    const b1Measure = await measureAppear(
        groupProbe(overviewBlockId, tabBId),
        (st) => st?.group?.rows != null && st.group.rows > rowsB0
    );
    const b1After = b1Measure.last ?? (await evalRetry(groupProbe(overviewBlockId, tabBId)));
    check(
        "s2-background-tab-add-block",
        b1Measure.withinThreshold,
        {
            blockId: addB1.blockId,
            rpcMs: addB1.rpcMs,
            rowsBefore: rowsB0,
            rowsAfter: b1After?.group?.rows ?? null,
            headerBefore: headerB0,
            headerAfter: b1After?.group?.headerCount ?? null,
            appearedAtMs: b1Measure.appearedAt,
            withinThreshold: b1Measure.withinThreshold,
            tabBlockIdsContainsBlock: (b1After?.tabBlockIds ?? []).includes(addB1.blockId),
            verdict: b1Measure.withinThreshold
                ? "背景 Tab 新增块 ≤2s 入组"
                : b1Measure.appearedAt != null
                  ? `迟到（${b1Measure.appearedAt}ms）→ H2 类`
                  : (b1After?.tabBlockIds ?? []).includes(addB1.blockId)
                    ? "永不出现（数据已到本 renderer，UI 不更新）→ H1 类 atom 失效"
                    : "永不出现（数据层也没到本 renderer）→ 数据/广播问题（排除 H4）",
        }
    );
    await shot(client, "07-background-tab-add-block");

    // ── 断言 8：近似「恢复会话」（同 shape agent-meta 块建在背景 Tab）────────
    // 真实 AISessions「恢复」入口需要真实会话历史（profile 内无历史），所以这里建
    // 带 agent:autoresume/provider/sessionid 的 term 块（= agent-resume 台同 shape），
    // 覆盖「数据层出现一个可恢复 agent 块 → Overview 出卡」这一段链路。
    // 基线必须在建块**之前**读（上一轮把基线读在建块之后，块已上屏 → 断言恒红）。
    const rowsB1 = (await evalRetry(groupProbe(overviewBlockId, tabBId)))?.group?.rows ?? -1;
    // 恢复路径同样走 **tabB 自己的 renderer** 发 RPC（保真：Overview renderer 不发这条 RPC）。
    const restoreProbe = `(async () => {
        ${VG_PREAMBLE}
        try {
            const services = await __vimp("/frontend/app/store/services.ts", ["ObjectService"]);
            const t0 = performance.now();
            const blockId = await services.ObjectService.CreateBlockInTab(
                ${JSON.stringify(tabBId)},
                {
                    meta: {
                        view: "term",
                        "agent:autoresume": true,
                        "agent:provider": "pi",
                        "agent:sessionid": "verify-refresh-restored",
                        "cmd:cwd": "/tmp/verify-overview-refresh",
                    },
                },
                { termsize: { rows: 25, cols: 80 } },
                false,
                false
            );
            return { ok: true, blockId, rpcMs: Math.round(performance.now() - t0) };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`;
    const addRestore = clientB != null ? await clientB.evaluate(restoreProbe) : await evalRetry(restoreProbe);
    if (addRestore?.ok !== true) {
        skipped.push(`s1 恢复会话近似块建不出来：${addRestore?.err}`);
    }
    let restoreOk = false;
    let restoreDetail = { skipped: addRestore?.ok !== true };
    if (addRestore?.ok === true) {
        agentBlockIds.push(addRestore.blockId);
        const rMeasure = await measureAppear(
            groupProbe(overviewBlockId, tabBId),
            (st) => st?.group?.rows != null && st.group.rows > rowsB1
        );
        const rAfter = rMeasure.last ?? (await evalRetry(groupProbe(overviewBlockId, tabBId)));
        restoreOk = rMeasure.withinThreshold;
        restoreDetail = {
            blockId: addRestore.blockId,
            rpcMs: addRestore.rpcMs,
            rowsBefore: rowsB1,
            rowsAfter: rAfter?.group?.rows ?? null,
            headerAfter: rAfter?.group?.headerCount ?? null,
            appearedAtMs: rMeasure.appearedAt,
            withinThreshold: rMeasure.withinThreshold,
            tabBlockIdsContainsBlock: (rAfter?.tabBlockIds ?? []).includes(addRestore.blockId),
            rpcOrigin: clientB != null ? "tabB 自己的 renderer" : "Overview renderer（降级）",
        };
        await shot(client, "08-restored-session-card");
    }
    check(
        "s1-restored-session-card",
        restoreOk,
        {
            ...restoreDetail,
            fidelity: "近似：走 CreateBlockInTab + agent:autoresume/provider/sessionid（同 agent-resume 台 shape），未驱动 AISessions「恢复」按钮 UI",
        }
    );

    // ── 断言 9：看板视图（S1 的看板面）──────────────────────────────────────
    const boardClick = await evalRetry(clickViewModeProbe(overviewBlockId, "board"));
    let boardDetail = { skipped: boardClick?.ok !== true, reason: boardClick?.reason ?? null };
    if (boardClick?.ok === true) {
        const bMeasure = await measureAppear(
            boardCardsProbe(agentBlockIds),
            (st) => st != null && st.missing.length === 0 && st.present.length === agentBlockIds.length
        );
        boardDetail = {
            expectedBlockIds: agentBlockIds,
            present: bMeasure.last?.present ?? [],
            missing: bMeasure.last?.missing ?? [],
            totalCards: bMeasure.last?.totalCards ?? 0,
            appearedAtMs: bMeasure.appearedAt,
            withinThreshold: bMeasure.withinThreshold,
        };
        await shot(client, "09-board-cards");
        // 切回 list，别把 profile 留在 board 态
        await evalRetry(clickViewModeProbe(overviewBlockId, "list"));
    } else {
        skipped.push("看板视图按钮不可用（data-overview-view=board 缺失）→ 看板面未断言");
    }
    check("board-cards-for-added-blocks", boardDetail.skipped ? false : boardDetail.withinThreshold === true, {
        ...boardDetail,
    });

    // ── 根因判定表（写进 report，结论必须能追溯到数字）──────────────────────
    const results = reporter.results;
    const rows = {
        "s2-cross-renderer-add-block": results.find((r) => r.id === "s2-cross-renderer-add-block")?.ok ? "PASS" : "FAIL",
        "s2b-add-while-overview-tab-inactive": results.find((r) => r.id === "s2b-add-while-overview-tab-inactive")?.ok ? "PASS" : "FAIL",
        "s2-live-tab-add-block": results.find((r) => r.id === "s2-live-tab-add-block")?.ok ? "PASS" : "FAIL",
        "s3-hover-card-refresh-live": results.find((r) => r.id === "s3-hover-card-refresh-live")?.ok ? "PASS" : "FAIL",
        "s2-background-tab-add-block": results.find((r) => r.id === "s2-background-tab-add-block")?.ok ? "PASS" : "FAIL",
        "s1-restored-session-card": results.find((r) => r.id === "s1-restored-session-card")?.ok ? "PASS" : "FAIL",
        "board-cards-for-added-blocks": results.find((r) => r.id === "board-cards-for-added-blocks")?.ok ? "PASS" : "FAIL",
    };
    const rootCauseTable = [
        "## 根因判定表（对应 PRD H1-H4）",
        "",
        "| 断言 | 结果 | 触发假设 |",
        "| --- | --- | --- |",
        `| s2-cross-renderer-add-block | ${rows["s2-cross-renderer-add-block"]} | 主路径（RPC 来自另一 renderer，只吃 WPS 广播）：FAIL→H1（永不，数据已到则派生 atom 失效）/H2（迟到）；PASS→广播链路正常 |`,
        `| s2b-add-while-overview-tab-inactive | ${rows["s2b-add-while-overview-tab-inactive"]} | FAIL→切回 Overview 也看不到（真 bug）；PASS→「人眼/切 Tab 后已刷新」（H4 倾向） |`,
        `| s2-live-tab-add-block | ${rows["s2-live-tab-add-block"]} | 同 renderer 路径（RPC 回包也会写 cache）：FAIL→H1/H2；PASS 但 cross FAIL→回包假绿 |`,
        `| s3-hover-card-refresh-live | ${rows["s3-hover-card-refresh-live"]} | FAIL 且组行同步→H3（hover latch）；组行也未同步→同 H1 |`,
        `| s2-background-tab-add-block | ${rows["s2-background-tab-add-block"]} | FAIL→H1/H2；数据层也没有→排除 H4（真 bug） |`,
        `| s1-restored-session-card | ${rows["s1-restored-session-card"]} | 同上（近似恢复会话） |`,
        `| board-cards-for-added-blocks | ${rows["board-cards-for-added-blocks"]} | S1 看板面 |`,
        "",
        "全绿 → H4（不是 bug，视图/人眼错位）；任一红 → 按 above verdict 字段里的 H1/H2/H3 分类。",
    ].join("\n");
    log(rootCauseTable);

    reporter.finish({
        extra: { overviewBlockId, tabAId, tabBId, agentBlockIds, rootCauseTable },
        skipped,
        cleanup: keepOpen
            ? () => {
                  client?.close?.();
                  log("--keep-open：实例保留，手工检查后自行关闭");
              }
            : () => {
                  client?.close?.();
                  if (instance?.spawned) instance.cleanup?.();
              },
    });
}

try {
    await main();
} catch (err) {
    reporter.fatal(err, {
        cleanup: () => {
            client?.close?.();
            if (instance?.spawned) instance.cleanup?.();
        },
    });
}
