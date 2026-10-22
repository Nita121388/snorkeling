// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionDetailInfoCard — 会话详情 / GUI Chat Block 的 InfoCard。
//
// 数据源与 AgentHoverCard 一致：session-note-cache（note/tags 的单一真相源），
// 因此全局 aisession 视图里的编辑会通过 aisession-note-updated 事件同步到这里。
// 与 Agent 卡片的差别：不展示模型/运行状态，改为 source / 消息数 / 路径等会话身份信息。

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
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";

function trimmedMetaString(meta: Record<string, unknown> | undefined, key: string): string {
    const value = meta?.[key];
    return typeof value === "string" ? value.trim() : "";
}

export function SessionDetailInfoCard({
    blockData,
    onOpen,
}: {
    blockData: Block | null;
    onOpen?: () => void;
}) {
    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    const sessionId = resolveBlockSessionId(meta);
    const connection = trimmedMetaString(meta, "connection");
    const state = useSessionNoteState(sessionId, connection);
    const summary = state.summary;

    const fallbackTitle = trimmedMetaString(meta, "frame:title") || (meta["aisessions:newchat"] === true ? "New Session" : "Session Details");
    const title = summary?.title || summary?.id || fallbackTitle;
    const source = summary?.source ?? "";
    const messageCount = typeof summary?.messageCount === "number" ? summary.messageCount : null;
    const projectPath = summary?.projectPath || summary?.filePath || "";

    const metaParts = [
        source,
        messageCount != null ? `${messageCount} msgs` : "",
        connection !== "" ? connection : "",
    ].filter((part) => part !== "");

    return (
        <InfoCard className="session-detail-card">
            <InfoCardSection>
                <InfoCardHead>
                    <InfoCardIcon icon="fa-sharp fa-solid fa-comments" />
                    <InfoCardMarquee text={title} />
                </InfoCardHead>
                {metaParts.length > 0 ? (
                    <div className="session-detail-card-meta">{metaParts.join(" · ")}</div>
                ) : null}
                {sessionId === "" ? (
                    <InfoCardText>
                        {meta["aisessions:newchat"] === true
                            ? "New chat — session id appears after the first message."
                            : "No session bound yet."}
                    </InfoCardText>
                ) : null}
            </InfoCardSection>

            {/* note + tags：summary 未就绪时该段自动隐藏 */}
            <SessionNoteSection state={state} />

            {projectPath !== "" ? (
                <InfoCardSection>
                    <InfoCardHead>
                        <InfoCardIcon icon="fa-solid fa-folder" />
                        <InfoCardTitle>Path</InfoCardTitle>
                    </InfoCardHead>
                    {onOpen ? (
                        <InfoCardPreview
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpen();
                            }}
                            title="Open"
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
