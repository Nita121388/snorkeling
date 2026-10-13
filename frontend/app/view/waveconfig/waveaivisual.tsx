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
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import {
    deleteWaveAIMode,
    getDefaultWaveAIMode,
    renameWaveAIMode,
    setDefaultWaveAIMode,
    upsertWaveAIMode,
} from "@/app/view/waveconfig/waveai-modes";
import { templateModeKey, templateToAIMode, WaveAITemplates } from "@/app/view/waveconfig/waveai-templates";
import { AITestServiceType } from "@/app/store/services";
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

export const WaveAIVisualContent = memo(function WaveAIVisualContent({
    model,
}: {
    model: WaveConfigViewModel;
}) {
    // Live mode map, re-renders on every backend broadcast (including our own writes).
    const modeConfigs = useAtomValue(atoms.waveaiModeConfigAtom) ?? {};
    const defaultMode = getDefaultWaveAIMode();
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    // editor keeps a local form copy so typing doesn't re-render from the atom mid-keystroke
    const [form, setForm] = useState<AIModeConfigType | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [testState, setTestState] = useState<TestState>({ status: "idle" });
    const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [adding, setAdding] = useState(false);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);
    const testService = useMemo(() => new AITestServiceType(), []);

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

    const selectedEntry = useMemo(
        () => entries.find((e) => e.key === selectedKey) ?? null,
        [entries, selectedKey]
    );

    // Keep selection valid as the list changes (deletes / external edits).
    useEffect(() => {
        if (selectedKey != null && !modeConfigs[selectedKey]) {
            setSelectedKey(entries[0]?.key ?? null);
        }
        if (selectedKey == null && entries.length > 0) {
            setSelectedKey(entries[0].key);
        }
    }, [entries, modeConfigs, selectedKey]);

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

    const handleRename = useCallback(() => {
        if (selectedKey == null || !nameDraft.trim()) {
            setRenaming(false);
            return;
        }
        void renameWaveAIMode(model, selectedKey, nameDraft.trim());
        setRenaming(false);
    }, [model, nameDraft, selectedKey]);

    const handleDelete = useCallback(() => {
        if (selectedKey == null) {
            return;
        }
        if (!window.confirm(`Delete AI mode "${selectedEntry?.config["display:name"] ?? selectedKey}"?`)) {
            return;
        }
        void deleteWaveAIMode(model, selectedKey);
        if (defaultMode === selectedKey) {
            void setDefaultWaveAIMode("");
        }
        setSelectedKey(entries.find((e) => e.key !== selectedKey)?.key ?? null);
    }, [defaultMode, entries, model, selectedEntry, selectedKey]);

    const handleAddFromTemplate = useCallback(
        (templateId: string) => {
            const template = WaveAITemplates.find((t) => t.id === templateId);
            if (!template) {
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
                secretName: form["ai:apitokensecretname"],
            });
            if (result.ok) {
                setTestState({ status: "ok", latencyMs: result.latencyMs, message: result.message });
            } else {
                setTestState({ status: "error", message: result.message });
            }
        } catch (err) {
            setTestState({ status: "error", message: err instanceof Error ? err.message : String(err) });
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
                secretName: form["ai:apitokensecretname"],
            });
            if (result.error) {
                setFetchState({ status: "error", message: result.error });
            } else {
                setFetchedModels(result.models ?? []);
                setFetchState({ status: "ok" });
            }
        } catch (err) {
            setFetchState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
    }, [form, selectedKey, testService]);

    const handleUseModel = useCallback(
        (modelId: string) => {
            if (form == null) {
                return;
            }
            const next = { ...form, "ai:model": modelId };
            setForm(next);
            void upsertWaveAIMode(model, selectedKey!, next);
        },
        [form, model, selectedKey]
    );

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-5 text-primary">
            <header className="flex shrink-0 items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold">Wave AI Modes</h2>
                    <p className="mt-1 max-w-3xl text-sm text-secondary">
                        Configure which models Wave AI uses. Built-in Wave Cloud modes ship with the app; custom
                        providers store their API key in the system keychain.
                    </p>
                </div>
                <button
                    type="button"
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-action px-3 py-1.5 text-xs text-actiontext hover:bg-actionhover"
                    onClick={() => setAdding((v) => !v)}
                >
                    <span className="text-sm leading-none">+</span> Add mode
                </button>
            </header>

            {adding && (
                <section className="shrink-0 rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 text-xs font-medium text-primary">Add from template</div>
                    <div className="flex flex-wrap gap-1.5">
                        {WaveAITemplates.map((template) => (
                            <button
                                key={template.id}
                                type="button"
                                className="cursor-pointer rounded border border-border bg-panel px-2.5 py-1.5 text-left text-xs text-secondary hover:bg-hover hover:text-primary"
                                title={template.note}
                                onClick={() => handleAddFromTemplate(template.id)}
                            >
                                {template.label}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {entries.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm text-secondary">No AI modes configured yet.</p>
                    <p className="max-w-md text-xs text-muted-foreground">
                        Add a provider from a template above, or edit <code className="text-primary">waveai.json</code> in the JSON tab.
                    </p>
                </div>
            ) : (
                <div className="@container flex min-h-0 min-w-0 flex-1">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface @xl:flex-row">
                        {/* Left pane: mode list */}
                        <div className="max-h-[168px] shrink-0 overflow-y-auto border-b border-border p-1.5 @xl:max-h-none @xl:w-[240px] @xl:border-r @xl:border-b-0">
                            {entries.map((entry) => {
                                const isDefault = entry.key === defaultMode;
                                const isSelected = entry.key === selectedKey;
                                return (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        onClick={() => setSelectedKey(entry.key)}
                                        aria-current={isSelected ? "true" : undefined}
                                        className={cn(
                                            "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded px-2 text-left transition-colors",
                                            isSelected ? "bg-hoverbg text-primary" : "text-secondary hover:bg-hoverbg/50"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "h-[6px] w-[6px] shrink-0 rounded-full",
                                                isDefault ? "bg-success" : "bg-border"
                                            )}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                            {entry.config["display:name"] || entry.key}
                                        </span>
                                        {isDefault && <span className="shrink-0 text-[9px] text-success">Default</span>}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Right pane: edit form */}
                        <div className="min-w-0 flex-1 overflow-y-auto p-4 @xl:px-6 @xl:py-5">
                            {!selectedEntry || form == null ? (
                                <div className="flex h-full items-center justify-center text-sm text-secondary">
                                    Select a mode to edit it.
                                </div>
                            ) : (
                                <div className="flex max-w-xl flex-col gap-5">
                                    {/* Heading: avatar + name + actions */}
                                    <div className="flex items-center gap-3">
                                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-sm">
                                            <i className="fa-sharp fa-solid fa-robot" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            {renaming ? (
                                                <div className="flex items-center gap-1.5">
                                                    <input
                                                        autoFocus
                                                        value={nameDraft}
                                                        onChange={(e) => setNameDraft(e.target.value)}
                                                        onBlur={handleRename}
                                                        onKeyDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.key === "Enter") {
                                                                e.currentTarget.blur();
                                                            }
                                                            if (e.key === "Escape") {
                                                                setRenaming(false);
                                                            }
                                                        }}
                                                        className="h-7 w-full max-w-[280px] rounded border border-border bg-panel px-2 text-sm font-semibold text-primary outline-none focus:border-accent"
                                                    />
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="block h-7 max-w-full cursor-pointer truncate rounded px-1.5 text-left text-sm font-semibold text-primary hover:bg-hoverbg"
                                                    title="Rename"
                                                    onClick={() => {
                                                        setNameDraft(selectedEntry.config["display:name"]);
                                                        setRenaming(true);
                                                    }}
                                                >
                                                    {selectedEntry.config["display:name"] || selectedEntry.key}
                                                </button>
                                            )}
                                            <p className="text-[11px] text-muted-foreground">
                                                {selectedEntry.key}
                                                {APITypeLabels[selectedEntry.config["ai:apitype"]]
                                                    ? ` · ${APITypeLabels[selectedEntry.config["ai:apitype"]]}`
                                                    : ""}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className={cn(
                                                "shrink-0 cursor-pointer rounded px-2.5 py-1 text-xs",
                                                defaultMode === selectedEntry.key
                                                    ? "border border-success/40 bg-success/10 text-success"
                                                    : "border border-border text-secondary hover:bg-hover"
                                            )}
                                            disabled={defaultMode === selectedEntry.key}
                                            onClick={() => void setDefaultWaveAIMode(selectedEntry.key)}
                                        >
                                            {defaultMode === selectedEntry.key ? "Default" : "Set default"}
                                        </button>
                                        <button
                                            type="button"
                                            className="shrink-0 cursor-pointer rounded border border-border px-2.5 py-1 text-xs text-error hover:bg-error/10"
                                            onClick={handleDelete}
                                        >
                                            Delete
                                        </button>
                                    </div>

                                    {/* Connection fields */}
                                    <div className="flex flex-col gap-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-medium text-secondary">API type</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {ApiTypeOptions.map((opt) => (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        className={cn(
                                                            "cursor-pointer rounded border px-2.5 py-1 text-xs transition-colors",
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
                                            placeholder="https://api.example.com/v1/chat/completions"
                                            mono
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
                                                        "shrink-0 cursor-pointer rounded border px-2 py-1.5 text-[11px] transition-colors",
                                                        fetchState.status === "fetching"
                                                            ? "border-border text-muted-foreground"
                                                            : "border-border text-secondary hover:bg-hover"
                                                    )}
                                                    disabled={fetchState.status === "fetching"}
                                                    onClick={() => void handleFetchModels()}
                                                >
                                                    {fetchState.status === "fetching" ? "Fetching…" : "Fetch from endpoint"}
                                                </button>
                                            }
                                        />
                                        {fetchState.status === "error" ? (
                                            <p className="text-xs text-error">{fetchState.message}</p>
                                        ) : null}
                                        {fetchedModels.length > 0 ? (
                                            <div className="max-h-40 overflow-y-auto rounded border border-border bg-panel p-2">
                                                <div className="flex flex-wrap gap-1">
                                                    {fetchedModels.map((mid) => (
                                                        <button
                                                            key={mid}
                                                            type="button"
                                                            className={cn(
                                                                "cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
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
                                            <label className="mb-1 block text-xs font-medium text-secondary">API key secret</label>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    ref={apiKeyInputRef}
                                                    value={form["ai:apitokensecretname"] ?? ""}
                                                    onChange={(e) => applyPatch({ "ai:apitokensecretname": e.target.value })}
                                                    placeholder="OPENAI_KEY"
                                                    spellCheck={false}
                                                    className="min-w-0 flex-1 rounded border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-primary outline-none focus:border-accent"
                                                />
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "flex shrink-0 cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors",
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
                                                <p
                                                    className={cn(
                                                        "mt-1 break-words text-xs",
                                                        testState.status === "ok" ? "text-success" : "text-error"
                                                    )}
                                                >
                                                    {testState.message}
                                                </p>
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

function Field({
    label,
    value,
    onChange,
    placeholder,
    mono,
    suffix,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    mono?: boolean;
    suffix?: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-1 block text-xs font-medium text-secondary">{label}</label>
            <div className="flex items-center gap-1.5">
                <input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    spellCheck={false}
                    className={cn(
                        "min-w-0 flex-1 rounded border border-border bg-panel px-2.5 py-1.5 text-xs text-primary outline-none focus:border-accent",
                        mono && "font-mono"
                    )}
                />
                {suffix}
            </div>
        </div>
    );
}

WaveAIVisualContent.displayName = "WaveAIVisualContent";