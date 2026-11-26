#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 外部会话运行态验证台（11-26-antigravity-runstate）。
//
//   node scripts/verify/antigravity-runstate/verify.mjs             # 干净实例（fixture 注入）→ 跑 → 自动关
//   node scripts/verify/antigravity-runstate/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/antigravity-runstate/verify.mjs --dry        # 只解析依赖，不启动 GUI
//
// 验的是什么（全部来自 11-26-antigravity-runstate 的 Requirements，机器判定不靠肉眼）：
//   1. RUNNING（新鲜 last_modified_time）的声明式 provider 会话行出现
//      `[data-external-running="true"]` 运行指示（R1+R2+R5）。
//   2. IDLE 行不出现运行指示（R2 归一化：非 RUNNING → 空）。
//   3. RUNNING 但 last_modified_time 距今超过 TTL（5 分钟）的行不出现运行指示
//      （R3 陈旧运行保护：agent 崩溃后会话不得永远显示 running）。
//
// fixture 注入方式（不碰用户真实数据）：
//   - 干净实例路径下，`.runcfg/<profile>/config/settings.json` 预写一条
//     `agent:sessionproviders.verifyrunstate` 条目，指向本台在 profile 内生成的
//     fixture sqlite（node:sqlite DatabaseSync 建表造数，零外部依赖）。
//   - provider 在 manager 构造时固定（paths.go defaultProvidersWithSettings），
//     settings 热加载不会重建，所以必须启动前写好 → 默认模式专用；
//     `--attach` 模式无法注入 fixture，相关判据整体 skip（见 README）。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance, findPidByPort, killPid } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "antigravity-runstate";
// provider 配置 key（也是会话 key 的 source 前缀）。
const FIXTURE_SOURCE = "verifyrunstate";
const FIXTURE_PROVIDER_LABEL = "VerifyRunState";
// R3 TTL 是 5 分钟；陈旧行用 10 分钟前的时间戳确保越界。
const STALE_MS = 10 * 60 * 1000;
const FRESH_MS = 30 * 1000;

const argv = process.argv.slice(2);
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const attach = argv.includes("--attach");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const profileDir = path.join(repoRoot, ".runcfg", DEFAULTS.profile);
const fixtureDir = path.join(profileDir, "fixture-runstate");

// fixture 会话 id 用运行时刻打戳，跨轮次不残留干扰（profile 每轮 reset，双保险）。
const runStamp = Date.now().toString(36);
const FIXTURES = [
    {
        id: `verify-run-${runStamp}`,
        title: `VerifyRunState Running ${runStamp}`,
        status: "CASCADE_RUN_STATUS_RUNNING",
        lastModifiedOffsetMs: -FRESH_MS,
        expectExternalRunning: true,
        criterion: "runstate-running-indicator",
    },
    {
        id: `verify-idle-${runStamp}`,
        title: `VerifyRunState Idle ${runStamp}`,
        status: "CASCADE_RUN_STATUS_IDLE",
        lastModifiedOffsetMs: -FRESH_MS,
        expectExternalRunning: false,
        criterion: "runstate-idle-no-indicator",
    },
    {
        id: `verify-stale-${runStamp}`,
        title: `VerifyRunState Stale ${runStamp}`,
        status: "CASCADE_RUN_STATUS_RUNNING",
        lastModifiedOffsetMs: -STALE_MS,
        expectExternalRunning: false,
        criterion: "runstate-stale-no-indicator",
    },
];

/** declarativeTimeLayouts 认的 Antigravity 形状："2006-01-02 15:04:05.999999999-07:00"。 */
function sqliteTimestamp(ms) {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00:00");
}

function buildFixtureDb(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE conversation_summaries (
            conversation_id TEXT PRIMARY KEY,
            title TEXT,
            last_modified_time TEXT,
            last_user_input_time TEXT,
            workspace_uris TEXT,
            parent_conversation_id TEXT,
            status TEXT
        )
    `);
    const insert = db.prepare(
        "INSERT INTO conversation_summaries (conversation_id, title, last_modified_time, last_user_input_time, workspace_uris, parent_conversation_id, status) VALUES (?, ?, ?, ?, ?, '', ?)"
    );
    const now = Date.now();
    const projectUri = pathToFileURL(repoRoot).href;
    for (const f of FIXTURES) {
        insert.run(
            f.id,
            f.title,
            sqliteTimestamp(now + f.lastModifiedOffsetMs),
            sqliteTimestamp(now + f.lastModifiedOffsetMs),
            JSON.stringify([projectUri]),
            f.status
        );
    }
    db.close();
}

function writeProfileSettings() {
    const configDir = path.join(profileDir, "config");
    mkdirSync(configDir, { recursive: true });
    const settings = {
        "agent:sessionproviders": {
            [FIXTURE_SOURCE]: {
                label: FIXTURE_PROVIDER_LABEL,
                type: "sqlite",
                db: path.join(fixtureDir, "conversation_summaries.db"),
                table: "conversation_summaries",
                columns: {
                    id: "conversation_id",
                    title: "title",
                    updated: "last_modified_time",
                    created: "last_user_input_time",
                    project: "workspace_uris",
                    parentid: "parent_conversation_id",
                    status: "status",
                },
            },
        },
    };
    writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 4) + "\n");
}

// 行快照：key + 行内是否存在外部运行指示（data-external-running）。
const ROWS_EXT_FN = `(() => {
    return Array.from(document.querySelectorAll('[data-session-key]')).map((el) => ({
        key: el.dataset.sessionKey || '',
        extRun: el.querySelector('[data-external-running="true"]') != null,
        text: (el.textContent || '').trim().slice(0, 60),
    }));
})()`;

async function openAisessionsView(client, log) {
    await client
        .send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape" })
        .catch(() => {});
    await client
        .send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" })
        .catch(() => {});
    const opened = await client.evaluate(`(() => {
        const btn = document.querySelector('[aria-label="AI Sessions"], [title="AI Sessions"]');
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    log(`open aisessions via widget button: ${opened}`);
    return opened === true;
}

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs + node:sqlite");
    reporter.finish({ ledger: false, cleanup: null });
}

try {
    if (attach) {
        // provider 集合在 manager 构造时固定，attach 的实例没有 fixture provider —— 判据整体 skip。
        const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
        instance = await ensureInstance({ attach: true });
        const client = instance.client;
        const pages = await listPageTargets(endpoint);
        const live = pages.length > 1 ? await pickLiveRenderer(pages, connectToTarget, endpoint) : null;
        const c = live?.client ?? client;
        await openAisessionsView(c, reporter.log);
        reporter.check("attach-mode-probe", true, "attach 实例可达（fixture 判据见 skipped）");
        reporter.finish({
            skipped: [
                "全部 fixture 判据（running/idle/stale 指示）：--attach 的实例没有注入 fixture provider（provider 在 manager 构造时固定，settings 热加载不重建），请用默认模式跑本台",
            ],
            cleanup: () => {
                c.close?.();
                client.close?.();
            },
        });
    }

    // ── 默认模式：干净实例 + fixture 注入 ─────────────────────────────
    // 1) 清掉可能在跑的旧 verify 实例（ensureInstance 会复用旧实例，绕过 fixture）。
    const oldPid = findPidByPort(DEFAULTS.cdpPort);
    if (oldPid != null) {
        reporter.log(`kill old verify instance on cdp port ${DEFAULTS.cdpPort} (pid ${oldPid})`);
        killPid(oldPid);
        await sleep(3000);
    }

    // 2) 手动 reset profile（不能走 ensureInstance 的 resetProfile：它启动前会 rm 掉 fixture）。
    rmSync(profileDir, { recursive: true, force: true });
    const dbPath = path.join(fixtureDir, "conversation_summaries.db");
    buildFixtureDb(dbPath);
    await writeProfileSettings();
    reporter.log(`fixture db: ${dbPath} (${FIXTURES.length} rows)`);

    // 3) 启动实例（resetProfile=false：profile 已手动清理且埋好 fixture/settings）。
    instance = await ensureInstance({ attach: false, resetProfile: false });
    let client = instance.client;
    const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
    const pages = await listPageTargets(endpoint);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log(`instance ready (launch, fixture=${FIXTURE_SOURCE})`);

    await dismissOnboarding(client, { log: reporter.log });

    if (!(await openAisessionsView(client, reporter.log))) {
        reporter.fatal(new Error("右侧 WidgetsBar 上找不到 AI Sessions 入口"));
    }
    reporter.check("aisessions-view-opened", true, "widget 入口点击成功");

    // 4) 等 fixture 会话出现（扫描 + 列表渲染）。
    let rows = [];
    const rowsDeadline = Date.now() + 90000;
    while (Date.now() < rowsDeadline) {
        rows = await client.evaluate(ROWS_EXT_FN);
        const hits = FIXTURES.filter((f) => rows.some((r) => r.key.startsWith(`${FIXTURE_SOURCE}:${f.id}:`)));
        if (hits.length === FIXTURES.length) break;
        await sleep(1500);
    }
    const listed = FIXTURES.filter((f) => rows.some((r) => r.key.startsWith(`${FIXTURE_SOURCE}:${f.id}:`)));
    reporter.check(
        "runstate-fixture-rows-listed",
        listed.length === FIXTURES.length,
        `fixture rows=${listed.length}/${FIXTURES.length}; total rows=${rows.length}` +
            (listed.length === 0 ? "（扫描未发现 fixture provider：确认 settings.json 已写入且 db 路径可读）" : "")
    );
    if (listed.length === 0) {
        reporter.finish({
            skipped: ["指示判据（running/idle/stale）：fixture 行未出现，无法判定"],
            cleanup: () => {
                client.close?.();
                if (instance?.spawned && !keepOpen) instance.cleanup?.();
            },
        });
    }
    await reporter.shot(client, "01-fixture-rows");

    // 5) 三条指示判据：逐行断言 extRun 与期望一致。
    for (const f of FIXTURES) {
        const row = rows.find((r) => r.key.startsWith(`${FIXTURE_SOURCE}:${f.id}:`));
        if (row == null) {
            reporter.check(f.criterion, false, `行未出现（id=${f.id}）`);
            continue;
        }
        const expected = f.expectExternalRunning;
        const ok = row.extRun === expected;
        const detail = ok
            ? `id=${f.id} status=${f.status} offset=${f.lastModifiedOffsetMs}ms → extRun=${row.extRun}（符合预期）`
            : `id=${f.id} status=${f.status} offset=${f.lastModifiedOffsetMs}ms → extRun=${row.extRun}（期望 ${expected}）`;
        reporter.check(f.criterion, ok, detail);
    }
    await reporter.shot(client, "02-indicator-verdict");

    reporter.finish({
        skipped: [
            "块内运行（AgentStatusStore hook 通道）与外部运行合流的优先级：Go/前端纯函数单测已覆盖（mergeRowRunning），真机只需外部通道",
            "thinking/tool 阶段粒度：db 只有粗粒度 RUNNING，任务明确 out of scope",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
