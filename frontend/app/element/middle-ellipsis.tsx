// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";

type MiddleEllipsisProps = {
    text: string;
    className?: string;
    ellipsis?: string;
};

// Renders long text with a middle ellipsis when it can't fit its container:
// "开头尽可能 + … + 结尾尽可能". When the whole text fits, no truncation.
// Decides how many characters fit by measuring the rendered text width, then
// splits the budget evenly between head and tail.
export function MiddleEllipsis({ text, className, ellipsis = "…" }: MiddleEllipsisProps) {
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
            // Binary-search the largest total visible length n such that
            //   width(text.slice(0, ceil(n/2))) + ellipsisW + width(text.slice(len - floor(n/2))) <= available
            const len = text.length;
            let lo = 2;
            let hi = len - 1;
            const fits = (n: number): boolean => {
                const headLen = Math.ceil(n / 2);
                const tailLen = Math.floor(n / 2);
                const head = text.slice(0, headLen);
                const tail = text.slice(len - tailLen);
                return measure(head) + ellipsisWidth + measure(tail) <= available;
            };
            while (lo < hi) {
                const mid = Math.ceil((lo + hi + 1) / 2);
                if (fits(mid)) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            const n = Math.max(2, lo);
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
    }, [text, ellipsis]);

    return (
        <div ref={containerRef} className={className} style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
            {render.text != null ? (
                <span>{render.text}</span>
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
