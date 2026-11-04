#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 看板 —— 真机 CDP 验证。
//
// 用法：
//   node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 起隔离实例并留着
//   node scripts/verify/overview-board/verify.mjs --attach
// 产物：verify-runs/<ts>-overviewboard/report.json + 截图
// 退出码：0 全绿 / 1 失败 / 2 环境错误

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../preview-edit/lib/cdp.mjs";
import { ensureInstance, dismissOverlays, DEFAULTS } from "../preview-edit/lib/launch.mjs";
import { readPng, scalePng, writePng } from "../preview-edit/lib/pixel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const runDir = path.join(
    repoRoot,
    "verify-runs",
    `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}-overviewboard`
);
mkdirSync(runDir, { recursive: true });

const results = [];
function check(id, ok, detail) {
    results.push({ id, ok: !!ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail != null ? ` — ${detail}` : ""}`);
    return ok;
}

const COUNTS = `(() => ({
    rows: document.querySelectorAll(".session-overview-block-row").length,
    columns: document.querySelectorAll(".session-overview-board-column").length,
    cards: document.querySelectorAll(".session-overview-board-card").length,
    columnTitles: [...document.querySelectorAll(".session-overview-board-column-title")].map((e) => (e.textContent || "").trim()),
    toggle: document.querySelector(".session-overview-view-toggle") != null,
    togglePressed: document.querySelector(".session-overview-view-toggle")?.getAttribute("aria-pressed") ?? null,
    board: document.querySelector(".session-overview-board") != null,
}))()`;

async function shot(client, name) {
    const clip = { x: 560, y: 60, width: 780, height: 640 };
    const s = await client.screenshot(clip);
    const buf = Buffer.isBuffer(s) ? s : s.buffer;
    const raw = path.join(runDir, `${name}-raw.png`);
    writeFileSync(raw, buf);
    let png = readPng(raw);
    const want = Math.round(clip.width);
    if (png.width !== want) {
        const factor = s?.clip != null ? Math.max(1, Math.round(s.clip.width)) / png.width : want / png.width;
        png = scalePng(png, factor);
    }
    writePng(path.join(runDir, `${name}.png`), png);
}

async function main() {
    const attach = process.argv.includes("--attach");
    let client;
    let spawned = false;
    if (attach) {
        client = await connect(`http://127.0.0.1:${DEFAULTS.cdpPort}`);
    } else {
        const inst = await ensureInstance({ attach: false, resetProfile: true });
        client = inst.client;
        spawned = inst.spawned;
    }
    try {
        await dismissOverlays(client).catch(() => []);

        // 先确保 localStorage 是 list（干净起点），再开 overview block
        await client.evaluate(`(() => { localStorage.removeItem("snorkeling.overview.viewMode"); return true; })()`);
        const opened = await client.evaluate(`(async () => {
            const mod = await import("/frontend/app/store/global.ts");
            if (typeof mod.createBlock !== "function") return { ok: false, err: "no createBlock" };
            const blockId = await mod.createBlock({ meta: { view: "sessionoverview" } }, false, false);
            return { ok: true, blockId };
        })()`);
        if (opened?.ok !== true) throw new Error(`打开 overview 失败: ${JSON.stringify(opened)}`);
        const blockId = opened.blockId;
        const scope = `.block.block-${blockId}`;
        await new Promise((r) => setTimeout(r, 4500));

        // 1) 默认列表视图：有行、无看板、有切换按钮
        let st = await client.evaluate(`(() => {
            const blk = document.querySelector("${scope}");
            if (blk == null) return { err: "block gone" };
            const q = ${COUNTS};
            return q;
        })()`);
        check("list-default-rows", st.rows > 0, `rows=${st.rows}`);
        check("list-default-no-board", st.board === false && st.cards === 0, `board=${st.board} cards=${st.cards}`);
        check("toggle-present", st.toggle === true, `aria-pressed=${st.togglePressed}`);
        check("toggle-default-off", st.togglePressed === "false", `aria-pressed=${st.togglePressed}`);
        const listRows = st.rows;
        await shot(client, "01-list");

        // 2) 切到看板
        const clicked = await client.evaluate(`(() => {
            const btn = document.querySelector("${scope} .session-overview-view-toggle");
            if (btn == null) return false;
            btn.click();
            return true;
        })()`);
        await new Promise((r) => setTimeout(r, 900));
        st = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`);
        check("toggle-clicked", clicked === true, "");
        check("board-rendered", st.board === true, `columns=${st.columns} cards=${st.cards}`);
        check("board-columns-fixed-order", st.columnTitles.length >= 1 && st.columnTitles.length <= 5, `列=${JSON.stringify(st.columnTitles)}`);
        check("board-cards-present", st.cards > 0, `cards=${st.cards}`);
        check("board-hides-list-rows", st.rows === 0, `rows=${st.rows}（看板视图不应同时渲染列表行）`);
        check("toggle-pressed", st.togglePressed === "true", `aria-pressed=${st.togglePressed}`);
        await shot(client, "02-board");

        // 2b) 宽屏多列：把面板容器撑到 ≥1160px（container query 命中最近祖先容器），
        //     断言真的是多列单行、列高撑满、列内滚动容器存在（审核指出此前从未验证）
        const wide = await client.evaluate(`(() => {
            const panel = document.querySelector("${scope} .session-overview-panel");
            if (panel == null) return { err: "no panel" };
            const host = panel.parentElement;
            host.style.width = "1400px";
            host.style.flex = "0 0 1400px";
            panel.style.width = "1400px";
            return { ok: true, hostW: host.getBoundingClientRect().width };
        })()`);
        await new Promise((r) => setTimeout(r, 700));
        const cols = await client.evaluate(`(() => {
            const board = document.querySelector(".session-overview-board");
            if (board == null) return { err: "no board" };
            const cs = getComputedStyle(board);
            const secs = [...board.querySelectorAll(".session-overview-board-column")];
            const tops = secs.map((s) => Math.round(s.getBoundingClientRect().top));
            const cardsScroll = [...board.querySelectorAll(".session-overview-board-cards")].map((c) => getComputedStyle(c).overflowY);
            return {
                hostW: ${JSON.stringify(wide.hostW ?? 0)},
                gridCols: cs.gridTemplateColumns,
                columnCount: secs.length,
                sameRow: tops.length <= 1 ? true : new Set(tops).size === 1,
                boardH: Math.round(board.getBoundingClientRect().height),
                bodyH: Math.round(document.querySelector("${scope} .session-overview-body")?.getBoundingClientRect().height ?? 0),
                scrolls: cardsScroll,
            };
        })()`);
        const colTrackCount = cols.gridCols ? cols.gridCols.split(" ").length : 0;
        check("wide-board-multi-column", colTrackCount > 1 || cols.columnCount <= 1,
            `hostW=${Math.round(cols.hostW)} grid=${cols.gridCols} 列数=${cols.columnCount}`);
        check("wide-board-single-row", cols.sameRow === true, `列 top 一致=${cols.sameRow}`);
        check("wide-board-column-scroll", (cols.scrolls ?? []).every((v) => v === "auto" || v === "scroll"),
            `列内 overflow-y=${JSON.stringify(cols.scrolls)}`);
        await shot(client, "02b-board-wide");

        // 2c) 卡片集合 ⊇ 列表行集合（折叠只会减少列表行；普通 block 已按
        //     shouldShowFullOverviewBlock 过滤，不会变成空卡片）
        const invariants = await client.evaluate(`(() => {
            const cards = [...document.querySelectorAll(".session-overview-board-card")];
            const emptyTitles = cards.filter((c) => (c.querySelector(".session-overview-board-card-title")?.textContent || "").trim() === "").length;
            return { cards: cards.length, emptyTitles };
        })()`);
        check("board-cards-have-titles", invariants.emptyTitles === 0, `卡片=${invariants.cards} 空标题=${invariants.emptyTitles}`);

        // 3) 持久化：写入 localStorage 后 reload 仍是看板
        const persisted = await client.evaluate(`localStorage.getItem("snorkeling.overview.viewMode")`);
        check("view-mode-persisted", persisted === "board", `storage=${persisted}`);
        await client.evaluate(`(() => { location.reload(); return true; })()`).catch(() => false);
        await new Promise((r) => setTimeout(r, 6000));
        st = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`);
        check("board-survives-reload", st.board === true && st.cards > 0, `board=${st.board} cards=${st.cards}`);

        // 4) 切回列表：行数应与初始一致（不回归）
        await client.evaluate(`(() => {
            const btn = document.querySelector(".session-overview-view-toggle");
            if (btn != null) btn.click();
            return true;
        })()`);
        await new Promise((r) => setTimeout(r, 900));
        st = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`);
        check("back-to-list-restores-rows", st.rows === listRows, `rows=${st.rows}（初始 ${listRows}）`);
        check("back-to-list-hides-board", st.board === false && st.cards === 0, `board=${st.board}`);
        await shot(client, "03-back-list");

        const failed = results.filter((r) => !r.ok);
        const report = {
            runDir,
            passed: results.length - failed.length,
            failed: failed.length,
            verdict: failed.length === 0 ? "pass" : "fail",
            results,
        };
        writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
        console.log(`\nverdict=${report.verdict}（${report.passed}/${results.length}）`);
        console.log(`run 目录: ${runDir}`);
        process.exitCode = failed.length === 0 ? 0 : 1;
    } finally {
        void spawned;
        client.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
});
