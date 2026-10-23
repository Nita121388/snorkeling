// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Prompts settings panel.
//
// Two-pane layout that matches the Wave AI Modes editor: a feature list on the
// left (backend-defined keys, so the page never invents feature names) and an
// edit form on the right. Every change is persisted to aiprompts.json through
// the serialized writer in aiprompt-model.ts; the backend watcher re-broadcasts
// the full config, so this page and the generation RPCs read the same source.

import { AISessionsServiceType } from "@/app/store/services";
import { atoms } from "@/app/store/global-atoms";
import { Toggle } from "@/app/element/toggle";
import {
    buildPromptPayload,
    flushPromptDraft,
    hasPromptOverride,
    PROMPT_FEATURE_FALLBACKS,
    PROMPT_FEATURE_ORDER,
    previewPrompt,
    resolvePromptDraft,
    savePromptConfig,
    type PromptDraft,
} from "@/app/view/waveconfig/aiprompt-model";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

const SaveDebounceMs = 500;

function featureMeta(features: PromptFeatureMeta[], key: string): PromptFeatureMeta {
    return features.find((f) => f.key === key) ?? PROMPT_FEATURE_FALLBACKS[key];
}

export const AIPromptsVisualContent = memo(function AIPromptsVisualContent({
    model,
}: {
    model: WaveConfigViewModel;
}) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const modeConfigs = useAtomValue(atoms.waveaiModeConfigAtom) ?? {};
    const [features, setFeatures] = useState<PromptFeatureMeta[]>([]);
    const [selectedKey, setSelectedKey] = useState<string>(PROMPT_FEATURE_ORDER[0]);
    const [draft, setDraft] = useState<PromptDraft>(() =>
        resolvePromptDraft({}, PROMPT_FEATURE_FALLBACKS[PROMPT_FEATURE_ORDER[0]])
    );
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");
    const initializedRef = useRef("");

    // Load built-in defaults + parameter metadata once. The static fallbacks keep
    // the form usable if the RPC fails (e.g. old backend).
    useEffect(() => {
        let cancelled = false;
        const service = new AISessionsServiceType();
        service
            .PromptTemplates({})
            .then((res) => {
                if (!cancelled && Array.isArray(res?.features)) {
                    setFeatures(res.features);
                }
            })
            .catch(() => {
                /* fallback metadata already covers the form */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const featureList = useMemo(() => {
        const ordered = PROMPT_FEATURE_ORDER.map((key) => featureMeta(features, key));
        return ordered.filter((meta): meta is PromptFeatureMeta => meta != null);
    }, [features]);

    const meta = featureMeta(features, selectedKey);
    const stored = fullConfig?.aiprompts?.[selectedKey] ?? {};

    // Reset the draft when switching features. Kept separate from the sync effect
    // so an edit in one feature never leaks into another.
    useEffect(() => {
        if (initializedRef.current === selectedKey) {
            return;
        }
        initializedRef.current = selectedKey;
        setDraft(resolvePromptDraft(stored, meta));
        setDirty(false);
        setSaveState("idle");
        setError("");
    }, [selectedKey, meta.key]);

    // External/config updates (including our own writes echoed by the watcher)
    // only flow into the form when the user is not mid-edit.
    const storedKey = JSON.stringify(stored);
    useEffect(() => {
        if (dirty) {
            return;
        }
        setDraft(resolvePromptDraft(stored, meta));
    }, [storedKey, meta.key]);

    // Switching features must not drop an edit that is still inside the
    // debounce window (the debounce effect is torn down by the key change).
    const selectFeature = useCallback(
        (key: string) => {
            if (key === selectedKey) {
                return;
            }
            if (dirty) {
                setSaveState("saving");
                flushPromptDraft(model, selectedKey, meta, draft)
                    .then(() => setSaveState("saved"))
                    .catch((err) => {
                        setSaveState("error");
                        setError(err instanceof Error ? err.message : String(err));
                    });
            }
            setSelectedKey(key);
        },
        [dirty, draft, meta, model, selectedKey]
    );

    const patch = useCallback((partial: Partial<PromptDraft>) => {
        setDraft((prev) => ({ ...prev, ...partial }));
        setDirty(true);
        setSaveState("idle");
        setError("");
    }, []);

    // Debounced auto-save, same rhythm as the session note editor.
    useEffect(() => {
        if (!dirty) {
            return;
        }
        const handle = window.setTimeout(() => {
            setSaveState("saving");
            savePromptConfig(model, selectedKey, buildPromptPayload(draft, meta))
                .then(() => {
                    setDirty(false);
                    setSaveState("saved");
                })
                .catch((err) => {
                    setSaveState("error");
                    setError(err instanceof Error ? err.message : String(err));
                });
        }, SaveDebounceMs);
        return () => window.clearTimeout(handle);
    }, [dirty, draft, meta, model, selectedKey]);

    useEffect(() => {
        if (saveState !== "saved") {
            return;
        }
        const handle = window.setTimeout(() => setSaveState("idle"), 1500);
        return () => window.clearTimeout(handle);
    }, [saveState]);

    const resetToDefault = useCallback(() => {
        setDraft(resolvePromptDraft({}, meta));
        setDirty(true);
        setSaveState("idle");
        setError("");
    }, [meta]);

    const modeOptions = useMemo(
        () =>
            Object.entries(modeConfigs).sort((a, b) =>
                (a[1]["display:name"] || a[0]).localeCompare(b[1]["display:name"] || b[0])
            ),
        [modeConfigs]
    );

    const preview = useMemo(() => previewPrompt(draft, meta), [draft, meta]);
    const isCustomized = hasPromptOverride(selectedKey);

    const numberField = (key: "maxNoteChars" | "maxTags" | "maxTitleChars") => {
        const param = meta.parameters.find((p) => p.key === key);
        if (param == null) {
            return null;
        }
        const value = draft[key] || param.defaultValue;
        return (
            <label className="flex items-center gap-2 text-xs text-secondary" key={key}>
                <span className="w-28 shrink-0">{param.label}</span>
                <input
                    type="number"
                    value={value}
                    min={param.min}
                    max={param.max}
                    aria-label={param.label}
                    className="h-7 w-20 rounded border border-border bg-panel px-2 text-xs text-primary tabular-nums outline-none focus:border-accent"
                    onChange={(event) => {
                        // Do not clamp while typing: clamping "100" after the first
                        // keystroke would turn it into "40". Clamp on blur instead.
                        const parsed = Number.parseInt(event.target.value, 10);
                        patch({ [key]: Number.isNaN(parsed) ? 0 : parsed } as Partial<PromptDraft>);
                    }}
                    onBlur={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        const base = Number.isNaN(parsed) ? param.defaultValue : parsed;
                        const clamped = Math.min(param.max, Math.max(param.min, base));
                        patch({ [key]: clamped } as Partial<PromptDraft>);
                    }}
                />
                <span className="text-muted">
                    {param.min}–{param.max}
                </span>
            </label>
        );
    };

    return (
        <div className="@container flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-4 text-primary">
            <div className="flex shrink-0 items-baseline justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-sm font-medium text-primary">AI Prompts</h2>
                    <p className="mt-0.5 text-xs text-muted">
                        Override the system prompt per feature. Empty fields keep the built-in default.
                    </p>
                </div>
                <span
                    className={cn(
                        "shrink-0 text-xxs",
                        saveState === "error" ? "text-error" : "text-muted"
                    )}
                    role="status"
                >
                    {saveState === "saving"
                        ? "Saving…"
                        : saveState === "saved"
                          ? "Saved"
                          : dirty
                            ? "Unsaved changes"
                            : ""}
                </span>
            </div>

            {error !== "" && (
                <div className="flex shrink-0 items-center gap-2 rounded border border-error/40 bg-error/10 px-3 py-2">
                    <i className="fa-sharp fa-solid fa-triangle-exclamation shrink-0 text-xs text-error" />
                    <span className="min-w-0 flex-1 break-words text-xs text-error">{error}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer text-xs font-medium text-error hover:underline"
                        onClick={() => setError("")}
                    >
                        Dismiss
                    </button>
                </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-panel @xl:flex-row">
                {/* Left pane: prompt features */}
                <div className="flex shrink-0 flex-col overflow-hidden border-b border-border @xl:w-[240px] @xl:border-r @xl:border-b-0">
                    <div className="px-3 pt-2.5 pb-1 text-xxs font-medium tracking-wide text-muted uppercase">
                        Features
                    </div>
                    <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1.5">
                        {featureList.map((item) => {
                            const isSelected = item.key === selectedKey;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => selectFeature(item.key)}
                                    aria-current={isSelected ? "true" : undefined}
                                    className={cn(
                                        "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                                        isSelected
                                            ? "bg-actionsoft text-actionsofttext"
                                            : "text-secondary hover:bg-hover"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "h-[6px] w-[6px] shrink-0 rounded-full",
                                            hasPromptOverride(item.key) ? "bg-accent" : "bg-border"
                                        )}
                                        aria-hidden="true"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                        {item.displayName}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Right pane: editor */}
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                        <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-primary">{meta.displayName}</div>
                            <div className="truncate text-xxs text-muted">{meta.description}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            {isCustomized && (
                                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xxs text-accent">
                                    Customized
                                </span>
                            )}
                            <button
                                type="button"
                                className="h-7 cursor-pointer rounded border border-border px-2 text-xxs text-secondary hover:bg-hover hover:text-primary"
                                onClick={resetToDefault}
                                title="Clear overrides and use the built-in prompt"
                            >
                                Reset to default
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4 p-4">
                        <section className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                                <label className="text-xs font-medium text-primary" htmlFor="ai-prompt-system">
                                    System prompt
                                </label>
                                <span className="text-xxs text-muted">Empty = built-in default</span>
                            </div>
                            <textarea
                                id="ai-prompt-system"
                                value={draft.systemPrompt}
                                rows={12}
                                spellCheck={false}
                                placeholder={meta.defaultPrompt || "Leave empty to use the built-in prompt"}
                                aria-label="System prompt"
                                onChange={(event) => patch({ systemPrompt: event.target.value })}
                                className="w-full resize-y rounded border border-border bg-panel px-2.5 py-2 font-mono text-xs leading-5 text-primary outline-none placeholder:text-muted focus:border-accent"
                            />
                        </section>

                        <section className="space-y-1.5">
                            <label className="text-xs font-medium text-primary" htmlFor="ai-prompt-extra">
                                Extra instructions
                            </label>
                            <textarea
                                id="ai-prompt-extra"
                                value={draft.extraInstructions}
                                rows={3}
                                spellCheck={false}
                                placeholder="Appended after the system prompt, e.g. reply in Chinese"
                                aria-label="Extra instructions"
                                onChange={(event) => patch({ extraInstructions: event.target.value })}
                                className="w-full resize-y rounded border border-border bg-panel px-2.5 py-2 font-mono text-xs leading-5 text-primary outline-none placeholder:text-muted focus:border-accent"
                            />
                        </section>

                        <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <label className="flex items-center gap-2 text-xs text-secondary">
                                <span className="w-28 shrink-0">Model</span>
                                <select
                                    value={draft.aiMode}
                                    aria-label="AI model"
                                    onChange={(event) => patch({ aiMode: event.target.value })}
                                    className="h-7 max-w-[240px] cursor-pointer rounded border border-border bg-panel px-1.5 text-xs text-primary outline-none focus:border-accent"
                                >
                                    <option value="">Auto (default mode)</option>
                                    {modeOptions.map(([key, config]) => (
                                        <option key={key} value={key}>
                                            {config["display:name"] || key}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {numberField("maxNoteChars")}
                            {numberField("maxTags")}
                            {numberField("maxTitleChars")}
                            <label className="flex items-center gap-2 text-xs text-secondary">
                                <Toggle
                                    checked={draft.enabled}
                                    onChange={(value) => patch({ enabled: value })}
                                    label=""
                                />
                                <span title="When off, the card button reports a disabled error">Enabled</span>
                            </label>
                        </section>

                        <details className="rounded border border-border bg-panel">
                            <summary className="cursor-pointer px-3 py-2 text-xs text-secondary hover:text-primary">
                                Preview resolved prompt
                            </summary>
                            <pre className="max-h-64 overflow-auto border-t border-border px-3 py-2 font-mono text-xxs whitespace-pre-wrap text-muted">
                                {preview}
                            </pre>
                        </details>
                    </div>
                </div>
            </div>
        </div>
    );
});