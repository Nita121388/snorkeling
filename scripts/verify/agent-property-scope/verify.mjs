#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 属性 scope（会话 / 仅此 Agent / 全局）+ 外部写入 —— 真机 CDP 验证（无人值守）。
//
// 判据（对应 prd.md AC8 / AC9）：
//   1. hover 卡点「+ Add property」打开浮层面板（名字 / 类型 / 3 个范围 / 按钮），默认「仅此会话」，
//      类型下拉 9 项，Esc 关闭；
//   2. UI 写入 agent 范围：卡片出现该属性行 + 验证 profile 的 settings.json 出现 scope="agent:pi"；
//   3. 外部写入（与 wsh agent card set 同一条 wshserver → agentcontrol → agentdata 链）：
//      agent 范围成功写入后，agent card get 的 schema 里出现该定义且 scope="agent:pi"；
//   4. 跨 Agent：codex 会话的卡片能看到全局范围的属性，**看不到** agent:pi 的属性。
//
// 数据隔离：本台子把 ai-sessions 索引/元数据指向临时目录（WAVETERM_AI_SESSIONS_*），
// settings 走验证 profile（.runcfg/<profile>/config），**不污染** ~/.snorkeling/ai-sessions
// 与用户真实 settings.json。
//
// 用法：
//   node scripts/verify/agent-property-scope/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/agent-property-scope/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/agent-property-scope/verify.mjs --keep-open  # 结束后留实例
//   node scripts/verify/agent-property-scope/verify.mjs --dry        # 只解析依赖
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, hoverUntil, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "agent-property-scope";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const PROFILE = "verify-agent-property-scope";
const CDP_PORT = 9235;
const VITE_PORT = 51803;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

// ── 数据隔离：ai-sessions 索引写临时目录（必须在 ensureInstance 之前设置）──
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const aiTmp = path.join(os.tmpdir(), `snorkeling-verify-ai-${PROFILE}`);
if (!attach) {
    rmSync(aiTmp, { recursive: true, force: true });
}
mkdirSync(aiTmp, { recursive: true });
process.env.WAVETERM_AI_SESSIONS_INDEX = path.join(aiTmp, "index.json");
process.env.WAVETERM_AI_SESSIONS_SQLITE_INDEX = path.join(aiTmp, "index-v2.sqlite");
process.env.WAVETERM_AI_SESSIONS_META = path.join(aiTmp, "meta.json");
process.env.WAVETERM_AI_SESSIONS_DELETED_DIR = path.join(aiTmp, "deleted");

// 验证 profile 的 settings.json（dev-isolated 把 WAVETERM_CONFIG_HOME 指向这里）。
const settingsPath = path.join(repoRoot, ".runcfg", PROFILE, "config", "settings.json");

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;

if (dry) {
    log("dry-run: 依赖解析成功（未启动 GUI）");
    check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
    process.exit(0);
}

// ── 页面内探针 ──────────────────────────────────────────────────────────────

const blockIdsProbe = `(() => [...document.querySelectorAll(".block[data-blockid]")].map((el) => el.getAttribute("data-blockid")))()`;

const headerCenterProbe = (blockId) => `(() => {
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    const header = block?.querySelector(".block-frame-default-header");
    if (header == null) return null;
    const r = header.getBoundingClientRect();
    if (r.width < 40 || r.height < 5) return null;
    return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) };
})()`;

/** 卡片快照：属性 key 列表 +「+ Add property」按钮中心。 */
const cardProbe = `(() => {
    const lists = [...document.querySelectorAll(".property-list--agent")];
    const list = lists.length === 0 ? null : lists[lists.length - 1];
    const add = list?.closest(".info-card")?.querySelector(".property-add") ??
        document.querySelector(".info-card .property-add");
    const rect = add?.getBoundingClientRect() ?? null;
    return {
        hasList: list != null,
        keys: list == null ? [] : [...list.querySelectorAll("[data-property-key]")].map((el) => el.getAttribute("data-property-key")),
        addBtn: rect == null || rect.width < 6
            ? null
            : { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
    };
})()`;

/** 新建属性浮层快照。 */
const addPopoverProbe = `(() => {
    const panel = document.querySelector('[data-testid="property-add-popover"]');
    if (panel == null) return null;
    const wraps = [...document.querySelectorAll(".property-value-popover")];
    const wrap = wraps.length === 0 ? null : wraps[wraps.length - 1];
    const r = wrap?.getBoundingClientRect() ?? null;
    return {
        open: true,
        hasName: panel.querySelector('[data-testid="property-add-name"]') != null,
        hasType: panel.querySelector('[data-testid="property-add-type"]') != null,
        typeLabel: (panel.querySelector(".property-add-panel__type-name")?.textContent || "").trim(),
        scopes: [...panel.querySelectorAll('[data-testid="property-add-scope"]')].map((el) => el.getAttribute("data-scope")),
        activeScope: panel.querySelector(".property-add-panel__scope-opt.is-active")?.getAttribute("data-scope") ?? null,
        submitDisabled: panel.querySelector('[data-testid="property-add-submit"]')?.disabled === true,
        error: (panel.querySelector('[data-testid="property-add-error"]')?.textContent || "").trim(),
        wrap: r == null ? null : {
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
            w: Math.round(r.width),
            h: Math.round(r.height),
        },
    };
})()`;

const typeMenuProbe = `(() => ({
    items: [...document.querySelectorAll('[data-testid="property-add-type-option"]')].map((el) => el.getAttribute("data-type")),
}))()`;

// ── 页面内动作 ──────────────────────────────────────────────────────────────

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
                    await mod.createBlock({ meta: ${JSON.stringify(meta)} }, false, false);
                    return { ok: true, via: url, tried };
                } catch (err) {
                    tried.push(url + "#" + attempt + ":" + String(err?.message ?? err).slice(0, 120));
                    await new Promise((r) => setTimeout(r, 400));
                }
            }
        }
        return { ok: false, tried };
    })()`;
}

const clickBySelectorJs = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el == null) return { ok: false, reason: "not-found" };
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
    return { ok: true };
})()`;

const setAddNameJs = (name) => `(() => {
    const input = document.querySelector('[data-testid="property-add-name"]');
    if (input == null) return { ok: false, reason: "no-input" };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
})()`;

/** 同一入口下调用 wshserver 的 agent card get/set（与外部 wsh 客户端同一条后端链）。 */
const cardRpcJs = `(async () => {
    const wshclient = await import("/frontend/app/store/wshclientapi.ts");
    const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
    window.__verifyCard = window.__verifyCard || {};
    window.__verifyCard.get = (identifier) =>
        wshclient.RpcApi.AgentCardGetCommand(wshrpcutil.TabRpcClient, { identifier });
    window.__verifyCard.set = (payload) =>
        wshclient.RpcApi.AgentCardSetCommand(wshrpcutil.TabRpcClient, payload);
    return { ok: true };
})()`;

const externalSetJs = (payload) => `(async () => window.__verifyCard.set(${JSON.stringify(payload)}))()`;
const externalGetJs = (identifier) => `(async () => window.__verifyCard.get(${JSON.stringify(identifier)}))()`;

// ── 环境助手 ────────────────────────────────────────────────────────────────

function walkNewest(root, predicate) {
    let newest = null;
    const walk = (dir) => {
        let entries = [];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!predicate(entry.name)) continue;
            const stat = statSync(full, { throwIfNoEntry: false });
            if (stat == null) continue;
            if (newest == null || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs };
        }
    };
    walk(root);
    return newest;
}

function findPiSessionId() {
    const root = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "agent", "sessions");
    const newest = walkNewest(root, (name) => name.endsWith(".jsonl"));
    if (newest == null) return null;
    try {
        const header = JSON.parse(readFileSync(newest.file, "utf8").split("\n", 1)[0]);
        const id = typeof header?.id === "string" ? header.id.trim() : "";
        return id === "" ? null : id;
    } catch {
        return null;
    }
}

function findCodexSessionId() {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
    const indexPath = path.join(codexHome, "session_index.jsonl");
    if (existsSync(indexPath)) {
        const lines = readFileSync(indexPath, "utf8").split("\n").filter((line) => line.trim() !== "");
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const row = JSON.parse(lines[i]);
                if (typeof row?.id === "string" && row.id.trim() !== "") return row.id.trim();
            } catch {
                // 继续往前找
            }
        }
    }
    const newest = walkNewest(path.join(codexHome, "sessions"), (name) => name.endsWith(".jsonl"));
    if (newest == null) return null;
    const match = newest.file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
    if (match != null) return match[1];
    try {
        const first = JSON.parse(readFileSync(newest.file, "utf8").split("\n", 1)[0]);
        const id = first?.payload?.id;
        return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
    } catch {
        return null;
    }
}

/** 读验证 profile 的 settings.json（settings 是转写后的 JSON，不是 JSON5）。 */
function readProfileSchema() {
    if (!existsSync(settingsPath)) return [];
    try {
        const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
        const defs = parsed?.["agent:propertyschema"];
        return Array.isArray(defs) ? defs : [];
    } catch {
        return [];
    }
}

async function waitNewBlockId(client, before, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ids = await client.evaluate(blockIdsProbe);
        const created = ids.find((id) => !before.has(id));
        if (created != null) return created;
        await sleep(400);
    }
    return null;
}

async function openHoverCard(client, blockId) {
    const header = await waitFor(client, headerCenterProbe(blockId), {
        timeoutMs: 20000,
        intervalMs: 300,
        label: "block header",
    }).catch(() => null);
    if (header == null) return null;
    return hoverUntil(client, header, cardProbe, (state) => state?.hasList === true, { tries: 20, waitMs: 700 });
}

async function openAddPopover(client) {
    const card = await waitFor(client, cardProbe, { timeoutMs: 8000, intervalMs: 250, label: "card add button" }).catch(
        () => null
    );
    if (card?.addBtn == null) return { card, popover: null };
    await client.click(card.addBtn.x, card.addBtn.y);
    const popover = await waitFor(client, addPopoverProbe, {
        timeoutMs: 8000,
        intervalMs: 250,
        label: "add property popover",
    }).catch(() => null);
    return { card, popover };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    instance = await ensureInstance({
        attach,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
        profile: PROFILE,
        resetProfile: !attach,
    });
    const pages = await listPageTargets(ENDPOINT);
    const client =
        pages.length > 1 ? (await pickLiveRenderer(pages, connectToTarget, ENDPOINT)).client : instance.client;
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"})`);
    log(`ai-sessions isolated at ${aiTmp}`);
    await dismissOnboarding(client, { log });
    await client.evaluate(cardRpcJs);

    const piSession = findPiSessionId();
    if (piSession == null) {
        skipped.push("全部用例：找不到 pi 会话（~/.pi/agent/sessions）");
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }
    log(`pi session: ${piSession}`);

    const before = new Set(await client.evaluate(blockIdsProbe));
    const created = await client.evaluate(createBlockJs({ view: "term", "agent:provider": "pi", "agent:sessionid": piSession }));
    if (!created?.ok) throw new Error(`创建 pi agent block 失败: ${JSON.stringify(created?.tried ?? created)}`);
    const blockId = await waitNewBlockId(client, before);
    if (blockId == null) throw new Error("30s 内没有出现新建的 term block");

    // ── case 1：浮层面板（只读）────────────────────────────────────────────
    let { card, popover } = await openAddPopover(client, blockId);
    if (card?.hasList !== true) {
        skipped.push(`浮层用例：卡片里没有属性区（keys=${JSON.stringify(card?.keys ?? [])}）`);
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }
    check("hover-card-add-button-visible", card.addBtn != null, card.addBtn);
    check("add-popover-opens", popover != null, popover == null ? "点 + Add property 后 8s 内没出现浮层" : "open");
    if (popover == null) {
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }
    await shot(client, "01-add-popover");
    check("popover-has-name-and-type", popover.hasName && popover.hasType, {
        hasName: popover.hasName,
        hasType: popover.hasType,
        typeLabel: popover.typeLabel,
    });
    check(
        "popover-has-three-scopes",
        JSON.stringify(popover.scopes) === JSON.stringify(["session", "agent", "global"]),
        popover.scopes
    );
    check("popover-defaults-to-session", popover.activeScope === "session", popover.activeScope);
    check("popover-submit-disabled-when-empty", popover.submitDisabled === true, popover.submitDisabled);

    await client.evaluate(clickBySelectorJs('[data-testid="property-add-type"]'));
    const typeMenu = await waitFor(client, typeMenuProbe, { timeoutMs: 4000, intervalMs: 200, label: "type menu" }).catch(
        () => null
    );
    check(
        "type-menu-lists-all-creatable-types",
        typeMenu?.items?.length === 9 && typeMenu.items.includes("multi_select"),
        { count: typeMenu?.items?.length, items: typeMenu?.items }
    );
    await shot(client, "02-type-menu");
    await client.evaluate(clickBySelectorJs('[data-testid="property-add-type"]'));
    await client.pressKey("Escape");
    await sleep(300);
    const closed = await client.evaluate(`document.querySelector('[data-testid="property-add-popover"]') == null`);
    check("escape-closes-popover", closed === true, closed);

    // ── case 2：UI 写入 agent 范围 ──────────────────────────────────────────
    ({ popover } = await openAddPopover(client, blockId));
    if (popover == null) throw new Error("第二次打开浮层失败");
    await client.evaluate(setAddNameJs("verify_scope_agent"));
    await client.evaluate(clickBySelectorJs('[data-testid="property-add-scope"][data-scope="agent"]'));
    const agentActive = await client.evaluate(
        `document.querySelector('.property-add-panel__scope-opt[data-scope="agent"]')?.classList.contains("is-active") === true`
    );
    check("agent-scope-selectable", agentActive === true, agentActive);
    await shot(client, "03-agent-scope-selected");
    await client.evaluate(clickBySelectorJs('[data-testid="property-add-submit"]'));
    const rowAppeared = await waitFor(
        client,
        `document.querySelector('[data-property-key="verify_scope_agent"]') != null`,
        { timeoutMs: 8000, intervalMs: 250, label: "new property row" }
    ).catch(() => null);
    check("ui-write-adds-card-row", rowAppeared === true, rowAppeared);
    await shot(client, "04-agent-scope-row");

    const schemaAfterUi = readProfileSchema();
    const uiAgentDef = schemaAfterUi.find((def) => def?.key === "verify_scope_agent");
    check("ui-write-persists-agent-pi-scope", uiAgentDef?.scope === "agent:pi", uiAgentDef ?? schemaAfterUi);

    // ── case 3：外部写入（wsh agent card set 同链）────────────────────────────
    // 先取最新 hash（case 2 改过 card），再按外部调用形状写一条 agent 范围属性。
    const beforeHash = await client.evaluate(externalGetJs(piSession));
    check("external-get-returns-hash", typeof beforeHash?.hash === "string" && beforeHash.hash !== "", {
        hash: beforeHash?.hash?.slice(0, 12),
    });
    const setResult = await client.evaluate(
        externalSetJs({
            identifier: piSession,
            props: { verify_scope_ext: { type: "text", value: "ext", name: "Verify Scope Ext", scope: "agent" } },
            yes: true,
            expectedhash: beforeHash?.hash,
        })
    );
    check("external-set-changed", setResult?.changed === true, {
        changed: setResult?.changed,
        messages: setResult?.messages,
        skipped: setResult?.skipped,
    });
    const afterGet = await client.evaluate(externalGetJs(piSession));
    const extDef = (afterGet?.schema ?? []).find((def) => def?.key === "verify_scope_ext");
    check("external-set-publishes-agent-scope-to-schema", extDef?.scope === "agent:pi", extDef ?? afterGet?.schema);
    check(
        "external-get-schema-is-scope-filtered",
        (afterGet?.schema ?? []).every((def) => (def?.scope ?? "") === "" || def.scope === "agent:pi"),
        afterGet?.schema
    );

    // 再写一条全局范围，用于跨 Agent 对照。
    const beforeHash2 = await client.evaluate(externalGetJs(piSession));
    await client.evaluate(
        externalSetJs({
            identifier: piSession,
            props: { verify_scope_global: { type: "text", value: "g", name: "Verify Scope Global", scope: "all" } },
            yes: true,
            expectedhash: beforeHash2?.hash,
        })
    );
    const schemaAfterExternal = readProfileSchema();
    const globalDef = schemaAfterExternal.find((def) => def?.key === "verify_scope_global");
    check("external-all-scope-is-global", globalDef != null && (globalDef.scope ?? "") === "", globalDef);

    // 回归：旧的「无 scope」调用不写模板（session 行为不变）。
    const beforeHash3 = await client.evaluate(externalGetJs(piSession));
    await client.evaluate(
        externalSetJs({
            identifier: piSession,
            props: { verify_scope_session: { type: "text", value: "s" } },
            yes: true,
            expectedhash: beforeHash3?.hash,
        })
    );
    const sessionDef = readProfileSchema().find((def) => def?.key === "verify_scope_session");
    check("external-session-scope-does-not-touch-template", sessionDef == null, sessionDef ?? "absent");

    // ── case 4：跨 Agent（codex 看不到 agent:pi）────────────────────────────
    const codexSession = findCodexSessionId();
    if (codexSession == null) {
        skipped.push("跨 Agent 用例：本机找不到 codex 会话（~/.codex/sessions）");
    } else {
        log(`codex session: ${codexSession}`);
        const beforeCodex = new Set(await client.evaluate(blockIdsProbe));
        await client.evaluate(createBlockJs({ view: "term", "agent:provider": "codex", "agent:sessionid": codexSession }));
        const codexBlockId = await waitNewBlockId(client, beforeCodex);
        if (codexBlockId == null) {
            skipped.push("跨 Agent 用例：30s 内没有出现 codex term block");
        } else {
            const codexCard = await openHoverCard(client, codexBlockId);
            const keys = codexCard?.keys ?? [];
            check("codex-sees-global-property", keys.includes("verify_scope_global"), keys);
            check(
                "codex-cannot-see-agent-property",
                !keys.includes("verify_scope_agent") && !keys.includes("verify_scope_ext"),
                keys
            );
            await shot(client, "05-codex-card");
        }
    }

    // pi 卡片最终态：三条属性都在
    const finalCard = await openHoverCard(client, blockId);
    check(
        "pi-card-shows-all-write-scopes",
        ["verify_scope_agent", "verify_scope_ext", "verify_scope_global", "verify_scope_session"].every((key) =>
            (finalCard?.keys ?? []).includes(key)
        ),
        finalCard?.keys
    );
    await shot(client, "06-pi-card-final");

    reporter.finish({ skipped, cleanup: () => closeAll(client) });
}

function closeAll(client) {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

main().catch((err) => {
    reporter.fatal(err, { cleanup: () => (instance?.spawned && !keepOpen ? instance.cleanup?.() : null) });
});
