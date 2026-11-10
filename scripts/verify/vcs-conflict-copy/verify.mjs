#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// VCS 合并冲突 + push 被拒复制给 agent —— 真机 CDP 验证（11-10-cfa-vcs-conflict 的验收断言）。
//
//   node scripts/verify/vcs-conflict-copy/verify.mjs            # 干净实例 → 跑 → 自动关
//   node scripts/verify/vcs-conflict-copy/verify.mjs --attach    # 复用已起实例
//   node scripts/verify/vcs-conflict-copy/verify.mjs --keep-open # 跑完留实例人工看图
//   node scripts/verify/vcs-conflict-copy/verify.mjs --dry       # 只解析依赖
//
// 场景（真实 git 仓库，本地命令造状态，UI 真实驱动）：
//   1. push 被拒仓库（amend 后非快进）：点 Push → 失败卡 + Copy for agent，
//      payload 含 action/repo/stderr（! [rejected]）/Task/Output contract；
//   2. 合并冲突仓库（同文件双分支改同一行后 merge）：冲突条 + Copy for agent，
//      payload 含 <<<<<<< / ======= / >>>>>>> / === path === / Task / Output contract；
//   3. 干净仓库：无冲突条。
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { dismissOnboarding, pickLiveRenderer, waitForProbe } from "../lib/probes.mjs";
import { createReporter, repoRoot } from "../lib/report.mjs";

const AREA = "vcs-conflict-copy";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs + git");
    reporter.finish({ cleanup: null, ledger: false });
}

function git(cwd, ...args) {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/** 造一个 push 必被拒的仓库：push 成功一次 → amend → 再 push 必非快进。 */
function makeRejectedPushRepo(parentDir) {
    const repo = path.join(parentDir, "reject");
    execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
    git(repo, "config", "user.email", "verify@local");
    git(repo, "config", "user.name", "Verify");
    writeFileSync(path.join(repo, "file.txt"), "line one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "base");
    const remote = path.join(parentDir, "reject-remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", remote], { encoding: "utf8" });
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-u", "origin", "main");
    // 改写已推送的历史 → 下一次 push 必被拒（非快进）。
    writeFileSync(path.join(repo, "file.txt"), "line one amended\n");
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "-m", "amended");
    return repo;
}

/** 造一个有未解决合并冲突的仓库：两分支改同一行后 merge。 */
function makeConflictRepo(parentDir) {
    const repo = path.join(parentDir, "conflict");
    execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
    git(repo, "config", "user.email", "verify@local");
    git(repo, "config", "user.name", "Verify");
    writeFileSync(path.join(repo, "conflicted.txt"), "base line\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "base");
    git(repo, "checkout", "-b", "feature");
    writeFileSync(path.join(repo, "conflicted.txt"), "feature version\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feature change");
    git(repo, "checkout", "main");
    writeFileSync(path.join(repo, "conflicted.txt"), "main version\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "main change");
    try {
        git(repo, "merge", "feature");
    } catch {
        // merge 失败 = 冲突已就位，正是要的状态
    }
    return repo;
}

function createBlockJs(meta) {
    return `(async () => {
        const mod = await import("/frontend/app/store/global.ts");
        if (typeof mod.createBlock !== "function") return { ok: false, err: "no createBlock" };
        const blockId = await mod.createBlock({ meta: ${JSON.stringify(meta)} }, false, false);
        return { ok: true, blockId };
    })()`;
}

function blockProbe(blockId) {
    return `(() => {
        const blk = document.querySelector(".block.block-${blockId}");
        if (blk == null) return { err: "block gone" };
        const conflictBar = blk.querySelector("[data-vcs-conflict-bar]");
        const conflictCopy = conflictBar ? conflictBar.querySelector("[data-copy-for-agent]") : null;
        const errorCards = [...blk.querySelectorAll("[data-copy-for-agent]")]
            .filter((el) => el.closest("[data-vcs-conflict-bar]") == null);
        return {
            hasConflictBar: conflictBar != null,
            conflictCopy: conflictCopy != null,
            errorCopyCount: errorCards.length,
        };
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

async function captureAfterClick(client, clickJs, label) {
    await client.evaluate(captureClipboardJs);
    const clicked = await client.evaluate(clickJs);
    if (clicked !== true) throw new Error(`点击 ${label} 失败`);
    let payload = "";
    for (let i = 0; i < 30 && payload === ""; i++) {
        payload = await client.evaluate(`(() => window.__cfaCaptured || "")()`);
        if (payload === "") await new Promise((r) => setTimeout(r, 300));
    }
    if (payload === "") throw new Error(`${label} 复制后未捕获到 payload`);
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

        const workDir = mkdtempSync(path.join(path.join(repoRoot, ".cache", "verify"), "vcs-conflict-"));
        try {
            // ── 1. push 被拒：失败卡 + 复制 ────────────────────────────────
            const rejectRepo = makeRejectedPushRepo(workDir);
            const opened1 = await client.evaluate(
                createBlockJs({ view: "vcs", "vcs:path": rejectRepo })
            );
            if (opened1?.ok !== true) throw new Error(`打开 vcs 块失败: ${JSON.stringify(opened1)}`);
            const block1 = opened1.blockId;
            // 等仓库加载完成（出现 Push 按钮，且 push 可点：ahead > 0）
            let pushEnabled = false;
            for (let i = 0; i < 40 && !pushEnabled; i++) {
                pushEnabled = await client.evaluate(`(() => {
                    const blk = document.querySelector(".block.block-${block1}");
                    const btn = [...(blk?.querySelectorAll("button[title='Push'], button[aria-label='Push']") ?? [])][0];
                    return btn != null && !btn.disabled;
                })()`);
                if (!pushEnabled) await new Promise((r) => setTimeout(r, 500));
            }
            reporter.check("push-button-ready", pushEnabled === true, "Push 按钮就绪且可点");

            // 干净树（无冲突）：冲突条不出现（验收点 4 的零态）
            const clean0 = await waitForProbe(client, blockProbe(block1), () => true, { timeoutMs: 1000 });
            reporter.check("no-conflict-bar-when-clean", clean0?.hasConflictBar !== true, "无冲突仓库无冲突条");

            await client.evaluate(`(() => {
                const blk = document.querySelector(".block.block-${block1}");
                const btn = [...(blk?.querySelectorAll("button[title='Push'], button[aria-label='Push']") ?? [])][0];
                if (btn == null) return false;
                btn.click();
                return true;
            })()`);
            const rejected = await waitForProbe(client, blockProbe(block1), (st) => st?.errorCopyCount > 0, {
                timeoutMs: 45000,
            });
            reporter.check("push-error-card-copy", rejected?.errorCopyCount === 1, "失败卡出现 Copy for agent");
            await reporter.shot(client, "01-push-rejected");

            const failPayload = await captureAfterClick(
                client,
                `(() => {
                    const blk = document.querySelector(".block.block-${block1}");
                    const btn = [...(blk?.querySelectorAll("[data-copy-for-agent]") ?? [])][0];
                    if (btn == null) return false;
                    btn.click();
                    return true;
                })()`,
                "push 失败复制"
            );
            reporter.check("push-payload-action", failPayload.includes("action: push"), "含 action: push");
            reporter.check("push-payload-repo", failPayload.includes("repo: "), "含 repo 路径");
            reporter.check("push-payload-stderr", failPayload.includes("stderr ("), "含 stderr 段");
            reporter.check(
                "push-payload-rejected-line",
                /\[rejected\]|non-fast-forward|rejected/.test(failPayload),
                "含被拒原因（! [rejected] / non-fast-forward）"
            );
            reporter.check("push-payload-task", failPayload.includes("### Task"), "含 Task 段");
            reporter.check("push-payload-contract", failPayload.includes("### Output contract"), "含 Output contract 段");

            // ── 2. 合并冲突：冲突条 + 复制 ────────────────────────────────
            const conflictRepo = makeConflictRepo(workDir);
            const opened2 = await client.evaluate(
                createBlockJs({ view: "vcs", "vcs:path": conflictRepo })
            );
            if (opened2?.ok !== true) throw new Error(`打开冲突 vcs 块失败: ${JSON.stringify(opened2)}`);
            const block2 = opened2.blockId;
            const conflicted = await waitForProbe(
                client,
                blockProbe(block2),
                (st) => st?.hasConflictBar === true && st?.conflictCopy === true,
                { timeoutMs: 45000 }
            );
            reporter.check("conflict-bar-shown", conflicted?.hasConflictBar === true, "冲突条出现");
            reporter.check("conflict-copy-present", conflicted?.conflictCopy === true, "冲突条 Copy for agent 存在");
            await reporter.shot(client, "02-merge-conflict");

            const mergePayload = await captureAfterClick(
                client,
                `(() => {
                    const blk = document.querySelector(".block.block-${block2}");
                    const btn = blk?.querySelector("[data-vcs-conflict-bar] [data-copy-for-agent]");
                    if (btn == null) return false;
                    btn.click();
                    return true;
                })()`,
                "冲突条复制"
            );
            reporter.check("merge-payload-markers", mergePayload.includes("<<<<<<<"), "含 <<<<<<< 标记");
            reporter.check("merge-payload-separator", mergePayload.includes("======="), "含 ======= 分隔");
            reporter.check("merge-payload-end", mergePayload.includes(">>>>>>>"), "含 >>>>>>> 结束标记");
            reporter.check("merge-payload-path-section", mergePayload.includes("=== "), "含 === path === 分段");
            reporter.check("merge-payload-task", mergePayload.includes("### Task"), "含 Task 段");
            reporter.check(
                "merge-payload-contract-count",
                (mergePayload.match(/### Output contract/g) ?? []).length === 1,
                "### Output contract = 1"
            );
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }

        await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup });
    }
} catch (err) {
    reporter.log(`ERROR: ${err?.message ?? err}`);
    await reporter.finish({ cleanup: keepOpen ? null : instance?.cleanup, verdictOverride: "env-error" });
}
