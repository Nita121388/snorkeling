#!/usr/bin/env node
// 半夜真机复现脚本（任务 11-09-overview-card-jump / R6 跨 tab 修复）：
// Overview 看板 agent 卡「定位到块」跨 tab 跳转是否真的落到具体 block。
//
// 架构事实（2026-11-10 静态分析 + 真机确认）：每个 tab 是独立的 WebContentsView
// renderer，staticTabId 在每个 renderer 里固定不变。所以：
//   - 跨 tab 断言必须连到目标 tab 自己的 CDP target 上查 DOM；
//   - createTab() 不会改变当前 evaluate 所在 renderer 的 staticTabId。
//
// 场景：tab A（当前 renderer）放 sessionoverview 块；createTab 出 tab B（新 renderer），
//       经 CreateBlockInTab 往 tab B 塞一个 agent term 块；切回 tab A；
//       看板点 [data-board-jump]；断言：视图切到 tab B、tab B 的 renderer 里
//       agent 块拿到高亮 + 焦点。
//
// 用法：node scripts/verify/overview-board/_jump-repro.mjs [--attach]

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, dismissOverlays, ensureInstance } from "../lib/launch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const runDir = path.join(
    repoRoot,
    "verify-runs",
    `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}-jumprepro`
);
mkdirSync(runDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;

// 在 tab A（本 renderer）建 overview 块；createTab 出 tab B；经 CreateBlockInTab
// 把 agent 块塞进 tab B；最后切回 tab A。
const SETUP = `(async () => {
    const globalMod = await import("/frontend/app/store/global.ts");
    const out = { tabA: "", tabB: "", agentBlockId: "", overviewBlockId: "", err: "" };
    try {
        out.tabA = globalMod.globalStore.get(globalMod.atoms.staticTabId);
        // tab A: overview 块
        out.overviewBlockId = await globalMod.createBlock({ meta: { view: "sessionoverview" } }, false, false);
        // 新建 tab B（新 renderer；本 renderer 的 staticTabId 不会变）
        globalMod.getApi().createTab();
        let tabB = "";
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 250));
            const ws = globalMod.globalStore.get(globalMod.atoms.workspace);
            tabB = (ws?.tabids ?? []).find((id) => id && id !== out.tabA) ?? "";
            if (tabB) break;
        }
        if (!tabB) throw new Error("createTab 后 10s 内 workspace.tabids 没有新 tab");
        out.tabB = tabB;
        // 经后端把 agent 块塞进 tab B 的 layout（createBlock 会落到本 renderer 的 static tab）
        const services = await import("/frontend/app/store/services.ts");
        const blockId = await services.ObjectService.CreateBlockInTab(
            tabB,
            {
                meta: {
                    view: "term",
                    "agent:provider": "claude",
                    "agent:sessionid": "verify-jump-session-0001",
                    "cmd:cwd": "/tmp/verify-jump-agent",
                },
            },
            { termsize: { rows: 25, cols: 80 } },
            false,
            false
        );
        out.agentBlockId = blockId;
        // 播一条 working 状态，让卡片状态列就绪
        try {
            await services.BlockService.ReportAgentStatus({
                blockId,
                provider: "claude",
                source: "manual",
                state: "working",
                phase: "thinking",
                seq: 1,
            });
        } catch (e) {
            out.err = "status:" + String(e);
        }
        // 回 tab A（overview 所在 tab）
        globalMod.getApi().setActiveTab(out.tabA);
    } catch (err) {
        out.err = String(err && err.message ? err.message : err);
    }
    return out;
})()`;

const CHECK_IN_TARGET = `(async () => {
    const globalMod = await import("/frontend/app/store/global.ts");
    const tabId = globalMod.globalStore.get(globalMod.atoms.staticTabId);
    const blk = document.querySelector(".block.block-${"AGENT_BLOCK_ID"}");
    const info = { tabId, blockExists: blk != null, visible: false, activeInBlock: false, border: "" };
    if (blk != null) {
        const r = blk.getBoundingClientRect();
        info.visible = r.width > 50 && r.height > 50 && r.bottom > 0 && r.right > 0;
        info.activeInBlock = blk.contains(document.activeElement);
        info.border = getComputedStyle(blk).borderColor + "/" + getComputedStyle(blk).boxShadow.slice(0, 60);
    }
    return info;
})()`;

/** 连到拥有指定 block 的那个 renderer target（各 tab 独立 target，逐个 smoke test）。 */
async function connectToBlockOwner(agentBlockId) {
    const pages = (await listPageTargets(endpoint)).filter((t) => /index\.html/.test(t.url ?? ""));
    for (const page of pages) {
        const client = await connectToTarget(endpoint, page).catch(() => null);
        if (client == null) continue;
        const owner = await client
            .evaluate(`document.querySelector(".block.block-${agentBlockId}") != null`)
            .catch(() => false);
        if (owner === true) return client;
    }
    return null;
}

async function main() {
    const attach = process.argv.includes("--attach");
    let client;
    let cleanup = null;
    if (attach) {
        client = await connect(endpoint);
    } else {
        const inst = await ensureInstance({ attach: false, resetProfile: true });
        client = inst.client;
        cleanup = inst.cleanup;
    }
    try {
        // 等 app 起来
        for (let i = 0; i < 60; i++) {
            const n = await client.evaluate(`document.querySelectorAll(".block").length`).catch(() => 0);
            if (n > 0) break;
            await sleep(500);
        }
        await dismissOverlays(client).catch(() => []);

        const setup = await client.evaluate(SETUP);
        console.log("setup:", JSON.stringify(setup, null, 2));
        if (!setup.agentBlockId) throw new Error("setup failed: " + setup.err);
        await sleep(4500); // 等 overview 数据加载 + tab A 视图切换完成

        // 确认回到了 tab A 且看板有 agent 卡
        await client.evaluate(`(() => {
            const btn = document.querySelector("[data-overview-view='board']");
            if (btn != null) btn.click();
            return true;
        })()`);
        await sleep(1500);
        const pre = await client.evaluate(`(() => {
            const cards = [...document.querySelectorAll(".session-overview-board-card")];
            const agent = cards.filter((c) => c.getAttribute("data-agent-like") === "true");
            return {
                total: cards.length,
                agent: agent.length,
                hasJumpBtn: agent[0]?.querySelector("[data-board-jump]") != null,
            };
        })()`);
        console.log("board pre-click:", JSON.stringify(pre));
        if (pre.agent === 0) throw new Error("看板上没有 agent 卡，场景构造失败");

        const clicked = await client.evaluate(`(() => {
            const card = [...document.querySelectorAll(".session-overview-board-card")].find(
                (c) => c.getAttribute("data-agent-like") === "true"
            );
            const btn = card?.querySelector("[data-board-jump]");
            if (btn == null) return { ok: false, err: "no jump button" };
            btn.click();
            return { ok: true };
        })()`);
        console.log("click jump:", JSON.stringify(clicked));
        await sleep(400);

        // 跨 tab 断言：连到 agent 块所在 renderer（tab B）查 DOM
        const owner = await connectToBlockOwner(setup.agentBlockId);
        if (owner == null) throw new Error("找不到 agent 块所在的 CDP target");
        const check1 = await owner.evaluate(CHECK_IN_TARGET.replace("AGENT_BLOCK_ID", setup.agentBlockId));
        await sleep(1200);
        const check2 = await owner.evaluate(CHECK_IN_TARGET.replace("AGENT_BLOCK_ID", setup.agentBlockId));
        console.log("tabB check @400ms:", JSON.stringify(check1, null, 2));
        console.log("tabB check @1600ms:", JSON.stringify(check2, null, 2));

        // 截图留证（当前激活视图应为 tab B）
        const s = await owner.screenshot({ x: 0, y: 0, width: 1280, height: 800 }).catch(() => null);
        if (s) {
            const buf = Buffer.isBuffer(s) ? s : s.buffer;
            writeFileSync(path.join(runDir, "after-jump.png"), buf);
        }

        const pass = check2.tabId === setup.tabB && check2.blockExists && check2.visible && check1.activeInBlock;
        console.log(pass ? "RESULT: PASS — 跨 tab 跳转落到具体块" : "RESULT: FAIL — 跨 tab 跳转没有落到块");
        console.log(`expect tabB=${setup.tabB}`);
        process.exitCode = pass ? 0 : 1;
    } finally {
        if (cleanup != null) await cleanup();
    }
}

main().catch((err) => {
    console.error("repro error:", err);
    process.exit(2);
});
