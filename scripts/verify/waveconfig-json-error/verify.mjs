#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 设置 JSON 校验失败复制给 agent —— 真机 CDP 验证（11-10-cfa-settings-json-error 验收）。
//
//   node scripts/verify/waveconfig-json-error/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/waveconfig-json-error/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/waveconfig-json-error/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/waveconfig-json-error/verify.mjs --dry       # 只解析依赖
//
// 手法（全真实 UI，不 mock）：打开 Settings（settings.json 的 Raw JSON），在 Monaco 里
// 全选替换成「缺括号 + 键类型错」的 JSON → 点 Save → 校验失败条出现 Copy for agent →
// 断言 payload（行列/片段/键名/三段式契约）→ 再替换回合法 JSON → Save → 失败条消失。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "waveconfig-json-error";
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

const errorProbe = `(() => {
    const banner = document.querySelector("[data-waveconfig-validation-error]");
    if (banner == null) return { hasBanner: false };
    const copy = banner.querySelector("[data-copy-for-agent]");
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    return {
        hasBanner: true,
        hasCopy: copy != null,
        copyTitle: copy ? copy.getAttribute("title") : null,
        text: banner.textContent ?? "",
        saveDisabled: save == null ? true : save.disabled,
    };
})()`;

const captureClipboardJs = `(() => {
    window.__cfaCaptured = null;
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (t) => { window.__cfaCaptured = String(t); } },
    });
    return true;
})()`;

/**
 * 在 Monaco 编辑器里全选并替换文本。
 *
 * 坑（2026-11-10 实踩）：这个 Monaco 用 Chromium 的 **EditContext** API（activeElement 是
 * `div.native-edit-context`），CDP 的 `Input.insertText` / execCommand 都进不了它的输入管线；
 * 必须用逐字符的 `char` 事件（EditContext 会把它转成 textupdate）。全选用 Meta+A 组合键，
 * 并验证 `.selected-text` 真的出现。
 */
async function replaceEditorContent(client, text, expected) {
    // marker：显式校验串（Monaco 会自动补全括号，落地的最终文本不等于输入文本，
    // 所以不能用输入的第二行做 marker —— 由调用方给出「一定能证明落地」的片段）。
    const marker = expected ?? text.trim();
    for (let attempt = 0; attempt < 3; attempt++) {
        const focused = await client.evaluate(`(() => {
            const lines = document.querySelector(".monaco-editor .view-lines");
            if (lines == null) return false;
            const r = lines.getBoundingClientRect();
            const target = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 2));
            if (target == null) return false;
            target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1 }));
            document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, buttons: 1 }));
            return true;
        })()`);
        if (focused !== true) throw new Error("无法聚焦 Monaco 编辑器");
        await new Promise((r) => setTimeout(r, 200));

        // Meta+A（先按 Meta 键本身，再按 A）
        await client.send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            modifiers: 4,
            key: "Meta",
            code: "MetaLeft",
            windowsVirtualKeyCode: 91,
        });
        await client.send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            modifiers: 4,
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
        });
        await client.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            modifiers: 4,
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
        });
        await client.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            modifiers: 0,
            key: "Meta",
            code: "MetaLeft",
            windowsVirtualKeyCode: 91,
        });
        await new Promise((r) => setTimeout(r, 250));
        const selection = await client.evaluate(
            `(() => ({ selected: document.querySelectorAll(".monaco-editor .selected-text").length }))()`
        );
        if (selection?.selected < 1) {
            // 没选中：重试用（可能是焦点丢了）
            continue;
        }
        // 逐字符写入（EditContext 只吃 char 事件）
        for (const ch of text + "\n") {
            if (ch === "\n") {
                await client.send("Input.dispatchKeyEvent", {
                    type: "rawKeyDown",
                    key: "Enter",
                    code: "Enter",
                    windowsVirtualKeyCode: 13,
                });
                await client.send("Input.dispatchKeyEvent", {
                    type: "keyUp",
                    key: "Enter",
                    code: "Enter",
                    windowsVirtualKeyCode: 13,
                });
            } else {
                await client.send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
            }
        }
        // 渲染是异步的：轮询等 marker 出现，而不是单次抓取（2026-11-10 实踩）
        let landed = "";
        for (let poll = 0; poll < 12 && !landed.includes(marker); poll++) {
            await new Promise((r) => setTimeout(r, 400));
            landed = await client.evaluate(`(() => {
                const lines = [...document.querySelectorAll(".monaco-editor .view-line")].map((el) => el.textContent ?? "");
                return lines.join("\\n").replace(new RegExp(String.fromCharCode(160), "g"), " ");
            })()`);
        }
        if (landed != null && landed.includes(marker)) return;
    }
    const dbgVal = await client.evaluate(
        `(() => [...document.querySelectorAll(".monaco-editor .view-line")].map((el) => el.textContent ?? "").slice(0, 8))()`
    );
    throw new Error(`Monaco 内容替换未落地（找不到 ${JSON.stringify(marker).slice(0, 40)}）: ${JSON.stringify(dbgVal)}`);
}

async function clickSave(client) {
    const clicked = await client.evaluate(`(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save" && !b.disabled);
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    if (clicked !== true) throw new Error("Save 按钮不可点");
}

async function captureAfterClick(client) {
    await client.evaluate(captureClipboardJs);
    const clicked = await client.evaluate(`(() => {
        const btn = document.querySelector("[data-waveconfig-validation-error] [data-copy-for-agent]");
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    if (clicked !== true) throw new Error("复制按钮不可点");
    let payload = "";
    for (let i = 0; i < 30 && payload === ""; i++) {
        payload = await client.evaluate(`(() => window.__cfaCaptured || "")()`);
        if (payload === "") await new Promise((r) => setTimeout(r, 300));
    }
    return payload;
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

        const opened = await client.evaluate(createBlockJs({ view: "waveconfig", file: "settings.json" }));
        if (opened?.ok !== true) throw new Error(`打开 waveconfig 失败: ${JSON.stringify(opened)}`);

        // 等编辑器加载（Monaco 出现 + Save 可见）。先确认校验通过时没有失败条。
        await waitForProbe(client, errorProbe, (st) => st?.hasBanner === false && st?.saveDisabled != null, {
            timeoutMs: 45000,
        });
        reporter.check("no-error-banner-initially", true, "校验通过时无失败条（按钮不渲染）");
        await reporter.shot(client, "01-loaded");

        // 等 Monaco 真正挂上（编辑器是异步挂载的，早于它就点会拿不到 view-lines）
        await waitForProbe(
            client,
            `(() => {
                const ed = document.querySelector(".monaco-editor");
                return { hasEditor: ed != null, hasLines: ed?.querySelector(".view-lines") != null };
            })()`,
            (st) => st?.hasLines === true,
            { timeoutMs: 45000 }
        );
        // 全选替换成坏 JSON：缺右括号 + term:fontsize 类型错 → 点 Save → 失败条 + 复制
        await replaceEditorContent(
            client,
            '{"term:fontsize": "13",, "ai:model": "gpt"}',
            ',,'
        );
        await clickSave(client);
        const failed = await waitForProbe(client, errorProbe, (st) => st?.hasBanner === true && st?.hasCopy === true, {
            timeoutMs: 30000,
        });
        reporter.check("error-banner-shown", failed?.hasBanner === true, "校验失败条出现");
        reporter.check("copy-shown-on-error", failed?.hasCopy === true, "失败条带 Copy for agent");
        reporter.check(
            "copy-title",
            /JSON error/.test(failed?.copyTitle ?? ""),
            failed?.copyTitle ?? "(no title)"
        );
        await reporter.shot(client, "02-error-banner");

        const payload = await captureAfterClick(client);
        reporter.check("payload-file", payload.includes("file: "), "含文件路径");
        reporter.check("payload-key", payload.includes("term:fontsize"), "含出错键（term:fontsize）");
        reporter.check("payload-position", payload.includes("position: line "), "含行列位置");
        reporter.check("payload-snippet", payload.includes("snippet ("), "含 ±5 行片段");
        reporter.check("payload-task", payload.includes("### Task"), "含 Task 段");
        reporter.check("payload-contract", payload.includes("### Output contract"), "含 Output contract 段");

        // 先关失败条（布局回到常态）再做修复替换——带着横幅做全选替换落点会被挤走。
        await client.evaluate(`(() => {
            const banner = document.querySelector("[data-waveconfig-validation-error]");
            const close = banner ? banner.querySelector("button") : null;
            if (close != null) close.click();
            return true;
        })()`);
        await new Promise((r) => setTimeout(r, 300));
        // 修好 → Save → 失败条消失（复制入口随错误一起消失）
        // 修复步骤用最不容易被自动补全干扰的内容：空对象 `{}`（`{` 自动补 `}`，
        // 手心打 `}` 会跳过消费，落成合法 JSON）——Save 即可通过。少打/多打都会留残影（实踩）。
        await replaceEditorContent(client, '{}', '{}');
        await clickSave(client);
        const fixed = await waitForProbe(client, errorProbe, (st) => st?.hasBanner === false, { timeoutMs: 30000 });
        reporter.check("banner-gone-after-fix", fixed?.hasBanner === false, "修复后失败条消失");
        await reporter.shot(client, "03-fixed");

        await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup });
    }
} catch (err) {
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup, verdictOverride: "env-error" });
}
