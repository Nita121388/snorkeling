// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Files Block header 的悬停分区「锁存」状态机。
//
// 为什么必须是锁存（而不是实时按鼠标位置算分区）：
//
// 右半悬浮会让左侧（chevron + 路径）收起让位，腾出的宽度全给右侧 icon 组，
// 于是右组会向左伸展、越过 header 中线。若分区靠 pointermove 实时重算，
// 鼠标去点那个已经伸过中线的 icon 时，x 落在中线左侧 → 分区翻成 left →
// 右组消失 → icon 点不到 → 鼠标退回 → 又翻回 right → 无限闪烁。
//
// 锁存把这个循环从结构上消灭：方向只在 pointerenter 判定一次，之后整个
// hover 会话内不可变。类型层就杜绝了误用 —— HoverLatchEvent 里没有 MOVE。
//
// 状态转移只由 pointerenter / pointerleave / 宽限定时器 / 菜单冻结驱动：
//
//   NEUTRAL ──ENTER(x)──▶ LATCHED_LEFT / LATCHED_RIGHT
//      ▲                        │
//      │                   LEAVE()│  ← pointermove 一律忽略
//      │                        ▼
//      │                     GRACE（pendingReset=true，方向仍保持）
//      │        RESET()（定时器到期）│
//      └────────────────────────┘
//              宽限内 ENTER() → 取消定时器 + 沿用原方向
//
// FROZEN（溢出菜单 / 浮层打开）时 LEAVE 不启动定时器、RESET 不生效，
// 保证「鼠标移进菜单」不会把已展开的那一侧收掉。

export type HoverZone = "left" | "right";

export type HoverLatchState = {
    /** 当前锁存的方向；null = 两侧都不展开（路径完整显示）。 */
    zone: HoverZone | null;
    /** 已收到 LEAVE，宽限定时器在跑。到期 RESET 才真正回到中性。 */
    pendingReset: boolean;
    /** 溢出菜单 / 浮层打开中：LEAVE 不再启动定时器，RESET 也不生效。 */
    frozen: boolean;
};

export type HoverLatchEvent =
    | { type: "ENTER"; x: number; mid: number }
    | { type: "LEAVE" }
    /** 宽限定时器到期（由调用方的 setTimeout 派发）。 */
    | { type: "RESET" }
    | { type: "FREEZE" }
    | { type: "UNFREEZE" };

export const NeutralHoverLatch: HoverLatchState = { zone: null, pendingReset: false, frozen: false };

/** 默认宽限毫秒数。0 = 离开 header 立刻恢复中性。 */
export const DefaultHoverGraceMs = 400;
export const MinHoverGraceMs = 0;
export const MaxHoverGraceMs = 1200;

/** 把任意数值钳制成合法的宽限毫秒数。 */
export function clampHoverGraceMs(raw: number | null | undefined): number {
    if (raw == null || !Number.isFinite(raw)) return DefaultHoverGraceMs;
    return Math.min(MaxHoverGraceMs, Math.max(MinHoverGraceMs, Math.round(raw)));
}

/**
 * 纯函数状态机。无副作用、无 DOM、无定时器 —— 定时器由调用方按
 * 返回值的 `pendingReset` 管理，所以整个转移图可以穷举单测。
 *
 * 关键性质：除了 ENTER，任何事件都不读坐标。ENTER 之外没有其它事件能改变
 * `zone` 的「方向」语义（LEAVE/RESET/FREEZE/UNFREEZE 只改 pendingReset/frozen
 * 或把 zone 清成 null）。
 */
export function reduceHoverLatch(st: HoverLatchState, ev: HoverLatchEvent): HoverLatchState {
    switch (ev.type) {
        case "ENTER":
            if (st.frozen) {
                // 菜单开着时指针回到 header：不重新判定，也不解除冻结。
                return st;
            }
            if (st.zone != null) {
                // 宽限内回来（或本来就在里面）：沿用原方向，只取消待重置。
                return { zone: st.zone, pendingReset: false, frozen: false };
            }
            return {
                zone: ev.x < ev.mid ? "left" : "right",
                pendingReset: false,
                frozen: false,
            };
        case "LEAVE":
            if (st.frozen || st.zone == null) {
                return st;
            }
            return { zone: st.zone, pendingReset: true, frozen: false };
        case "RESET":
            if (st.frozen || !st.pendingReset) {
                return st;
            }
            return { ...NeutralHoverLatch };
        case "FREEZE":
            return { zone: st.zone, pendingReset: false, frozen: true };
        case "UNFREEZE":
            return { ...NeutralHoverLatch };
        default: {
            // 类型层兜底：新增事件类型时必须在这里补分支，否则编译报错。
            const never: never = ev;
            return never;
        }
    }
}
