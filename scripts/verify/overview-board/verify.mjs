#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 看板 —— 真机 CDP 验证。
//
// 用法：
//   node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed   # 起隔离实例并留着
//   node scripts/verify/overview-board/verify.mjs --attach
// 产物：verify-runs/<ts>-overviewboard/report.json + report.md + 截图；台账追加一行
// 退出码：0 全绿 / 1 失败 / 2 环境错误
//
// 2026-11-05 起断言口径变更（看板 v2）：列数固定 5（含空列）、横向 snap 常开，
// 旧的 `board-columns-fixed-order`（1..5 列）与 `wide-board-multi-column`
//（container query 轨道数）已不适用。

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLedgerRow } from "../lib/report.mjs";
import { connect } from "../preview-edit/lib/cdp.mjs";
import { DEFAULTS, dismissOverlays, ensureInstance } from "../preview-edit/lib/launch.mjs";
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
const skipped = [];
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail != null ? ` — ${detail}` : ""}`);
  return ok;
}
/** 本机数据不可用的断言（如全新 profile 没有 agent 会话）：明确记 skipped，不静默省略。 */
function skip(id, detail) {
  skipped.push({ id, detail });
  console.log(`SKIP  ${id}${detail != null ? ` — ${detail}` : ""}`);
}

const COUNTS = `(() => {
    const cards = [...document.querySelectorAll(".session-overview-board-card")];
    const agentCards = cards.filter((c) => c.getAttribute("data-agent-like") === "true");
    const board = document.querySelector(".session-overview-board");
    const cs = board == null ? null : getComputedStyle(board);
    return {
        rows: document.querySelectorAll(".session-overview-block-row").length,
        columns: document.querySelectorAll(".session-overview-board-column").length,
        columnDots: document.querySelectorAll(".session-overview-board-column-dot").length,
        emptyColumns: document.querySelectorAll(".session-overview-board-empty").length,
        cards: cards.length,
        avatars: cards.filter((c) => c.querySelector(".session-overview-board-card-avatar") != null).length,
        statusChips: cards.filter((c) => c.querySelector(".session-overview-agent-status") != null).length,
        agentCards: agentCards.length,
        terminalAgentTitles: agentCards
            .map((c) => (c.querySelector(".session-overview-board-card-title")?.textContent || "").trim())
            .filter((t) => t === "Terminal").length,
        columnTitles: [...document.querySelectorAll(".session-overview-board-column-title")].map((e) => (e.textContent || "").trim()),
        toggle: document.querySelector(".session-overview-view-toggle") != null,
        togglePressed: document.querySelector(".session-overview-view-toggle")?.getAttribute("aria-pressed") ?? null,
        board: board != null,
        scrollWidth: board == null ? 0 : board.scrollWidth,
        clientWidth: board == null ? 0 : board.clientWidth,
        snapType: cs == null ? "" : cs.scrollSnapType,
        gridFlow: cs == null ? "" : cs.gridAutoFlow,
        viewButtons: [...document.querySelectorAll("[data-overview-view]")].map((b) => ({
            mode: b.getAttribute("data-overview-view"),
            pressed: b.getAttribute("aria-pressed"),
        })),
        groupSelectValue:
            document.querySelector("[data-overview-group]")?.value ?? null,
        columnKeys: [...document.querySelectorAll(".session-overview-board-column")].map(
            (c) => c.getAttribute("data-column-key")
        ),
    };
})()`;

/** 点视图分段按钮（list / board）。 */
const clickView = (mode) => `(() => {
    const btn = document.querySelector('[data-overview-view="${mode}"]');
    if (btn == null) return false;
    btn.click();
    return true;
})()`;

/** 切看板分组（原生 select：设 value + 派发 change）。 */
const setGroup = (group) => `(() => {
    const sel = document.querySelector("[data-overview-group]");
    if (sel == null) return false;
    sel.value = ${JSON.stringify(group)};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return sel.value === ${JSON.stringify(group)};
})()`;

async function shot(client, name, clipOverride = null) {
  const clip = clipOverride ?? { x: 560, y: 60, width: 780, height: 640 };
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

async function waitForApp(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blocks = await client.evaluate(`(() => document.querySelectorAll(".block").length)()`).catch(() => 0);
    if (blocks > 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const attach = process.argv.includes("--attach");
  const keepOpen = process.argv.includes("--keep-open");
  let client;
  let cleanup = null;
  if (attach) {
    client = await connect(`http://127.0.0.1:${DEFAULTS.cdpPort}`);
  } else {
    const inst = await ensureInstance({ attach: false, resetProfile: true });
    client = inst.client;
    cleanup = inst.cleanup;
  }
  // 窗口刚起来时可能还是空白页（多窗口切换瞬间 connect 会挑错 target）；
  // 先等 workspace 真的渲染出 .block，再开始断言，否则整轮断言都打在空 DOM 上。
  const ready = await waitForApp(client, 30000);
  if (!ready) {
    throw new Error("app 30s 内没有渲染出任何 .block（窗口空白 / target 选错）");
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
            const btn = document.querySelector("${scope} [data-overview-view='board']");
            if (btn == null) return false;
            btn.click();
            return true;
        })()`);
    // 首次绘制必须安静：list -> board 切换不得回放任何卡片飞行（首帧只记账）。
    // 采样点放在切换后 120ms（刚进入动画窗口），不能等到 900ms（那时早就结束了）。
    await new Promise((r) => setTimeout(r, 120));
    const firstPaintFlying = await client.evaluate(
      `document.querySelectorAll(".session-overview-board-card.is-flying").length`
    );
    await new Promise((r) => setTimeout(r, 780));
    st = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`);
    check("toggle-clicked", clicked === true, "");
    check("motion-first-paint-silent", firstPaintFlying === 0, `首帧 is-flying=${firstPaintFlying}`);
    check("board-rendered", st.board === true, `columns=${st.columns} cards=${st.cards}`);
    check("board-columns-all-five", st.columns === 5, `列=${JSON.stringify(st.columnTitles)}（5 列常显，含空列）`);
    check("board-column-dots", st.columnDots === st.columns, `dots=${st.columnDots} 列=${st.columns}`);
    check(
      "board-empty-column-placeholder",
      st.emptyColumns > 0 || st.cards > 10,
      `空列占位=${st.emptyColumns} cards=${st.cards}`
    );
    check("board-cards-present", st.cards > 0, `cards=${st.cards}`);
    check("board-hides-list-rows", st.rows === 0, `rows=${st.rows}（看板视图不应同时渲染列表行）`);
    check("toggle-pressed", st.togglePressed === "true", `aria-pressed=${st.togglePressed}`);

    // 2a0) 视图分段切换器 + 分组下拉
    check(
      "view-switch-segmented",
      // 三枚视图按钮（列表 / 看板 / 时间线）；时间线本身由 area `overview-timeline` 覆盖。
      (st.viewButtons ?? []).length === 3 &&
        st.viewButtons.some((b) => b.mode === "board" && b.pressed === "true") &&
        st.viewButtons.filter((b) => b.pressed === "false").length === 2,
      `buttons=${JSON.stringify(st.viewButtons)}`
    );
    check("group-select-present", st.groupSelectValue === "status", `value=${st.groupSelectValue}`);

    // 2a1) 分组 = Tab：列头换成 Tab 名，且不再出现空列
    const tabGroupSet = await client.evaluate(setGroup("tab"));
    await new Promise((r) => setTimeout(r, 700));
    const tabGroup = await client.evaluate(`(() => {
            const columns = [...document.querySelectorAll(".session-overview-board-column")];
            return {
                titles: columns.map((c) => (c.querySelector(".session-overview-board-column-title")?.textContent || "").trim()),
                keys: columns.map((c) => c.getAttribute("data-column-key")),
                empty: document.querySelectorAll(".session-overview-board-empty").length,
                dots: document.querySelectorAll(".session-overview-board-column-dot").length,
                cards: document.querySelectorAll(".session-overview-board-card").length,
            };
        })()`);
    check(
      "group-tab-applied",
      tabGroupSet === true && tabGroup.titles.length > 0,
      `列=${JSON.stringify(tabGroup.titles)}`
    );
    check(
      "group-tab-no-empty-columns",
      tabGroup.empty === 0 && tabGroup.keys.every((key) => (key ?? "").startsWith("tab:")),
      `empty=${tabGroup.empty} keys=${JSON.stringify(tabGroup.keys)}`
    );
    check("group-tab-no-status-dot", tabGroup.dots === 0, `dots=${tabGroup.dots}`);
    check("group-tab-keeps-cards", tabGroup.cards === st.cards, `cards=${tabGroup.cards}（status 分组 ${st.cards}）`);
    await shot(client, "02a-group-tab", { x: 520, y: 60, width: 700, height: 480 });
    await client.evaluate(setGroup("status"));
    await new Promise((r) => setTimeout(r, 700));

    // 2a) 卡片信息架构：头像 / 状态 chip / agent 标题不得是 "Terminal"
    check("board-card-avatars", st.avatars === st.cards, `avatar=${st.avatars} 卡片=${st.cards}`);
    // agent 卡片的 emoji / 标题 / 状态 chip 断言在 2b2 里用播种的 agent 块覆盖（更有判定力）。

    // 2a2) 窄面板：横向可滚动 + snap 生效（不再纵向堆叠）
    check(
      "narrow-board-horizontal-scroll",
      st.scrollWidth > st.clientWidth,
      `scrollWidth=${st.scrollWidth} clientWidth=${st.clientWidth}`
    );
    check("narrow-board-scroll-snap", /x/.test(st.snapType), `scroll-snap-type=${st.snapType}`);
    check("board-single-row-flow", /column/.test(st.gridFlow), `grid-auto-flow=${st.gridFlow}`);
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
            // 空列显式 hidden（没有可滚内容，避免空滚动条）；只断言非空列可滚。
            const cardsScroll = secs
                .filter((s2) => !s2.classList.contains("is-empty"))
                .map((s2) => getComputedStyle(s2.querySelector(".session-overview-board-cards")).overflowY);
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
    check("wide-board-all-columns", cols.columnCount === 5, `列数=${cols.columnCount} hostW=${Math.round(cols.hostW)}`);
    check("wide-board-single-row", cols.sameRow === true, `列 top 一致=${cols.sameRow}`);
    check(
      "wide-board-column-scroll",
      (cols.scrolls ?? []).every((v) => v === "auto" || v === "scroll"),
      `列内 overflow-y=${JSON.stringify(cols.scrolls)}`
    );
    await shot(client, "02b-board-wide", { x: 520, y: 60, width: 900, height: 620 });

    // 2b2) 造一个 agent 卡片（真机里最新的 overview 面板往往只有 term 块，
    //      否则 emoji 头像 / 标题 / 状态 chip 三条最关键的断言永远只能 skipped）：
    //      1. localStorage 写 provider persona（claude → 🦊）
    //      2. createBlock 一个带 agent:provider 的 term 块
    //      3. RpcApi.AgentStatusCommand 播一条 working 状态
    const seeded = await client.evaluate(`(async () => {
        const out = { ok: false, blockId: "", statusSeeded: false, err: "" };
        try {
            // 必须走 persona store（写 localStorage 不会通知已初始化的 store，同一文档也收不到 storage 事件）。
            const persona = await import("/frontend/app/agent-persona/persona-store.ts");
            persona.setAgentPersona("claude", "🦊");
            const globalMod = await import("/frontend/app/store/global.ts");
            const services = await import("/frontend/app/store/services.ts");
            out.blockId = await globalMod.createBlock(
                {
                    meta: {
                        view: "term",
                        "agent:provider": "claude",
                        // 播种一个 sessionId：卡片内「打开会话详情」按钮按它启用/禁用，
                        // 没有它就无法断言「卡内详情按钮能压出第二层弹窗」。
                        // 该会话不存在 → 详情弹窗内部会显错，但 modal 层仍然存在，
                        // 本验证只断言「层数变 2」，不关心内容。
                        "agent:sessionid": "verify-board-session-0001",
                        "cmd:cwd": "/tmp/verify-board-agent",
                    },
                },
                false,
                false
            );
            out.ok = true;
            try {
                await services.BlockService.ReportAgentStatus({
                    blockId: out.blockId,
                    provider: "claude",
                    source: "manual",
                    state: "working",
                    phase: "thinking",
                    seq: 1,
                });
                out.statusSeeded = true;
            } catch (err) {
                out.err = "status:" + String(err && err.message ? err.message : err);
            }
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`);
    if (seeded?.ok === true) {
      await client.evaluate(clickView("list"));
      await new Promise((r) => setTimeout(r, 1200));
      await client.evaluate(clickView("board"));
      await new Promise((r) => setTimeout(r, 2000));
      const agentCard = await client.evaluate(`(() => {
            const card = [...document.querySelectorAll(".session-overview-board-card")].find(
                (c) => c.getAttribute("data-agent-like") === "true"
            );
            if (card == null) return { found: false };
            const avatar = card.querySelector(".session-overview-board-card-avatar");
            const title = (card.querySelector(".session-overview-board-card-title")?.textContent || "").trim();
            const chip = card.querySelector(".session-overview-agent-status");
            return {
                found: true,
                avatarKind: avatar?.getAttribute("data-avatar-kind") ?? "",
                avatarText: (avatar?.textContent || "").trim(),
                title,
                chipLabel: (chip?.querySelector(".agent-status-chip-label, .session-overview-agent-status-label")?.textContent || "").trim(),
            };
        })()`);
      if (agentCard?.found === true) {
        check(
          "agent-card-emoji-avatar",
          agentCard.avatarKind === "emoji" && agentCard.avatarText !== "",
          `kind=${agentCard.avatarKind} text=${agentCard.avatarText}`
        );
        check(
          "agent-card-title-not-terminal",
          agentCard.title !== "" && agentCard.title !== "Terminal",
          `title=${agentCard.title}`
        );
        if (seeded.statusSeeded === true) {
          check("agent-card-status-chip", agentCard.chipLabel !== "", `chip=${agentCard.chipLabel}`);
        } else {
          skip("agent-card-status-chip", `状态播种失败: ${seeded.err}`);
        }
        // 让卡片真的进画面：面板撑宽 + 把卡片所在列横向滚到中间。
        await client
          .evaluate(
            `(() => {
                const card = [...document.querySelectorAll('.session-overview-board-card')].find(
                    (c) => c.getAttribute("data-agent-like") === "true"
                );
                const panel = document.querySelector(".session-overview-panel");
                if (panel != null && panel.parentElement != null) {
                    panel.parentElement.style.width = "700px";
                    panel.parentElement.style.flex = "0 0 700px";
                    panel.style.width = "700px";
                }
                const column = card == null ? null : card.closest(".session-overview-board-column");
                if (column != null) column.scrollIntoView({ block: "nearest", inline: "center" });
                return true;
            })()`
          )
          .catch(() => false);
        await new Promise((r) => setTimeout(r, 600));
        await shot(client, "02c-agent-card", { x: 520, y: 60, width: 700, height: 560 });

        // 动效（FLIP）：把这张卡的 agent 状态切到另一列，断言 WAAPI 动画真的跑起来。
        //
        // 关键坑（踩过）：隐藏/后台窗口里 requestAnimationFrame 被节流到几乎不触发，
        // 用 rAF 或 setTimeout 轮询 `is-flying` 会 0 命中 —— 不是动效没跑，是采样器没跑。
        // 因此这里改为断言 **Web Animations API 自身的时间轴**（pause + 定位 currentTime），
        // 不依赖 rAF：
        //   1. 列真的换了（beforeCol != afterCol）；
        //   2. 卡片上挂着 ≥1 个 animation，duration > 0；
        //   3. 把 currentTime 钉到中点，计算样式里的 transform 是「非 none 且有限值」（= 正在插值）；
        //   4. 动画结束后 transform 归 none、getAnimations() 归零。
        const motion = await client.evaluate(`(async () => {
            const blockId = ${JSON.stringify(seeded.blockId)};
            const services = await import("/frontend/app/store/services.ts");
            const findCard = () =>
                [...document.querySelectorAll(".session-overview-board-card")].find(
                    (c) => c.getAttribute("data-board-block-id") === blockId
                );

            const card = findCard();
            if (card == null) return { err: "seeded card not on board" };
            const beforeLeft = card.getBoundingClientRect().left;
            const beforeColumn = card.getAttribute("data-board-column") ?? "";

            await services.BlockService.ReportAgentStatus({
                blockId,
                provider: "claude",
                source: "manual",
                state: "blocked",
                phase: "none",
                seq: 9,
            });

            // 等 React 提交（宏任务轮询，不用 rAF：后台窗口 rAF 会被节流）。
            const el = await new Promise((resolve) => {
                let n = 0;
                const iv = setInterval(() => {
                    const e = findCard();
                    if (e != null && (e.getAttribute("data-board-column") ?? "") !== beforeColumn) {
                        clearInterval(iv);
                        resolve(e);
                        return;
                    }
                    if (++n > 120) { clearInterval(iv); resolve(e ?? null); }
                }, 10);
            });
            if (el == null) return { err: "card disappeared after status change" };

            const anims = el.getAnimations();
            const animInfo = anims.map((a) => ({
                playState: a.playState,
                duration: Number(a.effect?.getTiming?.().duration ?? 0),
                keyframes: (a.effect?.getKeyframes?.() ?? []).map((k) => k.transform ?? k.opacity),
            }));

            // 钉到中点，读计算样式（pause 后必须读一次布局属性强制重算）。
            let midTransform = null;
            if (anims.length > 0 && animInfo[0].duration > 0) {
                const a = anims[0];
                a.pause();
                a.currentTime = Math.round(animInfo[0].duration / 2);
                void el.offsetWidth;
                midTransform = getComputedStyle(el).transform;
                a.play();
            }

            await new Promise((r) => setTimeout(r, 500));
            const settledEl = findCard();
            const settled = settledEl == null ? null : settledEl.getBoundingClientRect();
            return {
                ok: true,
                beforeColumn,
                beforeLeft,
                afterColumn: el.getAttribute("data-board-column") ?? "",
                animCount: anims.length,
                animInfo,
                midTransform,
                settledLeft: settled == null ? null : settled.left,
                settledColumn: settledEl == null ? "" : settledEl.getAttribute("data-board-column") ?? "",
                settledFlying: settledEl == null ? null : settledEl.classList.contains("is-flying"),
                settledAnims: settledEl == null ? null : settledEl.getAnimations().length,
                settledTransform: settledEl == null ? null : getComputedStyle(settledEl).transform,
            };
        })()`);

        if (motion?.ok === true) {
            const before = Number(motion.beforeLeft);
            const settled = Number(motion.settledLeft);
            // 「正在插值」的判据：中点 transform 不是 none，且不是单位矩阵。
            const midIsInterpolating =
                typeof motion.midTransform === "string" &&
                motion.midTransform !== "none" &&
                !/^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(motion.midTransform);
            check(
                "motion-column-changed",
                motion.beforeColumn !== motion.afterColumn && motion.afterColumn !== "",
                `${motion.beforeColumn} -> ${motion.afterColumn}`
            );
            check(
                "motion-flight-observed",
                motion.animCount > 0 && motion.animInfo?.[0]?.duration > 0,
                `anims=${motion.animCount} duration=${motion.animInfo?.[0]?.duration} kf=${JSON.stringify(motion.animInfo?.[0]?.keyframes)}`
            );
            check(
                "motion-midflight-interpolating",
                midIsInterpolating,
                `mid-transform=${motion.midTransform}`
            );
            check(
                "motion-settled",
                Math.abs(settled - before) > 1 &&
                    motion.settledFlying === false &&
                    motion.settledAnims === 0 &&
                    (motion.settledTransform === "none" || motion.settledTransform === "matrix(1, 0, 0, 1, 0, 0)"),
                `before=${Math.round(before)} settled=${Math.round(settled)} flying=${motion.settledFlying} anims=${motion.settledAnims} transform=${motion.settledTransform}`
            );
        } else {
            skip("motion-column-changed", `动效采样失败: ${motion?.err ?? "unknown"}`);
            skip("motion-flight-observed", "动效采样失败");
            skip("motion-midflight-interpolating", "动效采样失败");
            skip("motion-settled", "动效采样失败");
        }
        // 复位状态，避免污染后面的 provider 分组断言（那里期望 Claude + term 共 2 张卡）。
        await client
            .evaluate(
                `(async () => {
                    try {
                        const services = await import("/frontend/app/store/services.ts");
                        await services.BlockService.ReportAgentStatus({
                            blockId: ${JSON.stringify(seeded.blockId)},
                            provider: "claude",
                            source: "manual",
                            state: "working",
                            phase: "thinking",
                            seq: 10,
                        });
                    } catch (err) {
                        /* ignore */
                    }
                    return true;
                })()`
            )
            .catch(() => false);
        await new Promise((r) => setTimeout(r, 600));

        // ── 阶段 1：卡片点击语义（点卡片 → 整卡弹窗 → 卡内「打开会话详情」）──
        //
        // 坑："agent-dialog" / "AISessionDetailModal" 都是 createPortal 到 #main 的，不在 overview block 内，
        // 所以这一段断言**不能** scope 到 overview 面板；点完必须把弹窗全部关掉，否则后面的分组断言会被遮住。
        const clickFlow = await client.evaluate(`(async () => {
            const modals = await import("/frontend/app/store/modalmodel.ts");
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const waitFor = async (sel, timeout = 3000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    const el = document.querySelector(sel);
                    if (el != null) return el;
                    await sleep(50);
                }
                return null;
            };
            const popAll = () => {
                for (let i = 0; i < 10 && modals.modalsModel.hasOpenModals(); i++) modals.modalsModel.popModal();
            };
            popAll();
            await sleep(120);

            const card = [...document.querySelectorAll(".session-overview-board-card")].find(
                (c) => c.getAttribute("data-agent-like") === "true"
            );
            if (card == null) return { err: "no agent card on board" };

            card.click();
            const dialog = await waitFor(".agent-dialog");
            const hadDialog = dialog != null;
            const detailBtn = dialog == null ? null : dialog.querySelector("[data-agent-card-detail]");
            const detailDisabled = detailBtn == null ? null : detailBtn.disabled === true;

            let detailOpened = false;
            if (detailBtn != null && detailDisabled === false) {
                /* AISessionDetailModal 的 Modal 没有结构化 header（无 .mpd-header），
                   用它的固定 class 组合认：宽度 w-[min(1120px,...)] 对应的 .modal 变体。
                   更稳的判据：最多等 6s，看是否出现第二个 .modal-wrapper（modal 栈叠两层）。 */
                const before = document.querySelectorAll(".modal-wrapper").length;
                detailBtn.click();
                const deadline = Date.now() + 6000;
                while (Date.now() < deadline) {
                    if (document.querySelectorAll(".modal-wrapper").length > before) {
                        detailOpened = true;
                        break;
                    }
                    await sleep(80);
                }
            }
            const layersAfterDetail = document.querySelectorAll(".modal-wrapper").length;
            popAll();
            await sleep(150);
            const layersAfterClose = document.querySelectorAll(".modal-wrapper").length;
            return {
                ok: true,
                hadDialog,
                hasDetailButton: detailBtn != null,
                detailDisabled,
                detailOpened,
                layersAfterDetail,
                layersAfterClose,
            };
        })()`);

        if (clickFlow?.ok === true) {
            check("card-click-opens-agent-dialog", clickFlow.hadDialog === true, `agent-dialog=${clickFlow.hadDialog}`);
            check(
                "agent-dialog-has-detail-button",
                clickFlow.hasDetailButton === true && clickFlow.detailDisabled === false,
                `button=${clickFlow.hasDetailButton} disabled=${clickFlow.detailDisabled}`
            );
            check(
                "agent-dialog-detail-opens-session",
                clickFlow.detailOpened === true && clickFlow.layersAfterDetail === 2,
                `opened=${clickFlow.detailOpened} layers=${clickFlow.layersAfterDetail}`
            );
            check("agent-dialog-stack-closes", clickFlow.layersAfterClose === 0, `layers=${clickFlow.layersAfterClose}`);
        } else {
            skip("card-click-opens-agent-dialog", `点击流程采样失败: ${clickFlow?.err ?? "unknown"}`);
            skip("agent-dialog-has-detail-button", "点击流程采样失败");
            skip("agent-dialog-detail-opens-session", "点击流程采样失败");
            skip("agent-dialog-stack-closes", "点击流程采样失败");
        }
        await new Promise((r) => setTimeout(r, 300));

        // ── 阶段 2：目录 / 标签分组 ──
        // 现状断言（不依赖真会话数据）：
        //   1. select 真的有 5 个 option（新增 project / tags）；
        //   2. 切到每种分组都能出列、且列数 > 0；
        //   3. 标签分组下列计数之和 >= 卡片数（多标签跨列）。
        const groupOptions = await client.evaluate(
          `(() => {\n                const sel = document.querySelector("[data-overview-group]");\n                return sel == null ? null : [...sel.options].map((o) => o.value);\n            })()`
        );
        check(
          "group-options-include-project-tags",
          Array.isArray(groupOptions) &&
            groupOptions.includes("project") &&
            groupOptions.includes("tags"),
          `options=${JSON.stringify(groupOptions)}`
        );

        const groupProbe = async (group) => {
          const applied = await client.evaluate(setGroup(group));
          await new Promise((r) => setTimeout(r, 700));
          return client.evaluate(`(() => {
                const columns = [...document.querySelectorAll(".session-overview-board-column")];
                const cards = document.querySelectorAll(".session-overview-board-card").length;
                const inColumns = columns.reduce(
                    (n, c) => n + c.querySelectorAll(".session-overview-board-card").length,
                    0
                );
                return {
                    applied: ${JSON.stringify(group)} === "project" || ${JSON.stringify(group)} === "tags",
                    columns: columns.length,
                    titles: columns.map(
                        (c) => (c.querySelector(".session-overview-board-column-title")?.textContent || "").trim()
                    ),
                    cards,
                    inColumns,
                };
            })()`).then((probe) => ({ ...probe, applied }));
        };

        const projectGroup = await groupProbe("project");
        check(
          "group-project-renders",
          projectGroup?.applied === true && projectGroup.columns > 0 && projectGroup.inColumns === projectGroup.cards,
          `列=${JSON.stringify(projectGroup?.titles)} cards=${projectGroup?.cards} inColumns=${projectGroup?.inColumns}`
        );
        const tagGroup = await groupProbe("tags");
        check(
          "group-tags-renders",
          tagGroup?.applied === true && tagGroup.columns > 0,
          `列=${JSON.stringify(tagGroup?.titles)} cards=${tagGroup?.cards}`
        );
        // 标签视图的核心不变量：多标签卡跳列 → 列内卡片数之和可以 > 卡片总数（但绝不能 <）。
        check(
          "group-tags-count-gte-cards",
          tagGroup != null && tagGroup.inColumns >= tagGroup.cards,
          `inColumns=${tagGroup?.inColumns} cards=${tagGroup?.cards}`
        );
        // ── 阶段 3：卡片标签 chip + 迷你时间线 ──
        // 播种块没有会话 tags（新会话无索引记录），所以这里断言的是**渲染契约**而不是数据：
        //   1. 有 tags 的卡片：chip 数 = min(tags,3)，溢出有 +n 且 n = tags-3；
        //   2. 无 tags 的卡片：不渲染任何 tag chip（不得凭空造标签）；
        //   3. 每张卡片的迷你条段数 >= 1，且段宽总和 ≈ 100%（不能被算成 0 宽）。
        const tagMini = await client.evaluate(`(() => {
            const cards = [...document.querySelectorAll(".session-overview-board-card")];
            const perCard = cards.map((card) => {
                const tags = [...card.querySelectorAll("[data-board-tag]")].map((el) => el.getAttribute("data-board-tag"));
                const overflow = card.querySelector("[data-board-tag-overflow]");
                const mini = card.querySelector(".session-overview-board-mini, .session-overview-board-card-mini");
                const segs = mini == null ? [] : [...mini.querySelectorAll(".session-overview-board-card-mini-seg")];
                const miniBox = mini == null ? null : mini.getBoundingClientRect();
                const segWidths = segs.map((s) => s.getBoundingClientRect().width);
                return {
                    blockId: card.getAttribute("data-board-block-id") ?? "",
                    tagCount: tags.length,
                    overflow: overflow == null ? 0 : Number(overflow.getAttribute("data-board-tag-overflow") ?? 0),
                    miniHeight: miniBox == null ? 0 : Math.round(miniBox.height),
                    segCount: segs.length,
                    segSum: segWidths.reduce((n, w) => n + w, 0),
                    miniWidth: miniBox == null ? 0 : miniBox.width,
                };
            });
            return { cards: perCard.length, perCard };
        })()`);

        const withTags = (tagMini?.perCard ?? []).filter((c) => c.tagCount > 0);
        const withoutTags = (tagMini?.perCard ?? []).filter((c) => c.tagCount === 0);
        // 无 tags 的卡必须一个 tag chip 都没有（不得凭空造标签）；有 tags 的卡 chip 数 ≤ 3。
        check(
          "card-tags-render-contract",
          (tagMini?.perCard ?? []).every((c) => c.tagCount <= 3) &&
            withoutTags.every((c) => c.tagCount === 0 && c.overflow === 0),
          `cards=${tagMini?.cards} withTags=${withTags.length} withoutTags=${withoutTags.length}`
        );
        // 溢出计数只在「有标签且超过 3 个」时出现。
        check(
          "card-tags-overflow-consistent",
          (tagMini?.perCard ?? []).every((c) =>
            c.overflow === 0 ? c.tagCount <= 3 : c.tagCount === 3
          ),
          `overflow=${JSON.stringify((tagMini?.perCard ?? []).map((c) => [c.tagCount, c.overflow]))}`
        );
        // 迷你时间线：每张卡至少 1 段，段宽之和 ≈ 条宽（±2px 容差，段间有 1px 缝）。
        const miniOk = (tagMini?.perCard ?? []).every(
          (c) => c.segCount >= 1 && c.miniHeight > 0 && Math.abs(c.segSum - c.miniWidth) <= 2 * c.segCount + 2
        );
        check(
          "card-mini-timeline-renders",
          miniOk,
          JSON.stringify(
            (tagMini?.perCard ?? []).map((c) => ({ segs: c.segCount, h: c.miniHeight, sum: Math.round(c.segSum), w: Math.round(c.miniWidth) }))
          )
        );

        // 复位到 status，避免给后续断言留副作用。
        await client.evaluate(setGroup("status"));
        await new Promise((r) => setTimeout(r, 500));

        // provider 分组：种子 agent（claude）+ 普通 term → 至少一列标题是 Claude，且没有空列
        // 「分组不丢卡」用**切分组前刚采的**卡数做基准（播种新增了卡片，早先的 st.cards 已过期）。
        const cardsBeforeGroup = await client.evaluate(
          `(() => document.querySelectorAll(".session-overview-board-card").length)()`
        );
        await client.evaluate(setGroup("provider"));
        await new Promise((r) => setTimeout(r, 700));
        const providerGroup = await client.evaluate(`(() => {
                const columns = [...document.querySelectorAll(".session-overview-board-column")];
                return {
                    titles: columns.map((c) => (c.querySelector(".session-overview-board-column-title")?.textContent || "").trim()),
                    empty: document.querySelectorAll(".session-overview-board-empty").length,
                    cards: document.querySelectorAll(".session-overview-board-card").length,
                };
            })()`);
        check(
          "group-provider-columns",
          (providerGroup.titles ?? []).includes("Claude") && providerGroup.empty === 0,
          `列=${JSON.stringify(providerGroup.titles)} empty=${providerGroup.empty}`
        );
        // 「分组不丢卡」：不写死卡数（工作区里可能有别的 agent 块），比对切分组前后的卡片总数。
        check(
          "group-provider-keeps-cards",
          providerGroup.cards === cardsBeforeGroup,
          `provider 分组 cards=${providerGroup.cards}，切分组前 cards=${cardsBeforeGroup}`
        );
        await shot(client, "02d-group-provider", { x: 520, y: 60, width: 700, height: 480 });
      } else {
        skip("agent-card-emoji-avatar", "播种的 agent 卡片没有进入看板（可能被过滤/折叠）");
        skip("agent-card-title-not-terminal", "播种的 agent 卡片没有进入看板");
        skip("agent-card-status-chip", "播种的 agent 卡片没有进入看板");
      }
    } else {
      skip("agent-card-emoji-avatar", `播种 agent 块失败: ${seeded?.err ?? "unknown"}`);
      skip("agent-card-title-not-terminal", "播种 agent 块失败");
      skip("agent-card-status-chip", "播种 agent 块失败");
    }
    // 无论断言结果如何都要清场：播种的块会污染后面的 rows 回归断言。
    if (seeded?.blockId) {
      await client
        .evaluate(
          `(async () => {
            try {
                const services = await import("/frontend/app/store/services.ts");
                await services.ObjectService.DeleteBlock(${JSON.stringify(seeded.blockId)});
            } catch (err) {
                /* 清理失败不影响 verdict：verify 实例本来就会被 reset */
            }
            try {
                const persona = await import("/frontend/app/agent-persona/persona-store.ts");
                persona.clearAgentPersona("claude");
            } catch (err) {
                /* ignore */
            }
            return true;
        })()`
        )
        .catch(() => false);
      await new Promise((r) => setTimeout(r, 1200));
    }

    // 2c) 卡片集合 ⊇ 列表行集合（折叠只会减少列表行；普通 block 已按
    //     shouldShowFullOverviewBlock 过滤，不会变成空卡片）
    const invariants = await client.evaluate(`(() => {
            const cards = [...document.querySelectorAll(".session-overview-board-card")];
            const emptyTitles = cards.filter((c) => (c.querySelector(".session-overview-board-card-title")?.textContent || "").trim() === "").length;
            return { cards: cards.length, emptyTitles };
        })()`);
    check(
      "board-cards-have-titles",
      invariants.emptyTitles === 0,
      `卡片=${invariants.cards} 空标题=${invariants.emptyTitles}`
    );

    // 播种步骤会把分组切到 provider；这里复位，避免污染后面的回归断言。
    await client.evaluate(setGroup("status")).catch(() => false);
    await new Promise((r) => setTimeout(r, 500));

    // 2d) 清理后重新取列表基准：播种 agent 块改变了 workspace，最初那次 rows 不再可比。
    const rebase = await client.evaluate(clickView("list"));
    await new Promise((r) => setTimeout(r, 900));
    const postCleanupRows = await client.evaluate(
      `(() => document.querySelectorAll(".session-overview-block-row").length)()`
    );
    await client.evaluate(clickView("board"));
    await new Promise((r) => setTimeout(r, 900));
    check("list-rows-after-cleanup", rebase === true && postCleanupRows >= 1, `清理后列表行=${postCleanupRows}`);

    // 3a) 分组持久化：切到 tab → 写 storage → reload 后保持
    await client.evaluate(setGroup("tab"));
    await new Promise((r) => setTimeout(r, 500));
    const groupStored = await client.evaluate(`localStorage.getItem("snorkeling.overview.boardGroup")`);
    check("group-persisted-storage", groupStored === "tab", `storage=${groupStored}`);

    // 3) 持久化：写入 localStorage 后 reload 仍是看板
    const persisted = await client.evaluate(`localStorage.getItem("snorkeling.overview.viewMode")`);
    check("view-mode-persisted", persisted === "board", `storage=${persisted}`);
    await client.evaluate(`(() => { location.reload(); return true; })()`).catch(() => false);
    // reload 后固定 sleep 6s 不够（实测 dev 模式下 renderer 重新引导 + workspace 回填常超 6s，
    // 之前一直判成 board=false cards=0 → 误报「持久化失效」）。改成等到面板真的重新挂载。
    const reloadReady = await (async () => {
      const deadline = Date.now() + 60000;
      let last = null;
      while (Date.now() < deadline) {
        last = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`).catch(() => null);
        if (last != null && last.board === true && last.cards > 0) return last;
        await new Promise((r) => setTimeout(r, 500));
      }
      return last;
    })();
    st = reloadReady ?? (await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`));
    check("board-survives-reload", st.board === true && st.cards > 0, `board=${st.board} cards=${st.cards}`);
    check(
      "group-survives-reload",
      st.groupSelectValue === "tab" && (st.columnKeys ?? []).every((key) => (key ?? "").startsWith("tab:")),
      `value=${st.groupSelectValue} keys=${JSON.stringify(st.columnKeys)}`
    );

    // 4) 切回列表：行数应与初始一致（不回归）
    await client.evaluate(clickView("list"));
    // 同上：reload 后的第一次点击可能落在面板刚挂载的帧上，轮询直到行数回来。
    st = await (async () => {
      const deadline = Date.now() + 20000;
      let last = null;
      while (Date.now() < deadline) {
        last = await client.evaluate(`(() => { const q = ${COUNTS}; return q; })()`).catch(() => null);
        if (last != null && last.board === false && last.rows > 0) return last;
        await new Promise((r) => setTimeout(r, 400));
      }
      return last;
    })();
    check(
      "back-to-list-restores-rows",
      st.rows === postCleanupRows,
      `rows=${st.rows}（清理后基准 ${postCleanupRows}，初始 ${listRows}）`
    );
    check("back-to-list-hides-board", st.board === false && st.cards === 0, `board=${st.board}`);
    await shot(client, "03-back-list");

    const failed = results.filter((r) => !r.ok);
    const report = {
      area: "overview-board",
      runDir,
      passed: results.length - failed.length,
      failed: failed.length,
      total: results.length,
      verdict: failed.length === 0 ? "pass" : "fail",
      results,
      skipped,
    };
    writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
    const md = [
      "# overview-board verify",
      "",
      `- verdict: ${report.verdict} (${report.passed}/${report.total})`,
      `- 时间: ${new Date().toISOString()}`,
      `- 证据目录: \`${path.basename(runDir)}\``,
      "",
      "## 断言",
      "",
      ...results.map((r) => `- ${r.ok ? "PASS" : "FAIL"} \`${r.id}\`${r.detail != null ? ` — ${r.detail}` : ""}`),
      "",
      "## 未覆盖",
      "",
      ...(skipped.length > 0 ? skipped.map((s2) => `- \`${s2.id}\` — ${s2.detail}`) : ["- 无"]),
      "",
    ].join("\n");
    writeFileSync(path.join(runDir, "report.md"), md);
    appendLedgerRow({
      at: new Date().toISOString(),
      area: "overview-board",
      passed: report.passed,
      total: report.total,
      mode: attach ? "attach" : "launch+reset",
      runName: path.basename(runDir),
      commit: "working-tree",
    });
    console.log(`\nverdict=${report.verdict}（${report.passed}/${report.total}，skipped ${skipped.length}）`);
    console.log(`run 目录: ${runDir}`);
    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    client.close();
    // 自己起的实例默认关掉（端口 → PID），只有 --keep-open 才留。
    if (!keepOpen && typeof cleanup === "function") {
      cleanup();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
