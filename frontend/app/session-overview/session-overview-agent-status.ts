const AgentStatusHookProviders = ["codex", "claude"];
const AgentStatusHookProviderSet = new Set(AgentStatusHookProviders);

type AgentStatusHookBlock = {
    isAgentLike: boolean;
    agentProvider: string;
};

function normalizeAgentProviderName(provider: string): string {
    return provider.trim().toLowerCase();
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
