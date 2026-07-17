// Cross-platform isolated dev launcher.  node scripts/dev-isolated.mjs [task flags...]
// One entry point for macOS / Linux / Windows: redirects Go backend (WAVETERM_*_HOME) AND
// Electron frontend (WAVETERM_ELECTRON_USER_DATA_HOME, WAVETERM_APP_NAME, SNORKELING_VITE_PORT)
// into <repo>/.runcfg so a second dev checkout (e.g. ../snorkeling) can run concurrently without
// fighting for the macOS SingletonLock or the default Vite port. Drop <repo>/.runcfg to reset.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runcfg = resolve(repoRoot, ".runcfg");

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
process.env.WAVETERM_APP_NAME = "Snorkeling-Light (Dev)";
process.env.SNORKELING_VITE_PORT = "51741";
process.env.WAVETERM_NOCONFIRMQUIT = "1";

for (const d of Object.values(dirs)) {
    mkdirSync(d, { recursive: true });
}

// task electron:dev sets WAVETERM_ENVFILE={{.ROOT_DIR}}/.env, which wavesrv loads via godotenv.
// Mirror the three Go-backend home overrides into .env so the backend sees the same roots.
writeFileSync(
    resolve(repoRoot, ".env"),
    `WAVETERM_CONFIG_HOME=${dirs.config}\nWAVETERM_DATA_HOME=${dirs.data}\nWAVETERM_HOME=${dirs.home}\n`
);

console.log(">> isolated dev run (cross-platform)");
console.log(`>> config:   ${dirs.config}`);
console.log(`>> data:     ${dirs.data}`);
console.log(`>> home:     ${dirs.home}`);
console.log(`>> electron: ${dirs.electron}`);
console.log(`>> app name: ${process.env.WAVETERM_APP_NAME}`);
console.log(`>> vite port: ${process.env.SNORKELING_VITE_PORT}`);
console.log(`>> reset:    rm -rf ${runcfg}`);
console.log();

const args = ["electron:dev", ...process.argv.slice(2)];
const child = spawn("task", args, { stdio: "inherit", env: process.env, shell: false });
child.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("error: 'task' not found in PATH. Install Task: https://taskfile.dev/installation/");
    } else {
        console.error("error:", err.message);
    }
    process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
