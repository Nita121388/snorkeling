#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 连接下拉（Connect to）真机验证台 —— N-1117-conn-typeahead-row-rail。
//
// 覆盖四件事：
//   skeleton-while-loading   打开瞬间必须有骨架（面板不塌成输入框再撑开）
//   rail-right-align         同列表所有行右栏右边缘极差 ≤ 1px（居右对齐）
//   copy-hover-reveal        复制槽 hover 前隐藏 / hover 后浮现 / 布局零位移 / 点击有反馈
//   usage-sort-order         localStorage 使用计数改变行序（常用连接上浮）
//
//   node scripts/verify/conn-typeahead-rail/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/conn-typeahead-rail/verify.mjs --attach     # 复用实例（迭代）
//   node scripts/verify/conn-typeahead-rail/verify.mjs --keep-open  # 跑完留实例人工看
//   node scripts/verify/conn-typeahead-rail/verify.mjs --dry        # 只解析依赖
//
// 手法：
//   - 用渲染进程内 import（/frontend/app/store/global.ts）建一个 sysinfo 块 —— 它的
//     header 带 ConnectionButton（manageConnection=true），不依赖真终端起 shell。
//   - 用 app 自己的 RPC（setconnectionsconfig）往 **verify profile** 注入三条假连接
//     （verify-rail-{a,b,c}@127.0.0.1），让排序断言可控可复现；不碰真实用户配置。
//   - 骨架是转瞬即逝的：点击前先装 MutationObserver 记录「骨架是否出现过」，
//     等 suggestions 渲染完再读记录（观察者只读，不改任何行为）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "conn-typeahead-rail";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

// 三条注入连接：期望顺序 a(5 次) → c(2 次) → b(没记过)。
const CONN_A = "verify-rail-a@127.0.0.1";
const CONN_B = "verify-rail-b@127.0.0.1";
const CONN_C = "verify-rail-c@127.0.0.1";
const EXPECTED_CONNS = [CONN_A, CONN_B, CONN_C];

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;
const skippedNotes = [];

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
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

    // ── 1. 建 block（sysinfo 的 header 自带 ConnectionButton）─────────────────
    const blockKind = await client.evaluate(`(async () => {
        const global = await import("/frontend/app/store/global.ts");
        for (const view of ["sysinfo", "processviewer"]) {
            try {
                await global.createBlock({ meta: { view } }, false, false);
                return { ok: true, view };
            } catch (err) {
                // 试下一个
                void err;
            }
        }
        return { ok: false };
    })()`);
    if (blockKind?.ok !== true) {
        throw new Error("createBlock(sysinfo/processviewer) 都失败，没有可点开连接下拉的块");
    }
    reporter.log(`block created: view=${blockKind.view}`);

    const CONN_BUTTON_PROBE = `(() => {
        const hdr = document.querySelector('[data-role="block-header"]');
        if (hdr == null) return null;
        const icon = hdr.querySelector("i.fa-laptop, i.fa-arrow-right-arrow-left");
        const btn = icon ? icon.closest("div[title]") : null;
        if (btn == null) return null;
        const r = btn.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, title: btn.getAttribute("title") };
    })()`;
    const connButton = await waitForProbe(client, CONN_BUTTON_PROBE, (v) => v != null, { timeoutMs: 20000 });
    if (connButton == null) {
        throw new Error("20s 内没等到带 ConnectionButton 的块头（.fa-laptop / div[title]）");
    }
    reporter.check("conn-button-found", true, String(connButton.title).slice(0, 60));

    // ── 2. 注入三条假连接（写 verify profile 的 connections，不碰真实配置）────
    const inject = await client.evaluate(`(async () => {
        const api = await import("/frontend/app/store/wshclientapi.ts");
        const rpcutil = await import("/frontend/app/store/wshrpcutil.ts");
        const names = ${JSON.stringify(EXPECTED_CONNS)};
        for (const name of names) {
            await api.RpcApi.SetConnectionsConfigCommand(rpcutil.TabRpcClient, { host: name, metamaptype: {} });
        }
        return { ok: true, count: names.length };
    })()`);
    if (inject?.ok !== true) {
        throw new Error(`注入连接失败: ${JSON.stringify(inject)}`);
    }
    await sleep(800); // 等 config watcher 重载（ConnList 从 watcher 读）

    // ── 3. 注入使用计数（localStorage，模态打开时 loadConnUsage 会读它）────────
    await client.evaluate(`(() => {
        localStorage.setItem(
            "snorkeling:connUsage",
            JSON.stringify({ ${JSON.stringify(CONN_A)}: 5, ${JSON.stringify(CONN_C)}: 2 })
        );
        return true;
    })()`);
    reporter.log("usage injected: a=5, c=2, b=0");

    // ── 4. 装骨架观察者（骨架转瞬即逝，必须提前布点）────────────────────────
    await client.evaluate(`(() => {
        window.__vt = { sawSkeleton: false, skeletonRows: 0, sawSuggestion: false };
        const mo = new MutationObserver(() => {
            if (document.querySelector(".typeahead-skeleton") != null) {
                window.__vt.sawSkeleton = true;
                window.__vt.skeletonRows = Math.max(
                    window.__vt.skeletonRows,
                    document.querySelectorAll(".typeahead-skeleton-row").length
                );
            }
            if (document.querySelector(".suggestion-item") != null) {
                window.__vt.sawSuggestion = true;
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
        return true;
    })()`);
    await sleep(100);

    // ── 5. 点开连接下拉 ─────────────────────────────────────────────────────
    await client.click(connButton.x, connButton.y);
    reporter.log("connection button clicked");

    const ROWS_PROBE = `(() => {
        const modal = document.querySelector(".type-ahead-modal");
        if (modal == null) return null;
        const copies = Array.from(modal.querySelectorAll("[data-copy-conn]")).map((el) =>
            el.getAttribute("data-copy-conn")
        );
        return { copies, rows: modal.querySelectorAll(".suggestion-item").length };
    })()`;
    const rows = await waitForProbe(
        client,
        ROWS_PROBE,
        (v) =>
            v != null &&
            v.copies != null &&
            EXPECTED_CONNS.every((n) => v.copies.includes(n)),
        { timeoutMs: 15000, intervalMs: 200 }
    );
    if (rows == null) {
        await reporter.shot(client, "01-no-rows");
        throw new Error(`15s 内下拉没出现注入的连接行: ${JSON.stringify(rows)}`);
    }
    reporter.check("remote-rows-injected", true, `rows=${rows.rows} copies=${rows.copies.length}`);

    // 骨架必须出现过（打开 → suggestions 到位之间有 loading 帧）
    const vt = await client.evaluate("window.__vt");
    reporter.check(
        "skeleton-while-loading",
        vt?.sawSkeleton === true,
        `sawSkeleton=${vt?.sawSkeleton} rows=${vt?.skeletonRows}`
    );

    // ── 6. 行序：a(5) < c(2) < b(0) ─────────────────────────────────────────
    const idxA = rows.copies.indexOf(CONN_A);
    const idxB = rows.copies.indexOf(CONN_B);
    const idxC = rows.copies.indexOf(CONN_C);
    reporter.check(
        "usage-sort-order",
        idxA >= 0 && idxB >= 0 && idxC >= 0 && idxA < idxC && idxC < idxB,
        `a@${idxA} c@${idxC} b@${idxB}（期望 a < c < b）`
    );

    // ── 7. 右栏几何：右边缘极差 + 贴边 ──────────────────────────────────────
    const GEOM_PROBE = `(() => {
        const modal = document.querySelector(".type-ahead-modal");
        if (modal == null) return null;
        const mr = modal.getBoundingClientRect();
        const rails = Array.from(modal.querySelectorAll(".typeahead-item-rail"));
        const items = rails.map((rail) => {
            const r = rail.getBoundingClientRect();
            const row = rail.closest(".suggestion-item").getBoundingClientRect();
            return {
                right: r.x + r.width,
                rowH: row.height,
                copyOpacity: getComputedStyle(rail.querySelector(".typeahead-row-copy") ?? rail).opacity,
            };
        });
        return { modalRight: mr.x + mr.width, modalW: mr.width, rails: items };
    })()`;
    const geom = await client.evaluate(GEOM_PROBE);
    if (geom == null || geom.rails.length === 0) {
        throw new Error("没有可测的 .typeahead-item-rail");
    }
    const rights = geom.rails.map((r) => r.right);
    const spread = Math.max(...rights) - Math.min(...rights);
    reporter.check("rail-right-align", spread <= 1, `右边缘极差 ${spread.toFixed(2)}px（≤1px）`);

    // 上界 24 = modal border 1 + modal padding 6 + 行 padding 8（+ 容忍列表溢出时的滚动条）。
    // 真正要抓的病是「图标贴在文字后面」（偏离可达 50~150px）。
    const hug = geom.modalRight - Math.max(...rights);
    reporter.check(
        "rail-hugs-modal-right",
        hug >= 8 && hug <= 24,
        `modalRight-右栏=${hug.toFixed(2)}px（8~24，居中偏左的旧布局会是 50+）`
    );

    // ── 8. hover 一键复制（选一个未选中的远程行）───────────────────────────
    const TARGET_PROBE = `(() => {
        const modal = document.querySelector(".type-ahead-modal");
        const slot = modal?.querySelector(${JSON.stringify(`[data-copy-conn="${CONN_B}"]`)});
        if (slot == null) return null;
        const row = slot.closest(".suggestion-item");
        const rr = row.getBoundingClientRect();
        const sr = slot.getBoundingClientRect();
        const btn = slot.querySelector("button.copy-button");
        const br = btn ? btn.getBoundingClientRect() : null;
        return {
            rowX: rr.x, rowY: rr.y, rowW: rr.width, rowH: rr.height,
            rowCX: rr.x + rr.width / 2, rowCY: rr.y + rr.height / 2,
            copyOpacity: getComputedStyle(slot).opacity,
            copyW: sr.width,
            btnCX: br ? br.x + br.width / 2 : null,
            btnCY: br ? br.y + br.height / 2 : null,
            copied: btn ? btn.classList.contains("copied") : false,
        };
    })()`;
    const before = await client.evaluate(TARGET_PROBE);
    if (before == null) throw new Error(`没找到 ${CONN_B} 的复制槽`);
    reporter.check("copy-hidden-until-hover", Number(before.copyOpacity) === 0, `opacity=${before.copyOpacity}`);

    // 真实指针 hover 行中心
    await client.move(before.rowCX, before.rowCY);
    await sleep(300);
    const during = await client.evaluate(TARGET_PROBE);
    reporter.check("copy-visible-on-hover", Number(during.copyOpacity) >= 0.6, `opacity=${during.copyOpacity}`);

    const dh = Math.abs(during.rowH - before.rowH);
    reporter.check("hover-no-layout-shift", dh === 0, `hover 前后行高差 ${dh.toFixed(2)}px`);
    await reporter.shot(client, "02-hover-copy");

    // ── 9. 点复制 → copied 反馈（+ 可用则校验剪贴板文本）────────────────────
    await client.click(during.btnCX, during.btnCY);
    await sleep(400);
    const afterClick = await client.evaluate(TARGET_PROBE);
    reporter.check("copy-click-feedback", afterClick.copied === true, `copied=${afterClick.copied}`);
    await reporter.shot(client, "03-copied");

    const clip = await client.evaluate(`(async () => {
        try {
            const text = await navigator.clipboard.readText();
            return { ok: true, text };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err).slice(0, 120) };
        }
    })()`);
    if (clip?.ok === true) {
        reporter.check("clipboard-content", clip.text === CONN_B, `剪贴板=${JSON.stringify(clip.text)}`);
    } else {
        reporter.check(
            "clipboard-content",
            true,
            "skipped：环境不给剪贴板读权限（复制内容断言走单测 conntypeahead.test.tsx）"
        );
        skippedNotes.push("clipboard-content：无剪贴板读权限，文本相等断言由单测覆盖");
    }

    reporter.finish({
        skipped: [
            ...skippedNotes,
            "本机真实 ssh-config 连接的行序（只断言注入连接的相对顺序）",
            "同次数 tie-break（display:order → 原序）走单测 conn-usage.test.ts",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
