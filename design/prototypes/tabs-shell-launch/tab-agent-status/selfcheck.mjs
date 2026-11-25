// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab Agent Status prototype self-check.
// Exit: 0 all pass / 1 assertion failure / 2 environment error.
// Usage: node design/prototypes/tabs-shell-launch/tab-agent-status/selfcheck.mjs [--keep-open]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectToTarget, listPageTargets, waitFor } from "../../../../scripts/verify/lib/cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const pageUrl = `${pathToFileURL(path.join(here, "index.html")).href}?fresh=1`;
const runDir = path.join(repoRoot, "verify-runs", "prototype-tab-agent-status");
const PORT = Number(process.env.PROTO_CDP_PORT || (9600 + (process.pid % 1000)));
const keepOpen = process.argv.includes("--keep-open");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function browserExe() {
    return process.env.PROTO_BROWSER || (process.platform === "win32" ? EDGE : "google-chrome");
}

function launchBrowser() {
    const args = [
        "--headless=new",
        `--remote-debugging-port=${PORT}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--force-device-scale-factor=1",
        "--window-size=1440,2200",
        `--user-data-dir=${path.join(repoRoot, "tmp", "proto-selfcheck", String(PORT))}`,
        pageUrl,
    ];
    const child = spawn(browserExe(), args, { stdio: "ignore", windowsHide: true, detached: false });
    child.on("error", () => {});
    return child;
}

async function waitForEndpoint(deadlineMs = 20000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        try {
            const pages = await listPageTargets(`http://127.0.0.1:${PORT}`);
            const hit = pages.find((page) => /tab-agent-status\/index\.html/.test(page.url ?? ""));
            if (hit != null) return hit;
        } catch {
            // browser not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
}

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
}

async function clickScheme(client, scheme) {
    await client.evaluate(`document.querySelector('[data-scheme="${scheme}"]').click()`);
    await waitFor(client, `document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]')?.classList.contains('scheme-${scheme}') === true`, {
        timeoutMs: 4000,
        label: `scheme ${scheme}`,
    });
}

async function setRange(client, id, value) {
    await client.evaluate(`(() => { const el = document.getElementById('${id}'); el.value = '${value}'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}

async function main() {
    mkdirSync(runDir, { recursive: true });
    let child = null;
    let client = null;
    try {
        child = launchBrowser();
        const target = await waitForEndpoint();
        if (target == null) {
            console.error(`✗ 环境错误：CDP ${PORT} 上没有加载到原型页。`);
            process.exit(2);
        }
        client = await connectToTarget(`http://127.0.0.1:${PORT}`, target);
        await waitFor(client, `document.readyState === 'complete' && document.querySelectorAll('#tabbar .tab').length === 3`, {
            timeoutMs: 15000,
            label: "prototype ready",
        });

        const initial = await client.evaluate(`(() => ({
            scheme: document.querySelector('#tabbar .tab.active')?.className,
            tabs: document.querySelectorAll('#tabbar .tab').length,
            ledger: document.querySelectorAll('#ledger .ledger-row').length,
            compare: document.querySelectorAll('[data-compare-scheme]').length,
            schemes: document.querySelectorAll('[data-scheme]').length,
            theme: document.documentElement.dataset.theme,
        }))()`);
        check("初始为 G 状态轨 + 头像", initial?.scheme?.includes("scheme-G") === true, JSON.stringify(initial));
        check("三个 Workspace Tab", initial?.tabs === 3, String(initial?.tabs));
        check("默认 8 个 Agent 全部进入清单", initial?.ledger === 8, String(initial?.ledger));
        check("七个方案按钮与七张对比卡", initial?.schemes === 7 && initial?.compare === 7, JSON.stringify(initial));
        check("默认深色主题", initial?.theme === "dark", initial?.theme);

        await client.evaluate(`document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 150 }))`);
        await waitFor(client, `document.getElementById('tab-context-menu').hidden === false`, { timeoutMs: 4000, label: "context menu open" });
        const menu = await client.evaluate(`(() => {
            const box = document.getElementById('tab-context-menu').getBoundingClientRect();
            return { schemes: document.querySelectorAll('[data-menu-scheme]').length, widths: document.querySelectorAll('[data-menu-width]').length, actions: document.querySelectorAll('[data-menu-action]').length, insideViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
        })()`);
        check("右键菜单：9 个编码选项 + 2 个宽度选项", menu?.schemes === 9 && menu?.widths === 2, JSON.stringify(menu));
        check("右键菜单：保留重命名 / 复制 / 恢复 / 收起 / 关闭", menu?.actions === 5, JSON.stringify(menu));
        check("右键菜单：不溢出视口", menu?.insideViewport === true, JSON.stringify(menu));
        writeFileSync(path.join(runDir, "context-menu-open.png"), (await client.screenshot({ x: 0, y: 0, width: 1440, height: 2200 })).buffer);

        await client.evaluate(`document.querySelector('[data-menu-scheme="B"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-B') === true && document.getElementById('tab-context-menu').hidden === true`, { timeoutMs: 4000, label: "menu choose B" });
        const persisted = await client.evaluate(`JSON.parse(localStorage.getItem('snorkeling:prototype:tab-agent-status') ?? '{}').scheme`);
        check("右键菜单：选择 B 立即生效并保存", persisted === "B", String(persisted));

        await client.evaluate(`document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 150 }))`);
        await waitFor(client, `document.getElementById('tab-context-menu').hidden === false`, { timeoutMs: 4000, label: "menu reopen" });
        await client.evaluate(`document.querySelector('[data-menu-scheme="off"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-off') === true && document.getElementById('metric-visible').textContent === '0'`, { timeoutMs: 4000, label: "menu off" });
        const off = await client.evaluate(`({ visible: Number(document.getElementById('metric-visible').textContent), badges: document.querySelector('#tabbar .tab.active .tab-badges').children.length })`);
        check("右键菜单：关闭后 Tab 无状态标记", off?.visible === 0 && off?.badges === 0, JSON.stringify(off));

        await client.evaluate(`document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 150 }))`);
        await waitFor(client, `document.getElementById('tab-context-menu').hidden === false`, { timeoutMs: 4000, label: "menu reopen attention" });
        await client.evaluate(`document.querySelector('[data-menu-scheme="attention"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-attention') === true`, { timeoutMs: 4000, label: "menu attention" });
        const attention = await client.evaluate(`({ legacy: document.querySelectorAll('#tabbar .tab.active .legacy-status').length, working: document.querySelectorAll('#tabbar .tab.active .state-working').length })`);
        check("右键菜单：仅提醒显示未阅状态且不显示 working", attention?.legacy > 0 && attention?.working === 0, JSON.stringify(attention));

        await client.evaluate(`document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 150 }))`);
        await waitFor(client, `document.getElementById('tab-context-menu').hidden === false`, { timeoutMs: 4000, label: "menu reopen G" });
        await client.evaluate(`document.querySelector('[data-menu-scheme="G"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-G') === true`, { timeoutMs: 4000, label: "menu G" });

        await clickScheme(client, "A");
        const a = await client.evaluate(`(() => {
            const b = document.querySelector('#tabbar .tab.active .tab-badges');
            return { chips: b.querySelectorAll('.summary-chip').length, visible: Number(b.dataset.visibleAgents), hidden: Number(b.dataset.hiddenAgents), ledger: document.querySelectorAll('#ledger .ledger-row').length };
        })()`);
        check("A：渲染聚合计数 chip", a?.chips > 0, JSON.stringify(a));
        check("A：8 个 Agent 的可见 + 溢出守恒", a?.visible + a?.hidden === 8, JSON.stringify(a));
        check("A：溢出 Agent 仍完整保留在清单", a?.ledger === 8, String(a?.ledger));

        await clickScheme(client, "B");
        const b = await client.evaluate(`(() => {
            const box = document.querySelector('#tabbar .tab.active .tab-badges');
            return { tokens: box.querySelectorAll('.agent-token').length, overflow: box.querySelector('.token-overflow')?.textContent.trim(), hidden: Number(box.dataset.hiddenAgents) };
        })()`);
        check("B：130px 下常驻 3 个头像", b?.tokens === 3, JSON.stringify(b));
        check("B：剩余 Agent 显示 +5", b?.overflow === "+5" && b?.hidden === 5, JSON.stringify(b));

        await clickScheme(client, "C");
        const c = await client.evaluate(`(() => ({
            segments: document.querySelectorAll('#tabbar .tab.active .rail-segment').length,
            count: document.querySelector('#tabbar .tab.active .rail-count')?.textContent.trim(),
        }))()`);
        check("C：一个 Agent 一段状态轨", c?.segments === 8, JSON.stringify(c));
        check("C：状态轨显示总数 8", c?.count === "8", c?.count);

        await clickScheme(client, "G");
        const g = await client.evaluate(`(() => {
            const tab = document.querySelector('#tabbar .tab.active');
            const box = tab.querySelector('.tab-badges');
            return { tokens: box.querySelectorAll('.agent-token').length, overflow: box.querySelector('.token-overflow')?.textContent.trim(), segments: tab.querySelectorAll('.rail-segment').length, nameWidth: Math.round(tab.querySelector('.name').getBoundingClientRect().width), policyEnabled: !document.querySelector('[data-width-policy="fixed"]').disabled };
        })()`);
        check("G：状态轨覆盖全部 8 个 Agent", g?.segments === 8, JSON.stringify(g));
        check("G：130px 固定宽度下显示 2 个头像 + +6", g?.tokens === 2 && g?.overflow === "+6", JSON.stringify(g));
        check("G：Tab 名称仍有可见宽度", g?.nameWidth > 0, JSON.stringify(g));
        check("G：宽度策略仅对 G 启用", g?.policyEnabled === true, JSON.stringify(g));

        await client.evaluate(`document.querySelector('[data-width-policy="elastic"]').click()`);
        await waitFor(client, `document.getElementById('width-output').textContent === '160px' && document.getElementById('width-range').max === '180'`, { timeoutMs: 4000, label: "elastic width" });
        const gElastic = await client.evaluate(`(() => {
            const tab = document.querySelector('#tabbar .tab.active');
            const box = tab.querySelector('.tab-badges');
            return { width: Math.round(tab.getBoundingClientRect().width), tokens: box.querySelectorAll('.agent-token').length, overflow: box.querySelector('.token-overflow')?.textContent.trim(), segments: tab.querySelectorAll('.rail-segment').length };
        })()`);
        check("G：放宽策略把上限放到 180px", gElastic?.width === 160, JSON.stringify(gElastic));
        check("G：160px 下显示 5 个头像 + +3", gElastic?.tokens === 5 && gElastic?.overflow === "+3", JSON.stringify(gElastic));
        check("G：放宽后状态轨仍覆盖全部 Agent", gElastic?.segments === 8, JSON.stringify(gElastic));
        await client.evaluate(`document.querySelector('[data-width-policy="fixed"]').click()`);
        await waitFor(client, `document.getElementById('width-output').textContent === '130px'`, { timeoutMs: 4000, label: "fixed width" });

        await clickScheme(client, "D");
        await client.evaluate(`document.querySelector('#tabbar .tab[data-tab-id="snorkeling"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))`);
        await waitFor(client, `document.getElementById('tab-roster').hidden === false`, { timeoutMs: 4000, label: "roster open" });
        const d = await client.evaluate(`(() => ({
            rows: document.querySelectorAll('#tab-roster .roster-row').length,
            trigger: document.querySelectorAll('#tabbar .tab.active [data-roster-trigger]').length,
            recommended: document.getElementById('stage-badge').textContent.trim(),
        }))()`);
        check("D：悬浮卡列出全部 8 个 Agent", d?.rows === 8, JSON.stringify(d));
        check("D：Tab 上有清单入口", d?.trigger === 1, String(d?.trigger));
        check("D：主舞台显示方案 D", d?.recommended === "方案 D", d?.recommended);

        await client.evaluate(`document.querySelector('#tab-roster [data-ack-agent="a4"]').click()`);
        await waitFor(client, `document.querySelector('#tab-roster [data-agent-row="a4"] .status-pill')?.classList.contains('is-seen') === true`, {
            timeoutMs: 4000,
            label: "ack done",
        });
        const ack = await client.evaluate(`(() => ({
            rosterSeen: document.querySelector('#tab-roster [data-agent-row="a4"] .status-pill')?.classList.contains('is-seen'),
            ledgerSeen: document.querySelector('#ledger [data-agent-row="a4"] .status-pill')?.classList.contains('is-seen'),
            rowStillExists: document.querySelector('#ledger [data-agent-row="a4"]') != null,
        }))()`);
        check("D：ack 后 Agent 行仍然存在", ack?.rowStillExists === true, JSON.stringify(ack));
        check("D：ack 状态同步到悬浮卡和总清单", ack?.rosterSeen === true && ack?.ledgerSeen === true, JSON.stringify(ack));

        await clickScheme(client, "E");
        const e = await client.evaluate(`(() => {
            const active = document.querySelector('#tabbar .tab.active');
            const inactive = document.querySelector('#tabbar .tab:not(.active)');
            return { expanded: active.classList.contains('expanded'), activeWidth: active.getBoundingClientRect().width, inactiveWidth: inactive.getBoundingClientRect().width, row: active.querySelectorAll('.expanded-agent-row').length };
        })()`);
        check("E：激活 Tab 展开第二行", e?.expanded === true && e?.row === 1, JSON.stringify(e));
        check("E：激活 Tab 比非激活 Tab 宽", e?.activeWidth > e?.inactiveWidth, JSON.stringify(e));

        await clickScheme(client, "F");
        const f = await client.evaluate(`(() => {
            const box = document.querySelector('#tabbar .tab.active .tab-badges');
            return { chips: box.querySelectorAll('.full-chip').length, clientWidth: box.clientWidth, scrollWidth: box.scrollWidth, metricHidden: Number(document.getElementById('metric-hidden').textContent) };
        })()`);
        check("F：渲染 8 个完整 chip", f?.chips === 8, JSON.stringify(f));
        check("F：130px 下真实发生溢出", f?.scrollWidth > f?.clientWidth || f?.metricHidden > 0, JSON.stringify(f));

        await clickScheme(client, "D");
        await setRange(client, "width-range", 100);
        await waitFor(client, `document.getElementById('metric-width').textContent === '100px'`, { timeoutMs: 4000, label: "100px width" });
        const narrow = await client.evaluate(`(() => {
            const tab = document.querySelector('#tabbar .tab.active');
            const name = tab.querySelector('.name').getBoundingClientRect();
            const badges = tab.querySelector('.tab-badges').getBoundingClientRect();
            const close = tab.querySelector('.close').getBoundingClientRect();
            const rect = tab.getBoundingClientRect();
            return { nameBadgesGap: badges.left - name.right, badgesCloseGap: close.left - badges.right, closeInside: close.right <= rect.right + 1, overlap: document.getElementById('metric-overlap').textContent.trim() };
        })()`);
        check("D：100px 下名称与状态不重叠", narrow?.nameBadgesGap >= -1, JSON.stringify(narrow));
        check("D：100px 下状态与关闭按钮不重叠", narrow?.badgesCloseGap >= -1 && narrow?.closeInside === true, JSON.stringify(narrow));
        check("D：实测报告无重叠", narrow?.overlap === "无重叠", narrow?.overlap);

        await client.evaluate(`document.querySelector('[data-orientation="vertical"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar').classList.contains('vertical') === true`, { timeoutMs: 4000, label: "vertical tabs" });
        const vertical = await client.evaluate(`(() => {
            const bar = document.querySelector('#tabbar');
            const tab = bar.querySelector('.tab.active');
            return { orientation: bar.getAttribute('aria-orientation'), barWidth: Math.round(bar.getBoundingClientRect().width), tabWidth: Math.round(tab.getBoundingClientRect().width), mode: document.getElementById('window-mode').textContent.trim() };
        })()`);
        check("垂直布局：Tab 栏切换为 vertical", vertical?.orientation === "vertical", JSON.stringify(vertical));
        check("垂直布局：Tab 栏使用 250px 宽", vertical?.tabWidth === 250, JSON.stringify(vertical));

        await client.evaluate(`(() => { const el = document.getElementById('scenario-select'); el.value = 'working'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitFor(client, `document.querySelectorAll('#ledger .ledger-row.state-working').length === 8`, { timeoutMs: 4000, label: "all working" });
        const working = await client.evaluate(`(() => ({ states: document.querySelectorAll('#ledger .ledger-row.state-working').length, summary: document.querySelector('#tabbar .tab.active .summary-chip')?.textContent.trim() }))()`);
        check("状态场景：全部进行中时 8 行都是 working", working?.states === 8, JSON.stringify(working));
        check("状态场景：Tab 汇总显示 8W", working?.summary === "W8", working?.summary);

        await setRange(client, "count-range", 3);
        await waitFor(client, `document.querySelectorAll('#ledger .ledger-row').length === 3 && document.getElementById('metric-total').textContent === '3'`, { timeoutMs: 4000, label: "three agents" });
        const count = await client.evaluate(`(() => ({ ledger: document.querySelectorAll('#ledger .ledger-row').length, total: document.getElementById('metric-total').textContent.trim(), output: document.getElementById('count-output').textContent.trim() }))()`);
        check("Agent 数量：清单、指标、控件三处一致", count?.ledger === 3 && count?.total === "3" && count?.output === "3", JSON.stringify(count));

        await client.evaluate(`document.getElementById('theme-toggle').click()`);
        await waitFor(client, `document.documentElement.dataset.theme === 'light'`, { timeoutMs: 3000, label: "light theme" });
        await client.evaluate(`document.getElementById('theme-toggle').click()`);
        await waitFor(client, `document.documentElement.dataset.theme === 'monochrome'`, { timeoutMs: 3000, label: "monochrome theme" });
        await client.evaluate(`document.getElementById('theme-toggle').click()`);
        await waitFor(client, `document.documentElement.dataset.theme === 'dark'`, { timeoutMs: 3000, label: "dark theme again" });
        check("主题：深色 / 浅色 / 黑白三态可切换", true, "dark → light → monochrome → dark");

        await client.evaluate(`document.querySelector('[data-compare-scheme="B"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-B') === true`, { timeoutMs: 4000, label: "comparison switch" });
        check("对比卡：点击 B 同步切换主舞台", true, "comparison → B");

        await client.evaluate(`(() => { const el = document.getElementById('scenario-select'); el.value = 'mixed'; el.dispatchEvent(new Event('change', { bubbles: true })); const r = document.getElementById('count-range'); r.value = '8'; r.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-orientation="horizontal"]').click(); document.querySelector('[data-scheme="G"]').click(); document.querySelector('[data-width-policy="fixed"]').click(); })()`);
        await waitFor(client, `document.querySelector('#tabbar .tab.active')?.classList.contains('scheme-G') === true && document.querySelectorAll('#ledger .ledger-row').length === 8 && document.getElementById('width-output').textContent === '130px'`, { timeoutMs: 4000, label: "reset recommended" });
        writeFileSync(path.join(runDir, "recommended-G-horizontal.png"), (await client.screenshot({ x: 0, y: 0, width: 1440, height: 2200 })).buffer);

        await client.evaluate(`document.querySelector('[data-width-policy="elastic"]').click()`);
        await waitFor(client, `document.getElementById('width-output').textContent === '160px'`, { timeoutMs: 4000, label: "elastic screenshot" });
        writeFileSync(path.join(runDir, "hybrid-G-elastic.png"), (await client.screenshot({ x: 0, y: 0, width: 1440, height: 2200 })).buffer);
        await client.evaluate(`document.querySelector('[data-width-policy="fixed"]').click()`);

        await clickScheme(client, "F");
        writeFileSync(path.join(runDir, "overflow-F-horizontal.png"), (await client.screenshot({ x: 0, y: 0, width: 1440, height: 2200 })).buffer);

        await client.evaluate(`document.querySelector('[data-orientation="vertical"]').click()`);
        await waitFor(client, `document.querySelector('#tabbar').classList.contains('vertical') === true`, { timeoutMs: 4000, label: "vertical screenshot" });
        await clickScheme(client, "G");
        writeFileSync(path.join(runDir, "recommended-G-vertical.png"), (await client.screenshot({ x: 0, y: 0, width: 1440, height: 2200 })).buffer);
    } catch (err) {
        console.error(`✗ 环境错误：${err?.message ?? err}`);
        report(2);
    } finally {
        if (client != null) client.close();
        if (child != null && !keepOpen) {
            try { child.kill(); } catch { /* ignore */ }
        }
    }
    report();
}

function report(forcedExitCode) {
    const passed = results.filter((result) => result.ok).length;
    const total = results.length;
    for (const result of results) {
        console.log(`${result.ok ? "✓" : "✗"} ${result.name}${result.ok ? "" : `  → ${result.detail ?? ""}`}`);
    }
    const exitCode = forcedExitCode ?? (total === 0 ? 2 : passed === total ? 0 : 1);
    writeFileSync(path.join(runDir, "REPORT.json"), JSON.stringify({ passed, total, exitCode, results }, null, 2));
    console.log(`\n${passed}/${total} · 证据 → verify-runs/prototype-tab-agent-status/`);
    process.exit(exitCode);
}

main();
