#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// F-1121-agent-roundtrip 真机验证台：`wsh agent send --wait-reply` /
// `--no-wait` 游标 / `wsh session wait` 的 CLI 真机闭环（prd AC4-AC8）。
//
// 为什么必须真机：本包的判据全是「真实后端行为」——
//   - 回合完成三信号（agentstatus seq / 会话文件增长 / turn 计数）只有真 pi
//     TUI 跑起来、hook 真的 `wsh agentstatus` 上报才会齐；
//   - `--reply-wait-ms 180000` 只有在 wsh CLI 自己把 RPC 超时放大到等待窗口
//     之上时才不会变成假 `E_TIMEOUT`（implement.md 的回滚点，单测锁不到）；
//   - session wait 的 idle 判定走的是 `session live` 同一个合并器，需要真活会话。
//
// 剧本（每条都走真实 wsh CLI，跑完自动关实例）：
//   1. ROUNDTRIP_OK  wait-reply 180s → replied=true / turn>0 / replyText 含 ROUNDTRIP_OK
//   2. 假超时        wait-reply 5s 对慢任务 → replied=false / warnings 含 reply-timeout / 退出码 0
//      （可选补收：之后 session turn 里真的出现 SLOW_DONE；3 分钟内没等到记 skipped，不算失败）
//   3. no-wait 游标  → 立即返回带 replycursor；随后轮询该 turn 的 assistant 文本出 NOWAIT_OK
//   4. session wait  → 块空闲后 --until idle 命中 matched=true；不存在的 key → 退出码非 0 + E_NOT_FOUND
//   5. RPC 不假杀    剧本 1 已隐式覆盖（180s 窗口 > wsh 默认 8s），断言里显式禁 reply-rpc-deadline
//
// 目标块：`agent launch --profile pi` 新建（新块 = 新会话，避开并发写同一 jsonl
// 把 turn 分支打乱的老坑，见 agent-resume 台注释）。
//
// 凭据链路：wsh 在 app 外没有 token。台子先用 renderer 里的 RpcApi.AgentAuthGrantCommand
// （app 内部，无需 scope）铸一个 launch-scope token 到 tmp/verify-agent-roundtrip/token.json；
// launch scope 覆盖 observe/data/launch 全部所需命令（pkg/agentscope/scope.go）。
// 块 meta 读 / 删块不在 commandScopes 表里，一律走 renderer 的 RpcApi。
//
// 用法：
//   node scripts/verify/agent-roundtrip/verify.mjs               # 起干净实例 → 全流程 → 自动关
//   node scripts/verify/agent-roundtrip/verify.mjs --attach      # 复用已起实例（迭代主力）
//   node scripts/verify/agent-roundtrip/verify.mjs --keep-open   # 结束后不关实例
//   node scripts/verify/agent-roundtrip/verify.mjs --dry         # 只解析参数/依赖，不启动 GUI
//   node scripts/verify/agent-roundtrip/verify.mjs --rebuild-wsh # 强制重编 tmp 下的 wsh.exe
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { ensureInstance } from "../lib/launch.mjs";
import { createReporter } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer, sleep } from "../lib/probes.mjs";

const AREA = "agent-roundtrip";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");
const rebuildWsh = argv.includes("--rebuild-wsh");

// 独立 profile + 独立端口：不与别的 area 抢默认实例（默认 profile=verify / cdp=9231 共用）。
const PROFILE = "verify-agent-roundtrip";
const CDP_PORT = 9260;
const VITE_PORT = 51870;
const ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const workDir = path.join(repoRoot, "tmp", "verify-agent-roundtrip");
const wshExe = path.join(workDir, "wsh.exe");
const tokenPath = path.join(workDir, "token.json");
// 服务器端（Electron 主进程）写文件：给它的路径用正斜杠，cmd / bash 两种默认 shell 都吃得下。
const tokenPathFwd = tokenPath.split(path.sep).join("/");

// 一轮 wait-reply 的 CLI 侧 RPC 预算是 wait+15s（capped 320s），execFile 必须再宽一点；
// 180s 窗口 > wsh 默认 8s RPC 超时，正是「不假杀」的判据本体。
const ROUNDTRIP_WAIT_MS = 180000;
// `session for-block` 走 session live 合并器（扫全量会话索引 + 逐个读 JSONL），
// 本机大索引下 >8s（wsh session 默认 --timeout 8000）会被截成假 EC-TIME。
const SESSION_RPC_TIMEOUT = 120000;
const SESSION_TIMEOUT_ARGS = ["--timeout", String(SESSION_RPC_TIMEOUT)];
const ROUNDTRIP_EXEC_TIMEOUT_MS = ROUNDTRIP_WAIT_MS + 35000;
// pi 首回合启动/思考 60-120s，读路径给足 3 分钟。
const TURN_POLL_MS = 180000;
const TURN_POLL_INTERVAL_MS = 5000;

const reporter = createReporter({
    area: AREA,
    endpoint: ENDPOINT,
    mode: attach ? "attach" : "launch+reset",
    meta: { profile: PROFILE, cdpPort: CDP_PORT, vitePort: VITE_PORT, roundtripWaitMs: ROUNDTRIP_WAIT_MS },
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
    } catch {
        throw new Error(`wsh ${args.join(" ")} stdout is not JSON: ${String(res.stdout).slice(0, 400)}`);
    }
}

/** 会话读路径的耗时日志（>2s 才记）：完成判定的采样代价直接决定 reply 窗口的粒度。 */
async function timedWshJson(args, opts) {
    const t0 = Date.now();
    try {
        return await wshJson(args, opts);
    } finally {
        const ms = Date.now() - t0;
        if (ms > 2000) log(`slow rpc (${ms}ms): wsh ${args.join(" ")}`);
    }
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
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
            ". .\\scripts\\use-local-env.ps1 -Quiet; go build -o tmp/verify-agent-roundtrip/wsh.exe ./cmd/wsh",
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
        name: "verify-roundtrip",
        scope: ["launch"],
        ttlseconds: 3600,
        out: ${JSON.stringify(tokenPathFwd)},
    });
    return { ok: true, out: res.outpath, scopes: res.scopes, socket: res.socket };
})()`;

/** 兜底路径（agent-resume 台预验证过）：term 块 + ControllerInput 打进 `wsh auth grant`。 */
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
    const direct = await client.evaluate(grantDirectJs).catch((err) => ({ ok: false, reason: String(err) }));
    if (direct?.ok && existsSync(tokenPath)) {
        log(`token granted via in-app RPC → ${tokenPath}`);
        return { via: "in-app-rpc" };
    }
    log(`direct grant failed (${JSON.stringify(direct)}), falling back to terminal block injection`);
    const created = await client.evaluate(createTermBlockJs).catch((err) => ({ ok: false, reason: String(err) }));
    if (!created?.ok || !created?.blockId) {
        throw new Error(`创建 term 块失败: ${JSON.stringify(created)}`);
    }
    createdBlockIds.push(created.blockId);
    log(`term block created: ${created.blockId}`);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const ids = await client.evaluate(blockIdsProbe);
        if (ids.includes(created.blockId)) break;
        await sleep(600);
    }
    await sleep(3000);
    const cmd = `wsh auth grant --name verify-roundtrip --scope launch --ttl 60m --out "${tokenPathFwd}"\r`;
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

// ── 会话读路径助手 ─────────────────────────────────────────────────────────

/**
 * `session for-block` 轮询到块绑定上了会话（= 块就绪：pi 进程已起、后端已持久化
 * agent:sessionid）。刚起的块往往还没有 sessionKey（pi 首条回复前不落 JSONL、索引里
 * 也没有它），所以 key 允许为空，用 sessionid 兜底；回合完成后才要求有 key。
 */
async function waitBlockSession(blockId, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const res = await wshRun(["session", "for-block", blockId, ...SESSION_TIMEOUT_ARGS, "--json"], {
            timeoutMs: SESSION_RPC_TIMEOUT + 15000,
        });
        if (res.code === 0) {
            const rec = parseJson(res.stdout);
            if (rec?.sessionid || rec?.sessionkey) {
                return { ok: true, key: rec.sessionkey ?? "", sessionid: rec.sessionid ?? "", record: rec };
            }
            last = rec;
        } else {
            last = (res.stderr || res.stdout || "").slice(0, 200);
        }
        await sleep(2000);
    }
    return { ok: false, key: "", sessionid: "", last };
}

/** 会话的最新 turn 号（页内最后一行 = 最大 turn 号）。 */
async function latestTurnNumber(sessionKey) {
    const turns = await timedWshJson(["session", "turns", sessionKey, "--limit", "1", "--refresh", ...SESSION_TIMEOUT_ARGS], {
        timeoutMs: SESSION_RPC_TIMEOUT + 15000,
    });
    const rows = turns?.rows ?? [];
    return rows.reduce((max, row) => Math.max(max, row?.turn ?? 0), 0);
}

/**
 * 轮询「最新 turn 的 assistant 文本包含 needle」。
 * 只看 assistant：注入的 user 文本本身就含标记（NOWAIT_OK 场景），用它断言会把
 * 「打进去了」当成「回来了」。minTurn 是游标下界（strictly greater）。
 */
async function waitAssistantText(sessionKey, needle, { minTurn = 0, timeoutMs = TURN_POLL_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const turnNo = await latestTurnNumber(sessionKey);
            last = { turn: turnNo, minTurn };
            if (turnNo > minTurn) {
                const detail = await timedWshJson(
                    ["session", "turn", sessionKey, "--turn", String(turnNo), "--chars", "8000", "--refresh", ...SESSION_TIMEOUT_ARGS],
                    { timeoutMs: SESSION_RPC_TIMEOUT + 15000 }
                );
                const assistantText = (detail?.rows ?? [])
                    .filter((row) => row?.role === "assistant")
                    .map((row) => String(row?.text ?? ""))
                    .join("\n");
                const hit = assistantText.includes(needle);
                last = { turn: turnNo, minTurn, hit, assistantChars: assistantText.length, assistant: assistantText.slice(0, 200) };
                if (hit) {
                    return { found: true, ...last };
                }
            }
        } catch (err) {
            last = { error: String(err).slice(0, 300) };
        }
        await sleep(TURN_POLL_INTERVAL_MS);
    }
    return { found: false, ...(last ?? {}) };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
    if (dry) {
        // dry：只确认依赖解析与脚本语法，不编 wsh、不起 GUI。
        const syntax = await run(process.execPath, ["--check", path.join(here, "verify.mjs")]);
        check("dry-deps-resolve", syntax.code === 0, `lib/{cdp,launch,report,probes}.mjs + syntax=${syntax.code}`);
        reporter.finish({ skipped, cleanup: null, ledger: false });
        return;
    }

    mkdirSync(workDir, { recursive: true });
    await ensureWsh();

    // ── CLI 帮助面（不需要实例）：新 flags 真的绑上了 ────────────────────────
    const sendHelp = await run(wshExe, ["agent", "send", "--help"]);
    const sendHelpText = `${sendHelp.stdout}${sendHelp.stderr}`;
    const sendFlags = ["--wait-reply", "--no-wait", "--reply-wait-ms", "--reply-chars", "--reply-poll-ms"];
    const missingSend = sendFlags.filter((flag) => !sendHelpText.includes(flag));
    const waitHelp = await run(wshExe, ["session", "wait", "--help"]);
    const waitHelpText = `${waitHelp.stdout}${waitHelp.stderr}`;
    const missingWait = ["--until", "--timeout-ms"].filter((flag) => !waitHelpText.includes(flag));
    check(
        "cli-roundtrip-help-flags",
        sendHelp.code === 0 && waitHelp.code === 0 && missingSend.length === 0 && missingWait.length === 0,
        {
            sendExit: sendHelp.code,
            waitExit: waitHelp.code,
            missingSendFlags: missingSend,
            missingWaitFlags: missingWait,
        }
    );

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

    // ── 准备：agent launch --profile pi（新块 = 新会话）─────────────────────
    // 不带 --model：走目录默认（PRD 的用法就是让调用方只挑 agent）。
    const launch = await wshRun(["agent", "launch", "--profile", "pi", "--wait", "--json"], { timeoutMs: 120000 });
    const launchJson = parseJson(launch.stdout);
    check(
        "launch-pi-block",
        launch.code === 0 && launchJson?.ok === true && typeof launchJson?.blockid === "string" && launchJson.blockid.length > 0,
        {
            exit: launch.code,
            ok: launchJson?.ok,
            blockid: launchJson?.blockid,
            profile: launchJson?.profile,
            model: launchJson?.model,
            cmd: launchJson?.cmd,
            stderr: (launch.stderr || "").slice(0, 300),
        }
    );
    const blockId = launchJson?.blockid;
    if (!blockId) {
        reporter.finish({
            skipped,
            extra: { launchStdout: launch.stdout.slice(0, 2000), launchStderr: launch.stderr.slice(0, 2000) },
            cleanup: () => closeInstance(),
        });
        return;
    }
    createdBlockIds.push(blockId);

    // 块就绪门：pi 起进程 → 后端持久化 agent:sessionid → `session for-block` 解析得出。
    const blockSession = await waitBlockSession(blockId);
    check("launch-block-session-resolved", blockSession.ok === true, {
        found: blockSession.ok,
        sessionKey: blockSession.key || null,
        sessionid: blockSession.sessionid || null,
        last: blockSession.ok ? undefined : JSON.stringify(blockSession.last).slice(0, 400),
    });
    let sessionRef = blockSession.key || blockSession.sessionid;
    if (!sessionRef) {
        await cleanupBlocks();
        reporter.finish({
            skipped,
            extra: { blockId, note: "块会话未解析出来，后续剧本无法执行" },
            cleanup: () => closeInstance(),
        });
        return;
    }
    log(`target block=${blockId} session=${sessionRef} (sessionid=${blockSession.sessionid || "-"})`);
    const meta = await client.evaluate(getMetaJs(blockId)).catch(() => null);
    log(`block meta: ${JSON.stringify(meta)}`);
    await shot(client, "01-launched-block");

    // ── 剧本 1：ROUNDTRIP_OK（wait-reply 180s）─────────────────────────────
    const rt0 = Date.now();
    const roundtrip = await wshRun(
        [
            "agent",
            "send",
            "--block",
            blockId,
            "--text",
            "reply with exactly: ROUNDTRIP_OK",
            "--wait-reply",
            "--reply-wait-ms",
            String(ROUNDTRIP_WAIT_MS),
            "--json",
        ],
        { timeoutMs: ROUNDTRIP_EXEC_TIMEOUT_MS }
    );
    const roundtripWallMs = Date.now() - rt0;
    const roundtripJson = parseJson(roundtrip.stdout);
    const roundtripWarnings = roundtripJson?.warnings ?? [];
    check(
        "roundtrip-reply-text",
        roundtrip.code === 0 &&
            roundtripJson?.ok === true &&
            roundtripJson?.injected === true &&
            roundtripJson?.replied === true &&
            String(roundtripJson?.replytext ?? "").includes("ROUNDTRIP_OK") &&
            (roundtripJson?.turn ?? 0) > 0 &&
            (roundtripJson?.replywaitedms ?? 0) > 0,
        {
            exit: roundtrip.code,
            wallMs: roundtripWallMs,
            ok: roundtripJson?.ok,
            injected: roundtripJson?.injected,
            submitted: roundtripJson?.submitted,
            replied: roundtripJson?.replied,
            turn: roundtripJson?.turn,
            replywaitedms: roundtripJson?.replywaitedms,
            totalchars: roundtripJson?.totalchars,
            truncated: roundtripJson?.truncated,
            replytext: String(roundtripJson?.replytext ?? "").slice(0, 240),
            warnings: roundtripWarnings,
            stderr: (roundtrip.stderr || "").slice(0, 300),
        }
    );
    // 剧本 5（隐式）：180s 等待窗口 > wsh 默认 8s RPC 超时。若 CLI 没放大 RPC 超时，
    // 这里会是 replied=false + reply-rpc-deadline（假失败），而不是一条真回复。
    check(
        "roundtrip-rpc-no-fake-kill",
        roundtripJson?.replied === true && !roundtripWarnings.includes("reply-rpc-deadline"),
        {
            replied: roundtripJson?.replied,
            waitedMs: roundtripJson?.replywaitedms ?? roundtripJson?.waitedms,
            wallMs: roundtripWallMs,
            warnings: roundtripWarnings,
            note: "replied=true 且无 reply-rpc-deadline = RPC 超时确实被放大到等待窗口之上",
        }
    );
    await shot(client, "02-after-roundtrip-ok");
    // 回合完成的三信号之一就是 turn 计数（走会话索引），所以 replied=true 之后该会话
    // 一定已入库：这里补一次 for-block 拿正式 sessionKey，失败才是真问题。
    const indexedSession = await waitBlockSession(blockId, 60000);
    check("session-key-indexed", indexedSession.ok === true && !!indexedSession.key, {
        sessionKey: indexedSession.key || null,
        sessionid: indexedSession.sessionid || null,
        warnings: indexedSession.record?.warnings,
    });
    if (indexedSession.key) sessionRef = indexedSession.key;
    const sessionId = indexedSession.sessionid || blockSession.sessionid;
    const cursorAfterRoundtrip = roundtripJson?.turn ?? 0;

    // 注入前的就绪门可能因 TUI 还在喷字（上一回合的流式回放）报 E_AGENT_NOT_READY；
    // 那不是超时判据的失败 —— 等它安静下来重发即可（注入本身还没发生）。
    async function sendWithRetry(prompt, tries = 3) {
        let last = null;
        for (let attempt = 1; attempt <= tries; attempt++) {
            last = await wshRun(
                ["agent", "send", "--block", blockId, "--text", prompt, "--wait-reply", "--reply-wait-ms", "5000", "--json"],
                { timeoutMs: 150000 }
            );
            if (last.code === 0 || !String(last.stderr ?? "").includes("E_AGENT_NOT_READY")) {
                return last;
            }
            log(`send attempt ${attempt}: E_AGENT_NOT_READY, waiting 10s for the TUI to settle`);
            await sleep(10000);
        }
        return last;
    }

    // ── 剧本 2：假超时（5s 窗口对慢任务）→ replied=false，退出码仍是 0 ─────
    // 慢任务的构造：让 pi 自己跑一条真耗时命令（bash `sleep 60`），回合时长由工具
    // 执行时间兜底，比「数 N 行」这种生成类任务可控（实测数 30/120/240/400 行都在
    // 十秒级答完）。标记 SLOW_DONE 仍保留，供下面的补收断言用。
    //
    // 为什么这条断言曾经失败（2026-11-21 真机首跑）：旧完成判定的三个信号全是
    // 「回合开始」信号（agentstatus working 上报 / 会话文件写入 / turn 计数），慢回合
    // 在窗口末尾必然三信号齐 → 提前 replied=true。修法是把 agentstatus 的收口状态
    // （idle/done）加成第四个条件，并只在收口 + 文件长过基线时才付昂贵的会话索引读
    // （两档采样）。现在 replied=true 是零容忍的失败（prematureReplied），不再用
    // 「重试到有一条正确」掩盖；重试只留给注入前的 E_AGENT_NOT_READY。
    //
    // replied=true 的 attempt 仍附「返回瞬间块是否还在 working」「标记在返回之后才
    // 落地」两项证据，失败时能直指谓词提前判定。
    const timeoutPrompts = [
        "Use the bash tool to run `sleep 60` and wait for it to finish, then reply with exactly: SLOW_DONE",
        "Start your reply with exactly SLOW_DONE on its own line, then count from 1 to 1500, one number per line.",
    ];
    const timeoutAttempts = [];
    let timeoutCase = null;
    for (let idx = 0; idx < timeoutPrompts.length; idx++) {
        const t0 = Date.now();
        const send = await sendWithRetry(timeoutPrompts[idx]);
        const returnedAt = Date.now();
        const json = parseJson(send.stdout);
        const warnings = json?.warnings ?? [];
        const replied = json?.replied === true;
        const attempt = {
            attempt: idx + 1,
            exit: send.code,
            ok: json?.ok,
            injected: json?.injected,
            replied,
            replywaitedms: json?.replywaitedms ?? json?.waitedms,
            wallMs: returnedAt - t0,
            replytext: String(json?.replytext ?? "").slice(0, 120),
            warnings,
            stderr: (send.stderr || "").slice(0, 200),
        };
        if (replied) {
            // 提前判定的两个证据：① 返回瞬间块还在 working；② 标记在返回之后才落地。
            const idleNow = await wshRun(
                ["session", "wait", sessionRef, "--until", "idle", "--timeout-ms", "3000", "--json"],
                { timeoutMs: 60000 }
            );
            attempt.idleRightAfterReturn = parseJson(idleNow.stdout)?.matched === true;
            const marker = await waitAssistantText(sessionRef, "SLOW_DONE", {
                minTurn: cursorAfterRoundtrip,
                timeoutMs: 150000,
            });
            attempt.markerAfterReturn = marker.found === true;
            attempt.markerTurn = marker.turn;
            attempt.markerAssistantChars = marker.assistantChars;
            attempt.markerWaitMs = Date.now() - returnedAt;
        }
        timeoutAttempts.push(attempt);
        log(`timeout attempt ${idx + 1}: ${JSON.stringify(attempt)}`);
        if (send.code === 0 && json?.ok === true && json?.injected === true && replied === false && warnings.includes("reply-timeout")) {
            timeoutCase = attempt;
            break;
        }
    }
    const prematureReplied = timeoutAttempts.filter((attempt) => attempt.replied === true);
    check("timeout-not-an-error", timeoutCase != null && prematureReplied.length === 0, {
        passingAttempt: timeoutCase?.attempt ?? null,
        attempts: timeoutAttempts,
        prematureReplied: prematureReplied.map((attempt) => attempt.attempt),
        note:
            "退出码 0 + replied=false + warnings 含 reply-timeout（超时不是错误）；" +
            "任何 attempt replied=true 都是失败（state 未收口就判完成）；" +
            "replied=true 的 attempt 附 idleRightAfterReturn/markerAfterReturn 指认提前判定",
    });
    await shot(client, "03-after-timeout");

    // 补收（PRD：超时后调用方自己读回来）：3 分钟内 assistant 文本出 SLOW_DONE。
    // 失败不算这条断言失败 —— 记 skipped（慢任务的 pi 回合可能比 3 分钟更久）。
    const slowRecovery = await waitAssistantText(sessionRef, "SLOW_DONE", { minTurn: cursorAfterRoundtrip, timeoutMs: 180000 });
    if (slowRecovery.found) {
        check("timeout-then-read-back", true, { turn: slowRecovery.turn, assistantChars: slowRecovery.assistantChars });
    } else {
        skipped.push(
            `超时后补收未在 180s 内读到 SLOW_DONE（最后观察：${JSON.stringify(slowRecovery).slice(0, 300)}）；` +
                "调用方仍可用 session turn 自取，不算 reply-timeout 判据失败"
        );
        log(`slow recovery not seen in 180s: ${JSON.stringify(slowRecovery).slice(0, 400)}`);
    }
    await shot(client, "04-after-slow-recovery");

    // 进剧本 3 之前等块真的空闲：上一轮的慢任务回合可能还在跑，此时注入新的 --no-wait
    // 会被 pi 排队/打断，把 nowait 游标断言搞成偶发失败。空闲门只记日志（不是断言），
    // 真正的 `session wait` 断言在剧本 4a 单独做。
    const idleGate = await wshRun(
        ["session", "wait", sessionRef, "--until", "idle", "--timeout-ms", "120000", "--json"],
        { timeoutMs: 180000 }
    );
    log(`idle gate before nowait: exit=${idleGate.code} ${(idleGate.stdout || idleGate.stderr || "").slice(0, 240)}`);

    // ── 剧本 3：--no-wait 游标（立即返回 + 之后自取）──────────────────────
    const nowaitCursorBefore = await latestTurnNumber(sessionRef).catch(() => cursorAfterRoundtrip);
    const nw0 = Date.now();
    const noWait = await wshRun(
        [
            "agent",
            "send",
            "--block",
            blockId,
            "--text",
            "reply with exactly: NOWAIT_OK",
            "--no-wait",
            "--json",
        ],
        { timeoutMs: 150000 }
    );
    const noWaitWallMs = Date.now() - nw0;
    const noWaitJson = parseJson(noWait.stdout);
    const nowaitCursor = noWaitJson?.replycursor;
    check(
        "nowait-returns-cursor",
        noWait.code === 0 &&
            noWaitJson?.ok === true &&
            noWaitJson?.injected === true &&
            noWaitJson?.replied !== true &&
            typeof nowaitCursor === "number" &&
            nowaitCursor >= 0 &&
            noWaitWallMs < 30000,
        {
            exit: noWait.code,
            wallMs: noWaitWallMs,
            ok: noWaitJson?.ok,
            injected: noWaitJson?.injected,
            replied: noWaitJson?.replied ?? false,
            replycursor: nowaitCursor,
            turnAtCursorProbe: nowaitCursorBefore,
            warnings: noWaitJson?.warnings,
            stderr: (noWait.stderr || "").slice(0, 300),
            note: "wallMs 远小于等待窗口 = 没等回复；replycursor 是之后自取的游标",
        }
    );
    // 随后用读路径自取：游标之后的新 turn 的 assistant 文本必须出现 NOWAIT_OK。
    const noWaitReply = await waitAssistantText(sessionRef, "NOWAIT_OK", {
        minTurn: typeof nowaitCursor === "number" ? nowaitCursor : nowaitCursorBefore,
        timeoutMs: TURN_POLL_MS,
    });
    check(
        "nowait-reply-read-back",
        noWaitReply.found === true,
        {
            found: noWaitReply.found,
            turn: noWaitReply.turn,
            minTurn: noWaitReply.minTurn,
            assistantChars: noWaitReply.assistantChars,
            assistant: noWaitReply.assistant,
            error: noWaitReply.error,
        }
    );
    await shot(client, "05-after-nowait");

    // ── 剧本 4a：session wait --until idle 命中 ────────────────────────────
    // 块此刻应已空闲（NOWAIT_OK 的回合刚被读回来）；命中判据是 matched=true。
    const waitIdle = await wshRun(
        ["session", "wait", sessionRef, "--until", "idle", "--timeout-ms", "60000", "--json"],
        { timeoutMs: 120000 }
    );
    const waitIdleJson = parseJson(waitIdle.stdout);
    check(
        "session-wait-idle-matched",
        waitIdle.code === 0 && waitIdleJson?.matched === true && waitIdleJson?.state != null,
        {
            exit: waitIdle.code,
            matched: waitIdleJson?.matched,
            state: waitIdleJson?.state,
            waitedms: waitIdleJson?.waitedms,
            polls: waitIdleJson?.polls,
            warnings: waitIdleJson?.warnings,
            stderr: (waitIdle.stderr || "").slice(0, 300),
        }
    );

    // ── 剧本 4b：不存在的会话 → 立刻 E_NOT_FOUND（不是等到超时）────────────
    const waitMissing = await wshRun(
        ["session", "wait", "codex:definitely-not-there:/x.jsonl", "--until", "idle", "--timeout-ms", "60000", "--json"],
        { timeoutMs: 60000 }
    );
    const waitMissingText = `${waitMissing.stderr}${waitMissing.stdout}`;
    check(
        "session-wait-not-found",
        waitMissing.code !== 0 && waitMissingText.includes("E_NOT_FOUND"),
        {
            exit: waitMissing.code,
            hasNotFound: waitMissingText.includes("E_NOT_FOUND"),
            stderr: (waitMissing.stderr || "").slice(0, 300),
            stdout: (waitMissing.stdout || "").slice(0, 200),
        }
    );

    // 有意不覆盖的面（写明，不静默省略）：
    skipped.push("MCP 面（snorkeling_agent_send 的 waitreply 等参数 / snorkeling_session_wait）由单测 schema+scope 快照覆盖，本台只验 CLI");
    skipped.push("blocked 审批流（reply-agent-blocked 警告）真机未构造：需要 pi 在回合中弹出可自动恢复的审批");
    skipped.push("session wait --until working/blocked/done 三种状态只验了 idle（done 是 idle 的同义归并，单测覆盖）");
    skipped.push("--wait-reply 与 --async / --no-wait 的 E_USAGE 互斥由 CLI 单测覆盖，真机未重复");
    skipped.push(
        "超时判据的第三种收尾（四信号齐但正文仍空 → replied=true + reply-empty）真机未构造：需要索引收口后仍读不回正文，走单测/代码路径"
    );

    // 收尾：清块必须在 finish 之前（finish 的 cleanup 是同步调用，await 会被 process.exit 截断）。
    await cleanupBlocks();

    reporter.finish({
        skipped,
        extra: {
            tokenVia: grant.via,
            tokenFile: tokenPath,
            blockId,
            sessionRef,
            sessionId,
            blockMeta: meta,
            roundtrip: {
                waitMs: ROUNDTRIP_WAIT_MS,
                wallMs: roundtripWallMs,
                turn: roundtripJson?.turn,
                replywaitedms: roundtripJson?.replywaitedms,
                replytext: roundtripJson?.replytext,
            },
            timeoutCase: {
                passingAttempt: timeoutCase?.attempt ?? null,
                attempts: timeoutAttempts,
                readBackTurn: slowRecovery.found ? slowRecovery.turn : null,
            },
            noWaitCase: { wallMs: noWaitWallMs, replycursor: nowaitCursor, readBackTurn: noWaitReply.turn ?? null },
        },
        cleanup: () => closeInstance(),
    });
}

async function cleanupBlocks() {
    for (const id of [...createdBlockIds]) {
        await deleteBlock(id, "cleanup");
    }
    createdBlockIds.length = 0;
}

function closeInstance() {
    client?.close?.();
    if (instance?.spawned && !keepOpen) instance.cleanup?.();
}

try {
    await main();
} catch (err) {
    await cleanupBlocks().catch(() => {});
    reporter.fatal(err, { cleanup: () => closeInstance() });
}
