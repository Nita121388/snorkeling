// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useInfoCardHover — 悬浮信息卡通用交互状态。
//
// 统一「目标元素 hover → 显示卡片 / 卡片自身 hover 保活 / 延迟隐藏」三件套，
// 供 Block Sidebar / Inline Tab 等 surface 复用，避免各自维护计时器。
//
// 关闭路径有三条（缺一条就会出现「卡片关不掉」或「编辑被打断」）：
//  1. hover 结束：目标或卡片 mouseleave → 延迟隐藏。
//  2. 焦点离开：卡片内元素失焦且指针已不在卡片上 → 延迟隐藏；
//     指针还在卡片上时不抢着关（等 mouseleave）。
//  3. 点击外侧：document 级 pointerdown 落到卡片与触发元素之外 → 立即关闭。
//     聚焦钉住（点过 note textarea / 复制按钮）后，mouseleave 已不再排定时器，
//     只剩这条路能关，历史上正是这里缺失导致卡片永久停留。
//
// 聚焦钉住语义：卡片内有键盘焦点时，鼠标移开不关卡片（否则 note 编辑被打断），
// 但仍可被「点击外侧」关闭 —— 关闭前先 blur，保证 textarea 的 onBlur 提交先执行。

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    claimInfoCard,
    isInfoCardClaimedBy,
    releaseInfoCard,
    subscribeInfoCard,
} from "./info-card-global";

export type InfoCardPlacement = "right" | "bottom";

export type InfoCardRefs = {
    /** 触发元素（hover 目标）。 */
    targetRef: React.RefObject<HTMLDivElement | null>;
    /** 卡片容器（portal wrapper）。关闭判定用它做「点卡片内部」的包含检查。 */
    cardRef: React.RefObject<HTMLDivElement | null>;
};

export type InfoCardHoverState = InfoCardRefs & {
    /** 卡片是否应该渲染（目标或卡片自身被 hover / 被聚焦时为 true）。 */
    isOpen: boolean;
    /** 卡片的 fixed 像素坐标（portal 用）。 */
    cardPos: { top: number; left: number } | null;
    /** 目标元素需要的 props：ref + onMouseEnter + onMouseLeave。 */
    targetProps: {
        ref: React.RefObject<HTMLDivElement | null>;
        onMouseEnter: () => void;
        onMouseLeave: () => void;
    };
    /** 卡片 wrapper 需要的 props：保活 + 键盘无障碍。 */
    cardProps: {
        onMouseEnter: () => void;
        onMouseLeave: () => void;
        onFocusCapture: () => void;
        onBlurCapture: (e: React.FocusEvent) => void;
    };
    /** 手动刷新卡片坐标（窗口滚动 / resize 后可用）。 */
    refreshCardPos: () => void;
};

/**
 * useInfoCardDismiss — 卡片打开期间监听 document 级 pointerdown / contextmenu：
 * 点击目标既不在卡片内、也不在触发元素内时立即关闭。
 *
 * 这是「点击外侧关闭」的兜底路径，不依赖 mouseleave / blur 是否按预期触发。
 * 关闭前若焦点还留在卡片内，先 blur 一次（让 textarea 之类先提交）。
 */
export function useInfoCardDismiss(opts: {
    isOpen: boolean;
    isInside: (target: Node) => boolean;
    onDismiss: () => void;
}): void {
    const { isOpen, isInside, onDismiss } = opts;
    const isInsideRef = useRef(isInside);
    const onDismissRef = useRef(onDismiss);
    isInsideRef.current = isInside;
    onDismissRef.current = onDismiss;

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handle = (event: Event) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (isInsideRef.current(target)) {
                return;
            }
            const active = document.activeElement;
            if (active instanceof HTMLElement && isInsideRef.current(active)) {
                // 先把卡片内的焦点清掉：textarea 的 onBlur（note 提交）先跑，
                // 再关卡片，避免「点外侧丢 note 草稿」。
                active.blur();
            }
            onDismissRef.current();
        };
        document.addEventListener("pointerdown", handle, true);
        document.addEventListener("contextmenu", handle, true);
        return () => {
            document.removeEventListener("pointerdown", handle, true);
            document.removeEventListener("contextmenu", handle, true);
        };
    }, [isOpen]);
}

export function useInfoCardHover(opts?: {
    placement?: InfoCardPlacement;
    hideDelayMs?: number;
    /** 外部传入的目标元素 ref（用于目标元素已持有 ref 的场景，如 InlineTab 的 tabRef 同时供 DnD 使用）。 */
    targetRef?: React.RefObject<HTMLDivElement | null>;
}): InfoCardHoverState {
    const placement = opts?.placement ?? "right";
    const hideDelayMs = opts?.hideDelayMs ?? 300;

    const [isHovered, setIsHovered] = useState(false);
    const [isCardHovered, setIsCardHovered] = useState(false);
    const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);

    // 本实例在全局独占管理器中的唯一 token, 用于被顶掉判定。
    const claimTokenRef = useRef<symbol>(Symbol("info-card-hover"));
    const internalRef = useRef<HTMLDivElement | null>(null);
    const cardElRef = useRef<HTMLDivElement | null>(null);
    const targetRef = opts?.targetRef ?? internalRef;
    const hideTimerRef = useRef<number | null>(null);
    const cardFocusRef = useRef(false);

    const cancelHide = useCallback(() => {
        if (hideTimerRef.current != null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    const refreshCardPos = useCallback(() => {
        const rect = targetRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        setCardPos(
            placement === "bottom"
                ? { top: rect.bottom + 2, left: rect.left }
                : { top: rect.top, left: rect.right + 8 }
        );
    }, [placement, targetRef]);

    const scheduleHide = useCallback(() => {
        cancelHide();
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setIsHovered(false);
            setIsCardHovered(false);
        }, hideDelayMs);
    }, [cancelHide, hideDelayMs]);

    const closeNow = useCallback(() => {
        cancelHide();
        cardFocusRef.current = false;
        setIsHovered(false);
        setIsCardHovered(false);
    }, [cancelHide]);

    const isInside = useCallback(
        (target: Node) => cardElRef.current?.contains(target) || targetRef.current?.contains(target) || false,
        [targetRef]
    );

    useInfoCardDismiss({ isOpen: isHovered || isCardHovered, isInside, onDismiss: closeNow });

    // 被全局独占管理器顶掉时, 立即强制关闭自身(跳过隐藏延迟)。
    useEffect(
        () =>
            subscribeInfoCard(() => {
                if (!isInfoCardClaimedBy(claimTokenRef.current)) {
                    cancelHide();
                    cardFocusRef.current = false;
                    setIsHovered(false);
                    setIsCardHovered(false);
                }
            }),
        [cancelHide]
    );

    // 完全关闭后释放占用, 避免 stale token 阻塞后续判断。
    useEffect(() => {
        if (!(isHovered || isCardHovered)) {
            releaseInfoCard(claimTokenRef.current);
        }
    }, [isHovered, isCardHovered]);

    useEffect(
        () => () => {
            cancelHide();
            releaseInfoCard(claimTokenRef.current);
        },
        [cancelHide]
    );

    const targetProps = useMemo(
        () => ({
            ref: targetRef,
            onMouseEnter: () => {
                cancelHide();
                claimInfoCard(claimTokenRef.current);
                setIsHovered(true);
                refreshCardPos();
            },
            onMouseLeave: scheduleHide,
        }),
        [cancelHide, refreshCardPos, scheduleHide]
    );

    const cardProps = useMemo(
        () => ({
            onMouseEnter: () => {
                cancelHide();
                claimInfoCard(claimTokenRef.current);
                setIsCardHovered(true);
            },
            onMouseLeave: () => {
                // 卡片内有焦点（正在写 note / 点了复制按钮）时不因鼠标移开而关闭，
                // 否则编辑会被 300ms 隐藏定时器打断；此时由「点击外侧」或失焦负责关闭。
                if (cardFocusRef.current) {
                    return;
                }
                scheduleHide();
            },
            onFocusCapture: () => {
                cardFocusRef.current = true;
                cancelHide();
                claimInfoCard(claimTokenRef.current);
                setIsCardHovered(true);
                setIsHovered(true);
            },
            onBlurCapture: (e: React.FocusEvent) => {
                if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
                    return;
                }
                cardFocusRef.current = false;
                // 指针还在卡片上就先不关，等 mouseleave；否则焦点走了就该收卡。
                const cardEl = cardElRef.current;
                if (cardEl?.matches(":hover")) {
                    return;
                }
                scheduleHide();
            },
        }),
        [cancelHide, scheduleHide, claimInfoCard]
    );

    return useMemo(
        () => ({
            isOpen: isHovered || isCardHovered,
            cardPos,
            targetRef,
            cardRef: cardElRef,
            targetProps,
            cardProps,
            refreshCardPos,
        }),
        [isHovered, isCardHovered, cardPos, targetProps, cardProps, refreshCardPos, targetRef]
    );
}

/**
 * InfoCardPortal — 把 children portal 到 body，定位在 cardPos（fixed 像素坐标）。
 * portal wrapper 自动绑定 cardProps（保活 + 无障碍）与 cardRef（点击外侧关闭判定）。
 */
export function InfoCardPortal({
    hover,
    children,
}: {
    hover: InfoCardHoverState;
    children: React.ReactNode;
}) {
    if (!hover.isOpen || hover.cardPos == null) {
        return null;
    }
    return createPortal(
        <div
            ref={hover.cardRef}
            className="info-card-portal"
            style={{
                position: "fixed",
                top: hover.cardPos.top,
                left: hover.cardPos.left,
                zIndex: 200,
            }}
            {...hover.cardProps}
        >
            {children}
        </div>,
        document.body
    );
}
