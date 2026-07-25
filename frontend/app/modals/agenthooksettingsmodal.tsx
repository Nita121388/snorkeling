// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { BlockServiceType } from "@/app/store/services";
import { ClaudeLogo, OpenAILogo } from "@/app/view/aisessions/controls";
import type { CcSwitchAppType, CcSwitchVendor } from "@/app/workspace/ccswitch-vendors";
import { loadCcSwitchVendors } from "@/app/workspace/ccswitch-vendors";
import { copyText } from "@/util/clipboard";
import { offset as offsetMiddleware, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { agentHookActionLabel, agentHookStatusLabel, vendorIsolationStateLabel } from "./agentsettings-utils";

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

type AgentHookSettingsModalProps = {
    initialAppType?: CcSwitchAppType;
    initialVendorId?: string;
};

function formatDiagnosticTime(timestamp: number): string {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleString();
}

// Native <select><option> popups render through the OS/Chromium popup path: on Windows the
// option-list background follows the system UA chrome, not the document theme tokens, so a
// dark-theme document still shows a white option panel. Render the option list ourselves via a
// floating portal so it inherits the modal (opaque) theme tokens instead.
function VendorSelect({
    vendors,
    value,
    loading,
    onChange,
}: {
    vendors: CcSwitchVendor[];
    value: string;
    loading: boolean;
    onChange: (vendorId: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const { refs, floatingStyles, context } = useFloating({
        placement: "bottom-start",
        strategy: "absolute",
        open: isOpen,
        onOpenChange: setIsOpen,
        middleware: [offsetMiddleware(2)],
    });
    const click = useClick(context);
    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

    const selected = vendors.find((vendor) => vendor.id === value);
    const triggerLabel = selected ? `${selected.name} ${selected.is_current ? "(current)" : ""}` : "No vendors";
    const disabled = loading || vendors.length === 0;

    return (
        <div className="relative">
            <button
                type="button"
                ref={refs.setReference}
                disabled={disabled}
                className="flex h-8 w-full items-center justify-between gap-2 rounded border border-border bg-surface px-2 text-xs text-primary focus:border-accent focus:outline-none disabled:opacity-50 cursor-pointer disabled:cursor-default"
                {...getReferenceProps()}
            >
                <span className="truncate">{triggerLabel}</span>
                <i className="fa-sharp fa-solid fa-chevron-down shrink-0 text-muted" />
            </button>
            {isOpen && (
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="absolute z-[var(--zindex-typeahead-modal)] max-h-64 w-[min(280px,calc(100vw-32px))] overflow-y-auto rounded border border-border bg-modalbg shadow-lg"
                >
                    {vendors.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted">No vendors</div>
                    ) : (
                        vendors.map((vendor) => (
                            <button
                                type="button"
                                key={vendor.id}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs cursor-pointer ${
                                    vendor.id === value ? "bg-accentbg text-primary" : "text-primary hover:bg-hoverbg"
                                }`}
                                onClick={() => {
                                    onChange(vendor.id);
                                    setIsOpen(false);
                                }}
                            >
                                <span className="truncate">{vendor.name}</span>
                                {vendor.is_current ? <span className="shrink-0 text-success">(current)</span> : null}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

function AgentHookSettingsModal({ initialAppType = "claude", initialVendorId = "" }: AgentHookSettingsModalProps) {
    const service = useMemo(() => new BlockServiceType(), []);
    const [activeTab, setActiveTab] = useState<"hooks" | "details">("hooks");
    const [statuses, setStatuses] = useState<HookStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingProvider, setUpdatingProvider] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [appType, setAppType] = useState<CcSwitchAppType>(initialAppType === "codex" ? "codex" : "claude");
    const [vendors, setVendors] = useState<CcSwitchVendor[]>([]);
    const [selectedVendorId, setSelectedVendorId] = useState(initialVendorId);
    const [vendorsLoading, setVendorsLoading] = useState(false);
    const [vendorDetected, setVendorDetected] = useState(false);
    const [details, setDetails] = useState<VendorIsolationStatus | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState("");

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
                if (provider === "claude" || provider === "codex") {
                    await loadCcSwitchVendors(provider, true);
                }
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

    const refreshVendors = useCallback(
        async (force: boolean) => {
            setVendorsLoading(true);
            setDetailsError("");
            try {
                const result = await loadCcSwitchVendors(appType, force);
                setVendors(result.vendors);
                setVendorDetected(result.detected);
                setSelectedVendorId((currentVendorId) => {
                    const preferred =
                        result.vendors.find((vendor) => vendor.id === currentVendorId) ??
                        result.vendors.find((vendor) => vendor.id === initialVendorId) ??
                        result.vendors.find((vendor) => vendor.is_current) ??
                        result.vendors[0];
                    return preferred?.id ?? "";
                });
            } finally {
                setVendorsLoading(false);
            }
        },
        [appType, initialVendorId]
    );

    useEffect(() => {
        if (activeTab !== "details") return;
        void refreshVendors(false);
    }, [activeTab, refreshVendors]);

    const refreshDetails = useCallback(async () => {
        if (!selectedVendorId) {
            setDetails(null);
            return;
        }
        if (vendors.some((vendor) => vendor.id === selectedVendorId && vendor.is_current)) {
            setDetails(null);
            setDetailsError("");
            return;
        }
        setDetailsLoading(true);
        setDetailsError("");
        try {
            setDetails(await service.GetVendorIsolationStatus(appType, selectedVendorId));
        } catch (nextError) {
            setDetails(null);
            setDetailsError(nextError instanceof Error ? nextError.message : String(nextError));
        } finally {
            setDetailsLoading(false);
        }
    }, [appType, selectedVendorId, service, vendors]);

    useEffect(() => {
        if (activeTab !== "details") return;
        void refreshDetails();
    }, [activeTab, refreshDetails]);

    const selectAppType = useCallback((nextAppType: CcSwitchAppType) => {
        setAppType(nextAppType);
        setSelectedVendorId("");
        setDetails(null);
    }, []);

    return (
        <Modal
            className="h-[min(760px,calc(100vh-48px))] w-[680px] max-w-[calc(100vw-32px)]"
            onClose={closeModal}
            onClickBackdrop={closeModal}
        >
            <div className="flex min-h-0 flex-1 flex-col text-primary">
                <div className="shrink-0 pr-8 pt-1">
                    <div className="text-sm font-semibold">Agent Settings</div>
                    <div className="mt-4 flex border-b border-border" role="tablist" aria-label="Agent settings">
                        {(["hooks", "details"] as const).map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab}
                                className={`h-8 border-b-2 px-3 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                                    activeTab === tab
                                        ? "border-accent text-primary"
                                        : "border-transparent text-secondary hover:text-primary"
                                }`}
                                onClick={() => setActiveTab(tab)}
                            >
                                {tab === "hooks" ? "Agent Hooks" : "Details"}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto py-4">
                    {activeTab === "hooks" ? (
                        <div className="overflow-x-auto">
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
                                                            className="h-7 min-w-16 rounded-sm bg-action px-2 text-xs font-medium text-actiontext hover:bg-actionhover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_minmax(0,1fr)_32px]">
                                <div>
                                    <div className="mb-1 text-xxs font-medium text-muted">App</div>
                                    <div className="flex h-8 rounded border border-border p-0.5">
                                        {(["claude", "codex"] as const).map((value) => (
                                            <button
                                                key={value}
                                                type="button"
                                                className={`flex-1 rounded-sm text-xs font-medium capitalize cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                                                    appType === value
                                                        ? "bg-actionsoft text-actionsofttext"
                                                        : "text-secondary hover:bg-hover"
                                                }`}
                                                onClick={() => selectAppType(value)}
                                            >
                                                {value}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <label
                                        className="mb-1 flex text-xxs font-medium text-muted"
                                    >
                                        Vendor
                                    </label>
                                    <VendorSelect
                                        vendors={vendors}
                                        value={selectedVendorId}
                                        loading={vendorsLoading}
                                        onChange={setSelectedVendorId}
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="mt-5 flex h-8 w-8 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                    title="Refresh vendor diagnostics"
                                    aria-label="Refresh vendor diagnostics"
                                    onClick={() => void refreshVendors(true)}
                                >
                                    <i className={`fa-sharp fa-solid fa-rotate ${vendorsLoading ? "fa-spin" : ""}`} />
                                </button>
                            </div>

                            {vendors.some((vendor) => vendor.id === selectedVendorId && vendor.is_current) ? (
                                <div className="space-y-3 border-y border-border py-3 text-xs">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="font-medium text-primary">
                                            {vendors.find((vendor) => vendor.id === selectedVendorId)?.name}
                                        </span>
                                        <span className="text-success">Current · system config</span>
                                    </div>
                                    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-secondary">
                                        <dt>Config source</dt>
                                        <dd className="font-mono text-primary">
                                            {appType === "claude" ? "~/.claude" : "~/.codex"}
                                        </dd>
                                        <dt>Capabilities</dt>
                                        <dd className="text-primary">
                                            System settings, skills, plugins, and project preferences
                                        </dd>
                                        <dt>Vendor binding</dt>
                                        <dd className="text-primary">None</dd>
                                    </dl>
                                </div>
                            ) : !vendorDetected && !vendorsLoading ? (
                                <div className="border border-border px-3 py-3 text-xs text-secondary">
                                    cc-switch vendor data is unavailable.
                                </div>
                            ) : detailsLoading ? (
                                <div className="py-10 text-center text-xs text-muted">Loading diagnostics...</div>
                            ) : detailsError ? (
                                <div className="flex items-center justify-between gap-3 border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                                    <span className="min-w-0 break-words">{detailsError}</span>
                                    <button
                                        type="button"
                                        className="shrink-0 cursor-pointer font-medium hover:text-primary"
                                        onClick={() => void refreshDetails()}
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : details ? (
                                <>
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-xs font-medium">
                                                <span
                                                    className={`h-2 w-2 rounded-full ${details.state === "ready" ? "bg-success" : details.state === "missing" ? "bg-error" : "bg-warning"}`}
                                                />
                                                {details.vendorname}
                                                <span className="text-secondary">
                                                    {vendorIsolationStateLabel(details.state)}
                                                </span>
                                            </div>
                                            <div
                                                className="mt-1 truncate font-mono text-xxs text-muted"
                                                title={details.vendorid}
                                            >
                                                {details.vendorid}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                disabled={!details.configdir}
                                                className="flex h-7 w-7 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary cursor-pointer disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                                title="Open isolation directory"
                                                aria-label="Open isolation directory"
                                                onClick={() => window.api.openNativePath(details.configdir)}
                                            >
                                                <i className="fa-sharp fa-solid fa-folder-open" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!details.redactedjson}
                                                className="flex h-7 w-7 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary cursor-pointer disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                                title="Copy redacted JSON"
                                                aria-label="Copy redacted JSON"
                                                onClick={() => void copyText(details.redactedjson)}
                                            >
                                                <i className="fa-sharp fa-solid fa-copy" />
                                            </button>
                                        </div>
                                    </div>

                                    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                                        <dt className="text-muted">Isolation path</dt>
                                        <dd className="min-w-0 break-all font-mono text-xxs">
                                            {details.configdir || "Global configuration"}
                                        </dd>
                                        <dt className="text-muted">Inherited hooks</dt>
                                        <dd>{details.inheritancesource}</dd>
                                        <dt className="text-muted">Top-level keys</dt>
                                        <dd className="break-words">{details.toplevelkeys?.join(", ") || "-"}</dd>
                                        <dt className="text-muted">Counts</dt>
                                        <dd>
                                            {details.envcount ?? 0} env / {details.hookeventcount ?? 0} hook events
                                        </dd>
                                    </dl>

                                    {details.warning ? (
                                        <div className="border-l-2 border-warning pl-3 text-xs text-secondary">
                                            {details.warning}
                                        </div>
                                    ) : null}

                                    <section>
                                        <div className="mb-2 text-xs font-medium">Materialized files</div>
                                        <div className="border-y border-border">
                                            {details.files.map((file) => (
                                                <div
                                                    key={file.name}
                                                    className="grid grid-cols-[minmax(0,1fr)_70px_150px] gap-3 border-b border-border/60 py-2 text-xs last:border-b-0"
                                                >
                                                    <span className="truncate font-mono text-xxs" title={file.name}>
                                                        {file.name}
                                                    </span>
                                                    <span className={file.exists ? "text-success" : "text-muted"}>
                                                        {file.exists ? `${file.size} B` : "Missing"}
                                                    </span>
                                                    <span className="text-right text-muted">
                                                        {formatDiagnosticTime(file.lastmodified)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>

                                    <section>
                                        <div className="mb-2 text-xs font-medium">Redacted materialized JSON</div>
                                        <pre className="max-h-64 overflow-auto rounded border border-border bg-surface-soft p-3 font-mono text-xxs leading-5 text-primary whitespace-pre-wrap break-all">
                                            {details.redactedjson || "No JSON preview available."}
                                        </pre>
                                    </section>
                                </>
                            ) : null}
                        </div>
                    )}
                </div>

                <div className="flex shrink-0 justify-end border-t border-border py-3">
                    <button
                        type="button"
                        className="h-8 rounded border border-border bg-surface px-4 text-xs font-medium text-primary hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        onClick={closeModal}
                    >
                        Close
                    </button>
                </div>
            </div>
        </Modal>
    );
}

AgentHookSettingsModal.displayName = "AgentHookSettingsModal";

export { AgentHookSettingsModal };
