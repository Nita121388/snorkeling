import { AISessionsService } from "@/app/store/services";
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { getWebServerEndpoint } from "@/util/endpoints";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export const CHAT_SOURCES = [
    { id: "pi", label: "Pi", dotClass: "bg-source-pi" },
    { id: "codex", label: "Codex", dotClass: "bg-source-codex" },
    { id: "claude", label: "Claude Code", dotClass: "bg-source-claude" },
    { id: "opencode", label: "OpenCode", dotClass: "bg-source-opencode" },
] satisfies readonly ChatSourceDef[];

export interface ChatSourceDef {
    id: string;
    label: string;
    icon?: ReactNode;
    dotClass?: string; // 会话列表中来源色点的 CSS 类
}

export const defaultChatSource = (): ChatSourceDef => CHAT_SOURCES[0];

/** One row of the GetSourceList RPC (aisessionsservice.GetSourceList). */
export type RpcChatSourceEntry = AISessionsSourceEntry;

/**
 * RPC 提供的来源 label 缓存（模块级）：纯函数 getChatSource() 的查表源。
 *
 * 只存「真实配置 label」：后端 ProviderLabel 对编译期 provider 回退裸 id（"pi"），
 * 这类条目不进缓存，CHAT_SOURCES 的硬编码 label（"Pi"）保持优先。声明式 provider
 * 的配置 label（如 "Antigravity"）则覆盖同 id 的内置条目。
 * 由 useMergedChatSources() 拉取后写入；测试用 resetRpcSourceCacheForTest() 复位。
 */
let rpcSourceLabels: Readonly<Record<string, string>> = {};

/** GetSourceList 的进程内单次拉取（多挂载点共享一次请求，避免双请求抖动）。 */
let rpcSourceEntriesPromise: Promise<readonly RpcChatSourceEntry[]> | null = null;

/** 把 GetSourceList 结果写入模块级 label 缓存（导出供单测直接驱动）。 */
export function applyRpcSourceEntries(entries: readonly RpcChatSourceEntry[] | null | undefined): void {
    const labels: Record<string, string> = {};
    for (const entry of entries ?? []) {
        const source = typeof entry?.source === "string" ? entry.source.trim() : "";
        const label = typeof entry?.label === "string" ? entry.label.trim() : "";
        if (source === "" || label === "" || label === source) continue;
        labels[source] = label;
    }
    rpcSourceLabels = labels;
}

/** 复位模块级 RPC 缓存（单测用；生产代码不要调）。 */
export function resetRpcSourceCacheForTest(): void {
    rpcSourceLabels = {};
    rpcSourceEntriesPromise = null;
}

function fetchRpcSourceEntries(): Promise<readonly RpcChatSourceEntry[]> {
    if (rpcSourceEntriesPromise == null) {
        rpcSourceEntriesPromise = AISessionsService.GetSourceList()
            .then((resp) => {
                const entries = Array.isArray(resp?.sources) ? resp.sources : [];
                applyRpcSourceEntries(entries);
                return entries as readonly RpcChatSourceEntry[];
            })
            .catch(() => [] as RpcChatSourceEntry[]);
    }
    return rpcSourceEntriesPromise;
}

export const getChatSource = (id: string): ChatSourceDef => {
    if (!id) return defaultChatSource();
    const builtin = CHAT_SOURCES.find((s) => s.id === id);
    const rpcLabel = rpcSourceLabels[id];
    // RPC 的真实配置 label 优先；编译期 provider 的裸 id 回退保持 CHAT_SOURCES 的 label。
    if (rpcLabel) return builtin ? { ...builtin, label: rpcLabel } : { id, label: rpcLabel };
    return builtin ?? { id, label: id };
};

/**
 * 合并来源面：CHAT_SOURCES ∪ GetSourceList 结果。
 * 同 id 以 RPC 的真实配置 label 为准（后端回退的裸 id 不覆盖内置 label）；
 * 未知来源保留（label 回退 id），由 dotClass 的中性回退负责样式。
 */
export function mergeChatSources(entries: readonly RpcChatSourceEntry[] | null | undefined): ChatSourceDef[] {
    const byId = new Map<string, ChatSourceDef>();
    for (const source of CHAT_SOURCES) {
        byId.set(source.id, source);
    }
    for (const entry of entries ?? []) {
        const source = typeof entry?.source === "string" ? entry.source.trim() : "";
        if (source === "") continue;
        const rawLabel = typeof entry?.label === "string" ? entry.label.trim() : "";
        const builtin = byId.get(source);
        if (builtin) {
            if (rawLabel !== "" && rawLabel !== source) {
                byId.set(source, { ...builtin, label: rawLabel });
            }
            continue;
        }
        byId.set(source, { id: source, label: rawLabel !== "" && rawLabel !== source ? rawLabel : source });
    }
    return [...byId.values()];
}

/**
 * 来源筛选选项的数据源：GetSourceList RPC 合并 CHAT_SOURCES 后的完整清单
 * （含当前页 0 结果的声明式来源），同 renderer 只发一次请求。
 */
export function useMergedChatSources(): ChatSourceDef[] {
    const [entries, setEntries] = useState<readonly RpcChatSourceEntry[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetchRpcSourceEntries()
            .then((list) => {
                if (!cancelled) setEntries(list);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);
    return useMemo(() => mergeChatSources(entries), [entries]);
}

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

/**
 * Hero-aware icons for the source chips. Lives in a hook (not the module-level
 * CHAT_SOURCES constant) so switching a provider emoji re-renders the chips.
 * Accepts the merged source list (useMergedChatSources) so declarative
 * sources get the getAgentIcon fallback chain instead of staying iconless.
 */
export function useChatSourceIcons(sources: readonly ChatSourceDef[] = CHAT_SOURCES): Record<string, ReactNode> {
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    return useMemo(() => {
        const icons: Record<string, ReactNode> = {};
        for (const source of sources) {
            const spec = getAgentIcon(source.id, { personas, sessionEmojis });
            if (spec == null) {
                continue;
            }
            icons[source.id] =
                spec.kind === "emoji" ? <span className="agent-emoji-icon">{spec.emoji}</span> : spec.icon;
        }
        return icons;
    }, [sources, personas, sessionEmojis]);
}
