// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useInfoCardHover — 悬浮信息卡通用交互状态。
//
// 统一「目标元素 hover → 显示卡片 / 卡片自身 hover 保活 / 延迟隐藏」三件套，
// 供 Block Sidebar / Inline Tab 等 surface 复用，避免各自维护计时器。
//
// blockframe-header 有自己的 PointerEnter/Leave 时序（2000ms），不使用此 hook。

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type InfoCardPlacement = "right" | "bottom";

export type InfoCardHoverState = {
    /** 卡片是否应该渲染（目标或卡片自身被 hover 时为 true）。 */
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

    const internalRef = useRef<HTMLDivElement | null>(null);
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

    useEffect(
        () => () => {
            cancelHide();
        },
        [cancelHide]
    );

    const targetProps = useMemo(
        () => ({
            ref: targetRef,
            onMouseEnter: () => {
                cancelHide();
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
                setIsCardHovered(true);
            },
            onMouseLeave: scheduleHide,
            onFocusCapture: () => {
                cardFocusRef.current = true;
                cancelHide();
                setIsCardHovered(true);
                setIsHovered(true);
            },
            onBlurCapture: (e: React.FocusEvent) => {
                if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
                    return;
                }
                cardFocusRef.current = false;
            },
        }),
        [cancelHide, scheduleHide]
    );

    return useMemo(
        () => ({
            isOpen: isHovered || isCardHovered,
            cardPos,
            targetProps,
            cardProps,
            refreshCardPos,
        }),
        [isHovered, isCardHovered, cardPos, targetProps, cardProps, refreshCardPos]
    );
}

/**
 * InfoCardPortal — 把 children portal 到 body，定位在 cardPos（fixed 像素坐标）。
 * portal wrapper 自动绑定 cardProps（保活 + 无障碍）。
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
