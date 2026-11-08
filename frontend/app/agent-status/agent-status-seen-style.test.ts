// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 已读（ack 后）样式一致性锁 —— 「agent card 的 Done 徽章和 agent header 上的 Done
// 样式不一样（包括 ack 后的样式）」这条 bug 的回归判据。
//
// 为什么是读 SCSS 而不是渲染测：四个面分属不同样式文件（block.scss / agent-status-chip.scss /
// session-overview.scss / info-card.scss），而 class 名是共用的（is-acked / is-seen）——
// 「同名不同值」既不会被 TS 抓到，也不会被任何 DOM 快照抓到（除非真机跑到 ack 之后那帧）。
// 真机台 agent-card-seen 覆盖行为，这里覆盖**数值**：基准是 block.scss 的
// `.agent-status-header.is-acked`，其余面必须写同一套四值。
//
// 基准（改这里就要同步改四处，否则这条测试红）：
//   border-style: dashed
//   border-color: rgb(from var(--secondary-text-color) r g b / 0.4)
//   前景          var(--secondary-text-color)
//   底色          rgb(from var(--main-text-color) r g b / 0.04)
//   opacity       0.7

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

function readScss(rel: string): string {
    return readFileSync(path.join(repoRoot, rel), "utf8");
}

/** 取出包含 `anchor` 的那条规则块（到第一个未缩进的 `}` 为止），保留原文以便断言。 */
function ruleBlock(scss: string, anchor: string): string {
    const at = scss.indexOf(anchor);
    expect(at, `找不到规则锚点: ${anchor}`).toBeGreaterThanOrEqual(0);
    const open = scss.indexOf("{", at);
    expect(open, `锚点后没有规则块: ${anchor}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = open; i < scss.length; i++) {
        if (scss[i] === "{") depth++;
        else if (scss[i] === "}") {
            depth--;
            if (depth === 0) return scss.slice(open, i + 1);
        }
    }
    throw new Error(`规则块未闭合: ${anchor}`);
}

const Baseline = {
    borderStyle: "border-style: dashed",
    borderColor: "border-color: rgb(from var(--secondary-text-color) r g b / 0.4)",
    foreground: "var(--secondary-text-color)",
    background: "rgb(from var(--main-text-color) r g b / 0.04)",
    opacity: "opacity: 0.7",
};

/** 正常化空白，避免格式差异让断言假红。 */
function norm(text: string): string {
    return text.replace(/\s+/g, " ");
}

function expectSameSeenValues(block: string, opts: { foregroundDecl: string; backgroundDecl: string }) {
    const text = norm(block);
    expect(text).toContain(Baseline.borderStyle);
    expect(text).toContain(Baseline.borderColor);
    expect(text).toContain(`${opts.foregroundDecl}: ${Baseline.foreground}`);
    expect(text).toContain(`${opts.backgroundDecl}: ${Baseline.background}`);
    expect(text).toContain(Baseline.opacity);
}

describe("已读样式：与 block 头部 is-acked 四值一致", () => {
    it("基准本身（block.scss .agent-status-header.is-acked）仍是那套四值", () => {
        const scss = readScss("frontend/app/block/block.scss");
        // 锚到 agent-status-header 里的 is-acked（文件里有两个 is-acked：inline tab 圆点 + 头部徽章）。
        const headerStart = scss.indexOf(".agent-status-header");
        expect(headerStart).toBeGreaterThanOrEqual(0);
        const inner = scss.slice(headerStart);
        const block = ruleBlock(inner, "&.is-acked");
        expectSameSeenValues(block, { foregroundDecl: "color", backgroundDecl: "background" });
    });

    it("共享 chip（agent-status-chip.scss .is-acked / .is-seen）", () => {
        const scss = readScss("frontend/app/agent-status/agent-status-chip.scss");
        const block = ruleBlock(scss, ".agent-status-chip.is-acked,");
        expectSameSeenValues(block, {
            foregroundDecl: "--agent-status-color",
            backgroundDecl: "--agent-status-bg",
        });
    });

    it("card 胶囊（agent-status-chip--card.is-seen）也走同值，且换回真实虚线边框", () => {
        const scss = readScss("frontend/app/agent-status/agent-status-chip.scss");
        const block = norm(ruleBlock(scss, ".agent-status-chip--card.is-acked,"));
        // 胶囊平时用 inset 阴影描边（box-shadow 画不出虚线），seen 必须换真实边框，
        // 否则「卡片 ack 后没有虚线边」这个差异会悄悄回来。
        expect(block).toContain("border: 1px dashed rgb(from var(--secondary-text-color) r g b / 0.4)");
        expect(block).toContain("box-shadow: none");
        expect(block).toContain(Baseline.background.replace("rgb(", "rgb("));
    });

    it("Overview chip（session-overview.scss &.is-acked）", () => {
        const scss = readScss("frontend/app/session-overview/session-overview.scss");
        const start = scss.indexOf(".session-overview-agent-status,");
        expect(start).toBeGreaterThanOrEqual(0);
        const block = ruleBlock(scss.slice(start), "&.is-acked");
        expectSameSeenValues(block, {
            foregroundDecl: "--agent-status-color",
            backgroundDecl: "--agent-status-bg",
        });
    });

    it("Tab 悬浮卡 pill（info-card.scss .tab-card-agent-row.is-seen .tab-card-agent-pill）", () => {
        const scss = readScss("frontend/app/element/info-card/info-card.scss");
        const block = ruleBlock(scss, ".tab-card-agent-row.is-seen .tab-card-agent-pill");
        const text = norm(block);
        expect(text).toContain("border: 1px dashed rgb(from var(--secondary-text-color) r g b / 0.4)");
        expect(text).toContain(`color: ${Baseline.foreground}`);
        expect(text).toContain(`background: ${Baseline.background}`);
        expect(text).toContain(Baseline.opacity);
        // 新增 1px 边框会把盒高从 17px 抬到 19px，必须用 line-height 抵消，否则 tab 行高抖动。
        expect(text).toContain("line-height: 15px");
    });

    it("旧兼容类（info-card.scss .agent-card-status-chip.is-seen）不再残留 0.72 那套", () => {
        const scss = readScss("frontend/app/element/info-card/info-card.scss");
        const block = norm(ruleBlock(scss, ".agent-card-status-chip.is-seen"));
        expect(block).not.toContain("opacity: 0.72");
        expect(block).toContain(Baseline.opacity);
        expect(block).toContain(Baseline.borderColor);
    });
});
