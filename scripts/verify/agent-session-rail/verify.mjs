#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话轨（右侧波浪刻度轨）真机验证台。
//
//   node scripts/verify/agent-session-rail/verify.mjs             # 起干净实例 → 跑 → 自动关
//   node scripts/verify/agent-session-rail/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/agent-session-rail/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/agent-session-rail/verify.mjs --dry        # 只解析依赖
//
// 验的是什么：
//   R1 水平滚动轴回归（主判据，可复现）：
//     用磁盘上一条「用户消息 > 37 条」的真实会话播种一个带 agent meta 的 term 块
//     （magnified）。刻度高 8px、容器 max-h 300px → 38+ 条就必然出现竖滚动条，
//     内容宽从 36px 掉到 32px（全局滚动条 4px）。旧实现只写 overflow-y:auto，
//     另一轴被强制成 auto → 36px 刻度在 32px 内容区横向溢出 → 底部水平滚动轴。
//     新实现断言的正是这个状态：overflowX === "hidden"（无水平轴）、
//     scrollWidth <= clientWidth、且竖滚动条真的出现了（scrollHeight > clientHeight）。
//   详情面（同一组件第二挂载点）做尽力而为检查，挂不上写 skipped。
//
//   R2/R3 端到端（新建会话刻度轨实时出现 / 列表实时刷新）依赖真实 agent CLI 写
//   会话文件的时刻，本台不做自动判定，写进 skipped 并给出人工核验方式。
//
// 数据来源是磁盘上的真实会话文件（干净 profile 不清 ~/.codex|claude|pi 会话）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "agent-session-rail";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

// 独立档位与端口（README 并行规范：每 area 一套，别和默认 verify 撞）。
const PROFILE = "verify-agent-session-rail";
const CDP_PORT = 9233;
const VITE_PORT = 51801;
// 刻度 8px 高、容器 max-h 300px：超过 37 条才出现竖滚动条（回归触发条件）。
const REGRESSION_MIN_TICKS = 38;

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(client, probe, ready, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.evaluate(probe).catch(() => null);
    if (ready(last)) return last;
    await sleep(400);
  }
  return last;
}

if (dry) {
  reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
  reporter.check("deps-resolve", true, "lib/{cdp,launch,probes,report}.mjs");
  reporter.finish({ cleanup: null, ledger: false });
}

// max-h-[300px] 是 SessionOutlineRail 滚动容器独有的类名（preview 块也用
// scrollbar-hide-until-hover，别撞上）。模板字面量里 4 个反斜杠 → 探针源码 2 个 →
// 浏览器字符串 1 个 → 合法 CSS 转义选择器 .max-h-\[300px\]。
const RAIL_SCAN_JS = `(() => {
    const rails = [...document.querySelectorAll(".max-h-\\\\[300px\\\\]")];
    return rails.map((el) => {
        const style = getComputedStyle(el);
        return {
            surface: el.closest(".term-agent-msg-rail") != null ? "tui" : "detail",
            isRail: el.classList.contains("scrollbar-hide-until-hover"),
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            ticks: el.children.length,
            maxHeight: style.maxHeight,
        };
    });
})()`;

function checkRail(rail, id, expectVerticalScroll) {
  reporter.check(`${id}-is-rail`, rail.isRail, "scrollbar-hide-until-hover expected");
  reporter.check(`${id}-overflow-x-hidden`, rail.overflowX === "hidden", {
    overflowX: rail.overflowX,
    overflowY: rail.overflowY,
  });
  reporter.check(`${id}-no-horizontal-overflow`, rail.scrollWidth <= rail.clientWidth, {
    clientWidth: rail.clientWidth,
    scrollWidth: rail.scrollWidth,
    ticks: rail.ticks,
  });
  reporter.check(`${id}-vertical-scroll-only`, rail.overflowY === "auto", {
    overflowY: rail.overflowY,
    scrollHeight: rail.scrollHeight,
    clientHeight: rail.clientHeight,
    maxHeight: rail.maxHeight,
  });
  reporter.check(`${id}-has-ticks`, rail.ticks > 0, { ticks: rail.ticks });
  if (expectVerticalScroll) {
    // 回归状态的硬条件：竖滚动条必须真的出现，否则这条用例没证明任何东西。
    reporter.check(`${id}-vertical-scrollbar-present`, rail.scrollHeight > rail.clientHeight, {
      scrollHeight: rail.scrollHeight,
      clientHeight: rail.clientHeight,
      ticks: rail.ticks,
    });
  }
}

try {
  instance = await ensureInstance({
    attach,
    resetProfile: !attach,
    profile: PROFILE,
    cdpPort: CDP_PORT,
    vitePort: VITE_PORT,
  });
  let client = instance.client;

  const pages = await listPageTargets(`http://127.0.0.1:${CDP_PORT}`).catch(() => []);
  if (pages.length > 1) {
    for (const page of pages) {
      const candidate = await connectToTarget(`http://127.0.0.1:${CDP_PORT}`, page).catch(() => null);
      if (candidate == null) continue;
      const blocks = await candidate.evaluate(`document.querySelectorAll(".block").length`).catch(() => 0);
      if (blocks > 0) {
        client = candidate;
        break;
      }
      candidate.close();
    }
  }
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await dismissOnboarding(client, { log: reporter.log });

  const ready = await waitFor(client, `document.querySelectorAll(".block").length`, (n) => n > 0);
  reporter.check("app-ready", ready > 0, `blocks=${ready}`);

  // ── 找一条用户消息 > 37 的真实会话（回归触发条件）────────────────────
  const picked = await client.evaluate(`(async () => {
        try {
            const svcMod = await import("/frontend/app/store/services.ts");
            const svc = new svcMod.AISessionsServiceType();
            const list = await svc.List({ limit: 100 });
            const sessions = (list?.sessions ?? [])
                .filter((s) => s && s.id && s.source !== "remote")
                .sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
                .slice(0, 15);
            for (const s of sessions) {
                try {
                    const outline = await svc.UserOutline({ id: s.id, limit: 50, refresh: true });
                    const count = outline?.userMessageCount ?? 0;
                    if (count >= ${REGRESSION_MIN_TICKS}) {
                        return {
                            ok: true,
                            id: s.id,
                            source: s.source,
                            userMessageCount: count,
                            returned: (outline?.messages ?? []).length,
                        };
                    }
                } catch (err) {
                    // 单条会话读失败不影响继续找
                }
            }
            return { ok: false, err: "no session with >= " + ${REGRESSION_MIN_TICKS} + " user messages" };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`);
  reporter.log(`picked session: ${JSON.stringify(picked)}`);
  if (picked?.ok !== true) {
    throw new Error(`找不到回归场景所需的真实会话: ${picked?.err ?? "unknown"}`);
  }
  reporter.check("regression-session-found", picked.userMessageCount >= REGRESSION_MIN_TICKS, {
    id: picked.id.slice(0, 12),
    userMessageCount: picked.userMessageCount,
  });

  // ── 面一：Agent TUI 右缘轨（magnified 保证 rail 可见）──────────────────
  const seeded = await client.evaluate(`(async () => {
        try {
            const mod = await import("/frontend/app/store/global.ts");
            const blockId = await mod.createBlock(
                {
                    meta: {
                        view: "term",
                        "agent:provider": ${JSON.stringify(picked.source)},
                        "agent:sessionid": ${JSON.stringify(picked.id)},
                    },
                },
                true,
                false
            );
            return { ok: true, blockId };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`);
  if (seeded?.ok !== true) throw new Error(`播种 agent term 块失败: ${JSON.stringify(seeded)}`);

  const tuiRail = await waitFor(
    client,
    `(() => document.querySelectorAll(".term-agent-msg-rail .max-h-\\\\[300px\\\\]").length)()`,
    (n) => n > 0,
    30000
  );
  reporter.check("tui-rail-mounted", tuiRail > 0, `rails=${tuiRail}`);

  const tuiRailState = await client.evaluate(`(() => {
        const el = document.querySelector(".term-agent-msg-rail .max-h-\\\\[300px\\\\]");
        if (el == null) return null;
        const style = getComputedStyle(el);
        return {
            isRail: el.classList.contains("scrollbar-hide-until-hover"),
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            ticks: el.children.length,
            maxHeight: style.maxHeight,
        };
    })()`);
  await reporter.shot(client, "01-tui-rail");
  if (tuiRailState == null) throw new Error("tui rail mounted but probe returned null");
  checkRail(tuiRailState, "tui-rail", true);
  reporter.check("tui-rail-ticks-meet-regression", tuiRailState.ticks >= REGRESSION_MIN_TICKS, {
    ticks: tuiRailState.ticks,
    required: REGRESSION_MIN_TICKS,
  });

  // ── 面二：GUI 会话详情轨（尽力而为；同一组件第二挂载点）───────────────
  const opened = await client.evaluate(`(async () => {
        try {
            const mod = await import("/frontend/app/store/global.ts");
            const blockId = await mod.createBlock({ meta: { view: "aisessions" } }, false, false);
            return { ok: true, blockId };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`);
  let detailRail = null;
  if (opened?.ok === true) {
    const aiScope = `.block.block-${opened.blockId}`;
    const rows = await waitFor(
      client,
      `(() => [...document.querySelectorAll("${aiScope} [data-session-key].cursor-pointer")].length)()`,
      (n) => n > 0,
      90000
    );
    if (rows > 0) {
      await client.evaluate(`(() => {
                const row = [...document.querySelectorAll("${aiScope} [data-session-key].cursor-pointer")].find(
                    (r) => r.getAttribute("data-session-key").split(":")[1] === ${JSON.stringify(picked.id)}
                );
                if (row != null) row.click();
            })()`);
      detailRail = await waitFor(
        client,
        `(() => {
                    const scope = document.querySelector("${aiScope}");
                    const el = scope?.querySelector(".max-h-\\\\[300px\\\\]");
                    if (el == null) return null;
                    const style = getComputedStyle(el);
                    return {
                        isRail: el.classList.contains("scrollbar-hide-until-hover"),
                        overflowX: style.overflowX,
                        overflowY: style.overflowY,
                        clientWidth: el.clientWidth,
                        scrollWidth: el.scrollWidth,
                        clientHeight: el.clientHeight,
                        scrollHeight: el.scrollHeight,
                        ticks: el.children.length,
                        maxHeight: style.maxHeight,
                    };
                })()`,
        (v) => v != null,
        45000
      );
    }
  }
  if (detailRail != null) {
    checkRail(detailRail, "detail-rail", false);
    await reporter.shot(client, "02-detail-rail");
  }

  reporter.finish({
    extra: { pickedSession: picked, tuiRail: tuiRailState, detailRail },
    skipped: [
      ...(detailRail == null
        ? ["GUI 会话详情轨未挂载（详情面板未在有限时间内渲染出 rail），同一组件已由 TUI 面覆盖"]
        : []),
      "R2 新建 agent 会话刻度轨实时出现：需要真实 agent CLI 写首条用户消息的时刻，本台用既有会话验证静态/回归契约；实时链路由单测锁定（term-agent-message-rail.dom.test.tsx）。",
      "R3 AISessions 列表 sessionschanged 事件端到端：需要运行中的 agent 写会话文件，本台不做自动判定；人工核验：列表开着时给 agent 发消息，行内容/新会话 ≤10s 出现（后端 tick 默认 5s + 前端 500ms 去抖 + 5s 最小间隔）。",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, {
    cleanup: () => {
      if (instance?.spawned) instance.cleanup?.();
    },
  });
}
