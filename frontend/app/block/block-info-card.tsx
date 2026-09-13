// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// BlockInfoCard — Block → InfoCard 的适配层（唯一分派点）。
//
// 设计原则：
//  - 新增某类 Block 的悬浮卡：在这里加一个 if 分支即可，不动任何壳子代码。
//  - 不再展示某一类卡片：删掉分支即可，不影响其它 surface。
//  - 返回 ReactNode：调用方只需判断 null / 非 null 来决定是否渲染 portal。
//
// 目前支持：
//  - Note Block        → NoteInfoCard（极简：图标 + 文件路径）
//  - Preview Block     → PreviewInfoCard（目录 → 文件夹图标；文件 → 文件图标，均带路径）
//  - Agent Block       → AgentHoverCard（完整：provider / model / status / note）
//  - 其它 Block        → null（由调用方 fallback 到原生 title tooltip）

import {
    InfoCard,
    InfoCardHead,
    InfoCardIcon,
    InfoCardPreview,
    InfoCardSection,
    InfoCardText,
    InfoCardTitle,
} from "@/app/element/info-card";
import { isAgentTerminalMeta } from "@/app/view/term/agent-meta";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import { PreviewPathIsDirMetaKey } from "@/app/view/preview/preview-navigation";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";
import type * as React from "react";

export type BlockInfoCardMode = "gui" | "tui";

// ── NoteInfoCard ──

/**
 * Note 类型 Block 的信息卡。
 *
 * 极简风格：Note 图标 + 文件路径（或 block OID 兜底）。
 * `onOpen` 可选：有则渲染成可点击按钮（激活 tab / 恢复布局等）；无则只展示文本。
 */
export function NoteInfoCard({ blockData, onOpen }: { blockData: Block | null; onOpen?: () => void }) {
    const meta = blockData?.meta as Record<string, unknown> | undefined;
    const path = (meta?.file as string) || blockData?.oid || "";

    return (
        <InfoCard>
            <InfoCardSection>
                <InfoCardHead>
                    <InfoCardIcon icon="fa-solid fa-note-sticky" />
                    <InfoCardTitle>Note</InfoCardTitle>
                </InfoCardHead>
                {onOpen ? (
                    <InfoCardPreview onClick={onOpen} title="Open">
                        <InfoCardText>{path}</InfoCardText>
                    </InfoCardPreview>
                ) : (
                    <InfoCardText>{path}</InfoCardText>
                )}
            </InfoCardSection>
        </InfoCard>
    );
}

// ── PreviewInfoCard ──

/**
 * Preview 类型 Block 的信息卡（Files 目录预览 + 文件预览如 Markdown）。
 *
 * 目录（preview:pathisdir=true）→ 文件夹图标；文件 → 文件图标。
 * 正文展示完整路径（或 block OID 兜底）；onOpen 可选（激活 tab / 恢复布局）。
 */
export function PreviewInfoCard({ blockData, onOpen }: { blockData: Block | null; onOpen?: () => void }) {
    const meta = blockData?.meta as Record<string, unknown> | undefined;
    const isDir = meta?.[PreviewPathIsDirMetaKey] === true;
    const path = (meta?.file as string) || (meta?.url as string) || blockData?.oid || "";

    return (
        <InfoCard>
            <InfoCardSection>
                <InfoCardHead>
                    <InfoCardIcon icon={isDir ? "fa-solid fa-folder" : "fa-solid fa-file-lines"} />
                    <InfoCardTitle>{isDir ? "Folder" : "File"}</InfoCardTitle>
                </InfoCardHead>
                {onOpen ? (
                    <InfoCardPreview onClick={onOpen} title="Open">
                        <InfoCardText>{path}</InfoCardText>
                    </InfoCardPreview>
                ) : (
                    <InfoCardText>{path}</InfoCardText>
                )}
            </InfoCardSection>
        </InfoCard>
    );
}

// ── BlockInfoCard ──

/**
 * Block → 信息卡 分派器。
 *
 * 检测顺序：Note → Preview → Agent → null。
 * Note 与 Agent 互斥（note 有 SnorkelingBlockKindMetaKey，agent 有 agent:autoresume / agent:provider），
 * 万一同时命中 Note 优先（与旧 InlineTabLabel 一致）。
 *
 * @param onOpen  卡片点击回调（Inline Tab 传 onActivate，Sidebar 传 restore 等）。
 */
export function BlockInfoCard({
    blockId,
    blockData,
    mode = "gui",
    onOpen,
}: {
    blockId: string;
    blockData: Block | null;
    mode?: BlockInfoCardMode;
    onOpen?: () => void;
}): React.ReactNode {
    const meta = blockData?.meta as Record<string, unknown> | undefined;

    if (meta?.[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote) {
        return <NoteInfoCard blockData={blockData} onOpen={onOpen} />;
    }
    if (meta?.view === "preview") {
        return <PreviewInfoCard blockData={blockData} onOpen={onOpen} />;
    }
    if (isAgentTerminalMeta(blockData?.meta)) {
        return <AgentHoverCard blockId={blockId} blockData={blockData} mode={mode} />;
    }
    return null;
}
