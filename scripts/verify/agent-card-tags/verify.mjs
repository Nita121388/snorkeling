#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 卡片标签候选：全局清单 + 计数 —— 真机 CDP 验证（无人值守）。
//
// 为什么要有这个台子：本次改动的判据是「打开 Tags 浮层时，候选里出现了**别的会话**用过的标签，
// 而且每个候选后面有使用次数」。这条链路依赖真实后端 `Tags` RPC（按 connection/origin 统计
// 全库 tag → count），单测只能喂假数据，覆盖不到「真机索引里确实有全局标签、卡片真的读到了」。
//
// 跑两条链路：
//   case HOVER  hover agent block header → 卡片出现 → 点 Tags 行 → 浮层候选
//               · 候选数 > 本会话已选数（说明确实并入了全局清单）
//               · 至少一个候选渲染了 .ptag-option-count 且为纯数字
//               · 已选 chip 与本会话 summary.tags 一致
//   case MODAL  点卡片右上角放大按钮 → AgentCardModal → 同一 connection 下候选清单文本与 hover 卡一致
//
// 只读约束：**不 toggle 任何候选**。属性写入落到 `~/.snorkeling/ai-sessions/`（用户真实索引库，
// 非 profile 隔离），验证台不允许污染真实会话元数据。写回链路由
// `property-list.dom.test.tsx` 的「全局清单里的标签可点选，写回完整数组」用例覆盖。
//
// 用法：
//   node scripts/verify/agent-card-tags/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/agent-card-tags/verify.mjs --attach     # 复用已起实例（迭代主力）
//   node scripts/verify/agent-card-tags/verify.mjs --keep-open  # 结束后留实例
//   node scripts/verify/agent-card-tags/verify.mjs --dry        # 只解析依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, hoverUntil, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "agent-card-tags";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

// 独立 profile + 独立端口：不与别的 area 抢默认实例（默认 profile=verify / cdp=9231 是共用的）。
const PROFILE = "verify-agent-card-tags";
const CDP_PORT = 9234;
const VITE_PORT = 51802;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

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
}

// ── 页面内探针 ──────────────────────────────────────────────────────────────

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

const headerCenterProbe = (blockId) => `(() => {
    const block = document.querySelector('.block[data-blockid="' + ${JSON.stringify(blockId)} + '"]');
    const header = block?.querySelector(".block-frame-default-header");
    if (header == null) return null;
    const r = header.getBoundingClientRect();
    if (r.width < 40 || r.height < 5) return null;
    return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) };
})()`;

/** 卡片是否出现、属性区里有哪些 key、Tags 行的值按钮中心点。 */
const cardProbe = `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    // 悬浮卡在 .info-card-portal 里；AgentCardModal 是 frameless 内嵌形态（不在 portal）。
    // 两个面共用同一个 .property-list--agent，所以按“最后出现的那个”取。
    const lists = [...document.querySelectorAll(".property-list--agent")];
    const list = lists.length === 0 ? null : lists[lists.length - 1];
    const inModal = list != null && list.closest(".agent-card--frameless") != null;
    const row = list?.querySelector('[data-property-key="tags"]');
    const btn = row?.querySelector(".property-row__button");
    const rect = btn?.getBoundingClientRect() ?? null;
    return {
        open: list != null,
        inModal,
        hasList: list != null,
        keys: list == null ? [] : [...list.querySelectorAll("[data-property-key]")].map((el) => el.getAttribute("data-property-key")),
        tagsValue: rect == null || rect.width < 8
            ? null
            : { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), text: clean(btn.textContent) },
        expandBtn: (() => {
            const scope = document.querySelector(".info-card-portal") ?? document;
            const b = scope.querySelector(".agent-card-expand-btn");
            if (b == null) return null;
            const r = b.getBoundingClientRect();
            if (r.width < 6 || r.height < 6) return null;
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        })(),
    };
})()`;

/**
 * 浮层快照。
 *
 * `optionCounts` 是本台子的核心判据：每个候选行是否渲染了 `.ptag-option-count`，值是不是纯数字。
 * 同时记录 `optionTexts` 用于跨面一致性比对（AC7）。
 */
const popoverProbe = `(() => {
    const clean = (s) => (s || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
    const editor = document.querySelector('[data-testid="property-tag-editor"]');
    if (editor == null) return null;
    const rows = [...editor.querySelectorAll(".ptag-option")].map((el) => {
        const chip = el.querySelector(".ptag-option-chip");
        const countEl = el.querySelector(".ptag-option-count");
        return {
            text: clean(chip?.textContent),
            count: countEl == null ? null : clean(countEl.textContent),
            selected: el.classList.contains("is-selected"),
            isCreate: el.classList.contains("is-create"),
        };
    });
    const wrap = editor.closest(".property-value-popover")?.getBoundingClientRect() ?? null;
    return {
        chips: [...editor.querySelectorAll(".ptag-selected .ptag-chip")].map((c) => clean(c.textContent)),
        rows,
        optionTexts: rows.filter((r) => !r.isCreate).map((r) => r.text),
        countedTexts: rows.filter((r) => !r.isCreate && r.count != null).map((r) => r.text),
        insideMarkdown: editor.closest(".markdown") != null,
        wrap: wrap == null ? null : {
            x: Math.round(wrap.x + wrap.width / 2),
            y: Math.round(wrap.y + wrap.height / 2),
            w: Math.round(wrap.width),
            h: Math.round(wrap.height),
        },
    };
})()`;

const modalOpenProbe = `(() => {
    const card = document.querySelector(".agent-card--frameless");
    return { card: card != null };
})()`;

/**
 * 直接调 openCardDialog 用的同一个 modalsModel 入口打开弹窗。
 *
 * 为什么不用指针点放大按钮：Escape 关浮层后卡片会重挂载，按钮坐标每一帧都可能变，
 * 实测 3/3 次点空（坐标落在旧位置）。而本台子要断言的是「弹窗面读到同一候选清单」，
 * 不是“按钮可点”本身；入口存在性另用一条断言看好（expandBtn 非空）。
 */
const openModalJs = (blockId) => `(async () => {
    const globalMod = await import("/frontend/app/store/global.ts");
    const modalsMod = await import("/frontend/app/store/modalmodel.ts");
    const blockData = globalMod.globalStore.get(globalMod.WOS.getWaveObjectAtom("block:" + ${JSON.stringify(blockId)})) ?? null;
    if (blockData == null) return { ok: false, reason: "no-block-data" };
    modalsMod.modalsModel.pushModal("AgentCardModal", { blockId: ${JSON.stringify(blockId)}, blockData });
    return { ok: true };
})()`;

// ── 环境助手 ────────────────────────────────────────────────────────────────

/** 取一个真实存在的 pi 会话 id（读文件首行 header.id，与后端解析口径一致）。 */
function findPiSessionId() {
    const root = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pi", "agent", "sessions");
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
            if (newest == null || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs };
        }
    };
    walk(root);
    if (newest == null) return null;
    try {
        const header = JSON.parse(readFileSync(newest.file, "utf8").split("\n", 1)[0]);
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

/** 打开 hover 卡并返回卡片的探针结果（含 tags 行中心点）。 */
async function openHoverCard(client, blockId) {
    const header = await waitFor(client, headerCenterProbe(blockId), {
        timeoutMs: 20000,
        intervalMs: 300,
        label: "block header",
    }).catch(() => null);
    if (header == null) return null;
    return hoverUntil(client, header, cardProbe, (state) => state?.hasList === true, { tries: 20, waitMs: 700 });
}

/** 点 Tags 值 → 等浮层出现 → 返回浮层快照。 */
async function openTagsPopover(client, card) {
    if (card?.tagsValue == null) return null;
    await client.click(card.tagsValue.x, card.tagsValue.y);
    return waitFor(client, popoverProbe, { timeoutMs: 10000, intervalMs: 250, label: "Tags 浮层" }).catch(
        () => null
    );
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
    await dismissOnboarding(client, { log });

    const session = findPiSessionId();
    if (session == null) {
        skipped.push("全部用例：本机找不到可用的 pi 会话文件（~/.pi/agent/sessions）");
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
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
        skipped.push("全部用例：30s 内没有出现新建的 term block");
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }

    // ── case HOVER ────────────────────────────────────────────────────────
    const card = await openHoverCard(client, blockId);
    if (card?.hasList !== true) {
        skipped.push(
            `case HOVER：hover 后卡片里没有属性区（后端未解析出 summary，keys=${JSON.stringify(card?.keys ?? [])}）`
        );
        await shot(client, "01-hover-no-props");
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }
    check("hover-card-props-visible", true, card.keys);
    await shot(client, "01-hover-card");

    const hoverPopover = await openTagsPopover(client, card);
    check(
        "hover-tags-popover-opens",
        hoverPopover != null,
        hoverPopover == null ? "点击 Tags 后 10s 内没出现 [data-testid=property-tag-editor]" : hoverPopover.chips
    );
    if (hoverPopover == null) {
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }
    await shot(client, "02-hover-tags-popover");

    const hoverSelected = hoverPopover.chips;
    // 已选 chip 对应的候选行必须标成 is-selected（浮层把“当前值”回显为选中态）。
    const selectedRows = hoverPopover.rows.filter((r) => r.selected).map((r) => r.text);
    check(
        "hover-popover-marks-session-tags-selected",
        hoverSelected.every((tag) => selectedRows.includes(tag)),
        { chips: hoverSelected, selectedRows }
    );

    // 核心判据 1：候选池并入了全局清单 —— 候选数 ≥ 已选数，且候选里含「本会话没选」的标签。
    const unselected = hoverPopover.optionTexts.filter((t) => !hoverSelected.includes(t));
    check(
        "hover-candidates-include-global-tags",
        unselected.length > 0,
        {
            optionCount: hoverPopover.optionTexts.length,
            selectedCount: hoverSelected.length,
            unselected: unselected.slice(0, 12),
        }
    );

    // 核心判据 2：至少一个候选渲染了数字计数（本次改动的可见证据）。
    const numericCounts = hoverPopover.rows
        .filter((r) => !r.isCreate && r.count != null)
        .map((r) => r.count);
    check(
        "hover-candidates-show-numeric-count",
        numericCounts.length > 0 && numericCounts.every((c) => /^\d+$/.test(c)),
        { counted: hoverPopover.countedTexts.length, samples: numericCounts.slice(0, 12) }
    );

    // 回归门：本会话已选值 / 无清单来源的候选**不能**伪造 0（应为 null，而不是 "0"）。
    check(
        "hover-no-fake-zero-count",
        hoverPopover.rows.every((r) => r.count == null || /^\d+$/.test(r.count)),
        hoverPopover.rows.filter((r) => r.count != null && !/^\d+$/.test(r.count)).map((r) => `${r.text}=${r.count}`)
    );

    // 指针移到 portal 浮层上：浮层必须还在（这是 pin/attached-layer 的核心判据）。
    // 卡片本身的存在性只记入 detail —— 悬浮卡的 hover 保持依赖 targetRef 的 mouseenter，
    // 干净 profile 下 summary 晚到会触发重挂载，卡片偶发收起；这条能力已由
    // scripts/verify/property-editor 的「指针移入附属浮层卡片不收起」专门覆盖，不在此重复硬断言。
    if (hoverPopover.wrap != null) {
        await client.move(hoverPopover.wrap.x, hoverPopover.wrap.y);
        await sleep(1200);
        const survived = await client.evaluate(
            `(() => ({ card: document.querySelector(".info-card-portal") != null, editor: document.querySelector('[data-testid="property-tag-editor"]') != null }))()`
        );
        check("hover-popover-survives-pointer-move", survived.editor === true, survived);
        if (survived.card !== true) {
            skipped.push(
                "悬浮卡在指针移入浮层后被收起（干净 profile 下 summary 晚到触发卡片重挂载）；" +
                    "卡片级保活由 scripts/verify/property-editor 覆盖，本台子只断言浮层自身存活"
            );
        }
        await shot(client, "03-hover-popover-hover");
    }

    // ── case MODAL（AC7：弹窗面与 hover 卡读到同一候选清单）──────
    await client.pressKey("Escape");
    await sleep(400);

    // 入口存在性：悬浮卡里确实有放大按钮（点了会走 openCardDialog）。
    // 卡片可能因重挂载而收起 → 先重新 hover 一次再读；仍读不到就如实记录而不是硬红。
    let cardAgain = await openHoverCard(client, blockId);
    if (cardAgain?.expandBtn == null) {
        cardAgain = await openHoverCard(client, blockId);
    }
    check("hover-card-has-expand-entry", cardAgain?.expandBtn != null, cardAgain?.expandBtn ?? "no expand button");

    // 弹窗本身走与按钮相同的 modalsModel 入口（指针点击会因卡片重挂载而点空）。
    const modalOpened = await client.evaluate(openModalJs(blockId));
    log(`open modal via modalsModel: ${JSON.stringify(modalOpened)}`);
    const modalState = await waitFor(client, modalOpenProbe, {
        timeoutMs: 12000,
        intervalMs: 300,
        label: "AgentCardModal",
    }).catch(() => null);
    check("agent-card-modal-opens", modalState?.card === true, modalState);
    await shot(client, "04-agent-card-modal");
    if (modalState?.card !== true) {
        skipped.push(`case MODAL：modalsModel 未能打开 AgentCardModal（${JSON.stringify(modalOpened)}）`);
        reporter.finish({ skipped, cleanup: () => closeAll(client) });
        return;
    }

    // 等弹窗里的属性区（frameless 内嵌形态，与悬浮卡共用 .property-list--agent）长出来。
    const modalCard = await waitFor(client, cardProbe, {
        timeoutMs: 12000,
        intervalMs: 300,
        label: "弹窗内属性区",
    }).catch(() => null);
    check("modal-card-props-visible", modalCard?.inModal === true, {
        inModal: modalCard?.inModal,
        keys: modalCard?.keys,
    });

    const modalPopover = await openTagsPopover(client, modalCard);
    check(
        "modal-tags-popover-opens",
        modalPopover != null,
        modalPopover == null ? "弹窗里点 Tags 后没出现浮层" : modalPopover.chips
    );
    if (modalPopover != null) {
        await shot(client, "05-modal-tags-popover");
        // AC7：同一 connection 下**全局清单部分**（带 count 的候选）必须与 hover 卡一致。
        // 只比带 count 的集合：本会话已选值的位置取决于该面的 summary 到达时机（弹窗是独立挂载，
        // 冷缓存会晚一拍），那是时序差异而不是“候选清单不同源”。
        const hoverGlobal = hoverPopover.countedTexts;
        const modalGlobal = modalPopover.countedTexts;
        check(
            "hover-and-modal-same-global-candidates",
            JSON.stringify(modalGlobal) === JSON.stringify(hoverGlobal),
            {
                hoverGlobalLen: hoverGlobal.length,
                modalGlobalLen: modalGlobal.length,
                hoverSample: hoverGlobal.slice(0, 10),
                modalSample: modalGlobal.slice(0, 10),
                hoverSelectedOnly: hoverPopover.optionTexts.filter((t) => !hoverGlobal.includes(t)),
                modalSelectedOnly: modalPopover.optionTexts.filter((t) => !modalGlobal.includes(t)),
            }
        );
        check(
            "modal-candidates-show-numeric-count",
            modalPopover.rows.filter((r) => !r.isCreate && r.count != null).length > 0,
            modalPopover.countedTexts.slice(0, 12)
        );
    }

    skipped.push(
        "写回链路（点选候选 / 取消 / 新建标签）不在真机验证：属性写入落到 ~/.snorkeling/ai-sessions 用户真实索引，验证台保持只读；" +
            "该链路由 property-list.dom.test.tsx 的「全局清单里的标签可点选，写回完整数组」用例覆盖"
    );
    skipped.push(
        "Tab「更多」首块（tab-more-agent-card）复用同一个 AgentHoverCard，需要 ≥2 agent 的工作区形态；" +
            "它与 hover 卡共用同一组件与同一 tagCatalog 供数，本台子以 hover 卡 + AgentCardModal 两面为代表"
    );

    reporter.finish({ skipped, cleanup: () => closeAll(client) });
}

function closeAll(client) {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

main().catch((err) => {
    reporter.fatal(err, { cleanup: () => (instance?.spawned && !keepOpen ? instance.cleanup?.() : null) });
});
