const AgentStatusHookProviders = ["codex", "claude"];
const AgentStatusHookProviderSet = new Set(AgentStatusHookProviders);

type AgentStatusHookBlock = {
    isAgentLike: boolean;
    agentProvider: string;
};

function normalizeAgentProviderName(provider: string): string {
    return provider.trim().toLowerCase();
}

export function agentStatusHookProvidersForInstall(): string[] {
    return [...AgentStatusHookProviders];
}

export function agentStatusHookProvidersForBlocks(blocks: AgentStatusHookBlock[]): string[] {
    const present = new Set<string>();
    for (const block of blocks) {
        if (!block.isAgentLike) continue;
        const provider = normalizeAgentProviderName(block.agentProvider);
        if (AgentStatusHookProviderSet.has(provider)) {
            present.add(provider);
        }
    }
    return AgentStatusHookProviders.filter((provider) => present.has(provider));
}

export function agentStatusHookStatusesNeedingInstall(providers: string[], statuses: HookStatus[]): HookStatus[] {
    const statusByProvider = new Map(
        statuses.map((status) => [normalizeAgentProviderName(status.provider), status] as const)
    );
    return providers
        .map((provider) => statusByProvider.get(normalizeAgentProviderName(provider)))
        .filter((status) => status?.supported === true && status.needsInstall === true);
}
