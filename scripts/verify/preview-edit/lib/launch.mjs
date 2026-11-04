// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// verify 实例的生命周期：launch / attach / 健康检查 / 清理。
//
// 关键约束（AGENTS.md）：**只按 PID 结束自己确认过的进程**，绝不按进程名批量杀。
// Electron 会派生一堆子进程，所以清理走"端口 → owner PID"这条唯一可靠路径。

import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, listPageTargets } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const cacheDir = path.join(repoRoot, ".cache", "verify", "preview-edit");

export const DEFAULTS = {
    profile: "verify",
    vitePort: 51799,
    cdpPort: 9231,
};

export function cdpUrl(port = DEFAULTS.cdpPort) {
    return `http://127.0.0.1:${port}`;
}

/** 端口 → 监听进程 PID（Windows）。返回 null 表示没人监听。 */
export function findPidByPort(port) {
    try {
        const out = execFileSync(
            "powershell",
            [
                "-NoProfile",
                "-Command",
                `(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
            ],
            { encoding: "utf8", timeout: 15000 }
        ).trim();
        const pid = Number(out.split(/\s+/)[0]);
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

export function killPid(pid) {
    if (pid == null) return;
    try {
        execFileSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${Number(pid)} -Force`], {
            timeout: 15000,
        });
    } catch {
        /* already gone */
    }
}

async function probeReady(client) {
    return client.evaluate(`(() => {
        if (document.readyState !== "complete") return false;
        if (document.fonts != null && document.fonts.status !== "loaded") return false;
        return document.querySelector(".block-content, .workspace, .markdown-render-root") != null;
    })()`);
}

/**
 * 确保有一个可用的 verify 实例，并返回 { client, spawned, cleanup }。
 *
 * attach=true 时直接连已存在的实例（循环迭代主力路径），连不上就报错并给出"怎么起"的提示。
 */
export async function ensureInstance({
    attach = false,
    cdpPort = DEFAULTS.cdpPort,
    vitePort = DEFAULTS.vitePort,
    resetProfile = true,
} = {}) {
    const url = cdpUrl(cdpPort);

    if (attach) {
        const client = await connect(url);
        await waitForReady(client);
        return { client, spawned: false, cleanup: () => client.close() };
    }

    // 已经有一个在跑就直接复用，避免"起第二个实例抢端口"。
    const existing = await listPageTargets(url).catch(() => []);
    if (existing.length > 0) {
        const client = await connect(url);
        await waitForReady(client);
        return { client, spawned: false, cleanup: () => client.close() };
    }

    // 默认重置 verify profile：验证台需要"干净工作区"。
    // 否则上一轮创建的 preview block 会累积、上次打开的面板可能盖住 markdown，
    // 采样点被别的元素遮挡 → 双击打不开编辑器（实测踩到）。
    if (resetProfile) {
        rmSync(path.join(repoRoot, ".runcfg", DEFAULTS.profile), { recursive: true, force: true });
    }

    mkdirSync(cacheDir, { recursive: true });
    const logPath = path.join(cacheDir, "launch.log");
    // 必须直接把文件描述符交给子进程，不能用 pipe：
    // 用 pipe 时父进程一退出，子进程下一次写 stdout 就 EPIPE 自杀（连带 electron 一起没）。
    const logFd = openSync(logPath, "w");
    let lastExit = null;
    const child = spawn(
        process.execPath,
        [
            path.join(repoRoot, "scripts", "dev-isolated.mjs"),
            "--profile",
            DEFAULTS.profile,
            "--vite-port",
            String(vitePort),
            "--cdp-port",
            String(cdpPort),
        ],
        { cwd: repoRoot, detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true }
    );
    closeSync(logFd);
    child.unref();

    const spawnedPid = child.pid;
    let exited = false;
    child.on("exit", (code) => {
        exited = true;
        lastExit = code;
    });

    // 等 CDP 端口起来（vite build + electron 启动，首次约 60~120s）
    // 首次（profile 被重置）要跑 vite build + go build，实测可达 3~5 分钟。
    const deadline = Date.now() + 420000;
    let lastErr;
    while (Date.now() < deadline) {
        if (exited) {
            throw new Error(
                `verify 启动器提前退出（exit=${lastExit}）。日志: ${logPath}\n` +
                    `手工排查: node scripts/dev-isolated.mjs --profile ${DEFAULTS.profile} --vite-port ${vitePort} --cdp-port ${cdpPort}`
            );
        }
        try {
            const pages = await listPageTargets(url);
            if (pages.length > 0) {
                const client = await connect(url);
                if (await probeReady(client)) {
                    return {
                        client,
                        spawned: true,
                        cleanup: () => {
                            client.close();
                            killPid(findPidByPort(cdpPort));
                        },
                    };
                }
                client.close();
            }
        } catch (err) {
            lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
        `verify 实例启动失败（${url}，spawn pid=${spawnedPid}）。日志: ${logPath}\n${lastErr?.message ?? ""}\n` +
            `手工排查: node scripts/dev-isolated.mjs --profile ${DEFAULTS.profile} --vite-port ${vitePort} --cdp-port ${cdpPort}`
    );
}

export async function waitForReady(client, timeoutMs = 60000) {
    await client.activate?.();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probeReady(client)) return;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("页面未就绪（readyState / fonts / 根节点 三项检查未全部通过）");
}

/** 打开 inline-edit 调试环，让规则能读到 measure 事件。需要 reload 一次。 */
export async function enableInlineEditLog(client) {
    const already = await client.evaluate(`window.__inlineEditLog != null`);
    if (already) return false;
    await client.evaluate(`localStorage.setItem("snorkelingInlineEditDebug", "1")`);
    await client.reload();
    await waitForReady(client);
    await client.evaluate(`window.__inlineEditLogClear?.()`);
    return true;
}

/** 注入"固定观感"样式：禁动效、隐藏光标与选区高亮（否则像素对比会被它们污染）。 */
export async function injectStabilityCss(client) {
    await client.evaluate(`(() => {
        const id = "verify-stability";
        document.getElementById(id)?.remove();
        const style = document.createElement("style");
        style.id = id;
        style.textContent = [
            "*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}",
            "input,textarea,[contenteditable]{caret-color:transparent!important}",
            "::selection{background:transparent!important;color:inherit!important}",
            "::-moz-selection{background:transparent!important;color:inherit!important}",
        ].join("\\n");
        document.head.appendChild(style);
        return true;
    })()`);
}

/**
 * 清掉挡路的浮层。实测踩到两类：
 *   1) 残留的空全屏 `.modal-backdrop`（无内容，吃掉所有点击）
 *   2) 首次安装的 Welcome 引导弹窗（`.modal-wrapper`，有内容，必须点它的 Continue）
 *
 * 策略：先点弹窗自己的"关闭类"按钮（白名单文案），再处理空 backdrop；全屏有内容却
 * 找不到关闭按钮 → 直接报错，绝不强删别人的 DOM。
 */
export async function dismissOverlays(client) {
    const warnings = [];
    // 引导流程是多页向导（Welcome → Wave AI → …），所以按"优先级打分"挑按钮：
    // 先找跳过类（Skip / Not now / Later），再找前进类（Continue / Next / Get Started），最后同意类。
    const DISMISS_SCORER = String.raw`(function score(label) {
        var s = 0;
        if (/^skip/i.test(label)) s = 100;
        else if (/not now|maybe later|later|already have/i.test(label)) s = 90;
        else if (/^(continue|next|next step|get started|got it|done|close|ok)$/i.test(label)) s = 50;
        else if (/^(i agree|agree)$/i.test(label)) s = 40;
        return s;
    })`;

    const probe = () =>
        client.evaluate(`(() => {
            const vw = innerWidth, vh = innerHeight;
            const shells = [...document.querySelectorAll(".modal-wrapper, .modal-backdrop, [role=dialog]")]
                .filter((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > vw * 0.5 && r.height > vh * 0.5;
                });
            const emptyBackdrops = shells.filter((el) => el.classList.contains("modal-backdrop"));
            const score = ${DISMISS_SCORER};
            let dismiss = null;
            let bestScore = 0;
            for (const el of shells) {
                for (const b of el.querySelectorAll("button, [role=button], a")) {
                    const label = (b.textContent || "").trim();
                    const sc = score(label);
                    if (sc <= bestScore) continue;
                    const r = b.getBoundingClientRect();
                    if (r.width <= 0 || r.height <= 0) continue;
                    bestScore = sc;
                    dismiss = { x: r.x + r.width / 2, y: r.y + r.height / 2, label };
                }
            }
            return {
                shells: shells.length,
                emptyBackdrops: emptyBackdrops.length,
                dismiss,
                summary: shells.map((el) => ({
                    cls: String(el.className || "").slice(0, 40),
                    text: (el.textContent || "").trim().slice(0, 60),
                })),
            };
        })()`);

    let state = await probe();

    // 刚启动时弹窗 DOM 可能还没渲染完（按钮尚未挂上）→ 先等它稳定，
    // 稳定后才判断"有没有可点的关闭按钮"（实测：太早 probe 会误判为"找不到按钮"）。
    for (let i = 0; i < 25 && (state.shells === 0 || (state.dismiss == null && state.emptyBackdrops === 0)); i++) {
        await new Promise((r) => setTimeout(r, 400));
        state = await probe();
    }

    // 1) 有"关闭类"按钮的弹窗：真实点击（Welcome / ToS / 升级引导都走这条路）
    for (let i = 0; i < 12 && state.dismiss != null; i++) {
        await client.click(state.dismiss.x, state.dismiss.y);
        await new Promise((r) => setTimeout(r, 350));
        warnings.push(`已关闭弹窗：点击了「${state.dismiss.label}」`);
        state = await probe();
    }

    // 2) 空 backdrop（无内容）→ 真实 Esc 两次，仍在我才移除
    if (state.emptyBackdrops > 0 && state.dismiss == null) {
        for (let i = 0; i < 2 && state.emptyBackdrops > 0; i++) {
            await client.pressKey("Escape");
            await new Promise((r) => setTimeout(r, 250));
            state = await probe();
        }
        if (state.emptyBackdrops > 0) {
            await client.evaluate(`(() => {
                let n = 0;
                for (const b of document.querySelectorAll(".modal-backdrop")) {
                    if ((b.textContent || "").trim() === "") { b.remove(); n++; }
                }
                return n;
            })()`);
            warnings.push(`环境异常：移除了 ${state.emptyBackdrops} 个空的 .modal-backdrop（会吞掉所有点击）`);
            await new Promise((r) => setTimeout(r, 150));
            state = await probe();
        }
    }

    if (state.shells > 0) {
        throw new Error(
            `仍有全屏浮层挡住工作区，且找不到可点的关闭按钮：${JSON.stringify(state.summary)}
` +
                `处理办法：让 app 停在干净状态，或把该弹窗的关闭按钮文案加进 dismissOverlays 的白名单。`
        );
    }
    return warnings;
}
