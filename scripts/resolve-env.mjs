import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function resolveEnv(repoRoot, baseEnv = process.env, platform = process.platform) {
    const env = { ...baseEnv };
    const toolsRoot = resolve(repoRoot, ".tools");
    const cacheRoot = resolve(repoRoot, ".cache");
    const cacheDirs = {
        goBuild: resolve(cacheRoot, "go-build"),
        goMod: resolve(cacheRoot, "gomod"),
        goPath: resolve(cacheRoot, "gopath"),
        npm: resolve(cacheRoot, "npm"),
        electron: resolve(cacheRoot, "electron"),
        electronBuilder: resolve(cacheRoot, "electron-builder"),
        zigGlobal: resolve(cacheRoot, "zig-global"),
        zigLocal: resolve(cacheRoot, "zig-local"),
        tmp: resolve(cacheRoot, "tmp"),
    };

    for (const dir of Object.values(cacheDirs)) {
        mkdirSync(dir, { recursive: true });
    }

    const localPaths = [
        resolve(toolsRoot, "go", "bin"),
        resolve(toolsRoot, "zig"),
        resolve(toolsRoot, "task"),
        resolve(repoRoot, "node_modules", ".bin"),
    ].filter(existsSync);

    // Windows can inherit duplicate case-insensitive PATH keys; merge them before spawning children.
    const inheritedPathKeys = Object.keys(env).filter((key) =>
        platform === "win32" ? key.toLowerCase() === "path" : key === "PATH"
    );
    const pathKey = platform === "win32" ? "Path" : "PATH";
    const pathSeparator = platform === "win32" ? ";" : ":";
    const inheritedPaths = inheritedPathKeys.flatMap((key) => env[key]?.split(pathSeparator) ?? []).filter(Boolean);
    for (const key of inheritedPathKeys) {
        delete env[key];
    }
    const seenPaths = new Set();
    env[pathKey] = [...localPaths, ...inheritedPaths]
        .filter((path) => {
            const key = platform === "win32" ? path.toLowerCase() : path;
            if (seenPaths.has(key)) {
                return false;
            }
            seenPaths.add(key);
            return true;
        })
        .join(pathSeparator);

    env.GOCACHE = cacheDirs.goBuild;
    env.GOMODCACHE = cacheDirs.goMod;
    env.GOPATH = cacheDirs.goPath;
    env.GOENV = "off";
    env.GOTOOLCHAIN = "local";
    env.NPM_CONFIG_CACHE = cacheDirs.npm;
    env.npm_config_cache = cacheDirs.npm;
    env.ELECTRON_CACHE = cacheDirs.electron;
    env.ELECTRON_BUILDER_CACHE = cacheDirs.electronBuilder;
    env.ZIG_GLOBAL_CACHE_DIR = cacheDirs.zigGlobal;
    env.ZIG_LOCAL_CACHE_DIR = cacheDirs.zigLocal;

    if (!env.GOPROXY?.trim()) {
        env.GOPROXY = "https://goproxy.cn,direct";
    }
    if (!env.ELECTRON_MIRROR?.trim()) {
        env.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
    }
    if (!env.NODE_OPTIONS?.trim()) {
        env.NODE_OPTIONS = "--max-old-space-size=8192";
    } else if (!env.NODE_OPTIONS.includes("--max-old-space-size")) {
        env.NODE_OPTIONS = `${env.NODE_OPTIONS} --max-old-space-size=8192`;
    }

    if (platform === "win32") {
        env.TEMP = cacheDirs.tmp;
        env.TMP = cacheDirs.tmp;
    } else {
        env.TMPDIR = cacheDirs.tmp;
    }

    const localTask = resolve(toolsRoot, "task", platform === "win32" ? "task.exe" : "task");
    return { env, taskBin: existsSync(localTask) ? localTask : "task" };
}
