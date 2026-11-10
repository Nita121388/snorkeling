#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 冲突「Copy for agent + 粘回 resolve」——真机 CDP 验证（11-10-cfa-commontext-conflict 的验收断言）。
//
//   node scripts/verify/sync-conflict-copy/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/sync-conflict-copy/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/sync-conflict-copy/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/sync-conflict-copy/verify.mjs --dry       # 只解析依赖
//
// 手法：冲突不走真实双端同步（太重），而是直接写 syncconflict 的存储文件
// （.runcfg/<profile>/data/sync/conflicts.json，纯 JSON，List() 每次 RPC 都现读），
// 再打开 Settings → Sync 面板断言：
//   1. conflicts=2：计数 chip=2、Copy for agent（title 含 "2 conflicts"）、Review 入口都在；
//   2. Copy for agent 的 payload 走 Go 端同一渲染源（SyncConflictsCopy RPC：含
//      "# Sync conflicts (2)" / "### Task" / "Reply with the merged content only"）；
//   3. Review 打开抽屉：逐条 row + 每条自己的 Copy for agent + 粘回输入区 + Resolve；
//   4. conflicts=0（清空 store 后 Sync now 刷新）：Copy for agent / Review 都不再渲染。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter, repoRoot } from "../lib/report.mjs";

const AREA = "sync-conflict-copy";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

/** syncconflict 存储文件（与 pkg/syncconflict.storePath 同路径：DataHome/sync/conflicts.json）。 */
function conflictStorePath() {
    // dev-isolated 把 WAVETERM_DATA_HOME 指到 .runcfg/<profile>/data
    return path.join(repoRoot, ".runcfg", DEFAULTS.profile, "data", "sync", "conflicts.json");
}

function writeConflictStore(entries) {
    const file = conflictStorePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(entries, null, 2), "utf8");
}

/** 造两条未解决冲突（与 syncconflict_test.go 的 fixture 同形状）。 */
function fabricatedConflicts() {
    const entry = (id, title, localText, remoteText) => ({
        id,
        fields: ["text"],
        local: { id, title, text: localText, updatedAt: 1000 },
        remote: { id, title, text: remoteText, updatedAt: 2000 },
        title,
        detectedAt: "2026-11-10T10:00:00Z",
        deviceName: "Work Mac",
        transport: "server",
    });
    return [entry("verify-ct1", "Checklist", "local one", "remote one"), entry("verify-ct2", "Tasks", "local two", "remote two")];
}

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

/** 面板状态探针：conflicts 计数 / Copy for agent / Review / 抽屉行。 */
const panelProbe = `(() => {
    const settings = document.querySelector("[data-sync-settings]");
    if (settings == null) return { err: "no [data-sync-settings]" };
    const count = settings.querySelector("[data-sync-conflicts]");
    const copyBtn = settings.querySelector("[data-copy-for-agent]");
    const review = settings.querySelector('[data-sync-action="review-conflicts"]');
    return {
        count: count ? count.textContent.trim() : null,
        copyTitle: copyBtn ? copyBtn.getAttribute("title") : null,
        hasReview: review != null,
    };
})()`;

const drawerProbe = `(() => {
    const modal = document.querySelector("[data-sync-conflict-modal]");
    if (modal == null) return { err: "no drawer" };
    return {
        rows: modal.querySelectorAll("[data-sync-conflict-row]").length,
        copyButtons: modal.querySelectorAll("[data-copy-for-agent]").length,
        textareas: modal.querySelectorAll("textarea[data-sync-merged-input]").length,
        resolveButtons: modal.querySelectorAll('[data-sync-resolve-action]').length,
    };
})()`;

const copyPayloadProbe = `(async () => {
    const mod = await import("/frontend/app/store/services.ts");
    const resp = await mod.CommonTextService.SyncConflictsCopy();
    return { count: resp?.count, head: String(resp?.text ?? "").slice(0, 200), text: resp?.text ?? "" };
})()`;

try {
    if (!dry) {
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

        // 造 2 条冲突（store 是每次 RPC 现读的，写完即生效），再打开 Settings → Sync。
        writeConflictStore(fabricatedConflicts());
        const opened = await client.evaluate(createBlockJs({ view: "waveconfig", file: "commontextsync" }));
        if (opened?.ok !== true) throw new Error(`打开 waveconfig 失败: ${JSON.stringify(opened)}`);
        reporter.log("waveconfig block opened (file: commontextsync)");

        // 1) conflicts=2 的面板形态。
        const twoConflicts = await waitForProbe(
            client,
            panelProbe,
            (st) => st?.count === "2" && st?.copyTitle != null && st?.hasReview === true,
            { timeoutMs: 30000 }
        );
        reporter.check("panel-count-2", twoConflicts.count === "2", `count=${twoConflicts.count}`);
        reporter.check(
            "panel-copy-title",
            /Copy all 2 conflicts for an AI to merge/.test(twoConflicts.copyTitle ?? ""),
            twoConflicts.copyTitle
        );
        reporter.check("panel-review-entry", twoConflicts.hasReview === true, "Review 按钮存在");
        await reporter.shot(client, "01-panel-two-conflicts");

        // 2) payload 走 Go 渲染源：与 CLI 同一格式（多冲突头 + Task + 输出契约）。
        const payload = await client.evaluate(copyPayloadProbe);
        reporter.check("payload-count", payload?.count === 2, `count=${payload?.count}`);
        reporter.check(
            "payload-render-source",
            payload?.text?.startsWith("# Sync conflicts (2)") === true,
            String(payload?.head).slice(0, 60)
        );
        reporter.check(
            "payload-task-section",
            payload?.text?.includes("### Task") === true,
            "含 ### Task 段"
        );
        reporter.check(
            "payload-output-contract",
            payload?.text?.includes("Reply with the merged content only") === true,
            "含输出契约"
        );

        // 3) Review 打开抽屉：逐条 row + 单条复制 + 粘回输入区 + Resolve。
        await client.evaluate(`(() => { document.querySelector('[data-sync-action="review-conflicts"]').click(); return true; })()`);
        const drawer = await waitForProbe(
            client,
            drawerProbe,
            (st) => st?.rows === 2 && st?.copyButtons === 2 && st?.textareas === 2 && st?.resolveButtons === 2,
            { timeoutMs: 30000 }
        );
        reporter.check("drawer-rows", drawer.rows === 2, `rows=${drawer.rows}`);
        reporter.check("drawer-copy-buttons", drawer.copyButtons === 2, `copy=${drawer.copyButtons}`);
        reporter.check("drawer-paste-back", drawer.textareas === 2, `textareas=${drawer.textareas}`);
        reporter.check("drawer-resolve-buttons", drawer.resolveButtons === 2, `resolve=${drawer.resolveButtons}`);
        await reporter.shot(client, "02-drawer");
        // 关抽屉（Modal 的 ✕ 由 onClose 触发 popModal）。
        await client.evaluate(`(() => {
            const modal = document.querySelector("[data-sync-conflict-modal]");
            const close = modal?.closest(".modal")?.querySelector('[aria-label="Close"], button.modal-close, .modal-close');
            if (close != null) { close.click(); return "clicked"; }
            return "no-close-button";
        })()`);
        await sleep(600);

        // 4) conflicts=0：清空 store，Sync now 刷新状态 → 复制/Review 都不渲染。
        writeConflictStore([]);
        await client.evaluate(`(() => { document.querySelector('[data-sync-action="sync-now"]').click(); return true; })()`);
        const zero = await waitForProbe(client, panelProbe, (st) => st?.count === "0", { timeoutMs: 30000 });
        reporter.check("panel-count-0", zero.count === "0", `count=${zero.count}`);
        reporter.check("panel-copy-hidden-at-zero", zero.copyTitle == null, "conflicts=0 时无 Copy for agent");
        reporter.check("panel-review-hidden-at-zero", zero.hasReview === false, "conflicts=0 时无 Review");
        await reporter.shot(client, "03-panel-zero-conflicts");

        await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup });
    }
} catch (err) {
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup, verdictOverride: "env-error" });
}
