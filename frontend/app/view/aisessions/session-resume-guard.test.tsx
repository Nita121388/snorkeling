// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// R8（aisessions 声明式 provider）：未知/声明式 source 不得产生 codex 恢复命令。
// 守卫两层：
// - 源码级：三个入口（session-row / session-menu / session-detail）的 Resume
//   与「复制恢复命令」渲染必须受 isResumableSource 守卫；utils.ts 不得再有
//   静默 `?? "codex"` 回退或无条件 `codex resume` 兜底。
// - 行为级：antigravity 行渲染出的 markup 不含 Resume 按钮与复制命令标签。

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n } from "@/i18n/config";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionRow } from "./session-row";
import type { SessionSummary } from "./types";

const dirUrl = new URL("./", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dirUrl), "utf8");

beforeEach(async () => {
    await initI18n("en");
});

describe("R8: 未知 source 不产生 codex 恢复命令（源码守卫）", () => {
    it("restoreCommandForSession 的 codex 分支必须显式判 source，尾部不得无条件回退", () => {
        const source = read("utils.ts");
        // 兜底从 `return \`codex resume ...\`` 改成了显式 codex 分支 + 空串。
        expect(source).toContain('if (summary.source === "codex")');
        // 不允许静默回退 codex 的写法再回来（restoreMetaForSession 曾有 `?? "codex"`）。
        const codeOnly = source.replace(/^\s*\/\/.*$/gm, "");
        expect(codeOnly).not.toContain('?? "codex"');
    });

    it("session-row 的 Resume 按钮与复制命令按钮都受 isResumableSource 守卫", () => {
        const source = read("session-row.tsx");
        expect(source).toContain("isResumableSource(session.source)");
        // 两处入口（Resume 按钮、CopyIconButton）都必须出现在守卫分支里。
        const guardCount = source.split("isResumableSource(session.source)").length - 1;
        expect(guardCount).toBeGreaterThanOrEqual(2);
    });

    it("session-menu 的 Resume 与「复制恢复命令」菜单项都受 canResume 守卫", () => {
        const source = read("session-menu.tsx");
        expect(source).toContain("canResume");
        expect(source).toMatch(/\{canResume \? \(\s*<MenuRow[^>]*fa-square-terminal/s);
        expect(source).toMatch(/\{canResume \? \(\s*<MenuRow[^>]*"aisessions:menu\.resumeCommand"/s);
    });

    it("session-detail 头栏菜单按来源传入 canResume", () => {
        const source = read("session-detail.tsx");
        expect(source).toContain("canResume={isResumableSource(summary.source)}");
    });
});

describe("R8: antigravity 会话行不渲染恢复入口（行为守卫）", () => {
    function renderRow(source: string): string {
        const session = { key: "k", id: "k", source } as unknown as SessionSummary;
        return renderToStaticMarkup(
            <SessionRow
                session={session}
                selected={false}
                onSelect={() => {}}
                onMark={() => {}}
                onNoteSave={() => Promise.resolve(true)}
                onResume={() => {}}
                onJumpToBlock={() => {}}
            />
        );
    }

    it("renders resume entries for a known source (pi)", () => {
        const markup = renderRow("pi");
        expect(markup).toContain(">Resume<");
        expect(markup).toContain("Copy resume command");
    });

    it("hides resume entries for a declarative source (antigravity)", () => {
        const markup = renderRow("antigravity");
        expect(markup).not.toContain(">Resume<");
        expect(markup).not.toContain("Copy resume command");
        expect(markup).not.toContain("codex");
    });
});
