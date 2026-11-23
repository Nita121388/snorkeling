#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText「新建 agent 并发送」= 后端 agentsend 的真机闭环（task 11-23-commontext-create-send）。
//
// 为什么必须真机：本包修的是一次**静默丢失**——create 路径原先只把文本塞进前端 pending-input，
// 由 term 视图 paste + 固定延迟回车，没有任何提交确认。pi 冷启动（跑 `npm view`，实测 40s+）
// 会吞掉回车，文字留在输入框、UI 却报「已发送」。单测只能锁「调了 AgentSendCommand」，
// 「回车真的生效 / agent 真的回复 / 日志里真的有提交确认」只有真 TUI 说得清。
//
// 判据（端到端，不接受"事件信号"当送达）：
//   1. UI 新建 agent 发送 → 弹窗关闭 → 新 agent block 出现在当前 Tab（meta: view=term + agent:provider）；
//   2. 派发回执：AgentDispatchListCommand 有一条属于该块的记录，state=confirmed、submittedat>0、error 空，
//      **并且**同一轮日志里 `[agentsend] <blockid> submit confirm retries=N confirmed=true` 与之对得上
//      （2026-11-23 P1：worker 曾无条件 Transition(confirmed) 且清空 Error，单看记录会把未确认谎报成成功）；
//   3. TUI 里真的出现这段文本（window.term.getScrollbackContent()）；
//   4. agent 真的回复了：会话 turn 的 assistant 正文含标记串；
//   5. 反证：`snorkeling:pending-input-injected` / `-fallback` 事件一条都不出现（前端 paste 链已退役）；
//   6. 后端日志：waveapp.log 出现 `[agentsend] <blockid> injected` 与
//      `[agentsend] <blockid> submit confirm retries=N confirmed=true`，且没有该块的
//      `[agentdispatch] … failed`。
//
// 日志路径：本台自己起实例（profile=verify-commontext-create-send），后端数据目录被
// dev-isolated.mjs 重定向到 <repo>/.runcfg/<profile>/data/，所以日志是
// <repo>/.runcfg/<profile>/data/waveapp.log —— **不是** %LOCALAPPDATA%\snorkeling。
// 需要换实例时用 --log=<path> 显式覆盖（--attach 到别人的实例时必须给）。
//
// 用法：
//   node scripts/verify/commontext-create-send/verify.mjs              # 起干净实例 → 跑 → 自动关
//   node scripts/verify/commontext-create-send/verify.mjs --attach     # 复用本 area 的实例
//   node scripts/verify/commontext-create-send/verify.mjs --log=<path> # 覆盖日志路径
//   node scripts/verify/commontext-create-send/verify.mjs --keep-open  # 跑完留着人工看
//   node scripts/verify/commontext-create-send/verify.mjs --dry        # 只解析依赖，不启动 GUI
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep, waitForProbe } from "../lib/probes.mjs";
import { createReporter } from "../lib/report.mjs";

const AREA = "commontext-create-send";
// 独立 profile + 独立端口：不与默认实例（profile=verify / cdp=9231）抢。
const PROFILE = "verify-commontext-create-send";
const CDP_PORT = 9262;
const VITE_PORT = 51872;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const logArg = argv.find((a) => a.startsWith("--log="));
// 实例自己的日志：dev-isolated 把 WAVETERM_DATA_HOME 指到 .runcfg/<profile>/data。
const logPath = logArg != null ? logArg.slice("--log=".length) : path.join(repoRoot, ".runcfg", PROFILE, "data", "waveapp.log");

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT, logPath },
});
const { log, check } = reporter;

const MARKER = `VERIFY-CCS-${Date.now()}`;
const SEND_TEXT = `请只回复这一行：${MARKER}`;

const POPOVER = "[data-commontext-send-popover]";
// 等 agent TUI 就绪 + 提交确认 + 回复的预算：pi 冷启动实测 40s+，提交确认窗口 180s。
const DISPATCH_CONFIRM_MS = 240000;
const TUI_TEXT_MS = 240000;
const REPLY_MS = 240000;

// ─────────── 真实指针 ───────────
// 合成 element.click() 会绕过命中测试（弹层被别的层叠上下文盖住时照样"点得到"）。
async function realClick(client, pt) {
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none", buttons: 0 });
    await sleep(80);
    await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: pt.x,
        y: pt.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
    });
    await sleep(60);
    await client.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: pt.x,
        y: pt.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
    });
    await sleep(400);
}

// ─────────── 页面探针 ───────────
const OPEN_MODAL = `(() => {
    window.dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", { detail: {} }));
    return true;
})()`;

const CARET_POINT = `(() => {
    const el = document.querySelector("[data-commontext-send-button]");
    if (!el) return null;
    const b = el.querySelectorAll("button")[1];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

// 绕过 UI 二级菜单直接写共享配置：本台只钉「create 路径的送达」，不重复测面板交互。
const SET_CONFIG = (patch) => `(async () => {
    const mod = await import("/frontend/app/commontext/commontext-send-button.tsx");
    const store = (await import("/frontend/app/store/jotaiStore.ts")).globalStore;
    const current = store.get(mod.commontextSendConfigAtom);
    store.set(mod.commontextSendConfigAtom, Object.assign({}, current, ${JSON.stringify(patch)}));
    return store.get(mod.commontextSendConfigAtom);
})()`;

const SET_EDITOR_TEXT = (text) => `(() => {
    const ta = document.querySelector("[data-commontext-composer]");
    if (!ta) return "no-editor";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value;
})()`;

const SEND_POINT = `(() => {
    const p = document.querySelector(${JSON.stringify(POPOVER)});
    if (!p) return null;
    const b = p.querySelector("[data-commontext-send-submit]") ?? p.querySelector("button[data-commontext-send-submit]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (b.textContent || "").trim() };
})()`;

// pending-input 事件（前端 paste 链的可观测面）：修复后 create 路径必须一条都不派发。
const ARM_PENDING_EVENTS = `(() => {
    window.__ccs = { injected: [], fallback: [] };
    window.addEventListener("snorkeling:pending-input-injected", (e) => window.__ccs.injected.push(e.detail ?? {}));
    window.addEventListener("snorkeling:pending-input-fallback", (e) => window.__ccs.fallback.push(e.detail ?? {}));
    return true;
})()`;
const PENDING_EVENTS = `(() => ({ injected: window.__ccs?.injected ?? [], fallback: window.__ccs?.fallback ?? [] }))()`;

// 当前 renderer 里 window.term 指向的块（create 到当前 Tab 时就是新建的 agent 块）
const TERM_BLOCK = `(() => {
    const tw = window.term;
    if (!tw) return null;
    return { blockId: tw.blockId ?? "", hasScrollback: typeof tw.getScrollbackContent === "function" };
})()`;

const TERM_BLOCK_META = (blockId) => `(async () => {
    const g = await import("/frontend/app/store/global.ts");
    const WOS = await import("/frontend/app/store/wos.ts");
    const oref = WOS.makeORef("block", ${JSON.stringify(blockId)});
    try { await WOS.loadAndPinWaveObject(oref); } catch {}
    const block = g.globalStore.get(WOS.getWaveObjectAtom(oref));
    return { view: block?.meta?.view ?? "", provider: block?.meta?.["agent:provider"] ?? "" };
})()`;

// TUI 回显：真实 xterm buffer（尾部 8000 字符足够覆盖「输入框 + 最近对话」）
const TERM_TAIL = `(() => {
    try {
        const text = window.term?.getScrollbackContent?.() ?? "";
        return text.length > 8000 ? text.slice(-8000) : text;
    } catch (e) {
        return "";
    }
})()`;

// 派发回执（后端状态机）：records 里带 text64，Node 侧解码比对标记串。
const DISPATCH_LIST = `(async () => {
    const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
    const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
    try {
        const records = await RpcApi.AgentDispatchListCommand(TabRpcClient, { limit: 20 });
        return { ok: true, records: Array.isArray(records) ? records : [] };
    } catch (error) {
        return { ok: false, error: String(error?.message ?? error), records: [] };
    }
})()`;

// agent 回复：blockid → 会话 → 最近 turn 的原始消息（layer 3 读，只读）
const REPLY_ROWS = `(async () => {
    const { RpcApi } = await import("/frontend/app/store/wshclientapi.ts");
    const { TabRpcClient } = await import("/frontend/app/store/wshrpcutil.ts");
    const blockId = window.term?.blockId ?? "";
    if (blockId === "") return { blockId: "", sessionid: "", rows: [], error: "no-term" };
    let rec = null;
    try {
        rec = await RpcApi.SessionGetCommand(TabRpcClient, { identifier: "", blockid: blockId });
    } catch (error) {
        return { blockId, sessionid: "", rows: [], error: String(error?.message ?? error) };
    }
    const sessionid = rec?.sessionid ?? "";
    if (sessionid === "") return { blockId, sessionid: "", rows: [], error: "" };
    let turns = null;
    try {
        turns = await RpcApi.SessionTurnsCommand(TabRpcClient, { identifier: sessionid, limit: 3 });
    } catch (error) {
        return { blockId, sessionid, rows: [], error: String(error?.message ?? error) };
    }
    const rows = [];
    for (const turn of turns?.rows ?? []) {
        try {
            const full = await RpcApi.SessionTurnCommand(TabRpcClient, {
                identifier: sessionid,
                turn: turn.turn,
                chars: 8000,
            });
            for (const msg of full?.rows ?? []) {
                rows.push({ turn: turn.turn, role: msg.role ?? "", text: String(msg.text ?? "").slice(0, 4000) });
            }
        } catch (error) {
            rows.push({ turn: turn.turn, role: "error", text: String(error?.message ?? error) });
        }
    }
    return { blockId, sessionid, rows, error: "" };
})()`;

// ─────────── 日志 ───────────
function readLogTail(fromByte) {
    try {
        const buf = readFileSync(logPath);
        return buf.subarray(Math.max(0, fromByte)).toString("utf8");
    } catch {
        return "";
    }
}

function logSize() {
    try {
        return readFileSync(logPath).length;
    } catch {
        return 0;
    }
}

// 提交确认的真实证据：与派发回执交叉验证，回执不能自证成功（见文件头判据 2）。
function submitConfirmLine(segment, blockId) {
    if (!segment || !blockId) return null;
    return new RegExp(`\\[agentsend\\] ${blockId} submit confirm retries=(\\d+) confirmed=(\\w+)`).exec(segment);
}

const decodeText64 = (text64) => {
    try {
        return Buffer.from(String(text64 ?? ""), "base64").toString("utf8");
    } catch {
        return "";
    }
};

const findDispatch = (records, marker) =>
    (records ?? []).find((rec) => decodeText64(rec?.text64).includes(marker)) ?? null;

if (dry) {
    reporter.log(`dry-run: 依赖解析成功（未启动 GUI）；日志路径 ${logPath}`);
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.check("log-path-resolved", logPath.endsWith("waveapp.log"), logPath);
    // dry 只解析依赖，不进台账（台账记的是「真验过一次」）。
    reporter.finish({ cleanup: null, ledger: false });
} else {
    let instance = null;
    let client = null;
    try {
        instance = await ensureInstance({
            attach,
            resetProfile: !attach,
            profile: PROFILE,
            cdpPort: CDP_PORT,
            vitePort: VITE_PORT,
        });
        client = instance.client;
        const pages = await listPageTargets(ENDPOINT);
        if (pages.length > 1) {
            client = (await pickLiveRenderer(pages, connectToTarget, ENDPOINT)).client;
        }
        await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        log(`instance ready (${attach ? "attach" : "launch"})；日志 ${logPath}`);
        await dismissOnboarding(client, { log });

        const baseline = await client.evaluate(TERM_BLOCK);
        check("baseline-term-present", baseline?.blockId != null, JSON.stringify(baseline ?? null));
        await client.evaluate(ARM_PENDING_EVENTS);
        const logOffset = logSize();

        // ── 1. UI：新建 agent 并发送 ──
        await client.evaluate(OPEN_MODAL);
        const sendButton = await waitForProbe(
            client,
            `document.querySelector("[data-commontext-send-button]") != null`,
            (v) => v === true,
            { timeoutMs: 20000 }
        );
        check("commontext-modal-open", sendButton === true, `sendButton=${sendButton}`);
        const caret = await client.evaluate(CARET_POINT);
        check("send-caret-point", caret != null, JSON.stringify(caret ?? null));
        if (caret != null) await realClick(client, caret);
        const popoverOpen = await waitForProbe(
            client,
            `document.querySelector(${JSON.stringify(POPOVER)}) != null`,
            (v) => v === true,
            { timeoutMs: 10000 }
        );
        check("send-popover-open", popoverOpen === true, `open=${popoverOpen}`);
        if (popoverOpen !== true) throw new Error("Send popover 未打开，后续发送无法进行");

        const config = await client.evaluate(
            SET_CONFIG({ mode: "create", background: true, profile: null, tab: { kind: "current" }, folder: null })
        );
        check(
            "config-create-current-tab",
            config?.mode === "create" && config?.tab?.kind === "current",
            JSON.stringify(config ?? null)
        );

        const editorValue = await client.evaluate(SET_EDITOR_TEXT(SEND_TEXT));
        check(
            "editor-text-set",
            typeof editorValue === "string" && editorValue.includes(MARKER),
            String(editorValue).slice(0, 120)
        );
        // 编辑器折叠（600ms）会移动工具栏，点坐标在写文本后重取。
        await sleep(700);
        const sendPoint = await client.evaluate(SEND_POINT);
        check("send-button-point", sendPoint != null, JSON.stringify(sendPoint ?? null));
        if (sendPoint == null) throw new Error("「发送」按钮不存在");
        await realClick(client, sendPoint);

        const modalClosed = await waitForProbe(
            client,
            `document.querySelector(${JSON.stringify(POPOVER)}) == null && document.querySelector("[data-commontext-send-button]") == null`,
            (v) => v === true,
            { timeoutMs: 20000 }
        );
        check("send-closes-modal", modalClosed === true, `closed=${modalClosed}`);

        // ── 2. 新 agent block（当前 Tab）──
        const newTerm = await waitForProbe(
            client,
            TERM_BLOCK,
            (probe) => probe != null && probe.blockId !== "" && probe.blockId !== baseline?.blockId,
            { timeoutMs: 60000, intervalMs: 500 }
        );
        const newBlockId = newTerm?.blockId ?? "";
        check(
            "new-agent-block-created",
            newBlockId !== "" && newBlockId !== baseline?.blockId,
            `baseline=${baseline?.blockId ?? ""} new=${newBlockId}`
        );
        if (newBlockId === "") throw new Error("新建 agent block 未出现（window.term 未切换）");
        const meta = await client.evaluate(TERM_BLOCK_META(newBlockId));
        check(
            "new-block-is-agent-term",
            meta?.view === "term" && String(meta?.provider ?? "") !== "",
            JSON.stringify(meta ?? null)
        );
        await reporter.shot(client, "01-after-create-send");

        // ── 3. 派发回执（后端状态机：accepted → submitted → confirmed）──
        const confirmed = await waitForProbe(
            client,
            DISPATCH_LIST,
            (res) => {
                if (res?.ok !== true) return false;
                const rec = findDispatch(res.records, MARKER);
                return rec != null && rec.state === "confirmed";
            },
            { timeoutMs: DISPATCH_CONFIRM_MS, intervalMs: 2000 }
        );
        const dispatchRecord = findDispatch(confirmed?.records ?? [], MARKER);
        check(
            "dispatch-record-created",
            dispatchRecord != null,
            dispatchRecord == null
                ? `no record for marker; list=${JSON.stringify((confirmed?.records ?? []).map((r) => r.state))} err=${confirmed?.error ?? ""}`
                : `dispatchid=${dispatchRecord.dispatchid} blockid=${dispatchRecord.blockid}`
        );
        check(
            "dispatch-record-targets-new-block",
            dispatchRecord?.blockid === newBlockId,
            `recordBlock=${dispatchRecord?.blockid ?? ""} newBlock=${newBlockId}`
        );
        // 回执必须与日志里的提交确认证据对得上：只看 state=confirmed 会被「无条件 confirmed」骗过。
        const submitEvidenceAtDispatch = submitConfirmLine(readLogTail(logOffset), newBlockId);
        check(
            "dispatch-submit-confirmed",
            dispatchRecord?.state === "confirmed" &&
                (dispatchRecord?.submittedat ?? 0) > 0 &&
                !dispatchRecord?.error &&
                submitEvidenceAtDispatch != null &&
                submitEvidenceAtDispatch[2] === "true",
            JSON.stringify({
                state: dispatchRecord?.state,
                submittedat: dispatchRecord?.submittedat,
                confirmedat: dispatchRecord?.confirmedat,
                submitretries: dispatchRecord?.submitretries,
                error: dispatchRecord?.error ?? "",
                log: submitEvidenceAtDispatch != null ? submitEvidenceAtDispatch[0] : "no submit confirm line",
            })
        );

        // ── 4. TUI 真的收到文本（真实回显，不是事件信号）──
        const tuiTail = await waitForProbe(client, TERM_TAIL, (text) => String(text ?? "").includes(MARKER), {
            timeoutMs: TUI_TEXT_MS,
            intervalMs: 2000,
        });
        check(
            "tui-shows-sent-text",
            String(tuiTail ?? "").includes(MARKER),
            `markerHits=${String(tuiTail ?? "").split(MARKER).length - 1} tailLen=${String(tuiTail ?? "").length}`
        );
        await reporter.shot(client, "02-tui-text");

        // ── 5. agent 真的回复（会话 turn 的 assistant 正文）──
        const replyProbe = await waitForProbe(
            client,
            REPLY_ROWS,
            (res) =>
                (res?.rows ?? []).some(
                    (row) => String(row?.role ?? "") === "assistant" && String(row?.text ?? "").includes(MARKER)
                ),
            { timeoutMs: REPLY_MS, intervalMs: 5000 }
        );
        const replyHit = (replyProbe?.rows ?? []).find(
            (row) => String(row?.role ?? "") === "assistant" && String(row?.text ?? "").includes(MARKER)
        );
        check(
            "agent-replied-with-marker",
            replyHit != null,
            replyHit != null
                ? `sessionid=${replyProbe?.sessionid} turn=${replyHit.turn} chars=${String(replyHit.text).length}`
                : `sessionid=${replyProbe?.sessionid ?? ""} rows=${JSON.stringify(
                      (replyProbe?.rows ?? []).map((r) => ({ role: r.role, turn: r.turn, len: String(r.text).length }))
                  )} error=${replyProbe?.error ?? ""}`
        );
        await reporter.shot(client, "03-agent-reply");

        // ── 6. 反证：前端 pending-input 链一条事件都不该出现 ──
        const pendingEvents = await client.evaluate(PENDING_EVENTS);
        check(
            "no-pending-input-injected",
            (pendingEvents?.injected ?? []).length === 0,
            JSON.stringify(pendingEvents?.injected ?? [])
        );
        check(
            "no-pending-input-fallback",
            (pendingEvents?.fallback ?? []).length === 0,
            JSON.stringify(pendingEvents?.fallback ?? [])
        );

        // ── 7. 后端日志：这次修复的核心证据 ──
        const logSegment = readLogTail(logOffset);
        check("log-path-readable", logSegment.length > 0, `${logPath}（新写入 ${logSegment.length} 字节）`);
        check(
            "log-agentsend-injected",
            new RegExp(`\\[agentsend\\] ${newBlockId} injected \\d+ bytes`).test(logSegment),
            `block=${newBlockId}`
        );
        const submitLine = submitConfirmLine(logSegment, newBlockId);
        check(
            "log-agentsend-submit-confirmed",
            submitLine != null && submitLine[2] === "true",
            submitLine != null ? submitLine[0] : "no submit confirm line"
        );
        check(
            "log-no-dispatch-failed",
            !new RegExp(`\\[agentdispatch\\][^\\n]*${newBlockId}[^\\n]*failed`).test(logSegment) &&
                !/\[agentdispatch\] d-\w+ failed/.test(logSegment),
            logSegment
                .split("\n")
                .filter((line) => line.includes("[agentdispatch]") && line.includes("failed"))
                .slice(-3)
                .join(" | ") || "无 failed 行"
        );

        reporter.finish({
            extra: {
                marker: MARKER,
                blockId: newBlockId,
                dispatchid: dispatchRecord?.dispatchid ?? "",
                submitretries: dispatchRecord?.submitretries ?? 0,
                logPath,
            },
            skipped: [
                "existing（发到已存在 agent block）路径：本台只钉 create；existing 由 commontext-send-agent-block 与单测覆盖",
                "远端 connection 目标：agentsend 本地-only，本轮不覆盖",
                "提交未确认（submitconfirmed=false）的可观测性：需要构造永远吞回车的 TUI，真机不可控；由 create 路径单测的 reject 用例覆盖",
            ],
            cleanup: () => {
                client?.close?.();
                if (instance?.spawned && !keepOpen) instance.cleanup?.();
            },
        });
    } catch (error) {
        reporter.fatal(error, { cleanup: () => instance?.cleanup?.() });
    }
}
