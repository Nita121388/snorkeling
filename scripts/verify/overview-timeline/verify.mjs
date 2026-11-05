#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 时间线（Gantt · G1 会话寿命条）—— 真机 CDP 验证。
//
// 用法：
//   node scripts/verify/overview-timeline/verify.mjs             # 起干净实例 → 跑 → 自动关
//   node scripts/verify/overview-timeline/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/overview-timeline/verify.mjs --keep-open # 留着手工看
// 产物：verify-runs/<ts>-overview-timeline/{report.json,report.md,*.png} + 台账一行
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "overview-timeline";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;
let client = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 有意没覆盖的面 / 数据不到位导致跳过的断言，最后统一进 report.skipped。 */
const skipped = ["「更早（n）折叠」与 G2 状态分段不在本视图范围"];

async function waitFor(client, probe, ready, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.evaluate(probe).catch(() => null);
    if (ready(last)) return last;
    await sleep(400);
  }
  return last;
}

/** 所有查询都 scope 到"我自己建的那个 overview block"，实例里可能有别的 overview 面板。 */
function timelineStateProbe(scope) {
  return `(() => {
    const blk = document.querySelector("${scope}");
    if (blk == null) return { missing: true };
    const root = blk.querySelector(".session-overview-timeline");
    const rangeSel = blk.querySelector("[data-overview-range]");
    const bars = [...blk.querySelectorAll(".session-overview-timeline-bar")];
    const nowLine = blk.querySelector(".session-overview-timeline-now");
    const track = blk.querySelector(".session-overview-timeline-track");
    const ticks = [...blk.querySelectorAll(".session-overview-timeline-tick")].map((t) => ({
        label: (t.textContent || "").trim(),
        left: t.style.left,
    }));
    return {
        missing: false,
        rendered: root != null,
        rows: blk.querySelectorAll(".session-overview-timeline-row").length,
        bars: bars.length,
        states: bars.map((b) => b.getAttribute("data-state")),
        startUnknown: bars.map((b) => b.getAttribute("data-start-unknown")),
        range: rangeSel == null ? null : rangeSel.value,
        tickCount: ticks.length,
        firstTick: ticks[0]?.label ?? "",
        lastTick: ticks[ticks.length - 1]?.label ?? "",
        nowRight:
            nowLine != null && track != null
                ? Math.round(track.getBoundingClientRect().right - nowLine.getBoundingClientRect().right)
                : null,
        tailClasses: [...blk.querySelectorAll(".session-overview-timeline-bar-tail")].map((t) => t.className),
        board: blk.querySelector(".session-overview-board") != null,
        listRows: blk.querySelectorAll(".session-overview-block-row").length,
        trackVisible: (() => {
            const track = blk.querySelector(".session-overview-timeline-track");
            if (track == null) return null;
            const panel = blk.getBoundingClientRect();
            const rect = track.getBoundingClientRect();
            return rect.left >= panel.left - 1 && rect.right <= panel.right + 1 && rect.width > 60;
        })(),
        rowStacked: (() => {
            const row = blk.querySelector(".session-overview-timeline-row");
            if (row == null) return null;
            return getComputedStyle(row).display === "block";
        })(),
        viewButtons: [...blk.querySelectorAll("[data-overview-view]")].map((b) => ({
            mode: b.getAttribute("data-overview-view"),
            pressed: b.getAttribute("aria-pressed"),
        })),
    };
})()`;
}

const setRange = (value, scope) => `(() => {
    const blk = document.querySelector("${scope}");
    const sel = blk == null ? null : blk.querySelector("[data-overview-range]");
    if (sel == null) return false;
    sel.value = ${JSON.stringify(String(value))};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return sel.value === ${JSON.stringify(String(value))};
})()`;

const clickView = (mode, scope) => `(() => {
    const blk = document.querySelector("${scope}");
    const btn = blk == null ? null : blk.querySelector('[data-overview-view="${mode}"]');
    if (btn == null) return false;
    btn.click();
    return true;
})()`;

try {
  const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
  instance = await ensureInstance({ attach, resetProfile: !attach });
  client = instance.client;

  const pages = await listPageTargets(endpoint);
  if (pages.length > 1) {
    client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
  }
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await dismissOnboarding(client, { log: reporter.log });

  const hasBlocks = await waitFor(client, `(() => document.querySelectorAll(".block").length)()`, (n) => n > 0);
  reporter.check("app-ready", hasBlocks > 0, `blocks=${hasBlocks}`);

  // 干净起点：清掉 view mode / range，再开 overview block
  await client.evaluate(`(() => {
            localStorage.removeItem("snorkeling.overview.viewMode");
            localStorage.removeItem("snorkeling.overview.timelineRange");
            return true;
        })()`);
  const opened = await client.evaluate(`(async () => {
            try {
                const mod = await import("/frontend/app/store/global.ts");
                const blockId = await mod.createBlock({ meta: { view: "sessionoverview" } }, false, false);
                return { ok: true, blockId };
            } catch (err) {
                return { ok: false, err: String(err && err.message ? err.message : err) };
            }
        })()`);
  if (opened?.ok !== true) throw new Error(`打开 overview 失败: ${JSON.stringify(opened)}`);
  const scope = `.block.block-${opened.blockId}`;
  await sleep(4500);

  // 1) 播种一个 agent 块（全新 profile 只有 term 块，否则时间线是空的、验不到着色）
  const seeded = await client.evaluate(`(async () => {
            const out = { ok: false, blockId: "", statusSeeded: false, err: "" };
            try {
                const persona = await import("/frontend/app/agent-persona/persona-store.ts");
                persona.setAgentPersona("claude", "🦊");
                const globalMod = await import("/frontend/app/store/global.ts");
                const services = await import("/frontend/app/store/services.ts");
                out.blockId = await globalMod.createBlock(
                    { meta: { view: "term", "agent:provider": "claude", "cmd:cwd": "/tmp/verify-timeline-agent" } },
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
  reporter.check("seed-agent-block", seeded?.ok === true, seeded?.ok ? `blockId=${seeded.blockId}` : seeded?.err);

  // 2) 切到时间线
  const clicked = await client.evaluate(clickView("timeline", scope));
  await sleep(1800);
  let st = await client.evaluate(timelineStateProbe(scope));
  reporter.check("timeline-clicked", clicked === true, "");
  reporter.check("timeline-rendered", st.rendered === true, `rows=${st.rows} bars=${st.bars}`);
  reporter.check(
    "timeline-hides-others",
    st.board === false && st.listRows === 0,
    `board=${st.board} rows=${st.listRows}`
  );
  reporter.check("timeline-range-default-8h", st.range === "8", `range=${st.range}`);
  reporter.check(
    "timeline-ticks-9",
    st.tickCount === 9,
    `ticks=${st.tickCount} first=${st.firstTick} last=${st.lastTick}`
  );
  reporter.check(
    "timeline-now-line-right",
    st.nowRight != null && Math.abs(st.nowRight) <= 2,
    `now 线离轨道右端=${st.nowRight}px`
  );
  reporter.check("timeline-bar-present", st.bars > 0, `bars=${st.bars}`);
  reporter.check(
    "timeline-track-visible-narrow",
    st.trackVisible === true && st.rowStacked === true,
    `trackVisible=${st.trackVisible} rowStacked=${st.rowStacked}（窄面板应为标签+轨道两行，不用横滚找条）`
  );
  reporter.check(
    "timeline-start-unknown-marked",
    (st.startUnknown ?? []).includes("true"),
    `startUnknown=${JSON.stringify(st.startUnknown)}`
  );
  if (seeded?.statusSeeded === true) {
    reporter.check(
      "timeline-tail-state-color",
      (st.states ?? []).includes("working") && (st.tailClasses ?? []).some((cls) => cls.includes("is-working")),
      `states=${JSON.stringify(st.states)}`
    );
  } else {
    skipped.push(`timeline-tail-state-color — 状态播种失败: ${seeded?.err}`);
  }
  await reporter.shot(client, "01-timeline-8h");

  // 3) 时间窗切换：24h → 刻度变 MM/DD HH:MM，且写进 storage
  const rangeSet = await client.evaluate(setRange(24, scope));
  await sleep(1200);
  st = await client.evaluate(timelineStateProbe(scope));
  reporter.check("timeline-range-switch", rangeSet === true && st.range === "24", `range=${st.range}`);
  reporter.check(
    "timeline-tick-format-24h",
    /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(st.firstTick ?? ""),
    `firstTick=${st.firstTick}`
  );
  const stored = await client.evaluate(`localStorage.getItem("snorkeling.overview.timelineRange")`);
  reporter.check("timeline-range-persisted", stored === "24", `storage=${stored}`);
  await reporter.shot(client, "02-timeline-24h");

  // 4) reload 后仍是时间线 + 24h
  await client.evaluate(`(() => { location.reload(); return true; })()`).catch(() => false);
  await sleep(6000);
  await dismissOnboarding(client, { log: reporter.log }).catch(() => null);
  await waitFor(client, `(() => document.querySelectorAll(".block").length)()`, (n) => n > 0, 20000);
  st = await client.evaluate(timelineStateProbe(scope));
  reporter.check("timeline-survives-reload", st.rendered === true, `rendered=${st.rendered}`);
  reporter.check("timeline-range-survives-reload", st.range === "24", `range=${st.range}`);

  // 5) 切回列表：时间线消失、列表行回来
  const backClicked = await client.evaluate(clickView("list", scope));
  await sleep(1200);
  st = await client.evaluate(timelineStateProbe(scope));
  reporter.check("back-to-list", backClicked === true && st.rendered === false, `rendered=${st.rendered}`);

  // 清理：删掉播种块 + 复位 persona / range
  if (seeded?.blockId) {
    await client
      .evaluate(
        `(async () => {
                    try {
                        const services = await import("/frontend/app/store/services.ts");
                        await services.ObjectService.DeleteBlock(${JSON.stringify(seeded.blockId)});
                    } catch (err) {
                        /* 不影响 verdict：实例会被 reset */
                    }
                    try {
                        const persona = await import("/frontend/app/agent-persona/persona-store.ts");
                        persona.clearAgentPersona("claude");
                    } catch (err) {
                        /* ignore */
                    }
                    localStorage.removeItem("snorkeling.overview.timelineRange");
                    return true;
                })()`
      )
      .catch(() => false);
  }

  reporter.finish({
    skipped,
    cleanup: () => {
      client?.close?.();
      if (!keepOpen) instance?.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
