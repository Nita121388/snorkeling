#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// vcshistory 块提交行样式验证（11-10-vcs-history-commit-row-style 的验收断言）。
//
//   node scripts/verify/vcshistory-rows/verify.mjs              # 干净实例 → 跑 → 自动关
//   node scripts/verify/vcshistory-rows/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/vcshistory-rows/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/vcshistory-rows/verify.mjs --dry        # 只解析依赖
//
// 真机打开一个 vcshistory 块（指向本仓一个有历史的文件），断言它与 vcs-changes-tab
// Outgoing 共用同一套两行式 CommitRow（主行 subject / 副行 hash·author·相对时间、
// 2px 语义轨、hover:bg-hover、行分隔线、圆角容器、History 分组头 + 计数 chip），
// 并保留行内展开（files 面板 + Diff 按钮）。
//
// 已知限制：本仓 origin/main ahead=0，Outgoing 区没有活行可做像素对照 ——
// 用「行容器 class 与共享组件逐字一致」做结构一致性断言替代（见 skipped）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets, waitFor } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";
import { createReporter, repoRoot } from "../lib/report.mjs";

const AREA = "vcshistory-rows";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const HISTORY_FILE = "frontend/app/view/vcs/vcs-changes-tab.tsx";
// POSIX 风格 repo 路径（git 报的 repopath 口径，Windows 下 Golang 侧也是正斜杠）
const REPO_PATH = repoRoot
  .replace(/\\/g, "/")
  .replace(/\/\//g, "/")
  .replace(/^([A-Za-z]):/, (m) => m.toLowerCase());

// 共享 CommitRow 的行容器 class（vcs-commit-row.tsx，expandable 时追加 cursor-pointer）。
const ROW_BASE_CLASS =
  "flex w-full items-stretch gap-2 border-b border-border px-2 py-[7px] last:border-b-0 hover:bg-hover";

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

/**
 * 扫描 vcshistory 块：返回列表状态；块/列表没就绪时返回 null（供 waitFor 轮询）。
 */
const SCAN = `(() => {
    const groups = [...document.querySelectorAll("div")].filter(
        (d) => typeof d.className === "string" && d.className.startsWith("mt-3") && d.textContent.startsWith("History")
    );
    const group = groups[0];
    if (group == null) return null;
    const frame = group.closest("[data-blockid]") || group.closest(".block") || document.body;
    const rows = [...frame.querySelectorAll("div")].filter(
        (d) =>
            typeof d.className === "string" &&
            (d.className === ${JSON.stringify(ROW_BASE_CLASS)} ||
                d.className === ${JSON.stringify(ROW_BASE_CLASS)} + " cursor-pointer")
    );
    if (rows.length === 0) return null;
    const header = group.querySelector("span.font-semibold.text-secondary");
    const chip = group.querySelector("span.rounded.bg-surface-soft.font-mono");
    const meta = rows.map((r) => {
        const rail = r.querySelector("span.w-\\\\[2px\\\\]");
        const metaLine = [...r.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.startsWith("mt-[3px]"));
        const spans = metaLine ? [...metaLine.querySelectorAll("span")] : [];
        const timeSpan = spans[spans.length - 1];
        return {
            hasRail: rail != null,
            railClass: rail?.className ?? "",
            railWidth: rail?.getBoundingClientRect().width ?? 0,
            metaText: metaLine?.textContent ?? "",
            monoHash: metaLine?.querySelector("span.font-mono")?.textContent ?? "",
            timeTitle: timeSpan?.getAttribute("title") ?? "",
            timeText: timeSpan?.textContent ?? "",
        };
    });
    return {
        rows: meta.length,
        rowClassesIdentical: rows.every(
            (r) => r.className === ${JSON.stringify(ROW_BASE_CLASS)} || r.className === ${JSON.stringify(ROW_BASE_CLASS)} + " cursor-pointer"
        ),
        headerText: header?.textContent ?? "",
        chipText: chip?.textContent ?? "",
        meta,
        rawIsoLeak: /\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(frame.textContent || ""),
        containerRounded: group.querySelector("div.overflow-hidden.rounded-\\\\[7px\\\\]") != null,
    };
})()`;

if (dry) {
  reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
  reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs + vcs-commit-row.tsx");
  reporter.finish({ cleanup: null, ledger: false });
}

try {
  const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
  instance = await ensureInstance({ attach, resetProfile: !attach });
  let client = instance.client;

  const pages = await listPageTargets(endpoint);
  if (pages.length > 1) {
    client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
  }
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  reporter.log(`instance ready (${attach ? "attach" : "launch"})`);

  await dismissOnboarding(client, { log: reporter.log });

  // ── 通过渲染进程 store 建一个 vcshistory 块（与 vcs.tsx openHistoryBlock 同参数）──
  const created = await client.evaluate(`(async () => {
        const mod = await import("/frontend/app/store/global.ts");
        if (typeof mod.createBlock !== "function") return { ok: false, why: "no-createBlock" };
        await mod.createBlock({
            meta: {
                view: "vcshistory",
                connection: "local",
                "vcshistory:repotype": "git",
                "vcshistory:repopath": ${JSON.stringify(REPO_PATH)},
                "vcshistory:filepath": ${JSON.stringify(HISTORY_FILE)},
                "vcshistory:title": "History: ${HISTORY_FILE}",
            },
        });
        return { ok: true };
    })()`);
  reporter.check("history-block-created", created?.ok === true, JSON.stringify(created));

  // ── 等列表渲染（RPC 拉取 git log → 块内渲染 History 分组）──
  let state;
  try {
    state = await waitFor(client, SCAN, { timeoutMs: 45000, intervalMs: 600, label: "vcshistory 列表渲染" });
  } catch (err) {
    await reporter.shot(client, "01-timeout");
    throw err;
  }

  reporter.check("history-group-header", state.headerText === "History", state.headerText);
  reporter.check(
    "group-count-chip",
    state.chipText === String(state.rows) && state.rows > 0,
    `chip=${state.chipText} rows=${state.rows}`
  );
  reporter.check("rounded-group-container", state.containerRounded === true, "overflow-hidden rounded-[7px]");
  reporter.check(
    "row-class-parity-shared-component",
    state.rowClassesIdentical === true,
    "行容器 class 与共享 CommitRow 逐字一致"
  );

  // 行结构：两行式（副行 hash·author·相对时间）+ 2px 轨
  const twoLineOk = state.meta.every((m) => m.metaText.includes("·") && m.monoHash.length >= 7);
  const railOk = state.meta.every((m) => m.hasRail && Math.round(m.railWidth) === 2);
  reporter.check("rows-two-line", twoLineOk, state.meta[0]?.metaText ?? "no rows");
  reporter.check("rows-rail-2px", railOk, state.meta.map((m) => Math.round(m.railWidth)).join(","));

  // 轨颜色：中性 accent（非 outgoing 绿 / incoming 红）
  const railColorOk = state.meta.every(
    (m) => m.railClass.includes("bg-accent") && !m.railClass.includes("bg-success") && !m.railClass.includes("bg-error")
  );
  reporter.check("rail-neutral-accent", railColorOk, JSON.stringify(state.meta[0]?.railClass));

  // 相对时间 + 绝对时间 title（yyyy-MM-dd HH:mm）
  const timeOk = state.meta.every((m) => /^(just now|\d+m ago|\d+h ago|\d+d ago|\d{2}-\d{2}|—)$/.test(m.timeText));
  const titleOk = state.meta.every((m) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(m.timeTitle));
  reporter.check(
    "relative-time-with-absolute-title",
    timeOk && titleOk,
    `${state.meta[0]?.timeText} / ${state.meta[0]?.timeTitle}`
  );

  // 回归：不再直接渲染原始 ISO 日期串
  reporter.check("no-raw-iso-date", state.rawIsoLeak === false, state.rawIsoLeak ? "raw ISO date leaked" : "clean");

  await reporter.shot(client, "02-history-rows");

  // ── 展开第一行：files 面板出现（bg-surface-strong + Diff 按钮），再点收起 ──
  const firstRowCenter = await client.evaluate(`(() => {
        const group = [...document.querySelectorAll("div")].filter(
            (d) => typeof d.className === "string" && d.className.startsWith("mt-3") && d.textContent.startsWith("History")
        )[0];
        const frame = group?.closest("[data-blockid]") || group?.closest(".block") || document.body;
        const rows = [...frame.querySelectorAll("div")].filter(
            (d) => typeof d.className === "string" && d.className === ${JSON.stringify(ROW_BASE_CLASS)} + " cursor-pointer"
        );
        if (rows.length === 0) return null;
        const r = rows[0].getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
  if (firstRowCenter == null) {
    reporter.check("expand-toggle", false, "找不到可点行");
  } else {
    await client.click(firstRowCenter.x, firstRowCenter.y);
    const expanded = await waitFor(
      client,
      `(() => {
                const panel = document.querySelector(".bg-surface-strong");
                if (panel == null) return null;
                const btns = [...panel.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
                return { text: panel.textContent.slice(0, 60), diffButtons: btns.filter((t) => t === "Diff").length };
            })()`,
      { timeoutMs: 30000, intervalMs: 500, label: "展开面板 + Diff 按钮" }
    ).catch(() => null);
    reporter.check(
      "expand-toggle",
      expanded != null && expanded.diffButtons > 0,
      expanded ? `Diff buttons=${expanded.diffButtons}, text=${expanded.text}` : "panel not found"
    );
    await reporter.shot(client, "03-expanded");
    await client.click(firstRowCenter.x, firstRowCenter.y);
    await sleep(600);
    const collapsed = await client.evaluate(`(() => document.querySelector(".bg-surface-strong") == null)()`);
    reporter.check("collapse-toggle", collapsed === true, "panel still open");
  }

  reporter.finish({
    skipped: [
      "Outgoing 活行像素对照：本仓 ahead=0 无 Outgoing 提交，用「行容器 class 与共享 CommitRow 逐字一致（ROW_BASE_CLASS）」替代结构对照",
    ],
    cleanup: () => {
      client.close?.();
      if (instance?.spawned && !keepOpen) instance.cleanup?.();
    },
  });
} catch (err) {
  reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
