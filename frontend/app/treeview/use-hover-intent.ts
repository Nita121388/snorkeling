// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from "react";

/**
 * hover-intent（悬浮意图）时序控制。
 *
 * 语义：
 *  - `pointerEnter()`：开始计时，延迟 `delayMs` 后才真正打开；
 *  - `pointerLeave()`：立刻取消待打开的计时；如果已经打开，则开始关闭流程；
 *  - 关闭分两段：先 `onClose`（触发淡出过渡），`closeDelayMs` 之后再 `onUnmount`
 *    （真正把 DOM 摘掉），保证出场动画能跑完。
 *
 * 为什么要抽成纯控制器（不直接写成 hook）：
 *  - 计时行为是纯时序逻辑，与 React 无关。做成普通对象就能用 fake timers 做确定性单测，
 *    不必渲染组件、不必依赖真实鼠标；
 *  - 虚拟滚动的树里可能有几十行同时挂载，计时器必须**整棵树共用**，
 *    每行一个 timer 会互相抢先把浮层指向别的行。
 */

export interface HoverIntentOptions {
    /** 打开前的等待时长（毫秒） */
    delayMs: number;
    /** 关闭动画时长（毫秒）；到期后调用 onUnmount 摘除 DOM */
    closeDelayMs: number;
    /** 计时到期、浮层应当打开 */
    onOpen: () => void;
    /** 指针移出、浮层应当开始关闭（触发淡出） */
    onClose: () => void;
    /** 关闭动画结束、DOM 可以摘除 */
    onUnmount: () => void;
}

export interface HoverIntentController {
    pointerEnter: () => void;
    pointerLeave: () => void;
    /** 清理待触发的计时器（组件卸载时调用） */
    dispose: () => void;
}

export function createHoverIntentController(options: HoverIntentOptions): HoverIntentController {
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    // 用 globalThis 而不是 window：本模块是纯时序逻辑（不碰 DOM），
    // 这样单测不需要 jsdom 环境，node 下也能直接跑。
    const clearOpenTimer = () => {
        if (openTimer != null) {
            globalThis.clearTimeout(openTimer);
            openTimer = null;
        }
    };

    const clearCloseTimer = () => {
        if (closeTimer != null) {
            globalThis.clearTimeout(closeTimer);
            closeTimer = null;
        }
    };

    return {
        pointerEnter() {
            clearOpenTimer();
            clearCloseTimer();
            openTimer = globalThis.setTimeout(() => {
                openTimer = null;
                options.onOpen();
            }, options.delayMs);
        },
        pointerLeave() {
            clearOpenTimer();
            options.onClose();
            clearCloseTimer();
            closeTimer = globalThis.setTimeout(() => {
                closeTimer = null;
                options.onUnmount();
            }, options.closeDelayMs);
        },
        dispose() {
            clearOpenTimer();
            clearCloseTimer();
        },
    };
}

/**
 * React 版本的 hover-intent。回调放在 ref 里，调用方每次渲染传新的函数引用也不会
 * 重建控制器（虚拟滚动下渲染很频繁）。
 */
export function useHoverIntent(options: HoverIntentOptions): {
    pointerEnter: () => void;
    pointerLeave: () => void;
} {
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const controllerRef = useRef<HoverIntentController | null>(null);
    if (controllerRef.current == null) {
        controllerRef.current = createHoverIntentController({
            delayMs: optionsRef.current.delayMs,
            closeDelayMs: optionsRef.current.closeDelayMs,
            onOpen: () => optionsRef.current.onOpen(),
            onClose: () => optionsRef.current.onClose(),
            onUnmount: () => optionsRef.current.onUnmount(),
        });
    }

    useEffect(() => {
        const controller = controllerRef.current;
        return () => {
            // 组件卸载时清掉待触发的计时器，避免回调打到已销毁的树上
            controller?.dispose();
        };
    }, []);

    return {
        pointerEnter: () => controllerRef.current?.pointerEnter(),
        pointerLeave: () => controllerRef.current?.pointerLeave(),
    };
}
