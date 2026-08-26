// 聊天来源（agent）单一注册表。
//
// 新增 / 移除一个 agent = 只改这里 + 后端 chatProviderForSource 加 case：
//   - composer 的 agent 选择器从这里派生
//   - 会话列表的 source 筛选从这里派生
// 不再有“pi/codex/claude”字面量散落在两处。
import { ClaudeLogo, OpenAILogo, PiLogo } from "./controls";
import type { ReactNode } from "react";

// ponytail: available 暂由前端写死。后端若提供 /capabilities（返回可用源清单），
// 应在此用其结果覆盖 available，做到“实现后端即自动可用”，无需手动翻 true。
export const CHAT_SOURCES = [
    { id: "pi", label: "Pi", available: true, icon: <PiLogo />, dotClass: "bg-source-pi" },
    { id: "codex", label: "Codex", available: false, icon: <OpenAILogo />, dotClass: "bg-source-codex" },
    { id: "claude", label: "Claude Code", available: false, icon: <ClaudeLogo />, dotClass: "bg-source-claude" },
] as const;

export type ChatSourceId = (typeof CHAT_SOURCES)[number]["id"];

export interface ChatSourceDef {
    id: ChatSourceId;
    label: string;
    available: boolean; // 后端 chatProviderForSource 是否实现（今天只有 pi）
    icon?: ReactNode;
    dotClass?: string; // 会话列表中来源色点的 CSS 类
}

export const defaultChatSource = (): ChatSourceDef => CHAT_SOURCES[0];

export const getChatSource = (id: string): ChatSourceDef =>
    CHAT_SOURCES.find((s) => s.id === id) ?? defaultChatSource();

export const isSourceAvailable = (id: string): boolean =>
    !!CHAT_SOURCES.find((s) => s.id === id)?.available;
