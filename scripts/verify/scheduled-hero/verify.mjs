#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 11-23 晚间批次（Hero 定时执行 core/ui · 看板拖拽 · 定时任务弹窗化）真机 CDP 验证。
//
// 用法：
//   node scripts/verify/scheduled-hero/verify.mjs              # 干净实例 → 跑 → 自动关
//   node scripts/verify/scheduled-hero/verify.mjs --attach      # 复用已起实例（迭代用）
//   node scripts/verify/scheduled-hero/verify.mjs --keep-open
// 产物：verify-runs/<ts>-scheduled-hero/report.json + report.md + 截图；台账追加一行
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误
//
// 播种手法与 overview-board 台同源：在页面里动态 import 前端模块
// （RpcApi 造定时任务 / global.createBlock 造块与 Tab / services 读 Tab 真值）。

import { listPageTargets, connectToTarget } from "../lib/cdp.mjs";
import { ensureInstance, DEFAULTS, dismissOverlays, waitForReady } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "scheduled-hero";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;
let client = null;

/** 等某个 DOM 状态成立（页面内轮询，比外面 evaluate 轮询少往返）。 */
function waitForDom(selector, predicateSrc, { timeoutMs = 15000, intervalMs = 400 } = {}) {
    return client.evaluate(
        `new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                let value = null;
                try {
                    const el = document.querySelector(${JSON.stringify(selector)});
                    if (el != null) value = ${predicateSrc};
                } catch (err) { /* 下一轮再试 */ }
                if (value != null && value !== false) { resolve(value); return; }
                if (Date.now() - started > ${timeoutMs}) { resolve(null); return; }
                setTimeout(tick, ${intervalMs});
            };
            tick();
        })`
    );
}

const clickView = (mode) => `(() => {
    const btn = document.querySelector('[data-overview-view="${mode}"]');
    if (btn == null) return false;
    btn.click();
    return true;
})()`;

const setGroup = (group) => `(() => {
    const sel = document.querySelector("[data-overview-group]");
    if (sel == null) return false;
    sel.value = ${JSON.stringify(group)};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return sel.value === ${JSON.stringify(group)};
})()`;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null });
}

try {
    const endpoint = `http://127.0.0.1:${DEFAULTS.cdpPort}`;
    if (attach) {
        // attach 时可能有多个 page target（旧窗口/iframe 壳），直接挑「有真工作区」的那个，
        // 不走 ensureInstance 的默认 connect（它会随机挑到空白壳并卡在 waitForReady）。
        const pages = await listPageTargets(endpoint);
        if (pages.length === 0) throw new Error(`attach: ${endpoint} 没有 page target`);
        client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
        instance = { client, spawned: false, cleanup: () => client.close() };
    } else {
        instance = await ensureInstance({ attach, resetProfile: true });
        client = instance.client;
        const pages = await listPageTargets(endpoint);
        if (pages.length > 1) {
            client = (await pickLiveRenderer(pages, connectToTarget, endpoint)).client;
        }
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    if (!attach) {
        // attach 模式下 pickLiveRenderer 已按「有 .block 且窗口非零」筛过真 renderer；
        // probeReady 额外要求 .block-content/.workspace，多 Tab 窗口下会误判，故只在 launch 路径用。
        await waitForReady(client);
    }
    await dismissOverlays(client).catch(() => []);
    await dismissOnboarding(client, { log: reporter.log }).catch(() => {});
    reporter.log(`instance ready (${attach ? "attach" : "launch"})`);

    // ── S0. 清空既有定时任务（历次失败跑留下的）→ 干净起点，计数断言才成立 ──
    const purged = await client.evaluate(`(async () => {
        try {
            const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
            const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
            const list = await RpcApi.ScheduledTaskListCommand(TabRpcClient);
            for (const task of Array.isArray(list) ? list : []) {
                await RpcApi.ScheduledTaskDeleteCommand(TabRpcClient, task.id);
            }
            return { ok: true, removed: Array.isArray(list) ? list.length : 0 };
        } catch (err) {
            return { ok: false, err: String(err && err.message ? err.message : err) };
        }
    })()`);
    reporter.check("sched-clean-start", purged?.ok === true, `清掉既有任务 ${purged?.removed ?? "?"} 个`);

    // ── 打开 Overview 块（列表视图起点，与 overview-board 台同源）──────────
    await client.evaluate(`(() => { localStorage.removeItem("snorkeling.overview.viewMode"); return true; })()`);
    const opened = await client.evaluate(`(async () => {
        const mod = await import("/frontend/app/store/global.ts");
        if (typeof mod.createBlock !== "function") return { ok: false, err: "no createBlock" };
        const blockId = await mod.createBlock({ meta: { view: "sessionoverview" } }, false, false);
        return { ok: true, blockId };
    })()`);
    if (opened?.ok !== true) throw new Error(`打开 overview 失败: ${JSON.stringify(opened)}`);
    const overviewBlockId = opened.blockId;
    await sleep(4500);
    reporter.log(`overview block: ${overviewBlockId}`);

    // ── S1. 定时任务区：无任务时整区不渲染 ────────────────────────────────
    const emptySection = await client.evaluate(
        `(() => document.querySelector(".block.block-${overviewBlockId} [data-overview-scheduled-tasks]") == null)()`
    );
    reporter.check("sched-empty-section-hidden", emptySection === true, "无任务时 [data-overview-scheduled-tasks] 不存在");

    // ── S1b. 造两个任务（1 启用 + 1 禁用）—— 必须先于 overview 挂载：面板只在挂载时拉一次。
    const created = await client.evaluate(`(async () => {
        const out = { ok: false, ids: [], err: "" };
        try {
            const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
            const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
            const stamp = Date.now();
            const a = await RpcApi.ScheduledTaskCreateCommand(TabRpcClient, {
                id: "verify-sched-a-" + stamp,
                name: "Verify任务A(启用)",
                enabled: true,
                prompt: "echo verify-a",
                mode: "headless",
                schedule: { type: "interval", intervalMs: 3600000 },
            });
            const b = await RpcApi.ScheduledTaskCreateCommand(TabRpcClient, {
                id: "verify-sched-b-" + stamp,
                name: "Verify任务B(禁用)",
                enabled: false,
                prompt: "echo verify-b",
                mode: "headless",
                schedule: { type: "interval", intervalMs: 7200000 },
            });
            out.ids = [a?.id, b?.id].filter(Boolean);
            out.ok = out.ids.length === 2;
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`);

    // 面板只在挂载时拉一次任务列表：造完任务后 reload 一次页面，让 Overview 块重新挂载后再断言。
    if (created?.ok !== true) throw new Error(`造任务失败: ${JSON.stringify(created)}`);
    await client.send("Page.reload", { ignoreCache: false }).catch(() => {});
    await sleep(6000);
    // reload 唤醒窗口后，主 renderer 的 target 可能换 id；这里不重连，DOM 断言走同一 client 即可
    // （Electron 的 CDP session 在 reload 后仍然有效）。
    const schedStats = await waitForDom("[data-overview-scheduled-tasks]", `(() => {
        const root = document.querySelector("[data-overview-scheduled-tasks]");
        const cards = [...root.querySelectorAll(".session-overview-scheduled-task-card")];
        if (cards.length === 0) return null;
        return {
            total: cards.length,
            disabled: cards.filter((c) => c.classList.contains("is-disabled")).length,
            withHero: root.querySelectorAll(".session-overview-scheduled-task-hero").length,
            withNextRun: cards.filter((c) => (c.querySelector(".session-overview-scheduled-task-nextrun")?.textContent || "").trim() !== "").length,
            firstCard: cards[0] ? (cards[0].querySelector(".session-overview-scheduled-task-name")?.textContent || "").trim() : "",
        };
    })()`);
    reporter.check("sched-section-renders", schedStats?.total === 2, `cards=${JSON.stringify(schedStats)}`);
    reporter.check("sched-disabled-kept-grey", schedStats?.disabled === 1, `is-disabled=${schedStats?.disabled}/2`);
    reporter.check("sched-nextrun-label", schedStats?.withNextRun === 2, `含下次运行文案=${schedStats?.withNextRun}/2`);
    reporter.check("sched-no-hero-when-unbound", schedStats?.withHero === 0, `无 hero 任务不渲染 emoji 节点=${schedStats?.withHero}`);
    await reporter.shot(client, "01-sched-section");

    // ── S3. 点卡 → 编辑弹窗；hero 下拉存在且默认「不绑定」─────────────────
    await client.evaluate(`(() => {
        const card = document.querySelector(".session-overview-scheduled-task-card");
        if (card == null) return false;
        card.click();
        return true;
    })()`);
    const editorState = await waitForDom("[data-scheduled-task-hero]", `(() => {
        const sel = document.querySelector("[data-scheduled-task-hero]");
        if (sel == null) return null;
        return {
            value: sel.value,
            optionCount: sel.options.length,
            firstOptionText: (sel.options[0]?.textContent || "").trim(),
            inModal: sel.closest(".modal-wrapper") != null,
        };
    })()`);
    reporter.check("editor-opens-on-card-click", editorState?.inModal === true, `hero select 在弹窗内=${editorState?.inModal}`);
    reporter.check("editor-hero-select-present", editorState?.optionCount >= 1, `options=${editorState?.optionCount}`);
    reporter.check("editor-hero-default-none", editorState?.value === "", `value=${JSON.stringify(editorState?.value)} first=${editorState?.firstOptionText}`);
    await reporter.shot(client, "02-editor-hero-select");

    // Esc 关编辑弹窗
    await client.evaluate(`(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return true;
    })()`);
    await sleep(600);

    // ── S4. 工具栏「定时任务」入口 → 管理弹窗：行数 = 任务数 ───────────────
    const managerClicked = await client.evaluate(`(() => {
        const btn = document.querySelector("[data-overview-schedtask-manager]");
        if (btn == null) return false;
        btn.click();
        return true;
    })()`);
    const managerState = await waitForDom(".schedtask-manager-modal", `(() => {
        const modal = document.querySelector(".schedtask-manager-modal");
        if (modal == null) return null;
        const rows = modal.querySelectorAll("[data-schedtask-row]").length;
        if (rows === 0) return null; // 数据异步回来前继续等
        return {
            rows,
            newButton: modal.querySelector("[data-schedtask-new]") != null,
            heroNodes: modal.querySelectorAll("[data-schedtask-hero]").length,
        };
    })()`, { timeoutMs: 20000 });
    reporter.check("manager-entry-in-toolbar", managerClicked === true, "[data-overview-schedtask-manager] 可点");
    reporter.check("manager-modal-opens", managerState?.rows === 2, `行=${managerState?.rows}/2`);
    reporter.check("manager-new-button", managerState?.newButton === true, "「新建任务」存在");
    reporter.check("manager-no-hero-when-unbound", managerState?.heroNodes === 0, `无 hero 不渲染 emoji=${managerState?.heroNodes}`);
    await reporter.shot(client, "03-manager-modal");

    // 管理弹窗内点行内「编辑」→ 复用编辑弹窗（hero select 在栈顶弹窗内）
    const editFromManager = await client.evaluate(`(() => {
        const row = document.querySelector("[data-schedtask-row] [data-schedtask-edit]");
        if (row == null) return false;
        row.click();
        return true;
    })()`);
    const editorFromManager = await waitForDom("[data-scheduled-task-hero]", `(() => {
        const sel = document.querySelector("[data-scheduled-task-hero]");
        return sel == null ? null : { inModal: sel.closest(".modal-wrapper") != null };
    })()`);
    reporter.check("manager-edit-reuses-editor", editFromManager === true && editorFromManager?.inModal === true, "行内编辑复用编辑弹窗");
    await reporter.shot(client, "04-manager-edit-editor");

    // 连按 Esc 关掉两层弹窗
    await client.evaluate(`(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return true;
    })()`);
    await sleep(600);

    // ── S5. 看板拖拽：agent 卡拖到空 Tab = MoveBlockToTab ─────────────────
    // 5a) 在当前 Tab 播种一个 agent 块（与 overview-board 台同源手法）
    const seeded = await client.evaluate(`(async () => {
        const out = { ok: false, blockId: "", tabIdsBefore: [], err: "" };
        try {
            const persona = await import("/frontend/app/agent-persona/persona-store.ts");
            persona.setAgentPersona("claude", "🦊");
            const globalMod = await import("/frontend/app/store/global.ts");
            out.blockId = await globalMod.createBlock(
                { meta: { view: "term", "agent:provider": "claude", "agent:sessionid": "verify-sched-hero-0001", "cmd:cwd": "/tmp/verify-sched-hero" } },
                false,
                false
            );
            const globalMod2 = await import("/frontend/app/store/global.ts");
            const storeMod = await import("/frontend/app/store/jotaiStore.ts");
            const ws = storeMod.globalStore.get(globalMod2.atoms.workspace);
            out.tabIdsBefore = ws?.tabids ?? [];
            out.ok = out.blockId != null && out.tabIdsBefore.length > 0;
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`);
    if (seeded?.ok !== true) throw new Error(`播种 agent 块失败: ${JSON.stringify(seeded)}`);
    const sourceTabId = seeded.tabIdsBefore[0];
    reporter.log(`seeded agent block ${seeded.blockId} in tab ${sourceTabId}`);

    // 5b) 建一个新 Tab 并清空它（createTab 带默认块，删掉 → 0 卡空 Tab），
    //     然后切回源 Tab（Overview 块在那里才可见）。
    const tabSetup = await client.evaluate(`(async () => {
        const out = { ok: false, emptyTabId: "", err: "" };
        try {
            const globalMod = await import("/frontend/app/store/global.ts");
            const storeMod = await import("/frontend/app/store/jotaiStore.ts");
            const services = await import("/frontend/app/store/services.ts");
            const wsBefore = storeMod.globalStore.get(globalMod.atoms.workspace);
            const before = wsBefore?.tabids ?? [];
            globalMod.createTab();
            await new Promise((r) => setTimeout(r, 1500));
            const wsAfter = storeMod.globalStore.get(globalMod.atoms.workspace);
            const emptyTabId = (wsAfter?.tabids ?? []).find((id) => !before.includes(id));
            if (emptyTabId == null) throw new Error("new tab not found");
            const tab = await services.ClientService.GetTab(emptyTabId);
            for (const blockId of tab?.blockids ?? []) {
                await services.ObjectService.DeleteBlock(blockId);
            }
            const wsId = wsAfter?.oid ?? wsAfter?.id ?? "";
            await services.WorkspaceService.SetActiveTab(wsId, ${JSON.stringify(sourceTabId)}, true);
            out.emptyTabId = emptyTabId;
            out.ok = true;
        } catch (err) {
            out.err = String(err && err.message ? err.message : err);
        }
        return out;
    })()`);
    if (tabSetup?.ok !== true) throw new Error(`空 Tab 准备失败: ${JSON.stringify(tabSetup)}`);
    const emptyTabId = tabSetup.emptyTabId;
    reporter.log(`empty tab ${emptyTabId} ready; back on source tab`);

    // 5c) 切看板 + 按 Tab 分组
    await client.evaluate(clickView("list"));
    await sleep(900);
    await client.evaluate(clickView("board"));
    await sleep(900);
    const grouped = await client.evaluate(setGroup("tab"));
    await sleep(900);
    reporter.check("board-tab-group-applied", grouped === true, "看板 + Tab 分组");

    // 5d) 拖起前：静态无落点（拖拽态才渲染）
    const idleTargets = await client.evaluate(`(() => document.querySelectorAll("[data-drop-target]").length)()`);
    reporter.check("drag-idle-no-drop-targets", idleTargets === 0, `拖起前落点=${idleTargets}（0=静态视觉 0 变化）`);

    // 5d) 拖起 agent 卡（合成 dragstart）→ 落点热区全部显形（含空 Tab 落点）
    const dragStart = await client.evaluate(`(async () => {
        const card = document.querySelector('[data-board-block-id="${seeded.blockId}"]');
        if (card == null) return { err: "seeded card not on board" };
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 300));
        const targets = [...document.querySelectorAll("[data-drop-target]")];
        return {
            count: targets.length,
            emptyZone: targets.filter((t) => t.getAttribute("data-drop-empty") === "true").length,
            emptyZoneTabId: (targets.find((t) => t.getAttribute("data-drop-empty") === "true")?.getAttribute("data-drop-target")) ?? null,
            hasSeededEmptyZone: targets.some((t) => t.getAttribute("data-drop-target") === ${JSON.stringify(emptyTabId)} && t.getAttribute("data-drop-empty") === "true"),
            hasSource: targets.some((t) => t.getAttribute("data-drop-target") === ${JSON.stringify(sourceTabId)}),
            dtPayload: dt.getData("text/plain"),
        };
    })()`);
    const tabCount = await client.evaluate(`(async () => {
        const globalMod = await import("/frontend/app/store/global.ts");
        const storeMod = await import("/frontend/app/store/jotaiStore.ts");
        const ws = storeMod.globalStore.get(globalMod.atoms.workspace);
        return (ws?.tabids ?? []).length;
    })()`);
    reporter.check(
        "drag-drop-targets-render",
        dragStart?.count === tabCount,
        `落点=${dragStart?.count} · 当前 Tab 数=${tabCount}（每个 Tab 一个落点）`
    );
    reporter.check(
        "drag-empty-tab-zone",
        (dragStart?.emptyZone ?? 0) >= 1 && dragStart?.hasSeededEmptyZone !== false,
        `空 Tab 占位数=${dragStart?.emptyZone}（本台新建的空 Tab 必须可落）`
    );
    reporter.check("drag-payload-encoded", typeof dragStart?.dtPayload === "string" && dragStart.dtPayload.length > 0, `payload=${JSON.stringify(dragStart?.dtPayload)}`);
    for (let attempt = 0; attempt < 3; attempt++) {
        const file = await reporter.shot(client, attempt === 0 ? "05-dragging" : "05-dragging");
        if (file != null) break;
        await sleep(1500);
        if (attempt === 2) reporter.log("05-dragging 截图三次超时（拖拽动画占用合成器），跳过");
    }

    // 5e) 落到空 Tab → 卡片换列；块真值也从源 Tab 移到空 Tab
    const dropped = await client.evaluate(`(async () => {
        const card = document.querySelector('[data-board-block-id="${seeded.blockId}"]');
        if (card == null) return { err: "card gone" };
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 200));
        const zone = document.querySelector('[data-drop-target="${emptyTabId}"]');
        if (zone == null) return { err: "empty drop zone missing" };
        zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 1200));
        const services = await import("/frontend/app/store/services.ts");
        const targetTab = await services.ClientService.GetTab(${JSON.stringify(emptyTabId)});
        const sourceTab = await services.ClientService.GetTab(${JSON.stringify(sourceTabId)});
        return {
            inTargetColumn: document.querySelector('[data-column-key="tab:${emptyTabId}"] [data-board-block-id="${seeded.blockId}"]') != null,
            stillInSourceColumn: document.querySelector('[data-column-key="tab:${sourceTabId}"] [data-board-block-id="${seeded.blockId}"]') != null,
            targetBlockIds: targetTab?.blockids ?? null,
            sourceBlockIds: sourceTab?.blockids ?? null,
        };
    })()`);
    reporter.check(
        "drop-moves-card-dom",
        dropped?.inTargetColumn === true && dropped?.stillInSourceColumn !== true,
        `目标列=${dropped?.inTargetColumn} 源列残留=${dropped?.stillInSourceColumn}`
    );
    const inTargetTruth = Array.isArray(dropped?.targetBlockIds) && dropped.targetBlockIds.includes(seeded.blockId);
    const notInSourceTruth = Array.isArray(dropped?.sourceBlockIds) && !dropped.sourceBlockIds.includes(seeded.blockId);
    reporter.check("drop-moves-block-truth", inTargetTruth && notInSourceTruth, "Tab.blockids 真值守恒（源 -1 / 目标 +1）");
    for (let attempt = 0; attempt < 3; attempt++) {
        const file = await reporter.shot(client, "06-after-drop");
        if (file != null) break;
        await sleep(1500);
        if (attempt === 2) reporter.log("06-after-drop 截图三次超时，跳过");
    }

    // 5f) 拖回原 Tab = 允许；同 Tab 落 = 0 变更（负面用例，DOM 快照对比）
    const sameTabBefore = await client.evaluate(`(async () => {
        const services = await import("/frontend/app/store/services.ts");
        const tab = await services.ClientService.GetTab(${JSON.stringify(emptyTabId)});
        return tab?.blockids ?? [];
    })()`);
    const sameTabDrop = await client.evaluate(`(async () => {
        const card = document.querySelector('[data-board-block-id="${seeded.blockId}"]');
        if (card == null) return { err: "card gone" };
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 200));
        const zone = document.querySelector('[data-drop-target="${emptyTabId}"]');
        if (zone == null) return { err: "same-tab zone missing" };
        zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 800));
        return { ok: true };
    })()`);
    const sameTabAfter = await client.evaluate(`(async () => {
        const services = await import("/frontend/app/store/services.ts");
        const tab = await services.ClientService.GetTab(${JSON.stringify(emptyTabId)});
        return tab?.blockids ?? [];
    })()`);
    reporter.check(
        "same-tab-drop-zero-change",
        sameTabDrop?.ok === true && JSON.stringify(sameTabBefore) === JSON.stringify(sameTabAfter),
        `drop 前=${sameTabBefore.length} 块 · drop 后=${sameTabAfter.length} 块（相等=0 次 MoveBlock）`
    );

    // ── 清场：删任务 / 删播种块 / 关空 Tab（本台独立 profile，清场只为报告整洁）──
    await client.evaluate(`(async () => {
        try {
            const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
            const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
            for (const id of ${JSON.stringify(created.ids)}) {
                await RpcApi.ScheduledTaskDeleteCommand(TabRpcClient, id);
            }
            const services = await import("/frontend/app/store/services.ts");
            await services.ObjectService.DeleteBlock(${JSON.stringify(seeded.blockId)});
            const storeMod = await import("/frontend/app/store/jotaiStore.ts");
            const globalMod = await import("/frontend/app/store/global.ts");
            const ws = storeMod.globalStore.get(globalMod.atoms.workspace);
            await services.ObjectService.CloseTab(ws?.oid ?? ws?.id ?? "", ${JSON.stringify(emptyTabId)}, true);
        } catch (err) {
            /* 清理失败不影响 verdict */
        }
        return true;
    })()`);

    reporter.finish({
        skipped: [
            "hero-group-emoji（真机）：需要名册 hero + 带 hero props 的会话文件，隔离 profile 造不出；由 session-group.test.tsx 4 例 jsdom DOM 测试覆盖",
            "hero-home meta 注入（真机）：需要到点真跑一次 block 模式任务（会起 agent 进程）；由 TestScheduledTaskHeroBlockMeta Go 单测覆盖",
            "hero 选择器带名册选项（真机）：隔离 profile 名册为空，下拉只有「不绑定」；有 hero 分支由 scheduledtask-hero.test.ts 覆盖",
            "MCP scheduled-task 写路径 hero 透传：由 N-1123-hero-sched-core 备注（后续任务收口）",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
        },
    });
} catch (err) {
    reporter.fatal(err, {
        cleanup: () => {
            client?.close?.();
            if (instance?.spawned && !keepOpen) instance?.cleanup?.();
        },
    });
}
