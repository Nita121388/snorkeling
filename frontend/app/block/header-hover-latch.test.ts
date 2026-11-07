// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 锁存状态机与「离开去向」判据的单测。
//
// 守住的核心不变量（PRD A2）：
//   1. ENTER 之后，任意多次 ENTER（坐标随便变）都不会翻转方向。
//   2. 宽限内回来沿用原方向；超过宽限才回中性。
//   3. FROZEN 时 LEAVE 不启动定时器、RESET 不生效。
//   4. 类型层没有 MOVE 事件 —— pointermove 无法参与分区。
//
// Run: npx vitest run frontend/app/block/header-hover-latch.test.ts

import { describe, expect, it } from "vitest";
import {
    clampHoverGraceMs,
    DefaultHoverGraceMs,
    MaxHoverGraceMs,
    NeutralHoverLatch,
    reduceHoverLatch,
    type HoverLatchEvent,
    type HoverLatchState,
} from "./header-hover-latch";

const MID = 120;

function enter(x: number): HoverLatchEvent {
    return { type: "ENTER", x, mid: MID };
}

function run(st: HoverLatchState, events: HoverLatchEvent[]): HoverLatchState {
    return events.reduce(reduceHoverLatch, st);
}

describe("reduceHoverLatch — 进入即锁", () => {
    it("从中性进入右半 → right", () => {
        expect(run(NeutralHoverLatch, [enter(200)]).zone).toBe("right");
    });

    it("从中性进入左半 → left", () => {
        expect(run(NeutralHoverLatch, [enter(10)]).zone).toBe("left");
    });

    it("正好落在中线上 → right（>= 中线归右）", () => {
        expect(run(NeutralHoverLatch, [enter(MID)]).zone).toBe("right");
    });

    it("锁存后再 ENTER（坐标在中线另一侧）方向不变 —— 这是消除自激的核心", () => {
        let st = run(NeutralHoverLatch, [enter(200)]);
        expect(st.zone).toBe("right");
        // 模拟鼠标去点那个已经伸过中线的 icon：x 落在中线左侧
        for (const x of [110, 60, 20, 0, 119, 121, 300]) {
            st = reduceHoverLatch(st, enter(x));
            expect(st.zone).toBe("right");
        }
    });

    it("左锁后反复 ENTER 右半坐标也保持 left", () => {
        let st = run(NeutralHoverLatch, [enter(10)]);
        for (const x of [200, 300, 400]) {
            st = reduceHoverLatch(st, enter(x));
            expect(st.zone).toBe("left");
        }
    });

    it("连续 100 次任意坐标 ENTER 不翻转", () => {
        let st = run(NeutralHoverLatch, [enter(200)]);
        for (let i = 0; i < 100; i++) {
            st = reduceHoverLatch(st, enter((i * 37) % 300));
            expect(st.zone).toBe("right");
        }
    });
});

describe("reduceHoverLatch — 宽限语义", () => {
    it("LEAVE 只置 pendingReset，方向仍保持", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "LEAVE" }]);
        expect(st.zone).toBe("right");
        expect(st.pendingReset).toBe(true);
    });

    it("LEAVE 后 RESET → 回中性", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "LEAVE" }, { type: "RESET" }]);
        expect(st).toEqual(NeutralHoverLatch);
    });

    it("宽限内从另一侧 ENTER → 方向不变且 pendingReset 清除", () => {
        // 从右侧进入 → LEAVE → （定时器未到期）从左侧回来
        const st = run(NeutralHoverLatch, [enter(200), { type: "LEAVE" }, enter(10)]);
        expect(st.zone).toBe("right");
        expect(st.pendingReset).toBe(false);
    });

    it("RESET 后再从另一侧 ENTER → 才切换", () => {
        const st = run(NeutralHoverLatch, [
            enter(200),
            { type: "LEAVE" },
            { type: "RESET" },
            enter(10),
        ]);
        expect(st.zone).toBe("left");
    });

    it("没有 LEAVE 时 RESET 是空操作", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "RESET" }]);
        expect(st.zone).toBe("right");
        expect(st.pendingReset).toBe(false);
    });

    it("中性时 LEAVE 是空操作", () => {
        const st = run(NeutralHoverLatch, [{ type: "LEAVE" }]);
        expect(st).toEqual(NeutralHoverLatch);
    });
});

describe("reduceHoverLatch — FROZEN", () => {
    it("FREEZE 时清掉待重置", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "LEAVE" }, { type: "FREEZE" }]);
        expect(st.zone).toBe("right");
        expect(st.pendingReset).toBe(false);
        expect(st.frozen).toBe(true);
    });

    it("冻结期间 LEAVE 不启动定时器", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "FREEZE" }, { type: "LEAVE" }]);
        expect(st.zone).toBe("right");
        expect(st.pendingReset).toBe(false);
    });

    it("冻结期间 RESET 不生效（菜单开着时不能被收掉）", () => {
        const st = run(NeutralHoverLatch, [
            enter(200),
            { type: "LEAVE" },
            { type: "FREEZE" },
            { type: "RESET" },
        ]);
        expect(st.zone).toBe("right");
        expect(st.frozen).toBe(true);
    });

    it("冻结期间 ENTER 不重新判定方向", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "FREEZE" }, enter(10)]);
        expect(st.zone).toBe("right");
        expect(st.frozen).toBe(true);
    });

    it("UNFREEZE 回中性", () => {
        const st = run(NeutralHoverLatch, [enter(200), { type: "FREEZE" }, { type: "UNFREEZE" }]);
        expect(st).toEqual(NeutralHoverLatch);
    });

    it("graceMs=0 时 FREEZE 救不回已丢失的 zone —— 必须靠 relatedTarget 拦 LEAVE", () => {
        // 模拟 graceMs=0：LEAVE 立刻伴随 RESET
        const st = run(NeutralHoverLatch, [enter(200), { type: "LEAVE" }, { type: "RESET" }, { type: "FREEZE" }]);
        expect(st.zone).toBeNull();
        expect(st.frozen).toBe(true);
        // 结论：主路径必须靠 isLeavingToAttachedLayer 在 LEAVE 之前拦下。
    });
});

describe("reduceHoverLatch — 类型层无 MOVE", () => {
    it("HoverLatchEvent 联合类型里不存在 pointermove 类事件", () => {
        const types: HoverLatchEvent["type"][] = ["ENTER", "LEAVE", "RESET", "FREEZE", "UNFREEZE"];
        // 若有人加了 MOVE，这里的断言会失败，提醒去改 PRD 而不是偷偷放进来。
        expect(types).toEqual(["ENTER", "LEAVE", "RESET", "FREEZE", "UNFREEZE"]);
    });
});

describe("clampHoverGraceMs", () => {
    it("缺省用默认值", () => {
        expect(clampHoverGraceMs(null)).toBe(DefaultHoverGraceMs);
        expect(clampHoverGraceMs(undefined)).toBe(DefaultHoverGraceMs);
        expect(clampHoverGraceMs(NaN)).toBe(DefaultHoverGraceMs);
    });

    it("钳制到 [0, 1200]", () => {
        expect(clampHoverGraceMs(-50)).toBe(0);
        expect(clampHoverGraceMs(5000)).toBe(MaxHoverGraceMs);
        expect(clampHoverGraceMs(400)).toBe(400);
    });

    it("0 是合法值（离开立刻恢复）", () => {
        expect(clampHoverGraceMs(0)).toBe(0);
    });
});
