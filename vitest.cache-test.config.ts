// 临时轻量 vitest 配置: 只跑 cache 测试, 避开 electronViteConfig 的 tailwind/electron 重负载.
// 完成 cache 测试调试后会移除.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
    plugins: [tsconfigPaths(), react()],
    test: {
        environment: "node",
        include: ["frontend/app/session-overview/session-overview-session-cache.test.ts"],
        reporters: ["verbose"],
    },
});
