// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentCardTitleSourceMark — agent card 副标题专用的标题来源小标记。
//
// 与共享的 TitleSourceBadge（AISessions 列表行 / 详情头 / EditableTitle /
// SessionNoteSection 都在用）刻意分离：那面按契约只标记 ai，扩展它会把
// first_user_message 标记泄漏到明确 out-of-scope 的界面，并且同一张卡上
// （副标题 + SessionNoteSection）会出现两次标记。本组件只挂在 agent card
// 副标题：ai → ✨，first_user_message → 消息小图标，其余来源不渲染。
// 完整来源说明只放 tooltip / aria-label（中英文 i18n），不占版面。

import { cn } from "@/util/util";
import { useTranslation } from "react-i18next";

export function AgentCardTitleSourceMark({ titleSource, className }: { titleSource?: string | null; className?: string }) {
    const { t } = useTranslation("term");
    if (titleSource === "ai") {
        return (
            <i
                data-title-source="ai"
                className={cn("agent-card-title-source-mark fa-sharp fa-solid fa-wand-magic-sparkles shrink-0 text-[9px] text-accent/70", className)}
                title={`${t("term:hoverCard.titleFromAI")} (${titleSource})`}
                aria-label={`${t("term:hoverCard.titleFromAI")} (${titleSource})`}
            />
        );
    }
    if (titleSource === "first_user_message") {
        return (
            <i
                data-title-source="first_user_message"
                className={cn("agent-card-title-source-mark fa-sharp fa-solid fa-comment-dots shrink-0 text-[9px] text-muted/80", className)}
                title={`${t("term:hoverCard.titleFromFirstMessage")} (${titleSource})`}
                aria-label={`${t("term:hoverCard.titleFromFirstMessage")} (${titleSource})`}
            />
        );
    }
    return null;
}
