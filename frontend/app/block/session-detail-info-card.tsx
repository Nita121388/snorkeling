// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionDetailInfoCard — 会话详情 / GUI Chat Block 的 InfoCard。
//
// 数据源与 AgentHoverCard 一致：session-note-cache（note/tags 的单一真相源），
// 因此全局 aisession 视图里的编辑会通过 aisession-note-updated 事件同步到这里。
// 与 Agent 卡片的差别：不展示模型/运行状态，改为 source / 消息数 / 路径等会话身份信息。

import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import {
    InfoCard,
    InfoCardHead,
    InfoCardIcon,
    InfoCardMarquee,
    InfoCardPreview,
    InfoCardSection,
    InfoCardText,
    InfoCardTitle,
} from "@/app/element/info-card";
import { SessionNoteSection } from "@/app/element/info-card/session-note-section";
import { useSessionNoteState } from "@/app/store/session-note-hook";
import { i18n } from "@/i18n/config";
import { useTranslation } from "react-i18next";

function trimmedMetaString(meta: Record<string, unknown> | undefined, key: string): string {
    const value = meta?.[key];
    return typeof value === "string" ? value.trim() : "";
}

export function SessionDetailInfoCard({ blockData, onOpen }: { blockData: Block | null; onOpen?: () => void }) {
    const { t } = useTranslation("block");
    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    const sessionId = resolveBlockSessionId(meta);
    const connection = trimmedMetaString(meta, "connection");
    const state = useSessionNoteState(sessionId, connection);
    const summary = state.summary;

    const fallbackTitle =
        trimmedMetaString(meta, "frame:title") ||
        (meta["aisessions:newchat"] === true ? t("block:infoCard.newSession") : t("block:infoCard.sessionDetails"));
    const title = summary?.title || summary?.id || fallbackTitle;
    const source = summary?.source ?? "";
    const messageCount = typeof summary?.messageCount === "number" ? summary.messageCount : null;
    const projectPath = summary?.projectPath || summary?.filePath || "";

    const metaParts = [
        source,
        messageCount != null ? i18n.t("block:infoCard.messageCount", { count: messageCount }) : "",
        connection !== "" ? connection : "",
    ].filter((part) => part !== "");

    return (
        <InfoCard className="session-detail-card">
            <InfoCardSection>
                <InfoCardHead>
                    <InfoCardIcon icon="fa-sharp fa-solid fa-comments" />
                    <InfoCardMarquee text={title} />
                </InfoCardHead>
                {metaParts.length > 0 ? <div className="session-detail-card-meta">{metaParts.join(" · ")}</div> : null}
                {sessionId === "" ? (
                    <InfoCardText>
                        {meta["aisessions:newchat"] === true
                            ? t("block:infoCard.newChatHint")
                            : t("block:infoCard.noSession")}
                    </InfoCardText>
                ) : null}
            </InfoCardSection>

            {/* note + tags：summary 未就绪时该段自动隐藏；详情卡允许内联编辑全部属性 */}
            <SessionNoteSection state={state} canEditProperties />

            {projectPath !== "" ? (
                <InfoCardSection>
                    <InfoCardHead>
                        <InfoCardIcon icon="fa-solid fa-folder" />
                        <InfoCardTitle>{t("block:infoCard.path")}</InfoCardTitle>
                    </InfoCardHead>
                    {onOpen ? (
                        <InfoCardPreview
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpen();
                            }}
                            title={t("block:infoCard.open")}
                        >
                            <InfoCardText>{projectPath}</InfoCardText>
                        </InfoCardPreview>
                    ) : (
                        <InfoCardText>{projectPath}</InfoCardText>
                    )}
                </InfoCardSection>
            ) : null}
        </InfoCard>
    );
}
