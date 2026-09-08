// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PreviewRail：消息右缘的波浪药丸大纲轨。移植自 Paseo chat-outline（rail.web.tsx +
// hover-intent.ts）+ .mockup/aisessions-chat-redesign 的右缘布局。
//
// - 药丸几何：静止 10px / 激活 18px / 放大 26px 宽，高 2→3px，左对齐向右生长
// - 余弦衰减放大：(1+cos(π·d/3))/2，半径 3
// - hover-intent：150ms 延迟激活；横向掠过重置计时
// - 动效：140ms ease-out CSS transition（Paseo web 同款，不用 rAF 弹簧）

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/util/util";

const RAIL_WIDTH = 36;
const SLOT_HEIGHT = 8;
const RESTING_PILL_HEIGHT = 2;
const MAGNIFIED_PILL_HEIGHT = 3;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const MAGNIFIED_PILL_WIDTH = 26;
const PREVIEW_WIDTH = 260;
const MAGNIFY_RADIUS = 3;

export type OutlinePrompt = {
    seq: number;
    preview: string;
};

/** Dock 式余弦衰减：指针处 1，半径处平滑到 0。 */
function tickMagnification(slotDistance: number): number {
    const distance = Math.abs(slotDistance);
    if (!Number.isFinite(distance) || distance >= MAGNIFY_RADIUS) return 0;
    return (1 + Math.cos((Math.PI * distance) / MAGNIFY_RADIUS)) / 2;
}

// —— hover-intent（Paseo 原版逐行移植）——
interface PointerPoint {
    x: number;
    y: number;
}

const INITIAL_ACTIVATION_DELAY_MS = 150;
const HORIZONTAL_TRANSIT_DISTANCE_PX = 4;

function createHoverIntent(input: {
    activate: (index: number | null) => void;
    schedule: (callback: () => void, delayMs: number) => number;
    cancel: (timerId: number) => void;
}) {
    let timerId: number | null = null;
    let candidateIndex: number | null = null;
    let motionAnchor: PointerPoint | null = null;
    let active = false;

    function cancelTimer(): void {
        if (timerId === null) return;
        input.cancel(timerId);
        timerId = null;
    }

    function scheduleActivation(): void {
        if (candidateIndex === null) return;
        cancelTimer();
        timerId = input.schedule(() => {
            timerId = null;
            active = true;
            if (candidateIndex !== null) input.activate(candidateIndex);
        }, INITIAL_ACTIVATION_DELAY_MS);
    }

    return {
        enter(point: PointerPoint): void {
            motionAnchor = point;
        },
        pointAt(index: number): void {
            candidateIndex = index;
            if (active) {
                input.activate(index);
                return;
            }
            if (timerId !== null) return;
            scheduleActivation();
        },
        move(point: PointerPoint): void {
            if (active || motionAnchor === null) return;
            const deltaX = point.x - motionAnchor.x;
            const deltaY = point.y - motionAnchor.y;
            if (Math.abs(deltaY) >= Math.abs(deltaX)) {
                motionAnchor = point;
                return;
            }
            if (Math.abs(deltaX) < HORIZONTAL_TRANSIT_DISTANCE_PX) return;
            motionAnchor = point;
            scheduleActivation();
        },
        leave(): void {
            cancelTimer();
            candidateIndex = null;
            motionAnchor = null;
            active = false;
            input.activate(null);
        },
        dispose(): void {
            cancelTimer();
            candidateIndex = null;
            motionAnchor = null;
            active = false;
        },
    };
}

type RailTickProps = {
    index: number;
    prompt: OutlinePrompt;
    isActive: boolean;
    attentionIndex: number | null;
    onHover: (index: number) => void;
    onJump: (seq: number) => void;
};

const RailTick = memo(function RailTick({
    index,
    prompt,
    isActive,
    attentionIndex,
    onHover,
    onJump,
}: RailTickProps) {
    const hasAttention = index === attentionIndex;
    const magnification =
        attentionIndex === null ? 0 : prefersReducedMotionCached() ? 0 : tickMagnification(index - attentionIndex);
    const restingWidth = isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
    const pillWidth = restingWidth + magnification * (MAGNIFIED_PILL_WIDTH - restingWidth);
    const pillHeight = RESTING_PILL_HEIGHT + magnification * (MAGNIFIED_PILL_HEIGHT - RESTING_PILL_HEIGHT);

    return (
        <div
            className="pointer-events-auto relative flex shrink-0 items-center justify-start"
            style={{ width: RAIL_WIDTH, height: SLOT_HEIGHT }}
            onMouseEnter={() => onHover(index)}
        >
            <button
                type="button"
                aria-label={`${index + 1}/${prompt.preview}`}
                onClick={() => onJump(prompt.seq)}
                className="flex h-full w-full cursor-pointer items-center justify-start rounded-sm pl-1 outline-none"
            >
                <span
                    className={cn(
                        "rounded-full transition-[width,height,background-color] duration-150 ease-out",
                        isActive ? "bg-primary/55" : hasAttention ? "bg-primary" : "bg-border"
                    )}
                    style={{ width: pillWidth, height: pillHeight }}
                />
            </button>
        </div>
    );
});

// matchMedia 每帧调用太贵；组件级缓存一次即可（ponytail: 不监听变化，刷新生效）
let reducedMotionCache: boolean | null = null;
function prefersReducedMotionCached(): boolean {
    if (reducedMotionCache == null) {
        reducedMotionCache = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    }
    return reducedMotionCache;
}

/**
 * 右缘波浪大纲轨。挂载在消息滚动容器的 relative 父层内；
 * activeSeq 由父层滚动位置推导（见 useActiveOutlineSeq）。
 */
export const SessionOutlineRail = memo(function SessionOutlineRail({
    prompts,
    activeSeq,
    onJump,
}: {
    prompts: OutlinePrompt[];
    activeSeq: number | null;
    /**
     * 可选：点击 tick 跳转消息位置（GUI 会话详情）。
     * 缺省时（如 TUI 消息轨）点击 = 固定/取消固定该消息的完整预览气泡。
     */
    onJump?: (seq: number) => void;
}) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [pinnedSeq, setPinnedSeq] = useState<number | null>(null);
    const [previewState, setPreviewState] = useState<{
        rect: DOMRect;
        preview: string;
        pinned: boolean;
    } | null>(null);
    const railRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const closeTimerRef = useRef<number | null>(null);
    const previewHoveredRef = useRef(false);
    const [copied, setCopied] = useState(false);

    const hoverIntent = useRef(
        createHoverIntent({
            activate: setHoveredIndex,
            schedule: (cb, delay) => window.setTimeout(cb, delay),
            cancel: (id) => window.clearTimeout(id),
        })
    );
    useEffect(
        () => () => {
            hoverIntent.current.dispose();
            if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
        },
        []
    );
    useEffect(() => {
        if (pinnedSeq == null) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setPinnedSeq(null);
                hoverIntent.current.leave();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [pinnedSeq]);
    const cancelClose = useCallback(() => {
        if (closeTimerRef.current != null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);
    const scheduleClose = useCallback(() => {
        cancelClose();
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            if (!previewHoveredRef.current && pinnedSeq == null) hoverIntent.current.leave();
        }, 500);
    }, [cancelClose, pinnedSeq]);
    const handleHover = useCallback((index: number) => {
        cancelClose();
        hoverIntent.current.pointAt(index);
    }, [cancelClose]);
    const handleJump = useCallback(
        (seq: number) => {
            if (onJump != null) {
                onJump(seq);
                return;
            }
            setPinnedSeq((current) => (current === seq ? null : seq));
        },
        [onJump]
    );

    // 当 hoveredIndex / pinnedSeq 变化时，直接从 DOM 读取 pill 位置来设置预览。
    // 固定点击优先于悬浮，保证点击后气泡不随指针离开消失。
    useEffect(() => {
        let index: number | null = null;
        let pinned = false;
        if (onJump == null && pinnedSeq != null) {
            const found = prompts.findIndex((p) => p.seq === pinnedSeq);
            if (found >= 0) {
                index = found;
                pinned = true;
            }
        }
        if (index == null) {
            index = hoveredIndex;
        }
        if (index == null || !scrollRef.current) {
            setPreviewState(null);
            return;
        }
        const pill = scrollRef.current.children[index] as HTMLElement;
        if (!pill) {
            setPreviewState(null);
            return;
        }
        const rect = pill.getBoundingClientRect();
        setPreviewState({ rect, preview: prompts[index]?.preview ?? "", pinned });
    }, [hoveredIndex, pinnedSeq, prompts, onJump]);

    // 滚动/resize 时刷新预览位置
    useEffect(() => {
        const index =
            onJump == null && pinnedSeq != null ? prompts.findIndex((p) => p.seq === pinnedSeq) : hoveredIndex;
        if (index == null || index < 0) return;
        const refresh = () => {
            if (!scrollRef.current) return;
            const pill = scrollRef.current.children[index] as HTMLElement;
            if (!pill) return;
            const rect = pill.getBoundingClientRect();
            setPreviewState((prev) => (prev ? { ...prev, rect } : prev));
        };
        const onFrame = () => requestAnimationFrame(refresh);
        window.addEventListener("scroll", onFrame, true);
        window.addEventListener("resize", onFrame);
        return () => {
            window.removeEventListener("scroll", onFrame, true);
            window.removeEventListener("resize", onFrame);
        };
    }, [hoveredIndex, pinnedSeq, prompts, onJump]);

    if (prompts.length < 2) return null;
    const attentionIndex = hoveredIndex;

    return (
        <>
            <div
                ref={railRef}
                className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2 flex flex-col justify-center py-1"
                style={{ width: RAIL_WIDTH }}
                onMouseEnter={(e) => {
                    cancelClose();
                    hoverIntent.current.enter({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => hoverIntent.current.move({ x: e.clientX, y: e.clientY })}
                onMouseLeave={scheduleClose}
            >
                <div ref={scrollRef} className="overflow-y-auto max-h-[300px] scrollbar-hide-until-hover" style={{ width: RAIL_WIDTH }}>
                    {prompts.map((prompt, index) => (
                        <RailTick
                            key={prompt.seq}
                            index={index}
                            prompt={prompt}
                            isActive={prompt.seq === activeSeq}
                            attentionIndex={attentionIndex}
                            onHover={handleHover}
                            onJump={handleJump}
                        />
                    ))}
                </div>
            </div>
            {/* 预览气泡走 portal: rail 可能挂在带 transform 的祖先(如 TUI 消息轨)下,
                position:fixed 会被 transform 捕获而定位错乱。 */}
            {previewState &&
                createPortal(
                    <div
                        className={cn(
                            "pointer-events-auto fixed z-50 rounded-lg border border-border bg-panel px-3 py-2 text-xs leading-4 text-primary shadow-xl",
                            "select-text",
                            previewState.pinned && "ring-1 ring-primary/30"
                        )}
                        onMouseEnter={() => {
                            previewHoveredRef.current = true;
                            cancelClose();
                        }}
                        onMouseLeave={() => {
                            previewHoveredRef.current = false;
                            scheduleClose();
                        }}
                        tabIndex={-1}
                        style={{
                            width: PREVIEW_WIDTH,
                            right: window.innerWidth - previewState.rect.left + 6,
                            top: previewState.rect.top + previewState.rect.height / 2,
                            transform: "translateY(-50%)",
                            maxHeight: 320,
                            overflowY: "auto",
                        }}
                    >
                        <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{previewState.preview}</span>
                            {previewState.pinned ? (
                                <button
                                    type="button"
                                    className="shrink-0 rounded px-1 text-secondary hover:bg-hover hover:text-primary"
                                    aria-label={copied ? "Copied" : "Copy message"}
                                    title={copied ? "Copied" : "Copy message"}
                                    onClick={() => {
                                        void (async () => {
                                            try {
                                                if (navigator.clipboard == null) return;
                                                await navigator.clipboard.writeText(previewState.preview);
                                                setCopied(true);
                                                window.setTimeout(() => setCopied(false), 1200);
                                            } catch {
                                                // Clipboard 权限被拒绝时保持 Tooltip 打开，用户仍可手动选择复制。
                                            }
                                        })();
                                    }}
                                >
                                    <i className={cn("fa-sharp fa-solid", copied ? "fa-check" : "fa-copy")} />
                                </button>
                            ) : null}
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
});

/**
 * 视口内最后一个 user 消息 seq 作为激活药丸。挂在滚动容器上，
 * 用 useSyncExternalStore 的思路简化为节流 state（消息数有限，计算便宜）。
 */
export function useActiveOutlineSeq(
    containerRef: React.RefObject<HTMLDivElement | null>,
    prompts: OutlinePrompt[]
): number | null {
    const [activeSeq, setActiveSeq] = useState<number | null>(null);
    const promptSeqs = useMemo(() => prompts.map((p) => p.seq), [prompts]);

    useEffect(() => {
        const container = containerRef.current;
        if (container == null || promptSeqs.length === 0) return;
        let raf = 0;
        const update = () => {
            raf = 0;
            const rect = container.getBoundingClientRect();
            const probeY = rect.top + rect.height * 0.25;
            let current: number | null = null;
            for (const seq of promptSeqs) {
                const node = document.getElementById(`aisession-message-${seq}`);
                if (node == null) continue;
                if (node.getBoundingClientRect().top <= probeY) {
                    current = seq;
                } else {
                    break;
                }
            }
            setActiveSeq(current ?? promptSeqs[0]);
        };
        const onScroll = () => {
            if (raf === 0) raf = window.requestAnimationFrame(update);
        };
        update();
        container.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", onScroll);
            if (raf !== 0) window.cancelAnimationFrame(raf);
        };
    }, [containerRef, promptSeqs]);

    return activeSeq;
}
