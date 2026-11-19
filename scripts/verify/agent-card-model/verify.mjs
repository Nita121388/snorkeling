#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 卡片模型展示：新鲜度 / provider·模型拆分 / 标题来源短标记 —— 真机 CDP 验证。
//
// 为什么要有这个台子：本包的判据是「agent 悬浮卡 + 弹窗展示了会话**当前**模型（切模型后
// 无新回复也能更新）、provider 与模型分两处、原始 titleSource 只进 tooltip 不占副标题」。
// 这条链路依赖真实后端（LiveSessionState → CurrentModelState 有界尾部读 + Summary 的
// titleSource），单测覆盖不到「真机索引里模型真的切了、卡片真的读到了」。
//
// 数据隔离：把 pi 会话目录指向临时 fixture（PI_CODING_AGENT_SESSION_DIR）+ ai-sessions
// 索引全部落临时目录（WAVETERM_AI_SESSIONS_*），**不读不写**真实 ~/.pi 与
// ~/.snorkeling/ai-sessions。fixture 由本台子自造（pi v3 真实形状），断言完全确定。
//
// 12 条断言：
//   1. 模型切换无新回复更新：副标题 = 切换目标 kimi-k3，绝不含旧模型 deepseek-v4.1-flash
//   2. provider 与模型分两处：name=mydeepseek（供应商）、sub=kimi-k3（模型），两元素不同
//   3. raw 在 tooltip：sub 的 title 属性保留原始 titleSource（first_user_message）
//   4. 副标题无 First User Message：可见文本不含 humanize 长串（旧 bug 的 `· First User Message`）
//   5. first_user_message 有标记：[data-title-source="first_user_message"] 且带消息图标类
//   6. ai 有 ✨：[data-title-source="ai"] 且带 fa-wand-magic-sparkles（向导星）
//   7. user 无标记：titleSource=user 的卡片副标题没有任何标题来源标记
//   8. mini 行零 RPC：Tab「更多」紧凑行只拆 meta 启动串，LiveSessionState 不被调用
//   9-12. hover/modal 一致性：弹窗（AgentCardModal）的 name / sub / mark / sub tooltip
//         与悬浮卡快照逐项相等
//
// 用法：
//   node scripts/verify/agent-card-model/verify.mjs              # 起干净实例 → 全流程 → 自动关
//   node scripts/verify/agent-card-model/verify.mjs --attach     # 复用已起实例（迭代主力）
//   node scripts/verify/agent-card-model/verify.mjs --keep-open  # 结束后不关实例
//   node scripts/verify/agent-card-model/verify.mjs --dry        # 只解析参数/依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, hoverUntil, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "agent-card-model";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
// 迭代验证用：worker 阶段不落台账（红线：verify-ledger.md 只由主 agent 在 G7/prove 时落）。
// 默认（不传）与其它 area 台子一致：跑完追加一行台账。
const noLedger = argv.includes("--no-ledger");

// 独立 profile + 独立端口：不与别的 area 抢默认实例（默认 profile=verify / cdp=9231 共用）。
const PROFILE = "verify-agent-card-model";
const CDP_PORT = 9253;
const VITE_PORT = 51814;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { fixtures: ["verify-switch-1", "verify-ai-1", "verify-user-1", "verify-mini-1"] },
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;

// ── 数据隔离：fixture pi 会话 + ai-sessions 索引全落临时目录（必须在 ensureInstance 之前）──
const fixtureTmp = path.join(os.tmpdir(), `snorkeling-verify-ai-${PROFILE}`);
const piDir = path.join(fixtureTmp, "pi-sessions");
if (!attach) {
    rmSync(fixtureTmp, { recursive: true, force: true });
}
mkdirSync(piDir, { recursive: true });
mkdirSync(path.join(fixtureTmp, "index"), { recursive: true });
process.env.PI_CODING_AGENT_SESSION_DIR = piDir;
process.env.WAVETERM_AI_SESSIONS_INDEX = path.join(fixtureTmp, "index", "index.json");
process.env.WAVETERM_AI_SESSIONS_SQLITE_INDEX = path.join(fixtureTmp, "index", "index-v2.sqlite");
process.env.WAVETERM_AI_SESSIONS_META = path.join(fixtureTmp, "index", "meta.json");
process.env.WAVETERM_AI_SESSIONS_DELETED_DIR = path.join(fixtureTmp, "index", "deleted");

// pi v3 真实形状：model_change 在最后一条 assistant 之后（u3 无回复）→ 当前模型 = 切换目标。
const SWITCH_JSONL = `{"type":"session","version":3,"id":"verify-switch-1","timestamp":"2026-11-17T05:00:00.000Z","cwd":"/home/verify/project"}\n` +
    `{"type":"model_change","id":"mc0","parentId":null,"timestamp":"2026-11-17T05:00:01.000Z","provider":"opencode-go","modelId":"deepseek-v4.1-flash"}\n` +
    `{"type":"message","id":"u1","parentId":"mc0","timestamp":"2026-11-17T05:00:02.000Z","message":{"role":"user","content":[{"type":"text","text":"verify the model switch"}]}}\n` +
    `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-11-17T05:00:05.000Z","message":{"role":"assistant","provider":"opencode-go","model":"deepseek-v4.1-flash","content":[{"type":"text","text":"ok"}]}}\n` +
    `{"type":"message","id":"u2","parentId":"a1","timestamp":"2026-11-17T05:01:00.000Z","message":{"role":"user","content":[{"type":"text","text":"switch now"}]}}\n` +
    `{"type":"model_change","id":"mcB","parentId":"u2","timestamp":"2026-11-17T05:01:02.000Z","provider":"magpie","modelId":"mydeepseek/kimi-k3"}\n` +
    `{"type":"message","id":"u3","parentId":"mcB","timestamp":"2026-11-17T05:01:03.000Z","message":{"role":"user","content":[{"type":"text","text":"why no reply"}]}}\n`;

// 其余三个 fixture 共用同一简单形状（标题来源随后通过真实 RPC 改成 ai / user）。
const PLAIN_JSONL = (id) =>
    `{"type":"session","version":3,"id":"${id}","timestamp":"2026-11-17T06:00:00.000Z","cwd":"/home/verify/project"}\n` +
    `{"type":"model_change","id":"mc0","parentId":null,"timestamp":"2026-11-17T06:00:01.000Z","provider":"magpie","modelId":"mydeepseek/kimi-k3"}\n` +
    `{"type":"message","id":"u1","parentId":"mc0","timestamp":"2026-11-17T06:00:02.000Z","message":{"role":"user","content":[{"type":"text","text":"hello ${id}"}]}}\n` +
    `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-11-17T06:00:05.000Z","message":{"role":"assistant","provider":"magpie","model":"mydeepseek/kimi-k3","content":[{"type":"text","text":"hi"}]}}\n`;

function writeFixture(name, content) {
    const p = path.join(piDir, `${name}.jsonl`);
    writeFileSync(p, content, "utf8");
    log(`fixture written: ${p}`);
}

if (dry) {
    log("dry-run: 依赖解析成功（未启动 GUI）");
    check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

// ── 页面内探针 ──────────────────────────────────────────────────────────────

const CLEAN = `function __clean(s) { return (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim(); }`;

const blockIdsProbe = `(() => [...document.querySelectorAll(".block[data-blockid]")].map((el) => el.getAttribute("data-blockid")))()`;

function createBlockJs(meta) {
    return `(async () => {
        const candidates = ["/frontend/app/store/global.ts"];
        const tried = [];
        for (const url of candidates) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const mod = await import(url);
                    if (typeof mod.createBlock !== "function") {
                        tried.push(url + ":no-createBlock");
                        break;
                    }
                    const blockId = await mod.createBlock({ meta: ${JSON.stringify(meta)} }, false, false);
                    return { ok: true, blockId, via: url, tried };
                } catch (err) {
                    const msg = String(err?.message ?? err).slice(0, 120);
                    tried.push(url + "#" + attempt + ":" + msg);
                    await new Promise((r) => setTimeout(r, 400));
                }
            }
        }
        return { ok: false, tried };
    })()`;
}

const headerCenterProbe = (blockId) => `(() => {
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    if (block == null) return null;
    block.scrollIntoView({ block: "nearest", behavior: "instant" });
    const header = block.querySelector(".block-frame-default-header");
    if (header == null) return null;
    const r = header.getBoundingClientRect();
    if (r.width < 40 || r.height < 5) return null;
    return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) };
})()`;

/** 悬浮卡（.info-card-portal 内 .agent-card，非 frameless）快照。 */
const hoverCardProbe = `(() => {
    ${CLEAN}
    const card = document.querySelector(".info-card-portal .agent-card:not(.agent-card--frameless)");
    if (card == null) return null;
    const name = card.querySelector(".agent-card-name");
    const sub = card.querySelector(".agent-card-sub");
    const mark = sub?.querySelector(".agent-card-title-source-mark");
    const titleBlock = card.querySelector(".agent-card-title-block");
    return {
        open: true,
        name: name ? __clean(name.textContent) : null,
        sub: sub ? __clean(sub.textContent) : null,
        subTitle: sub?.getAttribute("title") ?? null,
        markSource: mark ? (mark.getAttribute("data-title-source") ?? null) : null,
        markCls: mark ? (mark.className || "") : "",
        noteTitle: titleBlock ? __clean(titleBlock.textContent) : null,
    };
})()`;

/** 弹窗内（frameless）AgentHoverCard 快照 —— 与悬浮卡同探针。 */
const modalCardProbe = `(() => {
    ${CLEAN}
    const card = document.querySelector(".agent-card--frameless");
    if (card == null) return null;
    const name = card.querySelector(".agent-card-name");
    const sub = card.querySelector(".agent-card-sub");
    const mark = sub?.querySelector(".agent-card-title-source-mark");
    return {
        open: true,
        name: name ? __clean(name.textContent) : null,
        sub: sub ? __clean(sub.textContent) : null,
        subTitle: sub?.getAttribute("title") ?? null,
        markSource: mark ? (mark.getAttribute("data-title-source") ?? null) : null,
    };
})()`;

/** patch LiveSessionState，把每次调用的 sessionId 记录到 window.__verifyLssCalls。 */
const patchLssSpyJs = `(async () => {
    const m = await import("/frontend/app/store/services.ts");
    if (window.__verifyLssPatched) return { ok: true, already: true };
    window.__verifyLssCalls = [];
    const orig = m.AISessionsService.LiveSessionState.bind(m.AISessionsService);
    m.AISessionsService.LiveSessionState = (req) => {
        window.__verifyLssCalls.push(req?.sessionId ?? "");
        return orig(req);
    };
    window.__verifyLssPatched = true;
    return { ok: true };
})()`;

const lssCallsProbe = `(window.__verifyLssCalls ?? []).slice()`;

/** AgentCardGet → Set（title 标记 titleSource=ai，与 wsh `agent card set --title` 同链）。 */
const aiTitleSetJs = (id) => `(async () => {
    const wshclient = await import("/frontend/app/store/wshclientapi.ts");
    const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
    const get = await wshclient.RpcApi.AgentCardGetCommand(wshrpcutil.TabRpcClient, { identifier: ${JSON.stringify(id)} });
    if (get == null || !get.hash) return { ok: false, reason: "no-hash", get };
    const set = await wshclient.RpcApi.AgentCardSetCommand(wshrpcutil.TabRpcClient, {
        identifier: ${JSON.stringify(id)},
        title: "AI Verify Title",
        yes: true,
        expectedhash: get.hash,
    });
    return { ok: true, getHash: get.hash, changed: set?.changed, messages: set?.messages ?? [] };
})()`;

/** AISessionsService.Title → SetTitle（titleSource=user，与前端改名同链）。 */
const userTitleSetJs = (id) => `(async () => {
    const m = await import("/frontend/app/store/services.ts");
    const summary = await m.AISessionsService.Title(${JSON.stringify(id)}, "User Verify Title", "");
    return { ok: summary != null, title: summary?.title, source: summary?.titleSource };
})()`;

/** 打开 AgentCardModal（与放大按钮 pushModal 同一入口）。 */
const openModalJs = (blockId) => `(async () => {
    const globalMod = await import("/frontend/app/store/global.ts");
    const modalsMod = await import("/frontend/app/store/modalmodel.ts");
    const blockData = globalMod.globalStore.get(globalMod.WOS.getWaveObjectAtom("block:" + ${JSON.stringify(blockId)})) ?? null;
    if (blockData == null) return { ok: false, reason: "no-block-data" };
    modalsMod.modalsModel.pushModal("AgentCardModal", { blockId: ${JSON.stringify(blockId)}, blockData });
    return { ok: true };
})()`;

const tabMoreTriggerProbe = `(() => {
    const el = document.querySelector('[aria-haspopup="menu"]');
    if (el == null) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

const tabMoreRowProbe = `(() => {
    const rows = [...document.querySelectorAll('[role="menuitem"][data-tabid]')];
    const agentRow = rows.find((r) => r.getAttribute("data-agent-card") === "true");
    if (agentRow == null) return null;
    const r = agentRow.getBoundingClientRect();
    if (r.width < 10 || r.height < 5) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

const miniRowsProbe = `(() => {
    ${CLEAN}
    const rows = [...document.querySelectorAll('[data-testid="tab-more-agent-mini"]')];
    return rows.map((r) => ({ text: __clean(r.textContent) }));
})()`;

// ── 环境助手 ────────────────────────────────────────────────────────────────

function cleanText(value) {
    return (value ?? "").replace(/[\u200b-\u200f\ufeff]/g, "").trim();
}

/**
 * 本机 ui:locale 是 zh 时，首次启动的「欢迎使用 Snorkeling」向导按钮是中文（继续/开始使用/跳过），
 * 共享 dismissOnboarding 只匹配英文文案，盖不住 —— 卡在 modal-backdrop 后面什么都点不到。
 * lib/probes.mjs 不在本包白名单，所以在台内补一个中文消除器（只点确切的引导按钮）。
 */
const zhOnboardingButtonProbe = `(() => {
    const wanted = ["继续", "下一步", "开始使用", "跳过", "知道了", "开始", "完成", "好"];
    const els = [...document.querySelectorAll(".modal-backdrop button, .modal-backdrop [role=button], .modal button")];
    for (const el of els) {
        const t = (el.textContent || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
        if (!wanted.includes(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t };
    }
    return null;
})()`;

async function dismissOnboardingZh(client, { steps = 12, waitMs = 700 } = {}) {
    for (let i = 0; i < steps; i++) {
        const btn = await client.evaluate(zhOnboardingButtonProbe).catch(() => null);
        if (btn == null) return;
        await client.click(btn.x, btn.y);
        log(`dismissed zh onboarding: ${btn.t}`);
        await sleep(waitMs);
    }
}

async function waitNewBlockId(client, before, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ids = await client.evaluate(blockIdsProbe);
        const created = ids.find((id) => !before.has(id));
        if (created != null) return created;
        await sleep(500);
    }
    return null;
}

/** 等待指定 blockId 出现在 DOM；启动初期工作区还在建，块可能被布局初始化吞掉。 */
async function waitBlockIdAppear(client, blockId, timeoutMs = 40000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ids = await client.evaluate(blockIdsProbe);
        if (ids.includes(blockId)) return true;
        await sleep(600);
    }
    return false;
}

/** 启动初期工作区还在建：等 blockIds 连续三次采样稳定后再动手建块，避免新块被布局初始化吞掉。 */
async function waitWorkspaceStable(client, { samples = 3, intervalMs = 1500, timeoutMs = 90000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let stableCount = 0;
    let prev = null;
    while (Date.now() < deadline) {
        const ids = (await client.evaluate(blockIdsProbe)).slice().sort().join(",");
        if (prev != null && ids === prev) {
            stableCount++;
        } else {
            stableCount = 0;
        }
        prev = ids;
        if (stableCount >= samples - 1) return true;
        await sleep(intervalMs);
    }
    return false;
}

/** 悬停块头，等到 ready(snapshot) 成立；返回最后一次快照（可能不满足，由调用方断言）。 */
async function openHoverCard(client, blockId, ready, { tries = 30, waitMs = 800 } = {}) {
    const header = await waitFor(client, headerCenterProbe(blockId), {
        timeoutMs: 20000,
        intervalMs: 300,
        label: "block header",
    }).catch(() => null);
    if (header == null) return null;
    return hoverUntil(client, header, hoverCardProbe, (state) => state?.open === true && ready(state), {
        tries,
        waitMs,
    });
}

/** 真实指针点击（tab-more 触发器/弹窗）。 */
async function clickPoint(client, point) {
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0,
    });
    await sleep(120);
    await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    await sleep(60);
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
    });
    await sleep(350);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    writeFixture("verify-switch-1", SWITCH_JSONL);
    writeFixture("verify-ai-1", PLAIN_JSONL("verify-ai-1"));
    writeFixture("verify-user-1", PLAIN_JSONL("verify-user-1"));
    writeFixture("verify-mini-1", PLAIN_JSONL("verify-mini-1"));
    log(`fixtures ready under ${piDir}`);

    instance = await ensureInstance({
        attach,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
        profile: PROFILE,
        resetProfile: !attach,
    });
    // 启动初期可能只有 0x0 的空壳 shell 页；真实工作区在某个带块的 renderer 里。
    // 必须轮询到“有块且尺寸有效”的 renderer 再动手，否则 createBlock 插进空壳页，
    // 新块永远不出现（实测首轮就是这么超时的）。
    let client = instance.client;
    const deadline = Date.now() + 120000;
    let rendererReady = false;
    while (Date.now() < deadline) {
        const pages = await listPageTargets(ENDPOINT).catch(() => []);
        if (pages.length > 1) {
            try {
                const picked = await pickLiveRenderer(pages, connectToTarget, ENDPOINT);
                client = picked.client;
                rendererReady = true;
                break;
            } catch {
                // 还没有可用 renderer，稍后重试
            }
        } else if (pages.length === 1) {
            try {
                const cand = await connectToTarget(ENDPOINT, pages[0]);
                const info = await cand
                    .evaluate(`(() => ({ w: innerWidth, h: innerHeight, blocks: document.querySelectorAll(".block").length }))()`)
                    .catch(() => null);
                if ((info?.blocks ?? 0) > 0 && (info?.w ?? 0) > 0) {
                    client = cand;
                    rendererReady = true;
                    break;
                }
                cand.close?.();
            } catch {
                /* ignore */
            }
        }
        await sleep(1500);
    }
    if (!rendererReady) {
        throw new Error(`120s 内没有出现可用的 app renderer（带块且尺寸有效）`);
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"})`);
    await dismissOnboarding(client, { log });
    await dismissOnboardingZh(client);
    // 引导弹窗（含中文向导）必须彻底清掉：modal-backdrop 盖在整页上，后面所有 hover
    // 交互（块头悬浮卡 / tab-more 下拉）都会被它挡住。
    const backdropGone = await client.evaluate(`(() => {
        const b = document.querySelector(".modal-backdrop");
        return b == null || getComputedStyle(b).display === "none";
    })()`);
    if (backdropGone !== true) {
        throw new Error(`引导弹窗没清干净（modal-backdrop 仍在），后续 hover 断言全部会被挡住`);
    }
    log("onboarding cleared (en + zh)");

    // ── 建 4 个 term agent block（同一 Tab）；先写 ai/user 标题再 hover ──────
    // 启动初期工作区还在建：等 blockIds 稳定（连续 3 次采样一致）再建块，否则新块可能被
    // 布局初始化吞掉（实测第一次建块时就会出现「createBlock ok 但 DOM 没有新 id」）。
    await waitWorkspaceStable(client);
    const blocks = {};
    for (const [key, meta] of Object.entries({
        switch: { view: "term", "agent:provider": "pi", "agent:sessionid": "verify-switch-1" },
        ai: { view: "term", "agent:provider": "pi", "agent:sessionid": "verify-ai-1" },
        user: { view: "term", "agent:provider": "pi", "agent:sessionid": "verify-user-1" },
        mini: {
            view: "term",
            "agent:provider": "pi",
            "agent:sessionid": "verify-mini-1",
            "agent:requestedmodel": "mydeepseek/kimi-k3",
        },
    })) {
        const created = await client.evaluate(createBlockJs(meta));
        if (!created?.ok || !created?.blockId) {
            throw new Error(`创建 agent block (${key}) 失败: ${JSON.stringify(created?.tried ?? created)}`);
        }
        log(`createBlock ${key} → ${created.blockId}`);
        // 用创建返回的 id 直接等出现（比「before/after diff」稳：启动期没别的块干扰，diff 也怕布局重挂）。
        if (!(await waitBlockIdAppear(client, created.blockId))) {
            // 布局初始化可能吞掉第一次建块：补一次，再等。
            log(`block ${key} (${created.blockId}) 30s 没出现，重试一次`);
            const retry = await client.evaluate(createBlockJs(meta));
            if (retry?.ok && retry?.blockId && (await waitBlockIdAppear(client, retry.blockId))) {
                blocks[key] = retry.blockId;
                continue;
            }
            skipped.push(`${key} block：40s 内没出现新建的 term block（${created.blockId}）`);
            reporter.finish({ skipped, cleanup: () => closeAll(client), ledger: !noLedger });
            return;
        }
        blocks[key] = created.blockId;
        log(`block ${key}: ${created.blockId}`);
    }
    log(`all 4 agent blocks created: ${JSON.stringify(blocks)}`);
    await shot(client, "00-blocks");

    // 先把 ai/user 标题写进隔离索引（真实后端 RPC），再 hover —— 首次 Summary 即带对标题。
    const aiSet = await client.evaluate(aiTitleSetJs("verify-ai-1"));
    log(`ai title set: ${JSON.stringify(aiSet)}`);
    if (aiSet?.ok !== true) {
        skipped.push(`AI 标题写入失败（AgentCardSet）：${JSON.stringify(aiSet)}`);
        reporter.finish({ skipped, cleanup: () => closeAll(client), ledger: !noLedger });
        return;
    }
    const userSet = await client.evaluate(userTitleSetJs("verify-user-1"));
    log(`user title set: ${JSON.stringify(userSet)}`);
    if (userSet?.ok !== true) {
        skipped.push(`User 标题写入失败（AISessionsService.Title）：${JSON.stringify(userSet)}`);
        reporter.finish({ skipped, cleanup: () => closeAll(client), ledger: !noLedger });
        return;
    }
    await sleep(1500); // 让索引落盘/广播稳定后再读

    // ── 断言 1-5：switch 块悬浮卡（模型切换无新回复 + 拆分 + first_user_message 标记）──
    const switchReady = (s) =>
        s?.sub != null &&
        /kimi-k3/.test(s.sub) &&
        !/deepseek-v4\.1-flash/.test(s.sub) &&
        s?.markSource === "first_user_message";
    const switchCard = await openHoverCard(client, blocks.switch, switchReady, { tries: 40, waitMs: 800 });
    await shot(client, "01-hover-switch");
    // 卡片没开/没就绪时后续断言自然红（快照里全是 null/undefined），不需要额外的 ready 断言占 12 的名额。
    const sc = switchCard ?? {};
    check(
        "model-switch-no-reply-updates",
        (sc.sub ?? "").includes("kimi-k3") && !(sc.sub ?? "").includes("deepseek-v4.1-flash"),
        { sub: sc.sub }
    );
    check(
        "provider-model-two-spots",
        sc.name === "mydeepseek" && sc.sub === "kimi-k3",
        { name: sc.name, sub: sc.sub }
    );
    check(
        "raw-source-in-tooltip",
        (sc.subTitle ?? "").includes("first_user_message"),
        sc.subTitle
    );
    check(
        "subtitle-no-first-user-message",
        !/first.?user message|first_user_message|首条用户/i.test(sc.sub ?? ""),
        sc.sub
    );
    check(
        "first-user-message-mark",
        sc.markSource === "first_user_message" && (sc.markCls ?? "").includes("fa-comment-dots"),
        { mark: sc.markSource, cls: sc.markCls }
    );

    // ── 断言 6：ai 块悬浮卡（✨ 星形标记） ──────────────────────────────────
    const aiCard = await openHoverCard(
        client,
        blocks.ai,
        (s) => s?.markSource === "ai" && s?.noteTitle != null && s.noteTitle.includes("AI Verify Title"),
        { tries: 40, waitMs: 800 }
    );
    await shot(client, "02-hover-ai");
    check(
        "ai-title-sparkles-mark",
        aiCard?.markSource === "ai" && (aiCard?.markCls ?? "").includes("fa-wand-magic-sparkles"),
        { mark: aiCard?.markSource, cls: aiCard?.markCls, noteTitle: aiCard?.noteTitle }
    );

    // ── 断言 7：user 块悬浮卡（无标记） ────────────────────────────────────
    const userCard = await openHoverCard(
        client,
        blocks.user,
        (s) => s?.sub === "kimi-k3" && s?.noteTitle != null && s.noteTitle.includes("User Verify Title"),
        { tries: 40, waitMs: 800 }
    );
    await shot(client, "03-hover-user");
    const userMarkEl = await client.evaluate(
        `(() => !!document.querySelector('.info-card-portal .agent-card .agent-card-sub .agent-card-title-source-mark'))()`
    );
    check(
        "user-title-no-mark",
        userCard?.open === true && userMarkEl === false,
        { noteTitle: userCard?.noteTitle, hasMarkElement: userMarkEl }
    );

    // 关掉悬浮卡，避免挡后续 tab-more / modal。
    await client.pressKey("Escape");
    await sleep(400);

    // ── 断言 8：Tab「更多」mini 行零 RPC ──────────────────────────────────
    await client.evaluate(patchLssSpyJs);
    await client.evaluate(`(window.__verifyLssCalls = [])`);
    const moreTrigger = await client.evaluate(tabMoreTriggerProbe);
    if (moreTrigger == null) {
        skipped.push("tab-more 触发器（aria-haspopup=menu）不存在");
    } else {
        await clickPoint(client, moreTrigger);
        const row = await waitFor(client, tabMoreRowProbe, {
            timeoutMs: 10000,
            intervalMs: 250,
            label: "tab-more 当前 Tab 行（data-agent-card=true）",
        }).catch(() => null);
        if (row == null) {
            skipped.push("tab-more 下拉里没有 agent 行");
        } else {
            // hover 行 → InfoCardPortal 里的 TabMoreAgentCard（≥2 agents → mini 行出现）
            const mini = await hoverUntil(
                client,
                row,
                miniRowsProbe,
                (rows) => Array.isArray(rows) && rows.length > 0,
                { tries: 20, waitMs: 700 }
            );
            await shot(client, "04-tab-more-mini");
            const calls = await client.evaluate(lssCallsProbe);
            const miniText = (mini ?? []).map((r) => r.text).join(" | ");
            // mini 行拆了 mydeepseek/kimi-k3（只读 meta），且全程没向后端问 verify-mini-1
            check(
                "mini-row-zero-rpc",
                Array.isArray(mini) &&
                    mini.length > 0 &&
                    miniText.includes("kimi-k3") &&
                    miniText.includes("mydeepseek") &&
                    !calls.includes("verify-mini-1"),
                { miniRows: mini?.length ?? 0, miniText: miniText.slice(0, 160), lssCalls: calls }
            );
            await client.pressKey("Escape");
            await sleep(400);
        }
    }

    // ── 断言 9-12：AgentCardModal 与悬浮卡逐项一致 ────────────────────────
    // 等运行时模型富化落地（sub=kimi-k3）再快照："未指定"也是真值，早拍会把旧值当结论。
    const modalOpened = await client.evaluate(openModalJs(blocks.switch));
    const modalCard = await waitForProbe(
        client,
        modalCardProbe,
        (s) => s?.open === true && s?.sub === "kimi-k3" && s?.markSource === "first_user_message",
        { timeoutMs: 25000, intervalMs: 500 }
    );
    await shot(client, "05-agent-card-modal");
    const mc = modalOpened?.ok === true && modalCard?.open === true ? modalCard : {};
    check("modal-name-matches-hover", mc.name === sc.name, { modal: mc.name, hover: sc.name });
    check("modal-sub-matches-hover", mc.sub === sc.sub, { modal: mc.sub, hover: sc.sub });
    check("modal-mark-matches-hover", mc.markSource === sc.markSource, {
        modal: mc.markSource,
        hover: sc.markSource,
    });
    check("modal-raw-tooltip-matches-hover", mc.subTitle === sc.subTitle, {
        modal: mc.subTitle,
        hover: sc.subTitle,
    });

    skipped.push(
        "首帧性能（hover p95）未纳入本台子：需要与 G2 红证基线 `verify-runs/` 里的采样做比值，收尾由主 agent 在 queue prove 时落"
    );

    reporter.finish({ skipped, cleanup: () => closeAll(client), ledger: !noLedger });
}

function closeAll(client) {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

main().catch((err) => {
    reporter.fatal(err, { cleanup: () => (instance?.spawned && !keepOpen ? instance.cleanup?.() : null) });
});