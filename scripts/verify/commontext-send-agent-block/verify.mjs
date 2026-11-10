#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器真机验证：
//   1. Send split button（主键 + caret）存在；
//   2. caret 打开 popover，四段（聚焦 Agent Block / 选择 Agents / 选择 Type / 选择 Folder）+ 确认「发送」；
//   3. 无 agent block 时聚焦行禁用并显示提示；
//   4. Agents chip 切换会改主按钮 hint；
//   5. Type 下拉含「新建 Tab」并能选中；
//   6. Folder 下拉有候选并能选中；
//   7. 点「发送」→ 弹窗关闭 + 新 agent block 建立 + pending input 在 TUI 就绪后自动注入（term buffer 出现发送文本）。
//
//   node scripts/verify/commontext-send-agent-block/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-send-agent-block/verify.mjs --attach   # 复用已起实例
//   node scripts/verify/commontext-send-agent-block/verify.mjs --keep-open
//   node scripts/verify/commontext-send-agent-block/verify.mjs --dry
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";

const AREA = "commontext-send-agent-block";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

const MARKER = `VERIFY-CSAB-${Date.now()}`;

const OPEN_MODAL = `(() => {
    window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
    return true;
})()`;

const SEND_BUTTON_STATE = `(() => {
    const el = document.querySelector("[data-commontext-send-button]");
    if (!el) return null;
    const buttons = [...el.querySelectorAll("button")];
    return { count: buttons.length, title: buttons[0]?.getAttribute("title") ?? "" };
})()`;

const OPEN_POPOVER = `(() => {
    const el = document.querySelector("[data-commontext-send-button]");
    if (!el) return "no-button";
    const caret = el.querySelectorAll("button")[1];
    if (!caret) return "no-caret";
    caret.click();
    return "clicked";
})()`;

const POPOVER_TEXT = `(() => {
    const p = document.querySelector("[data-commontext-send-popover]");
    if (!p) return null;
    return p.textContent.replace(/\\s+/g, " ").trim();
})()`;

const CLICK_BY_TEXT = (needle, maxLen = 60) => `(() => {
    const roots = [
        ...document.querySelectorAll("[data-commontext-send-popover]"),
        ...document.querySelectorAll("[data-commontext-send-picker]"),
    ];
    if (roots.length === 0) return "no-popover";
    for (const root of roots) {
        for (const btn of root.querySelectorAll("button")) {
            const t = (btn.textContent || "").replace(/\\s+/g, " ").trim();
            if (t.includes(${JSON.stringify(needle)}) && t.length <= ${maxLen}) {
                btn.click();
                return "clicked:" + t;
            }
        }
    }
    return "not-found:" + ${JSON.stringify(needle)};
})()`;

const CLICK_BY_TITLE = (title) => `(() => {
    const p = document.querySelector("[data-commontext-send-popover]");
    if (!p) return "no-popover";
    const btn = [...p.querySelectorAll("button")].find((b) => b.getAttribute("title") === ${JSON.stringify(title)});
    if (!btn) return "not-found";
    btn.click();
    return "clicked";
})()`;

const PICKER_STATE = `(() => {
    const p = document.querySelector("[data-commontext-send-popover]");
    if (!p) return null;
    const pickers = [...p.querySelectorAll("button")].filter((b) => b.querySelector(".fa-chevron-down"));
    return pickers.map((b) => (b.textContent || "").replace(/\\s+/g, " ").trim());
})()`;

const MENU_ITEMS = `(() => {
    const menus = [...document.querySelectorAll("[data-commontext-send-picker]")];
    const texts = [];
    for (const menu of menus) {
        for (const b of menu.querySelectorAll("button")) {
            texts.push((b.textContent || "").replace(/\\s+/g, " ").trim());
        }
    }
    return texts.filter((t) => t.length > 0);
})()`;

const SET_EDITOR_TEXT = (text) => `(() => {
    const ta = document.querySelector("[data-commontext-composer]");
    if (!ta) return "no-editor";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value;
})()`;

const NEW_TERM_PROBE = `(() => {
    const tw = window.term;
    if (!tw) return null;
    return { blockId: tw.blockId ?? "" };
})()`;

// pending input 注入的可观测信号：term.tsx 在注入成功时派发 snorkeling:pending-input-injected。
const ARM_INJECT_EVENTS = `(() => {
    window.__csabInjected = [];
    window.addEventListener("snorkeling:pending-input-injected", (e) => {
        window.__csabInjected.push(e.detail ?? {});
    });
    window.__csabFallback = [];
    window.addEventListener("snorkeling:pending-input-fallback", (e) => {
        window.__csabFallback.push(e.detail ?? {});
    });
    return true;
})()`;

const INJECT_EVENTS = `(() => ({
    injected: window.__csabInjected ?? [],
    fallback: window.__csabFallback ?? [],
}))()`;

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

    // 1. 打开 CommonText 弹窗
    await client.evaluate(OPEN_MODAL);
    const sendButton = await waitForProbe(client, SEND_BUTTON_STATE, (s) => s != null && s.count === 2, {
        timeoutMs: 20000,
    });
    reporter.check("send-split-button", sendButton != null && sendButton.count === 2, JSON.stringify(sendButton));
    await reporter.shot(client, "01-send-button");

    // 2. caret 打开 popover，四段俱全
    await client.evaluate(OPEN_POPOVER);
    const popText = await waitForProbe(client, POPOVER_TEXT, (t) => typeof t === "string" && t.length > 0, {
        timeoutMs: 10000,
    });
    const sections = ["聚焦的 Agent Block", "选择 Agents", "选择 Type", "选择 Folder", "取消", "发送"];
    const missingSections = sections.filter((s) => !(popText ?? "").includes(s));
    reporter.check(
        "popover-sections",
        missingSections.length === 0,
        missingSections.length === 0 ? sections.join(" / ") : `missing: ${missingSections.join(", ")}`
    );
    // 无 agent block 的干净实例：聚焦行禁用 + 提示
    reporter.check(
        "non-agent-focused-hint",
        (popText ?? "").includes("当前聚焦块不是 Agent Block"),
        (popText ?? "").includes("当前聚焦块不是 Agent Block")
            ? "禁用提示已显示"
            : "未找到禁用提示（干净实例应没有聚焦 agent block）"
    );
    await reporter.shot(client, "02-popover");

    // 3. Agents chip 切换（默认 Codex → Claude Code）→ 主按钮 hint 必须跟着变
    const beforeTitle = sendButton.title;
    const claudeClick = await client.evaluate(CLICK_BY_TEXT("Claude Code", 40));
    await sleep(400);
    const afterTitles = await client.evaluate(SEND_BUTTON_STATE);
    reporter.check(
        "agent-chip-select",
        claudeClick.startsWith("clicked") &&
            afterTitles?.title?.includes("Claude Code") &&
            afterTitles?.title !== beforeTitle,
        `click=${claudeClick} before="${beforeTitle}" after="${afterTitles?.title ?? ""}"`
    );

    // 4. Type 下拉：含「新建 Tab」并可选
    await client.evaluate(CLICK_BY_TITLE("选择目标 Tab"));
    const tabMenu = await waitForProbe(client, MENU_ITEMS, (items) => Array.isArray(items) && items.some((t) => t.includes("新建 Tab")), {
        timeoutMs: 8000,
    });
    reporter.check(
        "type-menu-new-tab",
        Array.isArray(tabMenu) && tabMenu.some((t) => t.includes("新建 Tab")),
        JSON.stringify(tabMenu ?? [])
    );
    const newTabClick = await client.evaluate(CLICK_BY_TEXT("新建 Tab", 40));
    await sleep(400);
    const pickerState = await client.evaluate(PICKER_STATE);
    reporter.check(
        "type-picker-new",
        newTabClick.startsWith("clicked") && JSON.stringify(pickerState ?? []).includes("新建"),
        `click=${newTabClick} pickers=${JSON.stringify(pickerState ?? [])}`
    );

    // 5. Folder 下拉：有候选并可选中
    await client.evaluate(CLICK_BY_TITLE("选择项目目录（cwd）"));
    const folderMenu = await waitForProbe(
        client,
        MENU_ITEMS,
        (items) => Array.isArray(items) && items.some((t) => t.includes("/") || t.includes("~")),
        { timeoutMs: 8000 }
    );
    reporter.check(
        "folder-menu-candidates",
        Array.isArray(folderMenu) && folderMenu.some((t) => t.includes("/") || t.includes("~")),
        JSON.stringify(folderMenu ?? [])
    );
    const folderPick = folderMenu?.find((t) => t.includes("/") || t.includes("~"));
    if (folderPick != null) {
        await client.evaluate(CLICK_BY_TEXT(folderPick.slice(0, 30), 160));
        await sleep(300);
    }
    const pickerState2 = await client.evaluate(PICKER_STATE);
    reporter.check(
        "folder-picker-selected",
        JSON.stringify(pickerState2 ?? []).includes("已选"),
        JSON.stringify(pickerState2 ?? [])
    );

    // 5b. Type 切回当前 tab：确认「新建 Tab」是可选路径即可；建块落在 current tab 便于断言注入。
    await client.evaluate(CLICK_BY_TITLE("选择目标 Tab"));
    const tabMenu2 = await waitForProbe(client, MENU_ITEMS, (items) => Array.isArray(items) && items.length > 0, {
        timeoutMs: 8000,
    });
    const currentTabItem = (tabMenu2 ?? []).find((t) => t.includes("当前"));
    if (currentTabItem != null) {
        await client.evaluate(CLICK_BY_TEXT(currentTabItem.slice(0, 20), 80));
        await sleep(300);
    }
    const pickerState3 = await client.evaluate(PICKER_STATE);
    reporter.check(
        "type-back-to-current",
        currentTabItem != null && JSON.stringify(pickerState3 ?? []).includes("当前"),
        `item=${currentTabItem ?? "(none)"} pickers=${JSON.stringify(pickerState3 ?? [])}`
    );

    // 6. 写入发送文本并点「发送」→ 弹窗关闭 + 新块出现
    const editorValue = await client.evaluate(SET_EDITOR_TEXT(`请回复这一行：${MARKER}`));
    reporter.check("editor-text-set", typeof editorValue === "string" && editorValue.includes(MARKER), String(editorValue));

    await client.evaluate(ARM_INJECT_EVENTS);
    const beforeTerm = await client.evaluate(NEW_TERM_PROBE);
    const baselineBlockId = beforeTerm?.blockId ?? "";
    await client.evaluate(CLICK_BY_TEXT("发送", 10));
    const modalClosed = await waitForProbe(
        client,
        `document.querySelector("[data-commontext-send-popover]") == null && document.querySelector("[data-commontext-send-button]") == null`,
        (closed) => closed === true,
        { timeoutMs: 20000 }
    );
    reporter.check("send-closes-modal", modalClosed === true, String(modalClosed));
    await reporter.shot(client, "03-after-send");

    // 7. 新 term 块建立（window.term.blockId 变化）
    const newTerm = await waitForProbe(
        client,
        NEW_TERM_PROBE,
        (probe) => probe != null && probe.blockId !== "" && probe.blockId !== baselineBlockId,
        { timeoutMs: 30000, intervalMs: 500 }
    );
    reporter.check(
        "new-agent-block-created",
        newTerm != null && newTerm.blockId !== "" && newTerm.blockId !== baselineBlockId,
        `baseline=${baselineBlockId} new=${newTerm?.blockId ?? "(none)"}`
    );

    // 8. pending input 在 TUI 就绪后自动注入（term.tsx 派发 injected 事件即注入完成）
    const injectEvents = await waitForProbe(
        client,
        INJECT_EVENTS,
        (ev) => ev?.injected?.some((detail) => detail.blockId !== baselineBlockId),
        { timeoutMs: 90000, intervalMs: 1000 }
    );
    const injectedHit = injectEvents?.injected?.find((detail) => detail.blockId !== baselineBlockId);
    reporter.check(
        "pending-input-injected",
        injectedHit != null,
        injectedHit != null
            ? `blockId=${injectedHit.blockId} length=${injectedHit.length}`
            : `injected=${JSON.stringify(injectEvents?.injected ?? [])} fallback=${JSON.stringify(injectEvents?.fallback ?? [])}`
    );
    // 同一时刻不应触发 fallback（TTL 回退）
    reporter.check(
        "pending-input-no-fallback",
        (injectEvents?.fallback ?? []).length === 0,
        JSON.stringify(injectEvents?.fallback ?? [])
    );
    await reporter.shot(client, "04-injected");

    reporter.finish({
        skipped: [
            "existing（已存在聚焦 agent block 直接注入）路径：干净实例默认无 agent block，未覆盖；由单测 resolveSendTarget 覆盖",
            "远程 connection 目标：本轮为本地-only",
            "TUI 输入框文本回显：不同 CLI 首启提示（claude 目录信任 / codex 升级提示）会吞按键，改为断言 pending-input-injected 事件；由 term.tsx + pending-input 单测共同保证",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, { cleanup: () => instance?.cleanup?.() });
}
