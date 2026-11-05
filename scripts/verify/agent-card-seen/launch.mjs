#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 起一个隔离的 verify 实例（profile=verify / vite 51799 / CDP 9231）并**留着**，
// 供 scripts/verify/agent-card-seen/verify.mjs --attach 复用。
//
// 不复用 preview-edit/run.mjs：那个会先跑一遍预览回归。这里只要实例。
// 进程退出后 Electron 继续活着（不调 cleanup）；关闭用 `--kill` 的端口→PID 路径。

import { ensureInstance, findPidByPort, killPid, DEFAULTS } from "../preview-edit/lib/launch.mjs";

const argv = process.argv.slice(2);

if (argv.includes("--kill")) {
    const pid = findPidByPort(DEFAULTS.cdpPort);
    if (pid == null) {
        console.log("no instance on port", DEFAULTS.cdpPort);
        process.exit(0);
    }
    killPid(pid);
    console.log("killed pid", pid);
    process.exit(0);
}

const instance = await ensureInstance({ attach: false });
const probe = await instance.client.evaluate(`(() => ({
    href: location.href,
    blocks: document.querySelectorAll(".block-content").length,
    widgets: document.querySelectorAll(".widgets-bar, .widget-bar").length,
}))()`);
console.log("READY", JSON.stringify(probe), "cdp=", DEFAULTS.cdpPort);
// 不调 instance.cleanup()，让实例留着。
process.exit(0);
