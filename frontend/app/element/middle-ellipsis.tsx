// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";

type MiddleEllipsisProps = {
    text: string;
    className?: string;
    ellipsis?: string;
    // "middle": head + … + tail（默认，两边都保留）。
    // "tail": 省略开头、保留末尾（长路径场景，如 "…/core/src/features"）。
    variant?: "middle" | "tail";
};

// 在 [lo, hi] 内二分查找满足 fits 的最大 n（fits 随 n 单调递减：n 越大文本越宽）。
// 找不到满足项时收敛到 lo。调用方需保证 fits(lo) 恒真（否则返回的 lo 未经验证）。
export function maxFitLength(lo: number, hi: number, fits: (n: number) => boolean): number {
    while (lo < hi) {
        const mid = Math.ceil((lo + hi + 1) / 2);
        if (fits(mid)) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

// Renders long text with an ellipsis when it can't fit its container:
// - variant "middle": "开头尽可能 + … + 结尾尽可能"（默认）
// - variant "tail":   "… + 结尾尽可能"（省略开头，保留末尾）
// When the whole text fits, no truncation.
// Decides how many characters fit by measuring the rendered text width.
export function MiddleEllipsis({ text, className, ellipsis = "…", variant = "middle" }: MiddleEllipsisProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [render, setRender] = useState<{ text: string | null; head: string; tail: string }>({
        text: text,
        head: "",
        tail: "",
    });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let installed = true;

        const measure = (content: string): number => {
            const probe = document.createElement("span");
            probe.style.visibility = "hidden";
            probe.style.position = "absolute";
            probe.style.whiteSpace = "nowrap";
            probe.style.font = window.getComputedStyle(container).font;
            probe.textContent = content;
            container.appendChild(probe);
            const width = probe.getBoundingClientRect().width;
            container.removeChild(probe);
            return width;
        };

        const recompute = () => {
            if (!installed) return;
            const available = container.clientWidth;
            if (available <= 0) return;
            const fullWidth = measure(text);
            if (fullWidth <= available) {
                setRender({ text: text, head: "", tail: "" });
                return;
            }
            const ellipsisWidth = measure(ellipsis);
            if (available <= ellipsisWidth) {
                setRender({ text: null, head: "", tail: "" });
                return;
            }
            const len = text.length;
            if (variant === "tail") {
                // 省略开头：找最大的 n 使 "…" + text 末尾 n 个字符放得下。
                // fitsTail(0) 即 ellipsisWidth <= available，已被上面守卫保证。
                const fitsTail = (n: number): boolean =>
                    ellipsisWidth + measure(text.slice(len - n)) <= available;
                const n = maxFitLength(0, len - 1, fitsTail);
                setRender({ text: null, head: "", tail: text.slice(len - n) });
                return;
            }
            // 中间省略：Binary-search the largest total visible length n such that
            //   width(text.slice(0, ceil(n/2))) + ellipsisW + width(text.slice(len - floor(n/2))) <= available
            let lo = 2;
            let hi = len - 1;
            const fits = (n: number): boolean => {
                const headLen = Math.ceil(n / 2);
                const tailLen = Math.floor(n / 2);
                const head = text.slice(0, headLen);
                const tail = text.slice(len - tailLen);
                return measure(head) + ellipsisWidth + measure(tail) <= available;
            };
            const n = Math.max(2, maxFitLength(lo, hi, fits));
            const headLen = Math.ceil(n / 2);
            const tailLen = Math.floor(n / 2);
            const head = text.slice(0, headLen);
            const tail = text.slice(len - tailLen);
            setRender({ text: null, head, tail });
        };

        const ro = new ResizeObserver(() => recompute());
        ro.observe(container);
        const fonts = document.fonts;
        if (fonts && fonts.ready) {
            fonts.ready.then(() => recompute());
        }
        recompute();
        return () => {
            installed = false;
            ro.disconnect();
        };
    }, [text, ellipsis, variant]);

    return (
        <div ref={containerRef} className={className} style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
            {render.text != null ? (
                <span>{render.text}</span>
            ) : variant === "tail" ? (
                <>
                    <span>{ellipsis}</span>
                    <span>{render.tail}</span>
                </>
            ) : (
                <>
                    <span>{render.head}</span>
                    <span>{ellipsis}</span>
                    <span>{render.tail}</span>
                </>
            )}
        </div>
    );
}
