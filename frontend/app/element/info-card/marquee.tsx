// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * InfoCardMarquee — InfoCard 标题行的长文本走马灯。
 *
 * 为什么需要：
 *   InfoCard 标题（会话名 / tab 名）是单行 nowrap 文本，靠 text-overflow 省略号截断。
 *   但标题所在的 InfoCardHead 作为外层 flex item 时，它的自动最小尺寸 = 标题全文宽度，
 *   于是长会话名会把整行撑破卡片——文字直接跑到卡片边框外面（ellipsis 形同虚设，
 *   因为盒子本身已经比卡片宽）。
 *
 * 做法（结构固定，只有副本的 flex 行为随溢出状态切换）：
 *   容器(.info-card-marquee) → 轨道(.info-card-marquee-track) → 两份副本(.info-card-marquee-copy)
 *     - 未溢出：副本可收缩 → 省略号（与普通标题一致）；
 *     - 溢出  ：副本不可收缩 + 第二份接在第一份后面 + 轨道整体左移一个副本宽，
 *               两份首尾相接 → 循环无缝。
 *
 * 其它约定：
 *   - 溢出判定：文本宽度 > 容器可视宽度；宽度变化由 ResizeObserver 跟随。
 *   - hover / focus 暂停滚动，方便停在某一段细看。
 *   - prefers-reduced-motion: reduce 时不滚动，退回省略号。
 *   - 第二份副本 aria-hidden，屏幕阅读器只读一遍。
 */

import { cn } from "@/util/util";
import * as React from "react";

/** 走马灯滚动速度（px/s）：太慢读不完，太快看不清。 */
export const MarqueeSpeedPxPerSec = 45;

/** 两份副本之间的视觉间隙（px）：滚动到末尾时留一点呼吸位。 */
export const MarqueeGapPx = 28;

/** 一个滚动周期最短时长（s）：文本很短时也别闪得太快。 */
const MinMarqueeDurationSec = 4;

/**
 * 服务端渲染（测试用 renderToStaticMarkup）时没有 layout 阶段，
 * 用 useEffect 代替 useLayoutEffect，避免 React 告警。
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/** 用户是否要求减少动效；老环境没有 matchMedia 时一律当作“不要求”。 */
function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 是否需要走马灯：文本宽度超出可视宽度才算。
 * 可视宽度为 0（尚未布局 / 隐藏容器）时一律判定为「不需要」，避免误开动画。
 */
export function isMarqueeNeeded(textWidth: number, availableWidth: number): boolean {
    if (availableWidth <= 0) {
        return false;
    }
    return textWidth > availableWidth + 1;
}

/**
 * 一个完整滚动周期的时长（s）：走过的距离 = 一份副本的宽度（含间隙）。
 */
export function marqueeDurationSec(shiftPx: number, speedPxPerSec: number = MarqueeSpeedPxPerSec): number {
    if (shiftPx <= 0 || speedPxPerSec <= 0) {
        return MinMarqueeDurationSec;
    }
    return Math.max(MinMarqueeDurationSec, shiftPx / speedPxPerSec);
}

export type InfoCardMarqueeProps = {
    /** 文本内容（单行）。 */
    text: string;
    /** 追加到根节点的 class。 */
    className?: string;
    /** 滚动速度（px/s）。 */
    speed?: number;
};

export function InfoCardMarquee({ text, className, speed = MarqueeSpeedPxPerSec }: InfoCardMarqueeProps) {
    const containerRef = React.useRef<HTMLSpanElement | null>(null);
    const copyRef = React.useRef<HTMLSpanElement | null>(null);
    const textRef = React.useRef<HTMLSpanElement | null>(null);
    const [scrolling, setScrolling] = React.useState(false);
    const [shift, setShift] = React.useState(0);

    useIsomorphicLayoutEffect(() => {
        const container = containerRef.current;
        const probe = textRef.current;
        if (container == null || probe == null) {
            return;
        }

        const measure = () => {
            // getBoundingClientRect 拿到的是排版宽度，不受父级 overflow 裁剪影响。
            const textWidth = probe.getBoundingClientRect().width;
            const availableWidth = container.clientWidth;
            const reducedMotion = prefersReducedMotion();
            const next = !reducedMotion && isMarqueeNeeded(textWidth, availableWidth);
            setScrolling((prev) => (prev === next ? prev : next));
            if (!next) {
                return;
            }
            // 走马灯位移 = 一份副本的宽度（含尾部间隙），两份才能严丝合缝接上。
            const copyWidth = copyRef.current?.getBoundingClientRect().width ?? textWidth;
            setShift((prev) => (Math.abs(prev - copyWidth) < 0.5 ? prev : copyWidth));
        };

        measure();
        // 老环境 / 测试环境可能没有 ResizeObserver：量一次就够，不注册监听。
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(probe);
        return () => observer.disconnect();
        // scrolling 变化 = 副本 flex 行为变化 = 宽度需要重新量一次。
    }, [scrolling, text]);

    return (
        <span
            ref={containerRef}
            className={cn("info-card-title", "info-card-marquee", className, { "is-scrolling": scrolling })}
            title={text}
            style={
                scrolling
                    ? ({
                          "--info-card-marquee-shift": `${shift}px`,
                          "--info-card-marquee-duration": `${marqueeDurationSec(shift, speed)}s`,
                      } as React.CSSProperties)
                    : undefined
            }
        >
            <span className="info-card-marquee-track">
                <span className="info-card-marquee-copy" ref={copyRef}>
                    <span className="info-card-marquee-text" ref={textRef}>
                        {text}
                    </span>
                </span>
                {/* 第二份：滚动时接在第一份后面，循环时正好补位。 */}
                <span className="info-card-marquee-copy" aria-hidden="true">
                    <span className="info-card-marquee-text">{text}</span>
                </span>
            </span>
        </span>
    );
}
