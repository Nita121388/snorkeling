// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TitleSourceBadge — 标记 AI 生成的标题来源。
//
// 只有 titleSource === "ai" 才渲染：user 是用户自己写的、source_title 是
// provider 原生标题，都不应该被误标成 AI。小图标 + tooltip，不抢视觉。

import { cn } from "@/util/util";

export function TitleSourceBadge({ titleSource, className }: { titleSource?: string | null; className?: string }) {
    if (titleSource !== "ai") {
        return null;
    }
    return (
        <i
            className={cn("fa-sharp fa-solid fa-wand-magic-sparkles shrink-0 text-[9px] text-accent/70", className)}
            title="AI-generated title"
            aria-label="AI-generated title"
        />
    );
}
