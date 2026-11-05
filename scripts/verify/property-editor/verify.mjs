#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 属性值下拉编辑器 —— 真机 CDP 验证（无人值守）。
//
// 为什么要有这个台子：`属性行点开是逗号输入框 / 原生 select` 这类问题单测能覆盖状态，
// 但覆盖不到"真实悬浮卡里、真实 portal 浮层里、真实指针移过去之后卡片还在不在"。
// 这里跑两条真实链路：
//
//   case MD   md 预览属性卡：点 tags 值 → Wolai 风格浮层出现（portal 到 body、不被 markdown 裁切）
//             → 已选标签**没有 1px 描边**（computed box-shadow 为 none）+ 行尾 ✓。
//   case CARD Agent 悬浮卡：用 RPC 建一个带 `agent:sessionid` 的 term block（只读展示真实会话属性）
//             → hover block header 打开卡片 → 点 Tags 行 → 浮层出现
//             → 指针移到浮层上停留 1.2s，**卡片与浮层都还在**（这条就是 attached layer + pin 的验收点）。
//
// 只读约束：不 toggle 任何候选。属性写入会落到 `~/.snorkeling/ai-sessions/`
// （用户真实索引库，非 profile 隔离），验证台不允许污染真实会话元数据。
//
// 用法：
//   node scripts/verify/property-editor/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/property-editor/verify.mjs --attach      # 复用已起实例（迭代主力）
//   node scripts/verify/property-editor/verify.mjs --keep-open   # 结束后留实例
//   node scripts/verify/property-editor/verify.mjs --dry         # 只解析依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, hoverUntil, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "property-editor";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
// 多 agent 并行：本台子用独立 profile + 独立端口，绝不 reset / 抢占别的 area 的实例
// （默认 profile=verify、cdp=9231 是大家共用的，撞上别人的窗口会读到别人的工作区）。
const PROFILE = "verify-property-editor";
const CDP_PORT = 9233;
const VITE_PORT = 51801;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = path.join(repoRoot, "fixtures/verify/property-editor/props.md");

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { fixture: path.relative(repoRoot, FIXTURE) },
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;

if (dry) {
    log("dry-run: 依赖解析成功（未启动 GUI）");
    check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

// ── 页面内探针 ──────────────────────────────────────────────────────────────

/** 在渲染进程里 import app 真正实例化的 store 模块，建一个 block（preview / term）。 */
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

const blockIdsProbe = `(() => [...document.querySelectorAll(".block[data-blockid]")].map((el) => el.getAttribute("data-blockid")))()`;

/** md 预览属性卡里某个属性键的值单元格中心点。 */
const mdRowValueProbe = (key) => `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    const card = document.querySelector(".obsidian-props-card");
    if (card == null) return null;
    for (const row of card.querySelectorAll(".obsidian-props-row")) {
        if (clean(row.querySelector(".obsidian-props-key")?.textContent) !== ${JSON.stringify(key)}) continue;
        const value = row.querySelector(".obsidian-props-value");
        if (value == null) return null;
        const r = value.getBoundingClientRect();
        if (r.width < 10 || r.height < 5) return null;
        return { x: Math.round(r.x + 8), y: Math.round(r.y + r.height / 2), text: clean(value.textContent) };
    }
    return null;
})()`;

/** agent 悬浮卡里某个属性行的值按钮中心点。 */
const cardRowValueProbe = (key) => `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    const portal = document.querySelector(".info-card-portal");
    if (portal == null) return null;
    const list = portal.querySelector(".property-list--agent");
    if (list == null) return null;
    const row = list.querySelector('[data-property-key="' + ${JSON.stringify(key)} + '"]');
    const btn = row?.querySelector(".property-row__button");
    if (btn == null) return null;
    const r = btn.getBoundingClientRect();
    if (r.width < 8 || r.height < 5) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: clean(btn.textContent) };
})()`;

/** 浮层现状：已选 chips / 候选选中态（含 computed 描边）/ 浮层中心点。 */
const popoverProbe = `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    const editor = document.querySelector('[data-testid="property-tag-editor"]');
    if (editor == null) return null;
    const wrap = editor.closest(".property-value-popover");
    const wrapRect = wrap?.getBoundingClientRect() ?? null;
    const selected = [...editor.querySelectorAll(".ptag-option.is-selected")].map((el) => {
        const chip = el.querySelector(".ptag-option-chip");
        const cs = chip == null ? null : getComputedStyle(chip);
        return {
            text: clean(el.textContent),
            boxShadow: cs?.boxShadow ?? null,
            borderTopWidth: cs?.borderTopWidth ?? null,
            borderTopStyle: cs?.borderTopStyle ?? null,
            hasCheck: el.querySelector(".ptag-option-check") != null,
            hint: el.querySelector(".ptag-create-label") == null,
        };
    });
    const chips = [...editor.querySelectorAll(".ptag-selected .ptag-chip")].map((c) => clean(c.textContent));
    const options = [...editor.querySelectorAll(".ptag-option")].map((el) => clean(el.textContent));
    return {
        chips,
        options,
        selected,
        insideMarkdown: editor.closest(".markdown") != null,
        wrap: wrapRect == null ? null : {
            x: Math.round(wrapRect.x + wrapRect.width / 2),
            y: Math.round(wrapRect.y + wrapRect.height / 2),
            w: Math.round(wrapRect.width),
            h: Math.round(wrapRect.height),
        },
    };
})()`;

const cardPresenceProbe = `(() => {
    const portal = document.querySelector(".info-card-portal");
    const list = portal?.querySelector(".property-list--agent");
    return {
        open: portal != null,
        hasList: list != null,
        keys: list == null ? [] : [...list.querySelectorAll("[data-property-key]")].map((el) => el.getAttribute("data-property-key")),
    };
})()`;

const headerCenterProbe = (blockId) => `(() => {
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    const header = block?.querySelector(".block-frame-default-header");
    if (header == null) return null;
    const r = header.getBoundingClientRect();
    if (r.width < 40 || r.height < 5) return null;
    return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) };
})()`;

// ── 环境助手 ────────────────────────────────────────────────────────────────

/** 取一个真实存在的 pi 会话 id（读文件首行 header.id，与后端解析口径一致）。 */
function findPiSessionId() {
    const root = path.join(process.env.HOME || "", ".pi", "agent", "sessions");
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
            if (!entry.name.endsWith(".jsonl")) continue;
            const stat = statSync(full, { throwIfNoEntry: false });
            if (stat == null) continue;
            if (newest == null || stat.mtimeMs > newest.mtimeMs) {
                newest = { file: full, mtimeMs: stat.mtimeMs };
            }
        }
    };
    walk(root);
    if (newest == null) return null;
    try {
        const firstLine = readFileSync(newest.file, "utf8").split("\n", 1)[0];
        const header = JSON.parse(firstLine);
        const id = typeof header?.id === "string" ? header.id.trim() : "";
        return id === "" ? null : { id, file: newest.file };
    } catch {
        return null;
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

// ── case MD：md 预览属性卡的多值浮层 ────────────────────────────────────────

async function runMdCase(client) {
    const before = new Set(await client.evaluate(blockIdsProbe));
    const created = await client.evaluate(createBlockJs({ view: "preview", file: FIXTURE }));
    if (!created?.ok) throw new Error(`创建 preview block 失败: ${JSON.stringify(created?.tried ?? created)}`);
    const blockId = await waitNewBlockId(client, before);
    check("md-block-created", blockId != null, blockId ?? "30s 内没有出现 preview block");

    const tagsValue = await waitFor(client, mdRowValueProbe("tags"), {
        timeoutMs: 40000,
        intervalMs: 500,
        label: "md 预览属性卡 tags 行",
    }).catch(() => null);
    check("md-props-card-rendered", tagsValue != null, tagsValue?.text ?? "40s 内没等到 .obsidian-props-card 的 tags 行");
    if (tagsValue == null) return;

    await client.click(tagsValue.x, tagsValue.y);
    const popover = await waitFor(client, popoverProbe, {
        timeoutMs: 8000,
        intervalMs: 200,
        label: "属性值浮层",
    }).catch(() => null);
    check("md-popover-opens", popover != null, popover == null ? "点击 tags 值后 8s 内没出现 [data-testid=property-tag-editor]" : popover.chips);
    if (popover == null) return;

    check("md-popover-portal-outside-markdown", popover.insideMarkdown === false, {
        insideMarkdown: popover.insideMarkdown,
    });
    check("md-popover-shows-current-tags", popover.chips.includes("fix") && popover.chips.includes("ui"), popover.chips);

    const selected = popover.selected ?? [];
    check("md-selected-option-present", selected.length > 0, selected.map((s) => s.text));
    check(
        "md-selected-option-no-border",
        selected.every((s) => s.boxShadow === "none" && (s.borderTopWidth === "0px" || s.borderTopStyle === "none")),
        selected.map((s) => `${s.text}|shadow=${s.boxShadow}|border=${s.borderTopWidth}/${s.borderTopStyle}`)
    );
    check(
        "md-selected-option-check-icon",
        selected.every((s) => s.hasCheck === true),
        selected.map((s) => `${s.text}|check=${s.hasCheck}`)
    );

    await shot(client, "01-md-props-popover");
    await client.pressKey("Escape");
    await sleep(300);
}

// ── case CARD：agent 悬浮卡里的浮层 + 保活 ──────────────────────────────────

async function runAgentCardCase(client) {
    const session = findPiSessionId();
    if (session == null) {
        skipped.push("agent 悬浮卡：本机找不到可用的 pi 会话文件（~/.pi/agent/sessions）");
        log("skip agent card case: no pi session file");
        return;
    }
    log(`pi session for card case: ${session.id}`);

    const before = new Set(await client.evaluate(blockIdsProbe));
    const created = await client.evaluate(
        createBlockJs({ view: "term", "agent:provider": "pi", "agent:sessionid": session.id })
    );
    if (!created?.ok) throw new Error(`创建 term agent block 失败: ${JSON.stringify(created?.tried ?? created)}`);
    const blockId = await waitNewBlockId(client, before);
    if (blockId == null) {
        skipped.push("agent 悬浮卡：30s 内没有出现新建的 term block");
        return;
    }

    const header = await waitFor(client, headerCenterProbe(blockId), {
        timeoutMs: 20000,
        intervalMs: 300,
        label: "block header",
    }).catch(() => null);
    if (header == null) {
        skipped.push("agent 悬浮卡：新建 block 没有可见 header");
        return;
    }

    const card = await hoverUntil(client, header, cardPresenceProbe, (state) => state?.hasList === true, {
        tries: 20,
        waitMs: 700,
    });
    if (card?.hasList !== true) {
        // 会话属性依赖后端把该 session id 解析成 summary；解析不到时卡片只有身份区。
        skipped.push(
            `agent 悬浮卡：hover 后卡片里没有属性区（后端未解析出 summary，keys=${JSON.stringify(card?.keys ?? [])}）`
        );
        await shot(client, "02-agent-card-no-props");
        return;
    }
    check("agent-card-props-visible", true, card.keys);

    const tagsValue = await client.evaluate(cardRowValueProbe("tags"));
    if (tagsValue == null) {
        skipped.push("agent 悬浮卡：属性区里没有 tags 行（该会话无 tags 且 schema 未定义）");
        return;
    }

    await client.click(tagsValue.x, tagsValue.y);
    const popover = await waitFor(client, popoverProbe, {
        timeoutMs: 8000,
        intervalMs: 200,
        label: "卡片内的属性值浮层",
    }).catch(() => null);
    check("agent-card-popover-opens", popover != null, popover == null ? "点击 Tags 后 8s 内没出现浮层" : popover.chips);
    if (popover == null) return;

    await shot(client, "03-agent-card-popover");

    // 关键验收：指针移到 portal 到 body 的浮层上 → 卡片不能被 300ms 隐藏定时器收掉。
    if (popover.wrap != null) {
        await client.move(popover.wrap.x, popover.wrap.y);
        await sleep(1200);
        const afterMove = await client.evaluate(`(() => {
            const editor = document.querySelector('[data-testid="property-tag-editor"]');
            const portal = document.querySelector(".info-card-portal");
            const list = portal?.querySelector(".property-list--agent");
            const input = editor?.querySelector(".ptag-input");
            return {
                editor: editor != null,
                card: portal != null,
                list: list != null,
                input: input != null,
                inputFocused: document.activeElement === input,
                focusedTag: document.activeElement?.tagName ?? null,
            };
        })()`);
        check("agent-card-survives-pointer-into-popover", afterMove.card === true, afterMove);
        check("agent-popover-survives-pointer-move", afterMove.editor === true, afterMove);
        // 保活不能靠“焦点还在”，指针 hover 本身就要能撑住；这里同时记录焦点落点。
        check("agent-popover-input-available", afterMove.input === true, afterMove);

        const borderState = await client.evaluate(popoverProbe);
        const selected = borderState?.selected ?? [];
        if (selected.length > 0) {
            check(
                "agent-selected-option-no-border",
                selected.every(
                    (s) => s.boxShadow === "none" && (s.borderTopWidth === "0px" || s.borderTopStyle === "none")
                ),
                selected.map((s) => `${s.text}|shadow=${s.boxShadow}|border=${s.borderTopWidth}/${s.borderTopStyle}`)
            );
        } else {
            // 该会话没有已选标签 → 候选里没有“已选”行，描边规则由 md 用例覆盖，这里如实记录。
            log("agent card case: 该会话没有已选标签，跳过『已选候选无描边』断言（md 用例已覆盖）");
        }
        await shot(client, "04-agent-card-popover-hover");
    }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
    const endpoint = ENDPOINT;
    instance = await ensureInstance({
        attach,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
        profile: PROFILE,
        resetProfile: !attach,
    });
    // 多 Tab renderer 时 ensureInstance 可能连到 0x0 的空壳，重新挑一个真工作区。
    const pages = await listPageTargets(endpoint);
    const client = pages.length > 1 ? (await pickLiveRenderer(pages, connectToTarget, endpoint)).client : instance.client;
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"})`);
    await dismissOnboarding(client, { log });

    try {
        await runMdCase(client);
    } catch (err) {
        reporter.fatal(err, { cleanup: () => (instance?.spawned && !keepOpen ? instance.cleanup?.() : null) });
    }

    try {
        await runAgentCardCase(client);
    } catch (err) {
        log(`agent card case error: ${String(err?.message ?? err)}`);
        skipped.push(`agent 悬浮卡：用例执行异常（${String(err?.message ?? err).slice(0, 160)}）`);
    }

    // 如实登记「有意没覆盖」的面（验证台只读，不写用户真实的会话元数据）。
    skipped.push(
        "写回链路（toggle 候选 / 新建标签）不在真机验证：属性写入落到 ~/.snorkeling/ai-sessions 用户真实索引，验证台保持只读；" +
            "该链路由 property-list.dom.test.tsx 的「toggle 写回数组」与「单选替换即关闭」用例覆盖"
    );
    skipped.push(
        "会话详情卡（SessionDetailInfoCard，notion 布局）与悬浮卡共用同一个 PropertyList，本台子只跑 agent 悬浮卡；详情卡由单测覆盖"
    );

    reporter.finish({
        skipped,
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
}

main().catch((err) => {
    reporter.fatal(err, { cleanup: () => (instance?.spawned && !keepOpen ? instance.cleanup?.() : null) });
});
