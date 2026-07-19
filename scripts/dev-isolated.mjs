// Cross-platform isolated dev launcher.  node scripts/dev-isolated.mjs [task flags...]
// One entry point for macOS / Linux / Windows: redirects Go backend (WAVETERM_*_HOME) AND
// Electron frontend (WAVETERM_ELECTRON_USER_DATA_HOME, WAVETERM_APP_NAME, SNORKELING_VITE_PORT)
// into <repo>/.runcfg so a second dev checkout (e.g. ../snorkeling) can run concurrently without
// fighting for the macOS SingletonLock or the default Vite port. Drop <repo>/.runcfg to reset.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

console.log(">> isolated dev run (cross-platform)");
console.log(`>> profile:  ${profile}`);
console.log(`>> config:   ${dirs.config}`);
console.log(`>> data:     ${dirs.data}`);
console.log(`>> home:     ${dirs.home}`);
console.log(`>> electron: ${dirs.electron}`);
console.log(`>> app name: ${process.env.WAVETERM_APP_NAME}`);
console.log(`>> port mode: ${options.strictPort ? "strict" : "auto"}`);
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

const args = ["electron:dev", ...taskArgs];
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
