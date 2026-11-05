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
                // scripts/ 下是 node:test 风格（node --test 跑）的用例：vitest 会把它们当
                // "没有 test suite" 的空文件报红，实际从未在此处跑通过。归口：
                //   npm run test:scripts   → node --test scripts/**/*.test.mjs
                "scripts/**/*.test.mjs",
                "tests/**/*.test.mjs",
                "**/dist/**",
                "**/.claude/worktrees/**",
                "**/verify-runs/**",
                "**/.gitnexus/**",
                // 以下三类不是本仓库的应用测试：
                //  - .runcfg/：CDP 供应商运行时缓存（内含第三方 plugin 的 fixture 测试）
                //  - design/：原型目录里的 smoke 脚本（.cjs，独立跑）
                "**/.runcfg/**",
                "design/**",
            ],
            // Node >= 22.11 的 jsdom 不再自带 localStorage；统一在这里补内存实现，
            // 免得每个 DOM 测试都要人肉记住 NODE_OPTIONS=--localstorage-file=...（详见 setup 文件注释）。
            setupFiles: ["test/vitest-setup.ts"],
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
