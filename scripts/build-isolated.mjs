// Cross-platform isolated build launcher.  node scripts/build-isolated.mjs [electron-vite args...]
// Mirrors dev-isolated.mjs but for `electron-vite build`, so production/dev builds also inherit
// resolveEnv()'s NODE_OPTIONS (--max-old-space-size=8192), GOPROXY, Electron mirror, and isolated
// caches. Without this wrapper a direct `electron-vite build` runs with V8's default ~2GB old-space
// heap and OOMs on the frontend bundle (see scripts/resolve-env.mjs).

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnv } from "./resolve-env.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const extraArgs = process.argv.slice(2);

const { env } = resolveEnv(repoRoot);

// Prefer the repo's own electron-vite so the build is reproducible across machines.
// On Windows there is no bare executable; spawn the .cmd shim with shell:true (Node refuses to
// spawn .cmd/.bat directly without a shell since the CVE-2024-27980 mitigation). macOS/Linux use
// the shebang sh shim and can spawn it directly.
const isWindows = process.platform === "win32";
const electronViteBin = resolve(
    repoRoot,
    "node_modules",
    ".bin",
    isWindows ? "electron-vite.cmd" : "electron-vite"
);
const child = spawn(electronViteBin, ["build", ...extraArgs], {
    stdio: "inherit",
    env,
    shell: isWindows,
});

child.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("error: cannot find 'electron-vite'. checked repository node_modules/.bin/electron-vite.");
        console.error("       run `npm install` first.");
    } else {
        console.error("error:", err.message);
    }
    process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 1));
