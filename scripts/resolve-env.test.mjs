import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveEnv } from "./resolve-env.mjs";

test("resolveEnv prefers repository tools and preserves user settings", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "snorkeling-resolve-env-"));
    const platform = process.platform;
    const separator = platform === "win32" ? ";" : ":";
    const pathKey = platform === "win32" ? "Path" : "PATH";
    const localTask = resolve(repoRoot, ".tools", "task", platform === "win32" ? "task.exe" : "task");
    const localPaths = [
        resolve(repoRoot, ".tools", "go", "bin"),
        resolve(repoRoot, ".tools", "zig"),
        resolve(repoRoot, ".tools", "task"),
        resolve(repoRoot, "node_modules", ".bin"),
    ];

    try {
        for (const path of localPaths) {
            mkdirSync(path, { recursive: true });
        }
        writeFileSync(localTask, "");

        const { env, taskBin } = resolveEnv(
            repoRoot,
            {
                ...(platform === "win32" ? { PATH: "stale-bin" } : {}),
                [pathKey]: "global-bin",
                GOPROXY: "https://proxy.example",
                ELECTRON_MIRROR: "https://mirror.example/",
                NODE_OPTIONS: "--trace-warnings",
                CUSTOM_SETTING: "preserved",
            },
            platform
        );

        assert.equal(taskBin, localTask);
        const inheritedPaths = platform === "win32" ? ["stale-bin", "global-bin"] : ["global-bin"];
        assert.equal(env[pathKey], [...localPaths, ...inheritedPaths].join(separator));
        if (platform === "win32") {
            assert.equal("PATH" in env, false);
        }
        assert.equal(env.GOPROXY, "https://proxy.example");
        assert.equal(env.ELECTRON_MIRROR, "https://mirror.example/");
        assert.equal(env.NODE_OPTIONS, "--trace-warnings --max-old-space-size=8192");
        assert.equal(env.CUSTOM_SETTING, "preserved");
        assert.ok(existsSync(env.GOCACHE));
        assert.ok(existsSync(env.ELECTRON_CACHE));

        rmSync(localTask);
        assert.equal(resolveEnv(repoRoot, { [pathKey]: "global-bin" }, platform).taskBin, "task");
    } finally {
        rmSync(repoRoot, { recursive: true, force: true });
    }
});
