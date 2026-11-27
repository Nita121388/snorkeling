// Cross-platform isolated dev launcher.  node scripts/dev-isolated.mjs [task flags...]
// One entry point for macOS / Linux / Windows: redirects Go backend (WAVETERM_*_HOME) AND
// Electron frontend (WAVETERM_ELECTRON_USER_DATA_HOME, WAVETERM_APP_NAME, SNORKELING_VITE_PORT)
// into <repo>/.runcfg so a second dev checkout (e.g. ../snorkeling) can run concurrently without
// fighting for the macOS SingletonLock or the default Vite port. Drop <repo>/.runcfg to reset.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDevOptions } from "./dev-options.mjs";
import { findAvailablePort } from "./dev-port.mjs";
import { resolveEnv } from "./resolve-env.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseDevOptions(process.argv.slice(2));
const vitePort = await findAvailablePort(options.vitePort, { strict: options.strictPort });
if (options.strictPort && options.cdpPort === vitePort) {
    throw new Error(`Vite and CDP ports must differ when strict mode is enabled (${vitePort})`);
}
const cdpPort =
    options.cdpPort == null
        ? null
        : await findAvailablePort(options.cdpPort, { strict: options.strictPort, exclude: [vitePort] });
const { profile, taskArgs } = options;
const runcfgRoot = resolve(repoRoot, ".runcfg");
const runcfg = profile === "default" ? runcfgRoot : resolve(runcfgRoot, profile);

const dirs = {
    config: resolve(runcfg, "config"),
    data: resolve(runcfg, "data"),
    home: resolve(runcfg, "home"),
    electron: resolve(runcfg, "electron"),
};

process.env.WAVETERM_CONFIG_HOME = dirs.config;
process.env.WAVETERM_DATA_HOME = dirs.data;
process.env.WAVETERM_HOME = dirs.home;
process.env.WAVETERM_ELECTRON_USER_DATA_HOME = dirs.electron;
process.env.WAVETERM_APP_NAME = profile === "default" ? "Snorkeling-Light (Dev)" : `Snorkeling-Light (Dev:${profile})`;
process.env.SNORKELING_DEV_PROFILE = profile;
process.env.SNORKELING_PORT_MODE = options.strictPort ? "strict" : "auto";
process.env.SNORKELING_VITE_REQUESTED_PORT = String(options.vitePort);
process.env.SNORKELING_VITE_PORT = String(vitePort);
process.env.WAVETERM_NOCONFIRMQUIT = "1";
if (cdpPort != null) {
    process.env.SNORKELING_CDP_REQUESTED_PORT = String(options.cdpPort);
    process.env.SNORKELING_CDP_PORT = String(cdpPort);
}

for (const d of Object.values(dirs)) {
    mkdirSync(d, { recursive: true });
}

// AI Sessions 索引隔离（防误写真库）：Go 侧 pkg/aisessions/paths.go 把索引路径硬编码在
// ~/.snorkeling/ai-sessions（只认 WAVETERM_AI_SESSIONS_* env，不看 WAVETERM_DATA_HOME）。
// dev 实验代码一旦带未发布的索引变更（如 W3-2 的 DROP INDEX + VACUUM）就会直接落
// 生产库；这里默认把四件套全部指向 profile 目录，--shared-ai-index（或
// SNORKELING_SHARED_AI_INDEX=1）可退回共享（代价：dev 里看不到已有批注/标签）。
const sharedAiIndex = options.sharedAiIndex === true;
if (!sharedAiIndex) {
    const aiIndexDir = resolve(dirs.data, "ai-sessions");
    mkdirSync(aiIndexDir, { recursive: true });
    process.env.WAVETERM_AI_SESSIONS_INDEX = join(aiIndexDir, "index.json");
    process.env.WAVETERM_AI_SESSIONS_SQLITE_INDEX = join(aiIndexDir, "index-v2.sqlite");
    process.env.WAVETERM_AI_SESSIONS_META = join(aiIndexDir, "meta.json");
    process.env.WAVETERM_AI_SESSIONS_DELETED_DIR = join(aiIndexDir, "deleted");
}

console.log(">> isolated dev run (cross-platform)");
console.log(`>> profile:  ${profile}`);
console.log(`>> config:   ${dirs.config}`);
console.log(`>> data:     ${dirs.data}`);
console.log(`>> home:     ${dirs.home}`);
console.log(`>> electron: ${dirs.electron}`);
console.log(`>> app name: ${process.env.WAVETERM_APP_NAME}`);
console.log(`>> port mode: ${options.strictPort ? "strict" : "auto"}`);
console.log(
    `>> ai index: ${sharedAiIndex ? "SHARED (real ~/.snorkeling/ai-sessions)" : process.env.WAVETERM_AI_SESSIONS_SQLITE_INDEX}`
);
console.log(
    `>> vite:     http://127.0.0.1:${vitePort}${vitePort === options.vitePort ? "" : ` (requested ${options.vitePort})`}`
);
console.log(
    `>> cdp:      ${cdpPort == null ? "disabled" : `http://127.0.0.1:${cdpPort}${cdpPort === options.cdpPort ? "" : ` (requested ${options.cdpPort})`}`}`
);
if (cdpPort != null) {
    console.log(`>> cdp json: curl.exe http://127.0.0.1:${cdpPort}/json/version`);
    console.log(`>> inspect:  node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:${cdpPort} state`);
}
console.log(`>> reset:    rm -rf ${runcfg}`);
console.log();

// .tools/task is preferred over a global task so machines without a globally
// installed Task can still run dev (matches use-local-env.ps1's PATH precedence).
const { env, taskBin } = resolveEnv(repoRoot);

const taskName = process.env.SNORKELING_DEV_TASK || "electron:dev";
const args = [taskName, ...taskArgs];
const child = spawn(taskBin, args, { stdio: "inherit", env, shell: false });
child.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("error: cannot find 'task'. checked repository .tools/task and PATH.");
        console.error("       run npm run setup, or install Task globally: https://taskfile.dev/installation/");
    } else {
        console.error("error:", err.message);
    }
    process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
