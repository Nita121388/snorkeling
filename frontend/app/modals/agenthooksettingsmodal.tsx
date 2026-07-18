// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { BlockServiceType } from "@/app/store/services";
import { ClaudeLogo, OpenAILogo } from "@/app/view/aisessions/controls";
import { useCallback, useEffect, useMemo, useState } from "react";

const AgentHookProviderOrder = ["codex", "claude"];

function normalizeProvider(provider: string): string {
    return provider.trim().toLowerCase();
}

function providerLabel(provider: string): string {
    switch (normalizeProvider(provider)) {
        case "codex":
            return "Codex";
        case "claude":
            return "Claude";
        default:
            return provider;
    }
}

function formatHookVersion(version: number | undefined): string {
    return version > 0 ? `v${version}` : "-";
}

export function agentHookStatusLabel(status: HookStatus): string {
    if (!status.supported) return "CLI not detected";
    if (status.current) return "Current";
    if (!status.installed) return "Not installed";
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0)) return "Update available";
    return "Repair required";
}

export function agentHookActionLabel(status: HookStatus): string | null {
    if (!status.supported || !status.needsInstall) return null;
    if (!status.installed) return "Install";
    if ((status.installedVersion ?? 0) < (status.requiredVersion ?? 0)) return "Update";
    return "Repair";
}

function AgentProviderIcon({ provider }: { provider: string }) {
    switch (normalizeProvider(provider)) {
        case "codex":
            return <OpenAILogo />;
        case "claude":
            return <ClaudeLogo />;
        default:
            return null;
    }
}

function AgentHookSettingsModal() {
    const service = useMemo(() => new BlockServiceType(), []);
    const [statuses, setStatuses] = useState<HookStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingProvider, setUpdatingProvider] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await service.CheckAgentStatusHooks("all");
            const statusByProvider = new Map(
                (result.statuses ?? []).map((status) => [normalizeProvider(status.provider), status] as const)
            );
            setStatuses(
                AgentHookProviderOrder.map((provider) => statusByProvider.get(provider)).filter(
                    (status): status is HookStatus => status != null
                )
            );
        } catch (nextError) {
            setStatuses([]);
            setError(nextError instanceof Error ? nextError.message : String(nextError));
        } finally {
            setLoading(false);
        }
    }, [service]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const updateHook = useCallback(
        async (status: HookStatus) => {
            const provider = normalizeProvider(status.provider);
            if (!provider || agentHookActionLabel(status) == null) return;
            setUpdatingProvider(provider);
            setError("");
            setNotice("");
            try {
                await service.InstallAgentStatusHooks(provider);
                await refresh();
                setNotice(`${providerLabel(provider)} hook is current.`);
            } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
            } finally {
                setUpdatingProvider("");
            }
        },
        [refresh, service]
    );

    const closeModal = useCallback(() => modalsModel.popModal(), []);

    return (
        <Modal className="w-[600px] max-w-[calc(100vw-32px)]" onClose={closeModal} onClickBackdrop={closeModal}>
            <div className="pr-7 text-primary">
                <div className="text-base font-semibold">Agent Hooks</div>

                <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[520px]">
                        <div className="grid grid-cols-[minmax(130px,1fr)_80px_80px_130px_76px] gap-3 border-b border-border px-2 pb-2 text-xxs font-medium text-muted">
                            <span>Agent</span>
                            <span>Installed</span>
                            <span>Required</span>
                            <span>Status</span>
                            <span />
                        </div>

                        {loading && statuses.length === 0 ? (
                            <div className="px-2 py-8 text-center text-xs text-muted">Loading...</div>
                        ) : statuses.length === 0 ? (
                            <div className="px-2 py-8 text-center text-xs text-muted">
                                No hook integrations available.
                            </div>
                        ) : (
                            statuses.map((status) => {
                                const provider = normalizeProvider(status.provider);
                                const actionLabel = agentHookActionLabel(status);
                                const updating = updatingProvider === provider;
                                return (
                                    <div
                                        key={provider}
                                        className="grid min-h-14 grid-cols-[minmax(130px,1fr)_80px_80px_130px_76px] items-center gap-3 border-b border-border/60 px-2 py-2 text-xs last:border-b-0"
                                    >
                                        <div className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                                                <AgentProviderIcon provider={provider} />
                                            </span>
                                            <span className="truncate">{providerLabel(provider)}</span>
                                        </div>
                                        <span className="text-secondary">
                                            {formatHookVersion(status.installedVersion)}
                                        </span>
                                        <span className="text-secondary">
                                            {formatHookVersion(status.requiredVersion)}
                                        </span>
                                        <div className="min-w-0">
                                            <div className={status.current ? "text-success" : "text-secondary"}>
                                                {agentHookStatusLabel(status)}
                                            </div>
                                            {!status.current && status.reason ? (
                                                <div
                                                    className="mt-0.5 truncate text-xxs text-muted"
                                                    title={status.reason}
                                                >
                                                    {status.reason}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex justify-end">
                                            {actionLabel ? (
                                                <button
                                                    type="button"
                                                    className="h-7 min-w-16 rounded-sm bg-accent/80 px-2 text-xs font-medium text-primary hover:bg-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                                                    disabled={updatingProvider !== ""}
                                                    onClick={() => void updateHook(status)}
                                                >
                                                    {updating ? `${actionLabel}...` : actionLabel}
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {error ? (
                    <div className="mt-3 flex items-center justify-between gap-3 border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                        <span className="min-w-0 break-words">{error}</span>
                        <button
                            type="button"
                            className="shrink-0 text-xs font-medium text-error hover:text-foreground cursor-pointer"
                            onClick={() => void refresh()}
                        >
                            Retry
                        </button>
                    </div>
                ) : null}
                {notice ? <div className="mt-3 text-xs text-success">{notice}</div> : null}
            </div>
        </Modal>
    );
}

AgentHookSettingsModal.displayName = "AgentHookSettingsModal";

export { AgentHookSettingsModal };
