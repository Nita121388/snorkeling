import { UserConfig, defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import electronViteConfig from "./electron.vite.config";

// md-core 物理抽包（10-12）：与 electron.vite.config.ts / tsconfig.json 三处别名保持一致。
const MdCoreSrcDir = fileURLToPath(new URL("./packages/md-core/src", import.meta.url));

export default mergeConfig(
    electronViteConfig.renderer as UserConfig,
    defineConfig({
        resolve: {
            alias: {
                "@md/core": MdCoreSrcDir,
            },
        },
        test: {
            // 包内测试随包搬到了 packages/md-core/src/**，必须被收集到（否则用例数会"假性下降"）。
            include: ["frontend/**/*.{test,spec}.?(c|m)[jt]s?(x)", "packages/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
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
