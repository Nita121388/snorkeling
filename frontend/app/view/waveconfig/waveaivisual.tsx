// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave AI Modes visual editor — two-pane layout modeled after Lyra's
// ModelSettings: a mode/provider list on the left, the selected entry's edit
// form on the right. All edits persist immediately to waveai.json via
// FileWriteCommand; the backend watcher re-broadcasts the config so the global
// waveaiModeConfigAtom (and every other consumer) stays in sync.
//
// Storage format is unchanged — this is a UX layer over AIModeConfigType.

import { atoms } from "@/app/store/global-atoms";
import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import {
    deleteWaveAIMode,
    renameWaveAIMode,
    setDefaultWaveAIMode,
    upsertWaveAIMode,
} from "@/app/view/waveconfig/waveai-modes";
import { templateModeKey, templateToAIMode, WaveAITemplates } from "@/app/view/waveconfig/waveai-templates";
import { AITestServiceType, CcSwitchServiceType } from "@/app/store/services";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { modalsModel } from "@/app/store/modalmodel";
import { CopyButton } from "@/app/element/copybutton";
import { InlineRenameInput } from "@/app/element/inline-rename-input";
import { cn } from "@/util/util";

type TestState =
    | { status: "idle" }
    | { status: "testing" }
    | { status: "ok"; latencyMs: number; message: string }
    | { status: "error"; message: string };

type FetchState =
    | { status: "idle" }
    | { status: "fetching" }
    | { status: "ok" }
    | { status: "error"; message: string };

const ApiTypeOptions: { value: string; label: string }[] = [
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "openai-chat", label: "OpenAI Chat" },
    { value: "anthropic-messages", label: "Anthropic Messages" },
    { value: "google-gemini", label: "Google Gemini" },
];

const APITypeLabels = Object.fromEntries(ApiTypeOptions.map((o) => [o.value, o.label]));
const DEFAULT_MODE_KEY = "custom@default";
const isBuiltInMode = (key: string) => key.startsWith("waveai@");

/** Status dot meaning: connected (last test passed) vs never tested vs failed. */
type ProbeStatus = "none" | "ok" | "error";

export const WaveAIVisualContent = memo(function WaveAIVisualContent({
    model,
}: {
    model: WaveConfigViewModel;
}) {
    // Live mode map, re-renders on every backend broadcast (including our own writes).
    const modeConfigs = useAtomValue(atoms.waveaiModeConfigAtom) ?? {};
    const defaultMode = useAtomValue(getSettingsKeyAtom("waveai:defaultmode")) ?? "";
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    // editor keeps a local form copy so typing doesn't re-render from the atom mid-keystroke
    const [form, setForm] = useState<AIModeConfigType | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [testState, setTestState] = useState<TestState>({ status: "idle" });
    const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [adding, setAdding] = useState(false);
    const [ccSwitchVendors, setCcSwitchVendors] = useState<WaveAIVendor[]>([]);
    const [loadingCcSwitch, setLoadingCcSwitch] = useState(false);
    const [filter, setFilter] = useState("");
    const [error, setError] = useState<string | null>(null);
    // Last probe result per mode key, so the list can show a connection dot.
    const [probeResults, setProbeResults] = useState<Record<string, ProbeStatus>>({});
    const initializedDefault = useRef(false);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);
    const testService = useMemo(() => new AITestServiceType(), []);
    const ccSwitchService = useMemo(() => new CcSwitchServiceType(), []);

    const entries = useMemo(
        () =>
            Object.entries(modeConfigs)
                .map(([key, config]) => ({ key, config }))
                .sort((a, b) => {
                    const orderDiff = (a.config["display:order"] ?? 0) - (b.config["display:order"] ?? 0);
                    return orderDiff !== 0 ? orderDiff : a.config["display:name"].localeCompare(b.config["display:name"]);
                }),
        [modeConfigs]
    );

    const userEntries = useMemo(() => entries.filter((entry) => !isBuiltInMode(entry.key)), [entries]);

    // Filter applies to the name, the mode key and the model — those are what a
    // user remembers when hunting for a provider they set up months ago.
    const normalizedFilter = filter.trim().toLowerCase();
    const filterEntries = useCallback(
        (list: typeof entries) =>
            normalizedFilter == ""
                ? list
                : list.filter(
                      (entry) =>
                          entry.config["display:name"].toLowerCase().includes(normalizedFilter) ||
                          entry.key.toLowerCase().includes(normalizedFilter) ||
                          (entry.config["ai:model"] ?? "").toLowerCase().includes(normalizedFilter)
                  ),
        [normalizedFilter]
    );
    const visibleUserEntries = useMemo(() => filterEntries(userEntries), [filterEntries, userEntries]);

    useEffect(() => {
        if (initializedDefault.current || entries.length > 0) return;
        initializedDefault.current = true;
        const config: AIModeConfigType = {
            "display:name": "My AI",
            "ai:provider": "custom",
            "ai:apitype": "openai-chat",
            "ai:model": "",
            "ai:endpoint": "",
            "ai:apitokensecretname": "",
        };
        void upsertWaveAIMode(model, DEFAULT_MODE_KEY, config).then(() => setDefaultWaveAIMode(DEFAULT_MODE_KEY));
    }, [entries.length, model]);

    const selectedEntry = useMemo(
        () => entries.find((e) => e.key === selectedKey) ?? null,
        [entries, selectedKey]
    );

    // Keep selection valid as the list changes (deletes / external edits).
    useEffect(() => {
        if (selectedKey != null && !modeConfigs[selectedKey]) {
            setSelectedKey(userEntries[0]?.key ?? null);
        }
        if (selectedKey == null && userEntries.length > 0) {
            setSelectedKey(userEntries[0].key);
        }
    }, [modeConfigs, selectedKey, userEntries]);

    // Refresh the form when the selected mode changes.
    useEffect(() => {
        if (selectedEntry) {
            setForm(selectedEntry.config);
            setTestState({ status: "idle" });
            setFetchState({ status: "idle" });
            setFetchedModels([]);
            setRenaming(false);
        } else {
            setForm(null);
        }
    }, [selectedEntry?.key, selectedEntry?.config]);

    const showError = useCallback((message: string) => {
        modalsModel.pushModal("MessageModal", { children: message });
    }, []);

    const applyPatch = useCallback(
        (patch: Partial<AIModeConfigType>) => {
            if (selectedKey == null || form == null) {
                return;
            }
            const next = { ...form, ...patch };
            setForm(next);
            void upsertWaveAIMode(model, selectedKey, next);
        },
        [form, model, selectedKey]
    );

    const commitRename = useCallback(() => {
        if (selectedKey == null) {
            setRenaming(false);
            return;
        }
        const trimmed = nameDraft.trim();
        setRenaming(false);
        if (trimmed == "") {
            return;
        }
        if (trimmed === selectedEntry?.config["display:name"]) {
            return;
        }
        void renameWaveAIMode(model, selectedKey, trimmed);
    }, [model, nameDraft, selectedEntry, selectedKey]);

    const requestDelete = useCallback(() => {
        if (selectedKey == null) {
            return;
        }
        const label = selectedEntry?.config["display:name"] || selectedKey;
        modalsModel.pushModal(
            "ConfirmModal",
            {
                title: "Delete AI provider",
                message: `Delete "${label}"? The entry is removed from waveai.json. Existing sessions that already use it keep working until their mode is switched.`,
                confirmLabel: "Delete",
                destructive: true,
                onResolve: (confirmed: boolean) => {
                    if (!confirmed) return;
                    void deleteWaveAIMode(model, selectedKey).catch((err) =>
                        showError(`Could not delete AI provider: ${errorText(err)}`)
                    );
                    if (defaultMode === selectedKey) {
                        void setDefaultWaveAIMode("");
                    }
                },
            }
        );
    }, [defaultMode, model, selectedEntry, selectedKey, showError]);

    const handleLoadCcSwitch = useCallback(async () => {
        setLoadingCcSwitch(true);
        setError(null);
        try {
            const result = await model.env.rpc.CcSwitchListWaveAIVendorsCommand(TabRpcClient);
            setCcSwitchVendors(result?.vendors ?? []);
        } catch (err) {
            const message = `Could not read cc-switch providers: ${errorText(err)}`;
            setError(message);
            showError(message);
        } finally {
            setLoadingCcSwitch(false);
        }
    }, [model, showError]);

    // The import writes through the backend and returns the mode key it created;
    // the watcher broadcast updates the list, so no reload is needed.
    const handleImportCcSwitch = useCallback(
        async (vendor: WaveAIVendor) => {
            const models = vendor.models?.length > 0 ? vendor.models : [vendor.defaultModel || ""];
            setError(null);
            try {
                let lastKey: string | null = null;
                for (const modelId of models.filter(Boolean)) {
                    const result = await ccSwitchService.ImportWaveAI({ vendorId: vendor.id, model: modelId });
                    lastKey = result?.modeKey ?? lastKey;
                }
                if (lastKey != null) {
                    setSelectedKey(lastKey);
                }
                setAdding(false);
            } catch (err) {
                const message = `Could not import ${vendor.name}: ${errorText(err)}`;
                setError(message);
                showError(message);
            }
        },
        [ccSwitchService, showError]
    );

    const handleAddFromTemplate = useCallback(
        (templateId: string) => {
            const template = WaveAITemplates.find((t) => t.id === templateId);
            if (template == null) {
                return;
            }
            const key = templateModeKey(template);
            const existing = modeConfigs[key];
            const config = existing
                ? { ...existing, ...templateToAIMode(template) }
                : templateToAIMode(template);
            void upsertWaveAIMode(model, key, config).then(() => {
                setSelectedKey(key);
                setAdding(false);
            });
        },
        [modeConfigs, model]
    );

    const handleTest = useCallback(async () => {
        if (selectedKey == null || form == null) {
            return;
        }
        setTestState({ status: "testing" });
        try {
            const result = await testService.TestConnection({
                apiType: form["ai:apitype"],
                endpoint: form["ai:endpoint"],
                model: form["ai:model"],
                provider: form["ai:provider"],
                apiToken: form["ai:apitoken"],
                secretName: form["ai:apitokensecretname"],
            });
            if (result.ok) {
                setTestState({ status: "ok", latencyMs: result.latencyMs, message: result.message });
                setProbeResults((prev) => ({ ...prev, [selectedKey]: "ok" }));
            } else {
                setTestState({ status: "error", message: result.message });
                setProbeResults((prev) => ({ ...prev, [selectedKey]: "error" }));
            }
        } catch (err) {
            const message = errorText(err);
            setTestState({ status: "error", message });
            setProbeResults((prev) => ({ ...prev, [selectedKey]: "error" }));
        }
    }, [form, selectedKey, testService]);

    const handleFetchModels = useCallback(async () => {
        if (selectedKey == null || form == null) {
            return;
        }
        setFetchState({ status: "fetching" });
        setFetchedModels([]);
        try {
            const result = await testService.FetchModels({
                endpoint: form["ai:endpoint"],
                apiToken: form["ai:apitoken"],
                secretName: form["ai:apitokensecretname"],
            });
            if (result.error) {
                setFetchState({ status: "error", message: result.error });
            } else {
                setFetchedModels(result.models ?? []);
                setFetchState({ status: "ok" });
            }
        } catch (err) {
            setFetchState({ status: "error", message: errorText(err) });
        }
    }, [form, selectedKey, testService]);

    const handleUseModel = useCallback(
        (modelId: string) => {
            if (form == null || selectedKey == null) {
                return;
            }
            const next = { ...form, "ai:model": modelId };
            setForm(next);
            void upsertWaveAIMode(model, selectedKey, next);
        },
        [form, model, selectedKey]
    );

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-primary">
            {/* Toolbar: filter the list, add providers. */}
            <div className="flex shrink-0 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <i
                        className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted"
                        aria-hidden="true"
                    />
                    <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter models…"
                        spellCheck={false}
                        aria-label="Filter models"
                        className="h-8 w-full rounded border border-border bg-panel pr-7 pl-7 text-xs text-primary outline-none placeholder:text-muted focus:border-accent"
                    />
                    {filter != "" && (
                        <button
                            type="button"
                            aria-label="Clear filter"
                            title="Clear filter"
                            className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-primary"
                            onClick={() => setFilter("")}
                        >
                            <i className="fa-sharp fa-solid fa-xmark text-[11px]" />
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded bg-action px-3 text-xs text-actiontext hover:bg-actionhover"
                    onClick={() => setAdding((v) => !v)}
                    aria-expanded={adding}
                >
                    <i className="fa-sharp fa-solid fa-plus text-[11px]" />
                    Add provider
                </button>
            </div>

            {adding && (
                <section className="shrink-0 rounded-lg border border-border bg-panel p-3">
                    <div className="mb-2 text-xs font-medium text-primary">Add from template</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            className="h-7 cursor-pointer rounded border border-border bg-panel px-2.5 text-xs text-secondary hover:bg-hover hover:text-primary disabled:cursor-default disabled:opacity-50"
                            onClick={() => void handleLoadCcSwitch()}
                            disabled={loadingCcSwitch}
                        >
                            {loadingCcSwitch ? (
                                <>
                                    <i className="fa-sharp fa-solid fa-spinner animate-spin" /> Loading cc-switch…
                                </>
                            ) : (
                                "Import from cc-switch"
                            )}
                        </button>
                    </div>
                    {ccSwitchVendors.length > 0 && (
                        <div className="mb-3 max-h-40 overflow-y-auto rounded border border-border bg-panel p-2">
                            <div className="px-1 pb-1 text-xxs font-medium text-secondary">cc-switch providers</div>
                            {ccSwitchVendors.map((vendor) => (
                                <button
                                    key={`${vendor.appType}:${vendor.id}`}
                                    type="button"
                                    className="flex h-7 w-full items-center justify-between rounded px-2 text-left text-xs text-secondary hover:bg-hover hover:text-primary"
                                    onClick={() => void handleImportCcSwitch(vendor)}
                                >
                                    <span className="truncate">{vendor.name}</span>
                                    <span className="shrink-0 pl-2 text-xxs text-muted-foreground">
                                        {vendor.models?.length ?? 0} models
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        {WaveAITemplates.map((template) => (
                            <button
                                key={template.id}
                                type="button"
                                className="h-7 cursor-pointer rounded border border-border bg-panel px-2.5 text-left text-xs text-secondary hover:bg-hover hover:text-primary"
                                title={template.note}
                                onClick={() => handleAddFromTemplate(template.id)}
                            >
                                {template.label}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {error != null && (
                <div className="flex shrink-0 items-center gap-2 rounded border border-error/40 bg-error/10 px-3 py-2">
                    <i className="fa-sharp fa-solid fa-triangle-exclamation shrink-0 text-xs text-error" />
                    <span className="min-w-0 flex-1 break-words text-xs text-error">{error}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer text-xs font-medium text-error hover:underline"
                        onClick={() => setError(null)}
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {entries.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm text-secondary">No AI modes configured yet.</p>
                    <p className="max-w-md text-xs text-muted-foreground">
                        Add a provider from a template above, or edit <code className="text-primary">waveai.json</code>{" "}
                        in the JSON tab.
                    </p>
                </div>
            ) : (
                <div className="@container flex min-h-0 min-w-0 flex-1">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-panel @xl:flex-row">
                        {/* Left pane: mode list */}
                        <div className="flex min-h-0 max-h-[168px] shrink-0 flex-col overflow-hidden border-b border-border @xl:max-h-none @xl:w-[240px] @xl:border-r @xl:border-b-0">
                            {userEntries.length > 0 && (
                                <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
                                    <span className="text-xxs font-medium uppercase tracking-wide text-muted-foreground">
                                        My Models
                                    </span>
                                </div>
                            )}
                            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                                {visibleUserEntries.map((entry) => {
                                    const isDefault = entry.key === defaultMode;
                                    const isSelected = entry.key === selectedKey;
                                    const probe = probeResults[entry.key] ?? "none";
                                    return (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            onClick={() => setSelectedKey(entry.key)}
                                            aria-current={isSelected ? "true" : undefined}
                                            className={cn(
                                                "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded px-2 text-left transition-colors",
                                                isSelected
                                                    ? "bg-actionsoft text-actionsofttext"
                                                    : "text-secondary hover:bg-hover"
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "h-[6px] w-[6px] shrink-0 rounded-full",
                                                    probe === "ok"
                                                        ? "bg-success"
                                                        : probe === "error"
                                                          ? "bg-error"
                                                          : "bg-border"
                                                )}
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                                {entry.config["display:name"] || entry.key}
                                            </span>
                                            {isDefault && (
                                                <span className="shrink-0 rounded bg-actionsoft px-1 text-xxs text-actionsofttext">
                                                    Default
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                                {visibleUserEntries.length === 0 && (
                                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                                        No models match "{filter}".
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right pane: edit form */}
                        <div className="min-w-0 flex-1 overflow-y-auto p-4 @xl:px-6 @xl:py-5">
                            {!selectedEntry || form == null ? (
                                <div className="flex h-full items-center justify-center text-sm text-secondary">
                                    Select a mode to edit it.
                                </div>
                            ) : (
                                <div className="flex max-w-[640px] flex-col gap-5">
                                    {/* Heading: name (inline rename) + actions */}
                                    <div className="flex items-center gap-3">
                                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-actionsoft text-sm">
                                            <i className="fa-sharp fa-solid fa-robot" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            {renaming ? (
                                                <InlineRenameInput
                                                    defaultValue={nameDraft}
                                                    onCommit={commitRename}
                                                    onCancel={() => setRenaming(false)}
                                                    className="h-7 w-full max-w-[320px] rounded border border-border bg-panel px-2 text-sm font-semibold text-primary outline-none focus:border-accent"
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="flex h-7 w-full max-w-[320px] cursor-pointer items-center truncate rounded px-1.5 text-left text-sm font-semibold text-primary hover:bg-hover"
                                                    title="Rename"
                                                    onClick={() => {
                                                        setNameDraft(selectedEntry.config["display:name"]);
                                                        setRenaming(true);
                                                    }}
                                                >
                                                    {selectedEntry.config["display:name"] || selectedEntry.key}
                                                </button>
                                            )}
                                            <p className="truncate px-1.5 text-[11px] text-muted-foreground" title={selectedEntry.key}>
                                                {selectedEntry.key}
                                                {APITypeLabels[selectedEntry.config["ai:apitype"]]
                                                    ? ` · ${APITypeLabels[selectedEntry.config["ai:apitype"]]}`
                                                    : ""}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className={cn(
                                                "h-7 shrink-0 cursor-pointer rounded px-2.5 text-xs disabled:cursor-default disabled:opacity-50",
                                                defaultMode === selectedEntry.key
                                                    ? "border border-actionsoftborder bg-actionsoft text-actionsofttext"
                                                    : "border border-border text-secondary hover:bg-hover"
                                            )}
                                            disabled={defaultMode === selectedEntry.key}
                                            onClick={() => void setDefaultWaveAIMode(selectedEntry.key)}
                                        >
                                            {defaultMode === selectedEntry.key ? "Default" : "Set default"}
                                        </button>
                                        <button
                                            type="button"
                                            className="h-7 shrink-0 cursor-pointer rounded border border-border px-2.5 text-xs text-error hover:bg-error/10"
                                            onClick={requestDelete}
                                        >
                                            Delete
                                        </button>
                                    </div>

                                    {/* Connection fields */}
                                    <div className="flex flex-col gap-3">
                                        <div>
                                            <label className="mb-1 text-xs font-medium text-secondary">API type</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {ApiTypeOptions.map((opt) => (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        className={cn(
                                                            "h-7 cursor-pointer rounded border px-2.5 text-xs transition-colors",
                                                            form["ai:apitype"] === opt.value
                                                                ? "border-accent bg-accent/10 text-primary"
                                                                : "border-border text-secondary hover:bg-hover"
                                                        )}
                                                        onClick={() => applyPatch({ "ai:apitype": opt.value })}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <Field
                                            label="Endpoint"
                                            value={form["ai:endpoint"] ?? ""}
                                            onChange={(v) => applyPatch({ "ai:endpoint": v })}
                                            placeholder="https://api.example.com/v1"
                                            mono
                                            hint="Base URL and full request URL both work. A base URL such as https://host/v1 is expanded to the right path automatically."
                                        />
                                        <Field
                                            label="Model"
                                            value={form["ai:model"] ?? ""}
                                            onChange={(v) => applyPatch({ "ai:model": v })}
                                            placeholder="gpt-5-mini"
                                            mono
                                            suffix={
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "h-7 shrink-0 cursor-pointer rounded border px-2 text-[11px] whitespace-nowrap transition-colors",
                                                        fetchState.status === "fetching"
                                                            ? "border-border text-muted-foreground"
                                                            : "border-border text-secondary hover:bg-hover"
                                                    )}
                                                    disabled={fetchState.status === "fetching"}
                                                    onClick={() => void handleFetchModels()}
                                                >
                                                    {fetchState.status === "fetching" ? "Fetching…" : "Fetch models"}
                                                </button>
                                            }
                                        />
                                        {fetchState.status === "error" ? (
                                            <ErrorLine message={fetchState.message} />
                                        ) : null}
                                        {fetchedModels.length > 0 ? (
                                            <div className="max-h-40 overflow-y-auto rounded border border-border bg-panel p-2">
                                                <div className="flex flex-wrap gap-1">
                                                    {fetchedModels.map((mid) => (
                                                        <button
                                                            key={mid}
                                                            type="button"
                                                            className={cn(
                                                                "h-6 cursor-pointer rounded border px-1.5 font-mono text-[11px] transition-colors",
                                                                form["ai:model"] === mid
                                                                    ? "border-accent bg-accent/10 text-primary"
                                                                    : "border-border text-secondary hover:bg-hover"
                                                            )}
                                                            onClick={() => handleUseModel(mid)}
                                                        >
                                                            {mid}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}

                                        <div>
                                            <label className="mb-1 text-xs font-medium text-secondary">API key secret</label>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    ref={apiKeyInputRef}
                                                    value={form["ai:apitokensecretname"] ?? ""}
                                                    onChange={(e) => applyPatch({ "ai:apitokensecretname": e.target.value })}
                                                    placeholder="OPENAI_KEY"
                                                    spellCheck={false}
                                                    className="h-8 min-w-0 flex-1 rounded border border-border bg-panel px-2.5 font-mono text-xs text-primary outline-none focus:border-accent"
                                                />
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded border px-3 text-xs whitespace-nowrap transition-colors",
                                                        testState.status === "testing"
                                                            ? "border-border text-muted-foreground"
                                                            : testState.status === "ok"
                                                              ? "border-success/40 bg-success/10 text-success"
                                                              : testState.status === "error"
                                                                ? "border-error/40 bg-error/10 text-error"
                                                                : "border-border text-secondary hover:bg-hover"
                                                    )}
                                                    disabled={testState.status === "testing"}
                                                    onClick={() => void handleTest()}
                                                >
                                                    {testState.status === "testing" ? (
                                                        <i className="fa-sharp fa-solid fa-spinner animate-spin" />
                                                    ) : testState.status === "ok" ? (
                                                        <i className="fa-sharp fa-solid fa-check" />
                                                    ) : testState.status === "error" ? (
                                                        <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                                                    ) : (
                                                        <i className="fa-sharp fa-solid fa-bolt" />
                                                    )}
                                                    {testState.status === "testing"
                                                        ? "Testing…"
                                                        : testState.status === "ok"
                                                          ? `${testState.latencyMs}ms`
                                                          : testState.status === "error"
                                                            ? "Test failed"
                                                            : "Test connection"}
                                                </button>
                                            </div>
                                            {testState.status === "ok" || testState.status === "error" ? (
                                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                                                    <p
                                                        className={cn(
                                                            "min-w-0 flex-1 text-xs break-words",
                                                            testState.status === "ok" ? "text-success" : "text-error"
                                                        )}
                                                    >
                                                        {testState.message}
                                                    </p>
                                                    <span className="mt-0.5 shrink-0">
                                                        <CopyButton
                                                            title="Copy message"
                                                            onClick={() =>
                                                                void navigator.clipboard.writeText(testState.message)
                                                            }
                                                        />
                                                    </span>
                                                </div>
                                            ) : null}
                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                Save the key itself in Settings → Secrets under this name.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** A status line for fetch failures; keeps the message copyable. */
function ErrorLine({ message }: { message: string }) {
    return (
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
            <p className="min-w-0 flex-1 text-xs break-words text-error">{message}</p>
            <span className="mt-0.5 shrink-0">
                <CopyButton title="Copy message" onClick={() => void navigator.clipboard.writeText(message)} />
            </span>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    mono,
    hint,
    suffix,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    mono?: boolean;
    hint?: string;
    suffix?: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-1 text-xs font-medium text-secondary">{label}</label>
            <div className="flex items-center gap-1.5">
                <input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    spellCheck={false}
                    className={cn(
                        "h-8 min-w-0 flex-1 rounded border border-border bg-panel px-2.5 text-xs text-primary outline-none focus:border-accent",
                        mono && "font-mono"
                    )}
                />
                {suffix}
            </div>
            {hint != null && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

WaveAIVisualContent.displayName = "WaveAIVisualContent";