#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// VCS History 泳道提交图 —— 真机 CDP 验证（11-15-vcs-history-graph 的验收断言）。
//
//   node scripts/verify/vcs-history-graph/verify.mjs              # 干净实例 → 跑 → 自动关
//   node scripts/verify/vcs-history-graph/verify.mjs --attach     # 复用已起实例
//   node scripts/verify/vcs-history-graph/verify.mjs --keep-open  # 结束后留着手工看
//   node scripts/verify/vcs-history-graph/verify.mjs --dry        # 只解析依赖
//
// fixture：tmp/vcs-graph-fixture —— 一次构建的真实 git 仓库（带 bare 远端）：
//   main: c1 → c2 → m1(merge feature, tag v1.0, HEAD -> main, origin/main)
//   feature: f1 → f2（从 c1 分叉） → 2 泳道并发
//
// 断言：
//   1) 每行都有泳道 cell（[data-vcs-graph-cell]，行数 = 提交数 5）
//   2) HEAD 行有光环节点（[data-vcs-graph-head] 恰好 1 个）
//   3) ref 徽章：首行含 HEAD→main / v1.0 tag / origin/main
//   4) 头像首字母（NT）与作者名
//   5) 相对时间列非空
//   6) 点击行展开变更文件面板，±行数统计渲染（textContent 含 +N）
//   7) 分页 footer 文案（"of 5 commits · page 1"）
//
// 退出码：0 全绿 / 1 断言失败 / 2 环境错误。

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectToTarget, listPageTargets } from "../lib/cdp.mjs";
import { DEFAULTS, ensureInstance } from "../lib/launch.mjs";
import { createReporter, repoRoot } from "../lib/report.mjs";
import { dismissOnboarding, pickLiveRenderer } from "../lib/probes.mjs";

const AREA = "vcs-history-graph";
const argv = process.argv.slice(2);
const attach = argv.includes("--attach");
const keepOpen = argv.includes("--keep-open");
const dry = argv.includes("--dry");

const fixtureRoot = path.join(repoRoot, "tmp", "vcs-graph-fixture");
const author = "Nita Tester <nita@example.com>";

const reporter = createReporter({ area: AREA, mode: attach ? "attach" : "launch+reset" });
let instance = null;

function git(args, cwd, extraEnv = {}) {
    return execFileSync("git", args, {
        cwd,
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Nita Tester",
            GIT_AUTHOR_EMAIL: "nita@example.com",
            GIT_COMMITTER_NAME: "Nita Tester",
            GIT_COMMITTER_EMAIL: "nita@example.com",
            ...extraEnv,
        },
        encoding: "utf8",
    });
}

/** 构建两泳道 fixture：main + feature（合并）+ tag + bare 远端。 */
function buildFixture() {
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(fixtureRoot, { recursive: true });
    git(["init", "-b", "main"], fixtureRoot);
    git(["config", "user.name", "Nita Tester"], fixtureRoot);
    git(["config", "user.email", "nita@example.com"], fixtureRoot);
    const commitAt = (message, isoDate, extraArgs = []) => {
        writeFileSync(path.join(fixtureRoot, `${message.replace(/\W+/g, "-")}.txt`), `${message}\n`, "utf8");
        git(["add", "."], fixtureRoot);
        git(["commit", "-qm", message, ...extraArgs], fixtureRoot, {
            GIT_AUTHOR_DATE: isoDate,
            GIT_COMMITTER_DATE: isoDate,
        });
    };
    commitAt("chore: scaffold", "2026-01-01T10:00:00+08:00");
    const root = git(["rev-parse", "HEAD"], fixtureRoot).trim();
    commitAt("feat: add core", "2026-01-01T10:01:00+08:00");
    git(["checkout", "-qb", "feature", root], fixtureRoot);
    commitAt("feat: streaming", "2026-01-01T10:02:00+08:00");
    commitAt("fix: streaming buffer", "2026-01-01T10:03:00+08:00");
    git(["checkout", "-q", "main"], fixtureRoot);
    // merge commit：--no-ff 是 merge 的选项，不能走 commit；固定日期保序
    git(["merge", "--no-ff", "feature", "-m", "Merge branch 'feature'"], fixtureRoot, {
        GIT_AUTHOR_DATE: "2026-01-01T10:04:00+08:00",
        GIT_COMMITTER_DATE: "2026-01-01T10:04:00+08:00",
    });
    git(["tag", "v1.0"], fixtureRoot);
    const bareDir = path.join(fixtureRoot, "..", "vcs-graph-fixture-origin.git");
    rmSync(bareDir, { recursive: true, force: true });
    git(["init", "--bare", "-b", "main", bareDir], path.dirname(bareDir));
    git(["remote", "add", "origin", bareDir], fixtureRoot);
    git(["push", "-qu", "origin", "main"], fixtureRoot);
    git(["branch", "--set-upstream-to=origin/main", "main"], fixtureRoot);
}

async function waitFor(client, predicateExpr, label, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await client.evaluate(`(${predicateExpr})()`).catch(() => null);
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    reporter.log(`（等待超时：${label}）`);
    return null;
}

if (dry) {
    reporter.log("dry-run: 依赖解析成功（未启动 GUI）");
    reporter.check("deps-resolve", true, "lib/{cdp,launch,report,probes}.mjs");
    reporter.finish({ cleanup: null, ledger: false });
}

try {
    buildFixture();
    reporter.log(`fixture ready: ${fixtureRoot}`);

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

    // 打开 VCS 块，指向 fixture 仓库
    const opened = await client.evaluate(`(async () => {
        const mod = await import("/frontend/app/store/global.ts");
        const blockId = await mod.createBlock(
            { meta: { view: "vcs", "vcs:path": ${JSON.stringify(fixtureRoot)} } },
            false,
            false
        );
        return { ok: true, blockId };
    })()`);
    if (opened?.ok !== true || opened.blockId == null) {
        throw new Error(`打开 VCS 块失败: ${JSON.stringify(opened)}`);
    }
    const blockSel = `.block-${opened.blockId}`;

    // 建块后要先等它挂载进当前 DOM，否则选择器拿到 null（实测踩过）
    const blockReady = await waitFor(
        client,
        `() => document.querySelector(${JSON.stringify(blockSel)}) != null`,
        "vcs block mount"
    );
    reporter.check("vcs-block-mounted", !!blockReady, `selector=${blockSel}`);

    // 连接（local）就绪后块才会渲染 tab bar：等它而不是建完就点
    const tabBarReady = await waitFor(
        client,
        `() => document.querySelectorAll(${JSON.stringify(blockSel + " [data-vcs-tab='1']")}).length > 0`,
        "vcs tab bar",
        60000
    );
    if (!tabBarReady) {
        const blockText = await client.evaluate(
            `() => (document.querySelector(${JSON.stringify(blockSel)})?.textContent || "").slice(0, 200)`
        );
        reporter.log(`tab bar 未就绪，块内容片段: ${JSON.stringify(blockText)}`);
    }
    reporter.check("vcs-tab-bar-ready", !!tabBarReady, "60s 内应渲染出 4 个 tab");

    // 切到 History tab
    const switched = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        if (block == null) return { blockFound: false, tab: null, tabCount: 0 };
        const tabs = [...block.querySelectorAll("[data-vcs-tab='1']")];
        const tab = tabs.find((b) => (b.getAttribute("aria-label") || "") === "History");
        if (tab != null) tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return {
            blockFound: true,
            tab: tab ? tab.getAttribute("aria-label") : null,
            tabCount: tabs.length,
            labels: tabs.map((b) => b.getAttribute("aria-label")),
        };
    })()`);
    reporter.check(
        "switch-to-history-tab",
        switched?.tab === "History",
        `block=${switched?.blockFound} tabs=${switched?.tabCount} labels=${JSON.stringify(switched?.labels)}`
    );

    const listReady = await waitFor(
        client,
        `() => document.querySelector(${JSON.stringify(blockSel + " [data-vcs-commit-list]")}) != null`,
        "commit list",
        30000
    );
    reporter.check("commit-list-present", !!listReady, "");

    const stats = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        if (block == null) return null;
        const cells = block.querySelectorAll("[data-vcs-graph-cell]");
        const headRing = block.querySelectorAll("[data-vcs-graph-head]");
        const rows = [...block.querySelectorAll("[data-vcs-commit-row]")].map((row) => ({
            hash: row.getAttribute("data-vcs-commit-row"),
            subject: (row.textContent || "").trim(),
        }));
        const firstRow = block.querySelector("[data-vcs-commit-row]");
        const refsEl = firstRow?.querySelector("[data-vcs-commit-refs]");
        const title = firstRow?.querySelector('[title*="tag v"]') ?? null;
        const firstSvg = firstRow?.querySelector("[data-vcs-graph-cell]");
        return {
            cellCount: cells.length,
            rowCount: rows.length,
            headRingCount: headRing.length,
            refsText: refsEl ? refsEl.textContent : null,
            tagTitle: title ? title.getAttribute("title") : null,
            avatarText: firstRow?.querySelector("span[aria-hidden='true']")?.textContent?.trim() ?? null,
            svgWidth: firstSvg ? Number(firstSvg.getAttribute("width")) : null,
        };
    })()`);

    reporter.check("graph-cells-per-row", stats?.cellCount === 5, `cells=${stats?.cellCount}（期望 5 提交）`);
    reporter.check("head-ring-single", stats?.headRingCount === 1, `headRings=${stats?.headRingCount}`);
    reporter.check(
        "refs-head-branch-tag",
        stats?.refsText != null &&
            stats.refsText.includes("HEAD") &&
            stats.refsText.includes("main") &&
            stats.refsText.includes("v1.0") &&
            stats.refsText.includes("origin/main"),
        `refs=${stats?.refsText}`
    );
    reporter.check("tag-badge-title", stats?.tagTitle === "tag v1.0", `title=${stats?.tagTitle}`);
    reporter.check("avatar-initials", stats?.avatarText === "NT", `initials=${stats?.avatarText}（作者 ${author.split(" ")[0]} Tester）`);
    reporter.check("graph-svg-width-sane", stats?.svgWidth != null && stats.svgWidth >= 40, `svgWidth=${stats?.svgWidth}`);

    // 相对时间列：取首行 title（绝对时间）与行内相对时间
    const timeInfo = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        const firstRow = block?.querySelector("[data-vcs-commit-row]");
        const cells = firstRow ? [...firstRow.querySelectorAll("span")] : [];
        // 绝对时间 title 形如 "2026-01-01 10:03"（含空格与冒号）；hash chip 的 title 是纯 hash
        const timeCell = cells.find((s) => {
            const title = (s.getAttribute("title") || "").trim();
            return title.indexOf(":") > 0 && title.indexOf(" ") > 0;
        });
        return {
            relative: timeCell ? timeCell.textContent.trim() : null,
            absoluteTitle: timeCell ? timeCell.getAttribute("title") : null,
        };
    })()`);
    reporter.check(
        "relative-time-column",
        timeInfo?.relative != null && timeInfo.relative.length > 0 && timeInfo.absoluteTitle != null,
        `relative=${timeInfo?.relative} title=${timeInfo?.absoluteTitle}`
    );

    await reporter.shot(client, "01-history-list");

    // 展开非 merge 提交（fix: streaming buffer），断言文件面板 + ±统计
    const expanded = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        if (block == null) return false;
        const row = [...block.querySelectorAll("[data-vcs-commit-row]")].find((r) =>
            (r.textContent || "").includes("fix: streaming buffer"));
        if (row == null) return false;
        row.firstElementChild.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
    })()`);
    reporter.check("row-expand-click", expanded === true, "");

    const panelReady = await waitFor(
        client,
        `() => {
            const block = document.querySelector(${JSON.stringify(blockSel)});
            const panel = block?.querySelector("[data-vcs-commit-files]");
            if (panel == null) return false;
            return !panel.textContent.includes("Loading files");
        }`,
        "commit files panel"
    );
    reporter.check("files-panel-present", !!panelReady, "");

    const filesStats = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        const panel = block?.querySelector("[data-vcs-commit-files]");
        if (panel == null) return null;
        return {
            text: panel.textContent || "",
            svgLanes: panel.querySelectorAll("svg path").length,
        };
    })()`);
    reporter.check(
        "files-stats-rendered",
        filesStats != null && /\+\d/.test(filesStats.text) && filesStats.text.includes(".txt"),
        `text=${filesStats?.text?.slice(0, 120)}`
    );
    reporter.check(
        "files-gutter-lanes",
        filesStats != null && filesStats.svgLanes >= 1,
        `gutterPaths=${filesStats?.svgLanes}`
    );

    await reporter.shot(client, "02-row-expanded");

    // 分页 footer
    const footer = await client.evaluate(`(() => {
        const block = document.querySelector(${JSON.stringify(blockSel)});
        const footer = [...(block?.querySelectorAll("span") ?? [])].find((s) =>
            /commits/.test(s.textContent || ""));
        return footer ? footer.textContent.trim() : null;
    })()`);
    reporter.check(
        "pagination-footer",
        footer != null && /1–5 of 5 commits · page 1/.test(footer),
        `footer=${footer}`
    );

    reporter.finish({
        skipped: [
            "3 泳道并发（需要 ≥2 条未合并分支；fixture 只有 2 泳道，算法侧由 graph-layout.test.ts 覆盖）",
            "SVN 降级（fixture 无 SVN 仓库；降级路径由布局纯函数保证）",
            "翻页断线（页内泳道已断言，跨页行为为已记录取舍）",
        ],
        cleanup: () => {
            client.close?.();
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
            if (!keepOpen) rmSync(fixtureRoot, { recursive: true, force: true });
        },
    });
} catch (err) {
    reporter.fatal(err, {
        cleanup: () => {
            if (instance?.spawned && !keepOpen) instance.cleanup?.();
            rmSync(fixtureRoot, { recursive: true, force: true });
        },
    });
}
