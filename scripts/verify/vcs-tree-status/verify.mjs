#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Files 目录 VCS 标记 —— 真机 CDP 验证（design.md 的验收断言）。
//
// 两个视图都要验证：
//   1) Explorer 树视图（默认显示，preview-explorer → treeview）
//   2) 列表视图（preview-directory 的 DirectoryTable）
// 语义一致：M/U 着色 + 行尾字母、clean 完全静默、目录行尾聚合数量（不改色）。
//
// fixture：/tmp/vcs-fixture —— 一个真实 git 仓库
//   modified.txt (M) / untracked.txt (U) / clean.txt (clean) / sub/（内含 1 个 M: inner2.txt）
//
// 用法：node scripts/verify/vcs-tree-status/verify.mjs --attach
//       （需要先 node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed）
// 产物：verify-runs/<ts>-vcstreestatus/report.json + 截图

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../preview-edit/lib/cdp.mjs";
import { DEFAULTS, dismissOverlays, ensureInstance } from "../preview-edit/lib/launch.mjs";
import { readPng, scalePng, writePng } from "../preview-edit/lib/pixel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const runDir = path.join(
  repoRoot,
  "verify-runs",
  `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}-vcstreestatus`
);
mkdirSync(runDir, { recursive: true });
// Windows 真机：`/tmp` 只有盘符相对语义，git 报的 rootpath 会带盘符，两边拼写不可能对齐
// （路径对齐逻辑对 Windows 盘符路径是有意跳过的）。用 VCS_FIXTURE 指到真实盘符路径。
const fixture = process.env.VCS_FIXTURE || "/tmp/vcs-fixture";

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail != null ? ` — ${detail}` : ""}`);
  return ok;
}

// 行选择器：树视图用 [data-treeview-row]（名字 span = .ml-1.truncate，行尾 = .dir-vcs-mark）；
// 列表视图用 .dir-table-body-row（名字 = .dir-table-name）。两边都按「block 内」取证，
// 避免同一实例里别的 preview block 干扰。
const TREE_ROWS = `(blockSel) => {
    const block = document.querySelector(blockSel);
    if (block == null) return null;
    return [...block.querySelectorAll("[data-treeview-row]")].map((r) => {
        const label = r.querySelector("span.ml-1.truncate");
        const mark = r.querySelector(".dir-vcs-mark");
        return {
            name: (label?.textContent || "").trim(),
            nameClass: label?.className || "",
            mark: mark ? (mark.textContent || "").trim() : null,
            markClass: mark?.className || null,
            nameColor: label != null ? getComputedStyle(label).color : null,
            nameDecoration: label != null ? getComputedStyle(label).textDecorationLine : null,
        };
    }).filter((r) => r.name !== "");
}`;

const TABLE_ROWS = `(blockSel) => {
    const block = document.querySelector(blockSel);
    if (block == null) return null;
    return [...block.querySelectorAll(".dir-table-body-row")].map((r) => {
        const name = r.querySelector(".dir-table-name");
        const mark = r.querySelector(".dir-vcs-mark");
        return {
            name: (name?.textContent || "").trim(),
            nameClass: name?.className || "",
            mark: mark ? (mark.textContent || "").trim() : null,
            markClass: mark?.className || null,
            nameColor: name != null ? getComputedStyle(name).color : null,
            nameDecoration: name != null ? getComputedStyle(name).textDecorationLine : null,
        };
    }).filter((r) => r.name !== "" && r.name !== "..");
}`;

async function readRows(client, expr, blockSel) {
  return await client.evaluate(`(${expr})(${JSON.stringify(blockSel)})`);
}

async function waitFor(client, predicateExpr, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await client.evaluate(predicateExpr).catch(() => null);
    if (value) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`（等待超时：${label}）`);
  return false;
}

const RPC_COUNTER_INSTALL = `(async () => {
    const wr = await import("/frontend/app/store/wshrpcutil.ts");
    const c = wr.TabRpcClient;
    if (c.__vcsOrig == null) {
        c.__vcsOrig = c.wshRpcCall;
        c.__vcsCalls = [];
        c.wshRpcCall = function (command, data, opts) {
            if (command === "remotevcsrepositories") c.__vcsCalls.push(data?.path ?? "");
            return c.__vcsOrig.call(this, command, data, opts);
        };
    }
    c.__vcsCalls = [];
    return true;
})()`;

const RPC_COUNT = `(async () => {
    const wr = await import("/frontend/app/store/wshrpcutil.ts");
    return wr.TabRpcClient.__vcsCalls?.length ?? 0;
})()`;

async function shot(client, name, blockSel) {
  const rect = await client.evaluate(`(() => {
        const b = document.querySelector(${JSON.stringify(blockSel)});
        if (b == null) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.max(320, r.width), height: Math.max(240, r.height) };
    })()`);
  const clip = rect ?? { x: 560, y: 60, width: 780, height: 640 };
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

/** 一个视图的语义断言：M/U 着色 + 行尾字母、clean 静默、目录聚合数量。 */
function assertView(prefix, rows, { expectRootRow = true } = {}) {
  const byName = {};
  for (const r of rows) {
    if (byName[r.name] == null) {
      byName[r.name] = r;
    }
  }

  // 1) modified：行尾 M、文件名着色
  const mod = byName["modified.txt"];
  check(`${prefix}-modified-mark-m`, mod?.mark === "M", `mark=${mod?.mark}`);
  check(`${prefix}-modified-name-class`, (mod?.nameClass ?? "").includes("is-vcs-m"), `class=${mod?.nameClass}`);
  check(`${prefix}-modified-mark-class`, (mod?.markClass ?? "").includes("is-vcs-m"), `markClass=${mod?.markClass}`);

  // 2) untracked：行尾 U、文件名着色（绿）
  const un = byName["untracked.txt"];
  check(`${prefix}-untracked-mark-u`, un?.mark === "U", `mark=${un?.mark}`);
  check(`${prefix}-untracked-name-class`, (un?.nameClass ?? "").includes("is-vcs-u"), `class=${un?.nameClass}`);
  check(
    `${prefix}-modified-vs-untracked-color`,
    mod?.nameColor != null && un?.nameColor != null && mod.nameColor !== un.nameColor,
    `M=${mod?.nameColor} U=${un?.nameColor}`
  );

  // 3) clean：完全无标记（无 class、无行尾）
  const clean = byName["clean.txt"];
  check(
    `${prefix}-clean-silent`,
    clean != null && clean.mark == null && !(clean.nameClass ?? "").includes("is-vcs-"),
    `mark=${clean?.mark} class=${clean?.nameClass}`
  );

  // 4) sub 目录：聚合数量 1，目录名不变色
  const sub = byName["sub"];
  check(`${prefix}-sub-dir-count`, sub != null && sub.mark === "1", `mark=${sub?.mark}（sub 内 1 个变更文件）`);
  check(
    `${prefix}-sub-dir-count-class`,
    (sub?.markClass ?? "").includes("dir-vcs-count"),
    `markClass=${sub?.markClass}`
  );
  check(
    `${prefix}-sub-dir-name-not-colored`,
    !(sub?.nameClass ?? "").includes("is-vcs-"),
    `class=${sub?.nameClass}（目录名不变色）`
  );

  // 5) 根行：整棵树聚合数量 3（mod + untracked + sub/inner2）——表格不显示根自身
  if (expectRootRow) {
    const root = byName["vcs-fixture"];
    check(`${prefix}-root-count`, root != null && root.mark === "3", `mark=${root?.mark}（根下 3 个变更文件）`);
  }

  return byName;
}

async function main() {
  const attach = process.argv.includes("--attach");
  let client;
  if (attach) {
    client = await connect(`http://127.0.0.1:${DEFAULTS.cdpPort}`);
  } else {
    const inst = await ensureInstance({ attach: false, resetProfile: true });
    client = inst.client;
  }
  try {
    await dismissOverlays(client).catch(() => []);
    // VCS RPC 计数器：一次 RPC + 缓存命中（切视图不再请求）的硬预算断言
    await client.evaluate(RPC_COUNTER_INSTALL).catch(() => false);
    const opened = await client.evaluate(`(async () => {
            const mod = await import("/frontend/app/store/global.ts");
            const blockId = await mod.createBlock({ meta: { view: "preview", file: ${JSON.stringify(fixture)} } }, false, false);
            return { ok: true, blockId };
        })()`);
    if (opened?.ok !== true || opened.blockId == null) {
      throw new Error(`打开目录块失败: ${JSON.stringify(opened)}`);
    }
    const blockSel = `.block-${opened.blockId}`;
    const treeReady = await waitFor(
      client,
      `document.querySelector(${JSON.stringify(blockSel + " [data-treeview-row]")}) != null`,
      "tree rows"
    );
    // VCS RPC 有 250ms debounce，等标记落地（最多 ~10s）
    await waitFor(
      client,
      `document.querySelector(${JSON.stringify(blockSel + " .dir-vcs-mark")}) != null`,
      "tree vcs marks"
    );
    await new Promise((r) => setTimeout(r, 800));

    // ---------- 1) 树视图（默认显示） ----------
    let treeRows = await readRows(client, TREE_ROWS, blockSel);
    check(
      "tree-rows-present",
      treeReady && Array.isArray(treeRows) && treeRows.length >= 5,
      `rows=${treeRows?.length}`
    );
    const treeByName = assertView("tree", treeRows ?? []);
    const rpcAfterOpen = await client.evaluate(RPC_COUNT).catch(() => null);
    check(
      "tree-single-rpc",
      rpcAfterOpen != null && rpcAfterOpen <= 1,
      `remotevcsrepositories calls=${rpcAfterOpen}（≤1：一次 RPC + 可能缓存命中）`
    );
    await shot(client, "01-tree-vcs-marks", blockSel);

    // 展开 sub（树里单击即展开）：验证嵌套目录内的行标记
    const expanded = await client.evaluate(`(() => {
            const block = document.querySelector(${JSON.stringify(blockSel)});
            if (block == null) return false;
            const row = [...block.querySelectorAll("[data-treeview-row]")].find((r) =>
                ((r.querySelector("span.ml-1.truncate")?.textContent || "").trim() === "sub"));
            if (row == null) return false;
            row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return true;
        })()`);
    await waitFor(
      client,
      `(() => {
                const block = document.querySelector(${JSON.stringify(blockSel)});
                if (block == null) return false;
                return [...block.querySelectorAll("[data-treeview-row]")].some((r) =>
                    ((r.querySelector("span.ml-1.truncate")?.textContent || "").trim() === "inner2.txt"));
            })()`,
      "tree sub children"
    );
    treeRows = (await readRows(client, TREE_ROWS, blockSel)) ?? [];
    const inner2 = treeRows.find((r) => r.name === "inner2.txt");
    const innerClean = treeRows.find((r) => r.name === "inner.txt");
    check("tree-expand-sub", expanded === true, "");
    check("tree-subdir-inner2-m", inner2?.mark === "M", `mark=${inner2?.mark}`);
    check("tree-subdir-inner2-colored", (inner2?.nameClass ?? "").includes("is-vcs-m"), `class=${inner2?.nameClass}`);
    check(
      "tree-subdir-clean-silent",
      innerClean != null && innerClean.mark == null && !(innerClean.nameClass ?? "").includes("is-vcs-"),
      `mark=${innerClean?.mark}`
    );
    await shot(client, "02-tree-subdir", blockSel);

    // ---------- 2) 列表视图（块头 display 切换） ----------
    const switched = await client.evaluate(`(() => {
            const block = document.querySelector(${JSON.stringify(blockSel)});
            if (block == null) return null;
            const btn = [...block.querySelectorAll(".preview-list-mode-toggle")].find((b) =>
                (b.getAttribute("title") || "").includes("List"));
            if (btn == null) return null;
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return btn.getAttribute("title");
        })()`);
    check("switch-to-list-view", switched != null, `button=${switched}`);
    const tableReady = await waitFor(
      client,
      `document.querySelector(${JSON.stringify(blockSel + " .dir-table-body-row")}) != null`,
      "table rows"
    );
    await waitFor(
      client,
      `document.querySelector(${JSON.stringify(blockSel + " .dir-vcs-mark")}) != null`,
      "table vcs marks"
    );
    await new Promise((r) => setTimeout(r, 800));

    const tableRows = (await readRows(client, TABLE_ROWS, blockSel)) ?? [];
    check("table-rows-present", tableReady && tableRows.length >= 4, `rows=${tableRows.length}`);
    const tableByName = assertView("table", tableRows, { expectRootRow: false });
    const rpcAfterSwitch = await client.evaluate(RPC_COUNT).catch(() => null);
    check(
      "switch-view-uses-cache",
      rpcAfterSwitch != null && rpcAfterSwitch === rpcAfterOpen,
      `calls before=${rpcAfterOpen} after=${rpcAfterSwitch}（切视图应命中 10s 缓存，不再发请求）`
    );
    await shot(client, "03-table-vcs-marks", blockSel);

    // 树/表语义一致性抽查（表格无根行，不比较 root）
    check(
      "views-agree",
      treeByName["modified.txt"]?.mark === tableByName["modified.txt"]?.mark &&
        treeByName["untracked.txt"]?.mark === tableByName["untracked.txt"]?.mark &&
        treeByName["sub"]?.mark === tableByName["sub"]?.mark,
      `tree(M/U/sub)=${[treeByName["modified.txt"]?.mark, treeByName["untracked.txt"]?.mark, treeByName["sub"]?.mark].join("/")} table=${[tableByName["modified.txt"]?.mark, tableByName["untracked.txt"]?.mark, tableByName["sub"]?.mark].join("/")}`
    );

    const failed = results.filter((r) => !r.ok);
    const report = {
      runDir,
      fixture,
      blockId: opened.blockId,
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
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
