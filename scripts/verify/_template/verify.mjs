#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 新验证台的起点：复制成 scripts/verify/<area>/verify.mjs 再按注释改。
//
//   node scripts/verify/_template/verify.mjs             # 干净实例 → 跑 → 自动关
//   node scripts/verify/_template/verify.mjs --attach     # 复用已起实例（迭代主力）
//   node scripts/verify/_template/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/_template/verify.mjs --dry        # 只解析参数/依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, probeText, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "template"; // ← 改成目录名（台账按它归类）
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
}

try {
    const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
    instance = await ensureInstance({ attach, resetProfile: !attach });
    let client = instance.client;

    // 多 Tab 时 ensureInstance 连到的可能是空壳 renderer —— 重新挑一个真工作区。
    const pages = await listPageTargets(endpoint);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    reporter.log(`instance ready (${attach ? "attach" : "launch"})`);

    // 首次启动的引导向导会盖住右侧 WidgetsBar。
    await dismissOnboarding(client, { log: reporter.log });

    // ── 探针示例：读一个可见文本 ───────────────────────────────────────────
    const text = await client.evaluate(probeText(".agent-status-header"));
    reporter.check("probe-works", typeof text === "string" || text === null, text ?? "no .agent-status-header");
    await reporter.shot(client, "01-state");

    // ── 等待示例：轮询到条件成立 ─────────────────────────────────────────
    const surfaced = await waitForProbe(
        client,
        probeText(".agent-status-header"),
        (t) => typeof t === "string" && t.length > 0,
        { timeoutMs: 30000 }
    );
    reporter.check("wait-probe", surfaced != null, surfaced ?? "timeout");
    void sleep;

    reporter.finish({
        skipped: ["（在此列出有意没覆盖的面，别静默省略）"],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
