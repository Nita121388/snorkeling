// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 把纯函数状态机（header-hover-latch.ts）接到 React：管理宽限定时器 + 提供
// pointerenter / pointerleave 的处理器。
//
// 关键约定（改这里前先读）：
//  - **没有 pointermove 处理器**。方向只在 pointerenter 判定一次，之后整个
//    hover 会话内不可变。这是消除「右组越过中线导致翻区、点不到、来回闪」的
//    结构性保证，不是可以优化掉的东西。
//  - 与 `isHovered`（既有，控制 reveal 显隐 + 悬浮卡）**完全独立**。两者并行，
//    互不读写。
//  - 定时器只有一个（宽限重置），ENTER/FREEZE/UNFREEZE 一律取消它。

import * as React from "react";
import {
    clampHoverGraceMs,
    DefaultHoverGraceMs,
    NeutralHoverLatch,
    reduceHoverLatch,
    type HoverLatchEvent,
    type HoverLatchState,
} from "./header-hover-latch";
import { isLeavingToAttachedLayer } from "./header-attached-layer";

export type HeaderHoverLatchApi = {
    latch: HoverLatchState;
    /** 挂到 header 根节点的 onPointerEnter。 */
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
    /**
     * 挂到 header 根节点的 onPointerLeave。
     * `attachedEls` 里的元素（溢出菜单 / 浮层）视为「仍在会话内」。
     */
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => void;
    /** 溢出菜单 / 浮层开合时调用。 */
    freeze: () => void;
    unfreeze: () => void;
    /** 设置项变更时由调用方传入；0 = 离开立刻恢复。 */
    graceMs: number;
};

/**
 * @param enabled  false 时完全退回旧行为（不锁存、不改 data-latched）。
 * @param graceMsRaw 设置项原值；会被钳制到 [0, 1200]。
 * @param getAttachedEls 返回「附属层」根元素（溢出菜单 / 浮层）。延迟求值，
 *        因为菜单是 portal，挂载时机晚于 hook 初始化。
 */
export function useHeaderHoverLatch(
    enabled: boolean,
    graceMsRaw: number | null | undefined,
    getAttachedEls: () => (Element | null | undefined)[]
): HeaderHoverLatchApi {
    const graceMs = clampHoverGraceMs(graceMsRaw ?? DefaultHoverGraceMs);
    const [latch, setLatch] = React.useState<HoverLatchState>(NeutralHoverLatch);
    const resetTimerRef = React.useRef<number | null>(null);
    // 用 ref 镜像 state，避免 apply 的闭包读到过期值（同一帧内可能连发多个事件）。
    const latchRef = React.useRef<HoverLatchState>(NeutralHoverLatch);
    const graceMsRef = React.useRef(graceMs);
    graceMsRef.current = graceMs;

    const cancelReset = React.useCallback(() => {
        if (resetTimerRef.current != null) {
            window.clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
    }, []);

    const apply = React.useCallback(
        (ev: HoverLatchEvent) => {
            const next = reduceHoverLatch(latchRef.current, ev);
            latchRef.current = next;
            setLatch(next);

            if (ev.type === "ENTER" || ev.type === "FREEZE" || ev.type === "UNFREEZE") {
                cancelReset();
            }
            if (next.pendingReset) {
                cancelReset();
                const ms = graceMsRef.current;
                resetTimerRef.current = window.setTimeout(() => {
                    resetTimerRef.current = null;
                    const after = reduceHoverLatch(latchRef.current, { type: "RESET" });
                    latchRef.current = after;
                    setLatch(after);
                }, ms);
            }
        },
        [cancelReset]
    );

    React.useEffect(() => () => cancelReset(), [cancelReset]);

    // 关闭开关时立刻回中性，别留下半开状态。
    React.useEffect(() => {
        if (!enabled) {
            cancelReset();
            latchRef.current = NeutralHoverLatch;
            setLatch(NeutralHoverLatch);
        }
    }, [enabled, cancelReset]);

    const onPointerEnter = React.useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            if (!enabled) return;
            const rect = e.currentTarget.getBoundingClientRect();
            // 中线取「此刻尚未让位」的 header 宽度 —— 让位后宽度会变，但方向已锁死，
            // 所以不存在"中线漂移导致重判"的问题（本来也不重判）。
            apply({ type: "ENTER", x: e.clientX, mid: rect.left + rect.width / 2 });
        },
        [enabled, apply]
    );

    const onPointerLeave = React.useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            if (!enabled) return;
            // 实测（Playwright + Edge，菜单 portal 到 body）：header 的 pointerleave
            // 先于 menu 的 pointerenter 触发，所以不能指望菜单自己先 freeze。
            // 必须在派发 LEAVE 之前用 relatedTarget 拦一道，否则宽限定时器已启动，
            // graceMs=0 时状态直接丢。
            if (isLeavingToAttachedLayer(e.relatedTarget, getAttachedEls())) {
                return;
            }
            apply({ type: "LEAVE" });
        },
        [enabled, apply, getAttachedEls]
    );

    const freeze = React.useCallback(() => {
        if (!enabled) return;
        apply({ type: "FREEZE" });
    }, [enabled, apply]);

    const unfreeze = React.useCallback(() => {
        if (!enabled) return;
        apply({ type: "UNFREEZE" });
    }, [enabled, apply]);

    return { latch, onPointerEnter, onPointerLeave, freeze, unfreeze, graceMs };
}
