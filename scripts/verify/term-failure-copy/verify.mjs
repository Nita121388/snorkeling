#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 终端失败输出复制给 agent —— 真机 CDP 验证（11-10-cfa-terminal-output 的验收断言）。
//
//   node scripts/verify/term-failure-copy/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/term-failure-copy/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/term-failure-copy/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/term-failure-copy/verify.mjs --dry       # 只解析依赖
//
// 场景：开一个必失败的 cmd 块（sh -c 'echo ...; exit 3'），拿真实退出码驱动面板：
//   1. 运行中 / 失败前：失败提示条不存在；
//   2. 退出码 3 之后：右上角失败提示条出现（data-term-failure-copy + Copy for agent）；
//   3. 点击复制：payload 含 command / cwd / exit code / ### Task / ### Output contract；
//   4. 成功命令（exit 0）块：提示条不出现。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "term-failure-copy";
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
        const blockId = await mod.createBlock({ meta: ${JSON.stringify(meta)} }, false, false);
        return { ok: true, blockId };
    })()`;
}

/** 某个块的失败提示条探针（按 blockId 收窄，避免多块串扰）。 */
function failureProbe(blockId) {
    return `(() => {
        const blk = document.querySelector(".block.block-${blockId}");
        if (blk == null) return { err: "block gone" };
        const bar = blk.querySelector("[data-term-failure-copy]");
        const copy = bar ? bar.querySelector("[data-copy-for-agent]") : null;
        return { hasBar: bar != null, hasCopy: copy != null, title: copy ? copy.getAttribute("title") : null };
    })()`;
}

const captureClipboardJs = `(() => {
    window.__cfaCaptured = null;
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (t) => { window.__cfaCaptured = String(t); } },
    });
    return true;
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

        // ── 1. 必失败命令块（exit 3）────────────────────────────────────────
        const failed = await client.evaluate(
            createBlockJs({
                view: "term",
                controller: "cmd",
                cmd: "/bin/sh",
                "cmd:shell": false,
                "cmd:runonstart": true,
                // 真机断言点：payload 里必须找到这三行证据
                "cmd:args": ["-c", "echo boom-verify-line; exit 3"],
                "cmd:cwd": "/tmp",
            })
        );
        if (failed?.ok !== true) throw new Error(`创建失败命令块失败: ${JSON.stringify(failed)}`);
        const failedId = failed.blockId;

        const stFail = await waitForProbe(client, failureProbe(failedId), (st) => st?.hasCopy === true, {
            timeoutMs: 60000,
        });
        reporter.check("failure-bar-shown", stFail?.hasBar === true, "退出码 3 后失败提示条出现");
        reporter.check("failure-copy-present", stFail?.hasCopy === true, "Copy for agent 入口存在");
        reporter.check(
            "failure-copy-title",
            /exit 3/.test(stFail?.title ?? ""),
            stFail?.title ?? "(no title)"
        );
        await reporter.shot(client, "01-term-failed");

        await client.evaluate(captureClipboardJs);
        await client.evaluate(
            `(() => { const b = document.querySelector(".block.block-${failedId} [data-term-failure-copy] [data-copy-for-agent]"); if (b == null) return false; b.click(); return true; })()`
        );
        let payload = "";
        for (let i = 0; i < 30 && payload === ""; i++) {
            payload = await client.evaluate(`(() => window.__cfaCaptured || "")()`);
            if (payload === "") await new Promise((r) => setTimeout(r, 300));
        }
        reporter.check("payload-command", payload.includes("command: /bin/sh"), "含完整命令行");
        reporter.check("payload-cwd", payload.includes("cwd: /tmp"), "含 cwd");
        reporter.check("payload-exit-code", payload.includes("exit code: 3"), "含退出码");
        reporter.check("payload-output", payload.includes("boom-verify-line"), "含末段输出");
        reporter.check("payload-task", payload.includes("### Task"), "含 Task 段");
        reporter.check("payload-contract", payload.includes("### Output contract"), "含 Output contract 段");

        // ── 2. 成功命令块（exit 0）：提示条不出现 ───────────────────────────
        const okBlock = await client.evaluate(
            createBlockJs({
                view: "term",
                controller: "cmd",
                cmd: "/bin/sh",
                "cmd:shell": false,
                "cmd:runonstart": true,
                "cmd:args": ["-c", "echo fine; exit 0"],
                "cmd:cwd": "/tmp",
            })
        );
        if (okBlock?.ok !== true) throw new Error(`创建成功命令块失败: ${JSON.stringify(okBlock)}`);
        const okId = okBlock.blockId;
        // 等它跑完（exit code 图标出现）再断言"没有提示条"，避免拿运行中当"成功不渲染"。
        let okState = null;
        for (let i = 0; i < 40; i++) {
            okState = await client.evaluate(`(() => {
                const blk = document.querySelector(".block.block-${okId}");
                if (blk == null) return { err: "block gone" };
                const done = blk.querySelector(".fa-check") != null;
                const bar = blk.querySelector("[data-term-failure-copy]");
                return { done, hasBar: bar != null };
            })()`);
            if (okState?.done === true) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        reporter.check("success-no-failure-bar", okState?.hasBar !== true, "exit 0 块无失败提示条");
        await reporter.shot(client, "02-term-success");

        await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup });
    }
} catch (err) {
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup, verdictOverride: "env-error" });
}
