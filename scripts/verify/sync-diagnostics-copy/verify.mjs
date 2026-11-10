#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 同步诊断复制：失败态 / 服务端不可达 / 协议不兼容 —— 真机 CDP 验证
// （11-10-cfa-sync-diagnostics 的验收断言）。
//
//   node scripts/verify/sync-diagnostics-copy/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/sync-diagnostics-copy/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/sync-diagnostics-copy/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/sync-diagnostics-copy/verify.mjs --dry       # 只解析依赖
//
// 场景（全部走真实 RPC + 真实渲染，不 mock）：
//   1. 默认 none：SyncProbe 非 server 短路（无 probe）、面板无 Sync server 行、
//      Last sync 无错误时无复制按钮；
//   2. 改成 server + 不可达 URL：Sync server 行出现，Check 后复制按钮出现，
//      剪贴板 payload 含 checks / fix / Task / Output contract；
//   3. 改成 folder + 写入必失败路径：Sync now 触发失败 → Last sync 行出现复制按钮，
//      payload 含 last error / recent events / Task / Output contract；
//   4. SyncJournalTail n 上限：n=5000 仍 ≤ 100。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "sync-diagnostics-copy";
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

function createBlockJs(meta) {
    return `(async () => {
        const mod = await import("/frontend/app/store/global.ts");
        if (typeof mod.createBlock !== "function") return { ok: false, err: "no createBlock" };
        await mod.createBlock({ meta: ${JSON.stringify(meta)} }, false, false);
        return { ok: true };
    })()`;
}

/** 写 settings（走面板同一个 RPC）。 */
function setSettingsJs(patch) {
    return `(async () => {
        const api = await import("/frontend/app/store/wshclientapi.ts");
        const util = await import("/frontend/app/store/wshrpcutil.ts");
        await api.RpcApi.SetConfigCommand(util.TabRpcClient, ${JSON.stringify(patch)});
        return true;
    })()`;
}

/** 拦截剪贴板写入：e2e 里比读系统剪贴板可靠（无权限问题，也不依赖焦点）。 */
const captureClipboardJs = `(() => {
    window.__cfaCaptured = null;
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (t) => { window.__cfaCaptured = String(t); } },
    });
    return true;
})()`;

const panelProbe = `(() => {
    const settings = document.querySelector("[data-sync-settings]");
    if (settings == null) return { err: "no [data-sync-settings]" };
    const serverRow = settings.querySelector('[data-sync-row="status-server"]');
    const lastRow = settings.querySelector('[data-sync-row="status-last"]');
    return {
        hasServerRow: serverRow != null,
        probeButton: settings.querySelector('[data-sync-action="probe-server"]') != null,
        serverCopy: serverRow ? serverRow.querySelector("[data-copy-for-agent]") != null : false,
        lastCopy: lastRow ? lastRow.querySelector("[data-copy-for-agent]") != null : false,
        lastDescription: lastRow ? lastRow.textContent : "",
    };
})()`;

const probeRpc = `(async () => {
    const svc = await import("/frontend/app/store/services.ts");
    const resp = await svc.CommonTextService.SyncProbe();
    return { transport: resp?.transport, hasProbe: resp?.probe != null, protocol: resp?.clientProtocolVersion };
})()`;

function clickJs(selector) {
    return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el == null) return false; el.click(); return true; })()`;
}

function capturedJs() {
    return `(() => window.__cfaCaptured || "")()`;
}

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

        // ── 1. 默认 none：RPC 短路 + 面板无 server 行 / 无失败复制 ─────────────
        const probe0 = await client.evaluate(probeRpc);
        reporter.check("probe-non-server-short-circuit", probe0?.hasProbe === false, `transport=${probe0?.transport}`);
        reporter.check("probe-reports-protocol", typeof probe0?.protocol === "number", `protocol=${probe0?.protocol}`);

        const opened = await client.evaluate(createBlockJs({ view: "waveconfig", file: "commontextsync" }));
        if (opened?.ok !== true) throw new Error(`打开 waveconfig 失败: ${JSON.stringify(opened)}`);
        const st0 = await waitForProbe(client, panelProbe, (st) => st?.hasServerRow === false && st?.lastCopy === false, {
            timeoutMs: 30000,
        });
        reporter.check("no-server-row-for-none", st0.hasServerRow === false, "none 传输无 Sync server 行");
        reporter.check("no-failure-copy-when-healthy", st0.lastCopy === false, "Last sync 无错误时无复制按钮");
        await reporter.shot(client, "01-default-none");

        // ── 2. server + 不可达 URL：Check → 复制 payload 证据 ─────────────────
        await client.evaluate(
            setSettingsJs({
                "commontext:sync:transport": "server",
                "commontext:sync:server:url": "https://127.0.0.1:9/",
                "commontext:sync:server:allowinsecure": true,
            })
        );
        const stServer = await waitForProbe(client, panelProbe, (st) => st?.hasServerRow === true, { timeoutMs: 30000 });
        reporter.check("server-row-appears", stServer.hasServerRow === true, "server 传输出现 Sync server 行");
        reporter.check("probe-button-present", stServer.probeButton === true, "Check 按钮存在");
        reporter.check("no-copy-before-probe", stServer.serverCopy === false, "未探测前不摆必然失败的复制按钮");

        await client.evaluate(clickJs('[data-sync-action="probe-server"]'));
        const stProbe = await waitForProbe(client, panelProbe, (st) => st?.serverCopy === true, { timeoutMs: 45000 });
        reporter.check("copy-after-failed-probe", stProbe.serverCopy === true, "不可达探测后复制按钮出现");
        await reporter.shot(client, "02-server-unreachable");

        await client.evaluate(captureClipboardJs);
        await client.evaluate(clickJs('[data-sync-row="status-server"] [data-copy-for-agent]'));
        let payload = "";
        for (let i = 0; i < 20 && payload === ""; i++) {
            payload = await client.evaluate(capturedJs());
            if (payload === "") await new Promise((r) => setTimeout(r, 300));
        }
        reporter.check("probe-payload-checks", payload.includes("checks:"), "含 checks 段");
        reporter.check("probe-payload-fix", payload.includes("fix:"), "含 fix 行");
        reporter.check("probe-payload-task", payload.includes("### Task"), "含 Task 段");
        reporter.check("probe-payload-contract", payload.includes("### Output contract"), "含 Output contract 段");
        reporter.check("probe-payload-protocol", payload.includes("client protocol version:"), "含客户端协议版本");

        // ── 3. folder + 必失败路径：Sync now → 失败复制 ───────────────────────
        // 先播种 1 条 item：空 item 集的 run 会直接成功（无 push 无写盘），失败态永远出不来。
        await client.evaluate(
            setSettingsJs({
                "commontext:items": [
                    { id: "verify-item-1", title: "Verify", text: "verify payload", tags: [], pinned: false },
                ],
            })
        );
        await client.evaluate(
            setSettingsJs({
                "commontext:sync:transport": "folder",
                // /etc/hosts 是文件：在其下 mkdir 必 ENOTDIR → 写 payload 必失败。
                "commontext:sync:folder:path": "/etc/hosts/verify/commontext.json",
            })
        );
        await waitForProbe(client, panelProbe, (st) => st?.hasServerRow === false, { timeoutMs: 30000 });
        await client.evaluate(clickJs('[data-sync-action="sync-now"]'));
        const stFail = await waitForProbe(client, panelProbe, (st) => st?.lastCopy === true, { timeoutMs: 60000 });
        if (stFail?.lastCopy !== true) {
            const dbg = await client.evaluate(`(async () => {
                const svc = await import("/frontend/app/store/services.ts");
                const st = await svc.CommonTextService.SyncStatus();
                const panel = document.querySelector('[data-sync-row="status-last"]');
                const j = await svc.CommonTextService.SyncJournalTail({ n: 10 });
                const items = await svc.CommonTextService.List({ limit: 10 });
                return { lastError: st?.status?.lastError, transport: st?.status?.transport, rowText: panel?.textContent ?? null, events: j?.lines ?? [], itemCount: items?.items?.length ?? 0 };
            })()`);
            reporter.log(`DEBUG after failed run: ${JSON.stringify(dbg)}`);
        }
        reporter.check("failure-copy-appears", stFail.lastCopy === true, "失败后 Last sync 行复制按钮出现");
        await client.evaluate(captureClipboardJs);
        await client.evaluate(clickJs('[data-sync-row="status-last"] [data-copy-for-agent]'));
        payload = "";
        for (let i = 0; i < 20 && payload === ""; i++) {
            payload = await client.evaluate(capturedJs());
            if (payload === "") await new Promise((r) => setTimeout(r, 300));
        }
        reporter.check("failure-payload-error", payload.includes("last error:"), "含 last error");
        reporter.check("failure-payload-events", payload.includes("recent events ("), "含事件段");
        reporter.check("failure-payload-task", payload.includes("### Task"), "含 Task 段");
        reporter.check("failure-payload-contract", payload.includes("### Output contract"), "含 Output contract 段");
        await reporter.shot(client, "03-last-sync-failed");

        // ── 4. JournalTail 上限 ───────────────────────────────────────────────
        const tailBig = await client.evaluate(`(async () => {
            const svc = await import("/frontend/app/store/services.ts");
            const resp = await svc.CommonTextService.SyncJournalTail({ n: 5000 });
            return { n: resp?.n, lines: resp?.lines ?? [] };
        })()`);
        reporter.check("journal-tail-clamped", typeof tailBig?.n === "number" && tailBig.n <= 100, `n=${tailBig?.n}`);
        reporter.check(
            "journal-tail-cli-format",
            (tailBig?.lines ?? []).every((line) => /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}  /.test(line)),
            (tailBig?.lines ?? [])[0] ?? "(no events)"
        );

        await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup });
    }
} catch (err) {
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup, verdictOverride: "env-error" });
}
