import { getWebServerEndpoint } from "@/util/endpoints";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ClaudeLogo, OpenAILogo, PiLogo } from "./controls";

export const CHAT_SOURCES = [
    { id: "pi", label: "Pi", icon: <PiLogo />, dotClass: "bg-source-pi" },
    { id: "codex", label: "Codex", icon: <OpenAILogo />, dotClass: "bg-source-codex" },
    { id: "claude", label: "Claude Code", icon: <ClaudeLogo />, dotClass: "bg-source-claude" },
] satisfies readonly ChatSourceDef[];

export interface ChatSourceDef {
    id: string;
    label: string;
    icon?: ReactNode;
    dotClass?: string; // 会话列表中来源色点的 CSS 类
}

export const defaultChatSource = (): ChatSourceDef => CHAT_SOURCES[0];

export const getChatSource = (id: string): ChatSourceDef =>
    CHAT_SOURCES.find((s) => s.id === id) ?? (id ? { id, label: id } : defaultChatSource());

export type AvailableChatSourceDef = ChatSourceDef & { available: boolean };

export function chatSourcesForAvailability(availableSources: ReadonlySet<string>): AvailableChatSourceDef[] {
    const knownSources = new Set(CHAT_SOURCES.map((source) => source.id));
    return [
        ...CHAT_SOURCES,
        ...[...availableSources]
            .filter((source) => !knownSources.has(source))
            .sort()
            .map((source) => ({ id: source, label: source })),
    ].map((source) => ({ ...source, available: availableSources.has(source.id) }));
}

export async function fetchChatSourceIds(
    endpoint = `${getWebServerEndpoint()}/api/aisessions-chat`
): Promise<string[]> {
    const response = await fetch(endpoint);
    if (!response.ok) {
        throw new Error(`chat source list ${response.status}: ${response.statusText}`);
    }
    const body = (await response.json()) as { sources?: Array<{ source?: unknown }> };
    return (body.sources ?? []).flatMap((item) => (typeof item.source === "string" ? [item.source] : []));
}

export function useChatSourceAvailability(): ReadonlySet<string> {
    const [availableSources, setAvailableSources] = useState<ReadonlySet<string>>(
        () => new Set([defaultChatSource().id])
    );

    useEffect(() => {
        let cancelled = false;
        void fetchChatSourceIds()
            .then((sources) => {
                if (!cancelled) setAvailableSources(new Set(sources));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    return availableSources;
}

export const isSourceAvailable = (id: string, availableSources: ReadonlySet<string>): boolean =>
    availableSources.has(id);
