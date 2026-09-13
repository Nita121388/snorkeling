// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";
import type { WaveConfigViewModel } from "./waveconfig-model";

type Template = {
    id: string;
    label: string;
    provider: string;
    apiType: string;
    model: string;
    secret: string;
    endpoint?: string;
    note: string;
};

const templates: Template[] = [
    {
        id: "openai-responses",
        label: "OpenAI Responses",
        provider: "openai",
        apiType: "openai-responses",
        model: "gpt-5-mini",
        secret: "OPENAI_KEY",
        endpoint: "https://api.openai.com/v1/responses",
        note: "Newer OpenAI Responses API models. Replace the endpoint when using a proxy.",
    },
    {
        id: "openai-chat",
        label: "OpenAI Chat Completions",
        provider: "openai",
        apiType: "openai-chat",
        model: "gpt-4o",
        secret: "OPENAI_KEY",
        endpoint: "https://api.openai.com/v1/chat/completions",
        note: "OpenAI-compatible chat endpoints. Replace the endpoint when using a proxy.",
    },
    {
        id: "anthropic",
        label: "Anthropic Messages",
        provider: "anthropic",
        apiType: "anthropic-messages",
        model: "claude-sonnet-4-5",
        secret: "ANTHROPIC_KEY",
        endpoint: "https://api.anthropic.com/v1/messages",
        note: "Claude models through the Anthropic API. Replace the endpoint when using a compatible gateway.",
    },
    {
        id: "google-gemini",
        label: "Google Gemini",
        provider: "google",
        apiType: "google-gemini",
        model: "gemini-2.0-flash",
        secret: "GOOGLE_AI_KEY",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
        note: "Gemini models through Google AI. The model name is part of this endpoint.",
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        provider: "openrouter",
        apiType: "openai-chat",
        model: "anthropic/claude-3.5-sonnet",
        secret: "OPENROUTER_KEY",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        note: "Many models through one OpenAI-compatible endpoint.",
    },
    {
        id: "groq",
        label: "Groq",
        provider: "groq",
        apiType: "openai-chat",
        model: "llama-3.3-70b-versatile",
        secret: "GROQ_KEY",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        note: "Fast OpenAI-compatible inference.",
    },
    {
        id: "custom",
        label: "Custom OpenAI-compatible",
        provider: "custom",
        apiType: "openai-chat",
        model: "your-model",
        secret: "CUSTOM_AI_KEY",
        endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        note: "Ollama, LM Studio, vLLM, LiteLLM, or a private gateway",
    },
];

function templateJson(template: Template): string {
    const config: Record<string, string> = {
        "display:name": template.label,
        "ai:provider": template.provider,
        "ai:apitype": template.apiType,
        "ai:model": template.model,
        "ai:endpoint": template.endpoint ?? "",
        "ai:apitokensecretname": template.secret,
    };
    return JSON.stringify({ [`custom@${template.id}`]: config }, null, 2);
}

export const WaveAIVisualContent = memo(function WaveAIVisualContent({
    model,
}: {
    model: WaveConfigViewModel;
}) {
    const telemetryEnabled = useSettingsKeyAtom("telemetry:enabled") ?? false;
    const defaultMode = useSettingsKeyAtom("waveai:defaultmode") ?? "";
    const currentContent = useAtomValue(model.fileContentAtom);
    const [selectedTemplate, setSelectedTemplate] = useState(templates[0].id);
    const [copied, setCopied] = useState(false);

    const selected = useMemo(
        () => templates.find((template) => template.id === selectedTemplate) ?? templates[0],
        [selectedTemplate]
    );
    const selectedJson = useMemo(() => templateJson(selected), [selected]);

    const enableTelemetry = useCallback(() => {
        fireAndForget(() =>
            RpcApi.SetConfigCommand(TabRpcClient, { "telemetry:enabled": true } as SettingsType)
        );
    }, []);

    const setDefaultMode = useCallback(
        (mode: string) => {
            fireAndForget(() =>
                RpcApi.SetConfigCommand(TabRpcClient, { "waveai:defaultmode": mode } as SettingsType)
            );
        },
        []
    );

    const copyTemplate = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(selectedJson);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            setCopied(false);
        }
    }, [selectedJson]);

    const builtinModes = [
        { id: "waveai@quick", label: "Quick", model: "gpt-5-mini" },
        { id: "waveai@balanced", label: "Balanced", model: "gpt-5.1" },
        { id: "waveai@deep", label: "Deep", model: "gpt-5.1" },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 text-primary">
            <div>
                <h2 className="text-lg font-semibold">Wave AI setup</h2>
                <p className="mt-1 max-w-3xl text-sm text-secondary">
                    Configure which model Wave AI uses. Built-in Wave Cloud modes are already available; custom providers
                    use a secret stored in the system keychain.
                </p>
            </div>

            <section className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium">Built-in Wave Cloud modes</h3>
                        <p className="mt-1 text-xs text-secondary">Enable telemetry to use these modes.</p>
                    </div>
                    {telemetryEnabled ? (
                        <span className="rounded bg-accent/10 px-2 py-1 text-xs text-accent">Telemetry enabled</span>
                    ) : (
                        <button
                            type="button"
                            className="cursor-pointer rounded bg-action px-3 py-1.5 text-xs text-actiontext hover:bg-actionhover"
                            onClick={enableTelemetry}
                        >
                            Enable telemetry
                        </button>
                    )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {builtinModes.map((mode) => (
                        <button
                            key={mode.id}
                            type="button"
                            className={cn(
                                "cursor-pointer rounded border p-3 text-left hover:bg-hover",
                                defaultMode === mode.id ? "border-accent" : "border-border"
                            )}
                            onClick={() => setDefaultMode(mode.id)}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">{mode.label}</span>
                                {defaultMode === mode.id ? <span className="text-[10px] text-accent">Default</span> : null}
                            </div>
                            <div className="mt-1 text-xs text-secondary">{mode.id}</div>
                            <div className="mt-1 text-xs text-secondary">{mode.model}</div>
                        </button>
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium">Custom provider templates</h3>
                        <p className="mt-1 text-xs text-secondary">
                            Select a supported provider, copy its JSON, then paste it into the JSON tab. The endpoint is a full request URL, not only a hostname.
                        </p>
                    </div>
                    <select
                        className="cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-xs text-primary outline-none"
                        value={selectedTemplate}
                        onChange={(event) => setSelectedTemplate(event.target.value)}
                    >
                        {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                                {template.label}
                            </option>
                        ))}
                    </select>
                </div>
                <p className="mt-3 text-xs text-secondary">{selected.note}</p>
                <div className="mt-2 rounded border border-border/70 bg-black/10 p-2 text-xs text-secondary">
                    Endpoint: <code className="break-all text-primary">{selected.endpoint ?? "(enter your full request URL)"}</code>
                </div>
                <pre className="mt-2 max-h-52 overflow-auto rounded border border-border bg-black/10 p-3 text-xs text-primary">
                    {selectedJson}
                </pre>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border px-3 py-1.5 text-xs text-secondary hover:bg-hover hover:text-primary"
                        onClick={copyTemplate}
                    >
                        {copied ? "Copied" : "Copy JSON template"}
                    </button>
                    <span className="text-xs text-secondary">
                        Add <code className="text-primary">{selected.secret}</code> in the Secrets tab, then set the mode as default.
                    </span>
                </div>
            </section>

            <section className="rounded-lg border border-border/70 p-4 text-xs text-secondary">
                <h3 className="text-sm font-medium text-primary">How to use a custom model</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Copy a template above.</li>
                    <li>Open the JSON tab and merge it into <code className="text-primary">waveai.json</code>.</li>
                    <li>Open the Secrets tab and save the matching API key under the shown secret name.</li>
                    <li>Return here and click the mode card to make it the default.</li>
                </ol>
                {currentContent.trim() === "{}" ? (
                    <p className="mt-3 text-accent">Your current file is empty; the templates above are the starting point.</p>
                ) : null}
            </section>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";
