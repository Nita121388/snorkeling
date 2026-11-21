#!/usr/bin/env node
// Copyright 2026, Command  Line Inc.
// SPDX-License-Identifier: Apache-2.0

// F-1121-agent-resume 真机验证台：`wsh agent resume` / `wsh session mark` 的
// CLI 真机闭环（找会话 → 续上 → 补发一句话 → 读回合 → 星标开关）。
//
// 为什么要有这个台子：本包的判据依赖真实后端（会话索引解析真实 ~/.pi 会话、
// shellcontroller 把 agent:autoresume meta 转成 pi --session-id、AgentSendCommand
// 真实注入到 pi TUI、turn 读路径重新解析 jsonl）。单测锁的是 DTO 映射与 golden meta，
// 锁不到「真机上块真的建出来、meta 真的对、pi 真的回了 RESUME_OK」。
//
// 凭据链路：wsh 在 app 外没有 token。台子先用 renderer 里的 RpcApi.AgentAuthGrantCommand
// （app 内部，无需 scope）铸一个 launch-scope token 到 tmp/verify-agent-resume/token.json；
// 如果 renderer 直铸被拒（E_NO_ROUTE），退回 dispatch 预验证过的路径：建一个 term 块、
// 把 `wsh auth grant ...` 命令打进终端、轮询 token 文件出现。
//
// 12 条断言：
//   1. help-agent-resume-flags    `wsh agent resume --help` 含 --tab / --send / --no-focus
//   2. help-session-mark-unmark   `wsh session mark --help` 含 --unmark
//   3. resume-json-ok             resume <key> --json → ok / blockid / source / sessionid 全对
//   4. resume-meta-autoresume     新块 meta agent:autoresume === true
//   5. resume-meta-provider       新块 meta agent:provider === 会话 source
//   6. resume-meta-sessionid      新块 meta agent:sessionid === 会话 sessionid
//   7. resume-send-injected       resume <key> --send … --json → ok 且 send.injected=true
//   8. resume-send-reply-visible  session turn 读路径在 180s 内出现 assistant 回 RESUME_OK
//   9. mark-sets-flag             session mark → marked=true 且 --marked starred 过滤命中
//  10. mark-list-filter-true      `--marked true` 过滤应收窄且含该 key（CLI help 写的契约）
//  11. mark-unmark-clears         --unmark 后 --marked starred 不再含该 key
//  12. resume-error-not-found     不存在的 key → 非零退出 + stderr 含 E_NOT_FOUND
//
// 目标会话：真实 ~/.pi 会话（session list --source pi 取最新；跳过本进程 PI_SESSION_ID 与
// 最近 10 分钟仍在被写入的会话——两个 writer 并发写同一 jsonl 会把 turn 分支打乱，实测踩过）。
// pi 不可得时按 codex → 任意 source 降级，并在报告里写明。
//
// 用法：
//   node scripts/verify/agent-resume/verify.mjs               # 起干净实例 → 全流程 → 自动关
//   node scripts/verify/agent-resume/verify.mjs --attach      # 复用已起实例（迭代主力）
//   node scripts/verify/agent-resume/verify.mjs --keep-open   # 结束后不关实例
//   node scripts/verify/agent-resume/verify.mjs --dry         # 只解析参数/依赖，不启动 GUI
//   node scripts/verify/agent-resume/verify.mjs --rebuild-wsh # 强制重编 tmp 下的 wsh.exe
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "agent-resume";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const rebuildWsh = argv.includes("--rebuild-wsh");

// 独立 profile + 独立端口：不与别的 area 抢默认实例（默认 profile=verify / cdp=9231 共用）。
const PROFILE = "verify-agent-resume";
const CDP_PORT = 9258;
const VITE_PORT = 51860;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const workDir = path.join(repoRoot, "tmp", "verify-agent-resume");
const wshExe = path.join(workDir, "wsh.exe");
const tokenPath = path.join(workDir, "token.json");
// 服务器端（Electron 主进程）写文件：给它的路径用正斜杠，cmd / bash 两种默认 shell 都吃得下。
const tokenPathFwd = tokenPath.split(path.sep).join("/");
// 60s 一格的 execFile 超时兜不住 resume --send（CLI 内部预算 300s）。
const SEND_TIMEOUT_MS = 330000;

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT },
});
const { log, check, shot } = reporter;
const skipped = [];
let instance = null;
let client = null;
const createdBlockIds = [];

// ── 子进程与 wsh CLI 助手 ────────────────────────────────────────────────────

function run(cmd, args, { timeoutMs = 60000, cwd = repoRoot } = {}) {
    return new Promise((resolve) => {
        execFile(
            cmd,
            args,
            { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
            (err, stdout, stderr) => resolve({ code: err?.code ?? (err ? 1 : 0), stdout, stderr, err: err ?? null })
        );
    });
}

const wshRun = (args, opts) => run(wshExe, ["--token-file", tokenPath, ...args], opts);

async function wshJson(args, opts) {
    const res = await wshRun([...args, "--json"], opts);
    if (res.code !== 0) {
        throw new Error(`wsh ${args.join(" ")} failed (exit=${res.code}): ${res.stderr || res.stdout}`);
    }
    try {
        return JSON.parse(res.stdout);
    } catch (err) {
        throw new Error(`wsh ${args.join(" ")} stdout is not JSON: ${String(res.stdout).slice(0, 400)}`);
    }
}

async function ensureWsh() {
    if (existsSync(wshExe) && !rebuildWsh) {
        log(`wsh.exe exists: ${wshExe}`);
        return;
    }
    log("building wsh.exe (go build ./cmd/wsh, 首次可达数分钟)…");
    const t0 = Date.now();
    const res = await run(
        "powershell",
        [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            ". .\\scripts\\use-local-env.ps1 -Quiet; go build -o tmp/verify-agent-resume/wsh.exe ./cmd/wsh",
        ],
        { timeoutMs: 300000 }
    );
    if (res.code !== 0 || !existsSync(wshExe)) {
        throw new Error(`go build wsh 失败 (exit=${res.code}): ${res.stderr || res.stdout}`);
    }
    log(`wsh.exe built in ${Math.round((Date.now() - t0) / 1000)}s`);
}

// ── renderer 内 RPC（in-app，无 scope 限制）────────────────────────────────

const blockIdsProbe = `(() => [...document.querySelectorAll(".block[data-blockid]")].map((el) => el.getAttribute("data-blockid")))()`;

/** in-app 直铸 token（server 端写文件，0600 规则只活在一处）。 */
const grantDirectJs = `(async () => {
    const wshclient = await import("/frontend/app/store/wshclientapi.ts");
    const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
    const res = await wshclient.RpcApi.AgentAuthGrantCommand(wshrpcutil.TabRpcClient, {
        name: "verify-resume",
        scope: ["launch"],
        ttlseconds: 3600,
        out: ${JSON.stringify(tokenPathFwd)},
    });
    return { ok: true, out: res.outpath, scopes: res.scopes, socket: res.socket };
})()`;

/** 兜底路径（dispatch 预验证过）：term 块 + ControllerInput 打进 `wsh auth grant`。 */
const createTermBlockJs = `(async () => {
    const mod = await import("/frontend/app/store/global.ts");
    const blockId = await mod.createBlock({ meta: { view: "term", controller: "shell" } }, false, false);
    return { ok: true, blockId };
})()`;

function controllerInputJs(blockId, text) {
    const input64 = Buffer.from(text, "utf8").toString("base64");
    return `(async () => {
        const wshclient = await import("/frontend/app/store/wshclientapi.ts");
        const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
        await wshclient.RpcApi.ControllerInputCommand(wshrpcutil.TabRpcClient, {
            blockid: ${JSON.stringify(blockId)},
            inputdata64: ${JSON.stringify(input64)},
        });
        return { ok: true };
    })()`;
}

async function grantToken() {
    if (existsSync(tokenPath) && !attach) {
        rmSync(tokenPath, { force: true });
    }
    // 路径一：renderer 直铸（app 内部调用，不走 scope 门）。
    const direct = await client.evaluate(grantDirectJs).catch((err) => ({ ok: false, reason: String(err) }));
    if (direct?.ok && existsSync(tokenPath)) {
        log(`token granted via in-app RPC → ${tokenPath}`);
        return { via: "in-app-rpc" };
    }
    log(`direct grant failed (${JSON.stringify(direct)}), falling back to terminal block injection`);
    // 路径二：term 块里跑真实 `wsh auth grant`，轮询 token 文件落地。
    const created = await client.evaluate(createTermBlockJs).catch((err) => ({ ok: false, reason: String(err) }));
    if (!created?.ok || !created?.blockId) {
        throw new Error(`创建 term 块失败: ${JSON.stringify(created)}`);
    }
    createdBlockIds.push(created.blockId);
    log(`term block created: ${created.blockId}`);
    // 等 shell 就绪：块进 DOM 再宽限 3s（controllerinput 早到会被丢弃）。
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const ids = await client.evaluate(blockIdsProbe);
        if (ids.includes(created.blockId)) break;
        await sleep(600);
    }
    await sleep(3000);
    const cmd = `wsh auth grant --name verify-resume --scope launch --ttl 60m --out "${tokenPathFwd}"\r`;
    await client.evaluate(controllerInputJs(created.blockId, cmd));
    const fileDeadline = Date.now() + 30000;
    while (Date.now() < fileDeadline) {
        if (existsSync(tokenPath)) {
            log(`token granted via terminal block → ${tokenPath}`);
            return { via: "term-block" };
        }
        await sleep(1000);
    }
    throw new Error(`token 文件 30s 未出现: ${tokenPath}`);
}

const getMetaJs = (blockId) => `(async () => {
    const wshclient = await import("/frontend/app/store/wshclientapi.ts");
    const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
    const meta = await wshclient.RpcApi.GetMetaCommand(wshrpcutil.TabRpcClient, {
        oref: ${JSON.stringify(`block:${blockId}`)},
    });
    return {
        view: meta?.["view"],
        controller: meta?.["controller"],
        autoresume: meta?.["agent:autoresume"],
        provider: meta?.["agent:provider"],
        sessionid: meta?.["agent:sessionid"],
    };
})()`;

const deleteBlockJs = (blockId) => `(async () => {
    const wshclient = await import("/frontend/app/store/wshclientapi.ts");
    const wshrpcutil = await import("/frontend/app/store/wshrpcutil.ts");
    await wshclient.RpcApi.DeleteBlockCommand(wshrpcutil.TabRpcClient, { blockid: ${JSON.stringify(blockId)} });
    return { ok: true };
})()`;

async function deleteBlock(blockId, label) {
    const res = await client.evaluate(deleteBlockJs(blockId)).catch((err) => ({ ok: false, err: String(err) }));
    log(`deleteblock ${label} (${blockId}): ${JSON.stringify(res)}`);
}

// 本机 ui:locale=zh 时引导按钮是中文，共享 dismissOnboarding 盖不住。
const zhOnboardingButtonProbe = `(() => {
    const wanted = ["继续", "下一步", "开始使用", "跳过", "知道了", "开始", "完成", "好"];
    const els = [...document.querySelectorAll(".modal-backdrop button, .modal-backdrop [role=button], .modal button")];
    for (const el of els) {
        const t = (el.textContent || "").replace(/[\\u200b-\\u200f\\ufeff]/g, "").trim();
        if (!wanted.includes(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t };
    }
    return null;
})()`;

async function dismissOnboardingZh() {
    for (let i = 0; i < 12; i++) {
        const btn = await client.evaluate(zhOnboardingButtonProbe).catch(() => null);
        if (btn == null) return;
        await client.click(btn.x, btn.y);
        log(`dismissed zh onboarding: ${btn.t}`);
        await sleep(700);
    }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
    if (dry) {
        // dry：只确认依赖解析与脚本语法，不编 wsh、不起 GUI。
        const syntax = await run(process.execPath, ["--check", path.join(here, "verify.mjs")]);
        check("dry-deps-resolve", syntax.code === 0, `lib/{cdp,launch,report,probes}.mjs syntax=${syntax.code}`);
        reporter.finish({ skipped, cleanup: null, ledger: false });
        return;
    }

    mkdirSync(workDir, { recursive: true });
    await ensureWsh();

    // ── 断言 1-2：CLI 帮助面（不需要实例）──────────────────────────────────
    const resumeHelp = await run(wshExe, ["agent", "resume", "--help"]);
    const resumeHelpText = `${resumeHelp.stdout}${resumeHelp.stderr}`;
    check(
        "help-agent-resume-flags",
        resumeHelp.code === 0 &&
            resumeHelpText.includes("--tab") &&
            resumeHelpText.includes("--send") &&
            resumeHelpText.includes("--no-focus"),
        { exit: resumeHelp.code, hasTab: resumeHelpText.includes("--tab"), hasSend: resumeHelpText.includes("--send"), hasNoFocus: resumeHelpText.includes("--no-focus") }
    );
    const markHelp = await run(wshExe, ["session", "mark", "--help"]);
    const markHelpText = `${markHelp.stdout}${markHelp.stderr}`;
    check("help-session-mark-unmark", markHelp.code === 0 && markHelpText.includes("--unmark"), {
        exit: markHelp.code,
        hasUnmark: markHelpText.includes("--unmark"),
    });

    // ── 起实例 ──────────────────────────────────────────────────────────────
    instance = await ensureInstance({
        attach,
        cdpPort: CDP_PORT,
        vitePort: VITE_PORT,
        profile: PROFILE,
        resetProfile: !attach,
    });
    client = instance.client;
    // 多 renderer 时挑真工作区（空壳 shell 页建不了块）。
    const pages = await listPageTargets(ENDPOINT).catch(() => []);
    if (pages.length > 1) {
        client = (await pickLiveRenderer(pages, connectToTarget, ENDPOINT)).client;
    }
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    log(`instance ready (${attach ? "attach" : "launch"})`);

    await dismissOnboarding(client, { log });
    await dismissOnboardingZh();
    const backdropGone = await client.evaluate(
        `(() => { const b = document.querySelector(".modal-backdrop"); return b == null || getComputedStyle(b).display === "none"; })()`
    );
    if (backdropGone !== true) {
        throw new Error("引导弹窗没清干净（modal-backdrop 仍在）");
    }

    // ── 铸 token（launch scope：observe/data/launch 全放行）────────────────
    const grant = await grantToken();
    const listProbe = await wshRun(["session", "list", "--json", "--limit", "1"]);
    if (listProbe.code !== 0) {
        throw new Error(`token 连通性检查失败: ${listProbe.stderr || listProbe.stdout}`);
    }
    log(`wsh token works (grant via ${grant.via})`);

    // ── 找目标会话：pi → codex → 任意 source（降级要写进报告）──────────────
    // 选“空闲”会话：本进程自己的 PI_SESSION_ID 与**最近 10 分钟还在被别的 pi 进程写**
    // 的会话都不能碰（两个 writer 并发写同一 jsonl 会把 turn 分支打乱，看到的是
    // 别家会话的 turn 而本条的 RESUME_OK 落在分叉上——实测踩过）。
    const currentPiSessionId = process.env.PI_SESSION_ID ?? "";
    const IDLE_MS = 10 * 60 * 1000;

    function sessionFilePath(key) {
        const first = String(key ?? "").indexOf(":");
        const second = String(key ?? "").indexOf(":", first + 1);
        return second > 0 ? String(key).slice(second + 1) : "";
    }

    function sessionFileMtime(key) {
        const file = sessionFilePath(key);
        if (!file || !existsSync(file)) return 0;
        try {
            return statSync(file).mtimeMs;
        } catch {
            return 0;
        }
    }

    function isIdle(candidateKey) {
        const mtime = sessionFileMtime(candidateKey);
        return mtime > 0 && Date.now() - mtime > IDLE_MS;
    }

    async function pickSession() {
        const attempts = [
            { source: "pi", args: ["--source", "pi"] },
            { source: "codex", args: ["--source", "codex"] },
            { source: null, args: [] },
        ];
        const rejected = [];
        for (const attempt of attempts) {
            const res = await wshJson(["session", "list", ...attempt.args, "--limit", "50"]);
            const records = res?.records ?? [];
            for (const rec of records) {
                if (!rec?.sessionkey || !rec?.sessionid) continue;
                if (rec.sessionid === currentPiSessionId) {
                    rejected.push(`${rec.sessionid}: 本进程会话`);
                    continue;
                }
                if (!isIdle(rec.sessionkey)) {
                    rejected.push(`${rec.sessionid}: 10min 内有写入（mtime=${new Date(sessionFileMtime(rec.sessionkey) || 0).toISOString()}）`);
                    continue;
                }
                if (rec.projectpath && !existsSync(rec.projectpath)) {
                    rejected.push(`${rec.sessionid}: projectpath 不存在 (${rec.projectpath})`);
                    continue;
                }
                return { record: rec, degraded: attempt.source !== "pi", requested: attempt.source };
            }
        }
        return { record: null, rejected };
    }
    const picked = await pickSession();
    if (!picked.record) {
        throw new Error(`session list 没有可用会话（pi / codex / 任意 source 均被过滤）: ${JSON.stringify(picked.rejected?.slice(0, 8))}`);
    }
    const target = picked.record;
    const targetKey = target.sessionkey;
    if (picked.degraded) {
        skipped.push(`pi 会话不可用，降级到 source=${target.provider}（key=${targetKey}）`);
        log(`DEGRADED: pi 不可用，使用 ${target.provider} 会话 ${targetKey}`);
    } else {
        log(`target session: ${targetKey} (provider=${target.provider}, id=${target.sessionid})`);
    }

    // ── 断言 3：resume <key> --json ────────────────────────────────────────
    const resume1 = await wshRun(["agent", "resume", targetKey, "--no-focus", "--wait", "--json"], {
        timeoutMs: 60000,
    });
    let resume1Json = null;
    try {
        resume1Json = JSON.parse(resume1.stdout);
    } catch {
        /* handled by check below */
    }
    check(
        "resume-json-ok",
        resume1.code === 0 &&
            resume1Json?.ok === true &&
            typeof resume1Json?.blockid === "string" &&
            resume1Json.blockid.length > 0 &&
            resume1Json?.source === target.provider &&
            resume1Json?.sessionid === target.sessionid,
        { exit: resume1.code, ok: resume1Json?.ok, blockid: resume1Json?.blockid, source: resume1Json?.source, sessionid: resume1Json?.sessionid, stderr: (resume1.stderr || "").slice(0, 300) }
    );
    const blockA = resume1Json?.blockid;
    if (!blockA) {
        reporter.finish({
            skipped,
            extra: { resumeStdout: resume1.stdout.slice(0, 2000), resumeStderr: resume1.stderr.slice(0, 2000) },
            cleanup: () => instance?.cleanup?.(),
        });
        return;
    }
    createdBlockIds.push(blockA);

    // ── 断言 4-6：新块 meta（renderer 内 GetMetaCommand，免 scope 门）──────
    let meta = null;
    const metaDeadline = Date.now() + 20000;
    while (Date.now() < metaDeadline) {
        meta = await client.evaluate(getMetaJs(blockA)).catch(() => null);
        if (meta?.autoresume !== undefined) break;
        await sleep(800);
    }
    check("resume-meta-autoresume", meta?.autoresume === true, { meta });
    check("resume-meta-provider", meta?.provider === target.provider, { provider: meta?.provider, expected: target.provider });
    check("resume-meta-sessionid", meta?.sessionid === target.sessionid, { sessionid: meta?.sessionid, expected: target.sessionid });
    await shot(client, "01-resumed-block");

    // 收掉第一个块再测 --send：两个 pi 进程并发写同一 jsonl 是没验过的面。
    await deleteBlock(blockA, "resume-1");
    dropBlock(blockA);
    await sleep(2500);

    // ── 断言 7：resume --send（真实注入管线）──────────────────────────────
    const sendText = "reply with exactly: RESUME_OK";
    const resume2 = await wshRun(
        ["agent", "resume", targetKey, "--no-focus", "--send", sendText, "--json"],
        { timeoutMs: SEND_TIMEOUT_MS }
    );
    let resume2Json = null;
    try {
        resume2Json = JSON.parse(resume2.stdout);
    } catch {
        /* handled by check below */
    }
    check(
        "resume-send-injected",
        resume2.code === 0 && resume2Json?.ok === true && resume2Json?.send?.injected === true,
        { exit: resume2.code, ok: resume2Json?.ok, injected: resume2Json?.send?.injected, submitted: resume2Json?.send?.submitted, warnings: resume2Json?.warnings, stderr: (resume2.stderr || "").slice(0, 300) }
    );
    const blockB = resume2Json?.blockid;
    if (blockB) createdBlockIds.push(blockB);
    await shot(client, "02-send-block");

    // ── 断言 8：RESUME_OK 出现在 turn 读路径（pi 启动慢，预算 180s）────────
    let sawResumeOk = false;
    let lastTurnsRaw = null;
    const turnDeadline = Date.now() + 180000;
    while (Date.now() < turnDeadline && !sawResumeOk) {
        try {
            const turns = await wshJson(["session", "turns", targetKey, "--limit", "3", "--refresh"]);
            lastTurnsRaw = turns;
            const rows = turns?.rows ?? [];
            const maxTurn = rows.reduce((m, r) => Math.max(m, r?.turn ?? 0), 0);
            if (maxTurn > 0) {
                const detail = await wshJson([
                    "session",
                    "turn",
                    targetKey,
                    "--turn",
                    String(maxTurn),
                    "--chars",
                    "4000",
                    "--refresh",
                ]);
                lastTurnsRaw = { turns, detail };
                // 只看 assistant 行：注入的 user 文本本身就含 RESUME_OK，用它断言会把
                // “打进去了”当成“回了”。真正要证的是模型回了这句话。
                const answered = (detail?.rows ?? []).some(
                    (r) => r?.role === "assistant" && String(r?.text ?? "").includes("RESUME_OK")
                );
                if (answered) {
                    sawResumeOk = true;
                }
            }
        } catch (err) {
            log(`turn poll error (retry): ${String(err).slice(0, 200)}`);
        }
        if (!sawResumeOk) await sleep(5000);
    }
    check("resume-send-reply-visible", sawResumeOk, {
        found: sawResumeOk,
        lastRead: JSON.stringify(lastTurnsRaw ?? {}).slice(0, 600),
    });
    await shot(client, "03-after-reply");

    // ── 断言 9-10：session mark / --unmark + list --marked 过滤 ────────────
    // PRD AC7 / CLI help 的契约是 `--marked true|false`；后端 ListOptions 只认
    // "starred"/"unstarred"（GUI filter-panel 传的就是这两个值）。台子同时记录两种取值，
    // 失败时能直接指认是「写入没生效」还是「flag 词表不一致」。
    const markOn = await wshRun(["session", "mark", targetKey, "--json"], { timeoutMs: 30000 });
    let markOnJson = null;
    try {
        markOnJson = JSON.parse(markOn.stdout);
    } catch {
        /* handled below */
    }
    const markedTrue = await wshJson(["session", "list", "--marked", "true", "--limit", "500"]);
    const markedTrueKeys = (markedTrue?.records ?? []).map((r) => r?.sessionkey).filter(Boolean);
    const markedStarred = await wshJson(["session", "list", "--marked", "starred", "--limit", "500"]);
    const markedStarredKeys = (markedStarred?.records ?? []).map((r) => r?.sessionkey).filter(Boolean);
    const allKeys = (await wshJson(["session", "list", "--limit", "500"]))?.records?.map((r) => r?.sessionkey) ?? [];
    check(
        "mark-sets-flag",
        markOn.code === 0 && markOnJson?.marked === true && markedStarredKeys.includes(targetKey),
        {
            exit: markOn.code,
            marked: markOnJson?.marked,
            inStarredFilter: markedStarredKeys.includes(targetKey),
            starredFilterSize: markedStarredKeys.length,
        }
    );
    check(
        "mark-list-filter-true",
        // 「true 过滤」应当与 starred 过滤等价（后端只认 starred/unstarred）：同为标记集，
        // 且不该等于全量。用三者尺寸对比，失败时能直接指认是词表不一致而不是写入没生效。
        markedTrueKeys.length === markedStarredKeys.length && markedTrueKeys.includes(targetKey),
        {
            note: "CLI help / PRD 写的是 --marked true；后端 ListOptions 只认 starred/unstarred 时 true 等于不过滤",
            trueFilterSize: markedTrueKeys.length,
            starredFilterSize: markedStarredKeys.length,
            allSize: allKeys.length,
            inTrueFilter: markedTrueKeys.includes(targetKey),
        }
    );

    const markOff = await wshRun(["session", "mark", targetKey, "--unmark", "--json"], { timeoutMs: 30000 });
    let markOffJson = null;
    try {
        markOffJson = JSON.parse(markOff.stdout);
    } catch {
        /* handled below */
    }
    const unmarkedStarred = await wshJson(["session", "list", "--marked", "starred", "--limit", "500"]);
    const unmarkedStarredKeys = (unmarkedStarred?.records ?? []).map((r) => r?.sessionkey).filter(Boolean);
    check(
        "mark-unmark-clears",
        markOff.code === 0 && markOffJson?.marked === false && !unmarkedStarredKeys.includes(targetKey),
        {
            exit: markOff.code,
            marked: markOffJson?.marked,
            stillInStarredFilter: unmarkedStarredKeys.includes(targetKey),
        }
    );

    // ── 断言 11：错误路径 E_NOT_FOUND ───────────────────────────────────────
    const notFound = await wshRun(["agent", "resume", "codex:definitely-not-there:/x.jsonl", "--json"], {
        timeoutMs: 30000,
    });
    check(
        "resume-error-not-found",
        notFound.code !== 0 && (notFound.stderr + notFound.stdout).includes("E_NOT_FOUND"),
        { exit: notFound.code, stderr: (notFound.stderr || "").slice(0, 200), stdout: (notFound.stdout || "").slice(0, 200) }
    );

    // 有意不覆盖的面（写明，不静默省略）：
    if (!picked.degraded && target.provider !== "pi") {
        skipped.push(`目标会话 provider=${target.provider}，未逐家验证 codex/claude/opencode 恢复`);
    }
    if (target.provider === "pi") {
        skipped.push("codex/claude/opencode 会话的真机恢复未覆盖（AC6 的降级面，pi 主链已验）");
    }
    skipped.push("remote 连接拒绝（E_UNSUPPORTED）与 gemini（E_USAGE）由单测覆盖，真机未跑");
    skipped.push("MCP schema/scope 由单测覆盖，本台子只验 CLI 面");

    // 收尾：清块必须在 finish 之前（finish 的 cleanup 是同步调用，await 会被 process.exit 截断）。
    for (const id of [...createdBlockIds]) {
        await deleteBlock(id, "cleanup");
    }
    createdBlockIds.length = 0;

    reporter.finish({
        skipped,
        extra: {
            tokenVia: grant.via,
            tokenFile: tokenPath,
            targetSession: { key: targetKey, provider: target.provider, sessionid: target.sessionid },
        },
        cleanup: () => closeInstance(),
    });
}

function dropBlock(blockId) {
    const idx = createdBlockIds.indexOf(blockId);
    if (idx >= 0) createdBlockIds.splice(idx, 1);
}

function closeInstance() {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

async function cleanupBlocks() {
    for (const id of [...createdBlockIds]) {
        await deleteBlock(id, "cleanup");
    }
    createdBlockIds.length = 0;
}

try {
    await main();
} catch (err) {
    await cleanupBlocks().catch(() => {});
    reporter.fatal(err, { cleanup: () => closeInstance() });
}
