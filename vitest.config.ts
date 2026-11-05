import { UserConfig, defineConfig, mergeConfig } from "vitest/config";
import electronViteConfig from "./electron.vite.config";

export default mergeConfig(
    electronViteConfig.renderer as UserConfig,
    defineConfig({
        test: {
            // 本机并行开发会在 .claude/worktrees/** 下留整份仓库副本；默认 include 会把它们
            // 一起跑一遍 —— 既是双倍耗时，也会产出"别人 worktree 里的失败"这种幻影红灯
            // （2026-11-05 实测：31 个失败全部来自 origin-switch / i18n 等 worktree 的副本）。
            exclude: [
                "**/node_modules/**",
                "**/dist/**",
                "**/.claude/worktrees/**",
                "**/verify-runs/**",
                "**/.gitnexus/**",
            ],
            reporters: ["verbose", "junit"],
            outputFile: {
                junit: "test-results.xml",
            },
            coverage: {
                provider: "istanbul",
                reporter: ["lcov"],
                reportsDirectory: "./coverage",
            },
            typecheck: {
                tsconfig: "tsconfig.json",
            },
        },
    })
);
