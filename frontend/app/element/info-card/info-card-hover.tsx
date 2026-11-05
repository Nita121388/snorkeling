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
//
// 附属浮层（attached layer）：属性值编辑浮层等组件会 portal 到 body，DOM 上不是卡片子节点，
// 但 React 树仍是卡片的子孙。它们做两件事：
//  1. 根节点标 `data-info-card-attached` →「点卡片内部 / 焦点仍在编辑中」的包含判定把它算作卡内；
//  2. 通过 `useInfoCardPin()` 在打开期间 pin 住卡片，关闭时 release（见 InfoCardPinContext）。
// 缺这两条时：鼠标移到浮层上会被判成“离开卡片” → 300ms 收卡 → 锚点消失、编辑器当场消失。

import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    claimInfoCard,
    isInfoCardClaimedBy,
    releaseInfoCard,
    subscribeInfoCard,
} from "./info-card-global";

/** 附属浮层的根节点标记（portal 到 body 的浮层用它把自己声明成“卡内”）。 */
export const InfoCardAttachedAttribute = "data-info-card-attached";

/** 该节点是否落在卡片的附属浮层里（只在 DOM 上判断，不看 React 树）。 */
export function isInAttachedInfoCardLayer(target: Node | null | undefined): boolean {
    if (target == null) return false;
    const el = target instanceof Element ? target : (target as Node).parentElement;
    return el?.closest(`[${InfoCardAttachedAttribute}]`) != null;
}

/**
 * 附属浮层对卡片的保活句柄。
 * pin / release 必须成对调用（挂载即 pin，卸载或关闭即 release），内部按计数支持嵌套浮层。
 */
export type InfoCardPinHandle = {
    pin: () => void;
    release: () => void;
};

const NoopPinHandle: InfoCardPinHandle = { pin: () => {}, release: () => {} };

const InfoCardPinContext = createContext<InfoCardPinHandle>(NoopPinHandle);

/**
 * 在附属浮层里调用：拿到当前卡片的保活句柄（不在卡片里时是 no-op）。
 * 默认值刻意是 no-op 而不是 null —— md 预览等非卡片场景不用写判空。
 */
export function useInfoCardPin(): InfoCardPinHandle {
    return useContext(InfoCardPinContext);
}

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
    /** 附属浮层保活句柄（由 InfoCardPortal 通过 context 下发给浮层）。 */
    pinHandle: InfoCardPinHandle;
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
    /** 附属浮层 pin 计数：> 0 时一律不因 hover / 失焦收起卡片。 */
    const pinCountRef = useRef(0);

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
            // 定时器挂起期间状态可能已经变了（又被钉住 / 浮层刚打开），到期时再确认一次。
            if (cardFocusRef.current || pinCountRef.current > 0) {
                return;
            }
            setIsHovered(false);
            setIsCardHovered(false);
        }, hideDelayMs);
    }, [cancelHide, hideDelayMs]);

    const closeNow = useCallback(() => {
        cancelHide();
        cardFocusRef.current = false;
        pinCountRef.current = 0;
        setIsHovered(false);
        setIsCardHovered(false);
    }, [cancelHide]);

    // 附属浮层（portal 到 body）的保活：打开即 pin，关闭即 release。
    const pinCard = useCallback(() => {
        pinCountRef.current += 1;
        cancelHide();
        claimInfoCard(claimTokenRef.current);
        setIsHovered(true);
        setIsCardHovered(true);
    }, [cancelHide]);

    const releasePin = useCallback(() => {
        pinCountRef.current = Math.max(0, pinCountRef.current - 1);
        if (pinCountRef.current > 0) {
            return;
        }
        // 浮层关掉了：焦点不在卡内、指针也不在卡上时，按常规延迟收起。
        // 指针还在卡上就不抢着关（等 mouseleave，与其它路径一致）。
        if (cardFocusRef.current || cardElRef.current?.matches(":hover")) {
            return;
        }
        scheduleHide();
    }, [scheduleHide]);

    const pinHandle = useMemo(() => ({ pin: pinCard, release: releasePin }), [pinCard, releasePin]);

    const isInside = useCallback(
        (target: Node) =>
            cardElRef.current?.contains(target) ||
            targetRef.current?.contains(target) ||
            isInAttachedInfoCardLayer(target) ||
            false,
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
                    pinCountRef.current = 0;
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
                // 卡片内有焦点（正在写 note / 点了复制按钮）或附属浮层开着时不因鼠标移开而关闭，
                // 否则编辑会被 300ms 隐藏定时器打断；此时由「点击外侧」或失焦负责关闭。
                if (cardFocusRef.current || pinCountRef.current > 0) {
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
                if (e.relatedTarget instanceof Node) {
                    // 附属浮层也是“卡内”：焦点从卡片走出去进浮层，不算离开。
                    if (
                        e.currentTarget.contains(e.relatedTarget) ||
                        isInAttachedInfoCardLayer(e.relatedTarget)
                    ) {
                        return;
                    }
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
            pinHandle,
        }),
        [isHovered, isCardHovered, cardPos, targetProps, cardProps, refreshCardPos, targetRef, pinHandle]
    );
}

/**
 * InfoCardPinProvider — 把「附属浮层保活」句柄通过 context 下发给卡片内容。
 * 悬浮卡自己维护 hover/focus 状态时（如 BlockFrame_Header），直接用它包裹卡片内容即可。
 */
export function InfoCardPinProvider({
    pin,
    release,
    children,
}: {
    pin: () => void;
    release: () => void;
    children: React.ReactNode;
}) {
    const handle = useMemo(() => ({ pin, release }), [pin, release]);
    return <InfoCardPinContext.Provider value={handle}>{children}</InfoCardPinContext.Provider>;
}

/**
 * InfoCardPortal — 把 children portal 到 body，定位在 cardPos（fixed 像素坐标）。
 * portal wrapper 自动绑定 cardProps（保活 + 无障碍）与 cardRef（点击外侧关闭判定），
 * 并通过 InfoCardPinContext 把 pin 句柄下发给附属浮层（属性值浮层等）。
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
            <InfoCardPinProvider pin={hover.pinHandle.pin} release={hover.pinHandle.release}>
                {children}
            </InfoCardPinProvider>
        </div>,
        document.body
    );
}
