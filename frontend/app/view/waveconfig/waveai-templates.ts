// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave AI provider templates used by the visual editor's "add mode" flow.
// Each template maps to an AIModeConfigType fragment; applying it creates a
// custom@<id> mode that the user can then edit (endpoint, model, secret, ...).

export type WaveAITemplate = {
    id: string;
    label: string;
    provider: string;
    apiType: string;
    model: string;
    secret: string;
    endpoint?: string;
    note: string;
};

export const WaveAITemplates: WaveAITemplate[] = [
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

export function templateToAIMode(template: WaveAITemplate): AIModeConfigType {
    return {
        "display:name": template.label,
        "ai:provider": template.provider,
        "ai:apitype": template.apiType,
        "ai:model": template.model,
        "ai:endpoint": template.endpoint ?? "",
        "ai:apitokensecretname": template.secret,
    };
}

export function templateModeKey(template: WaveAITemplate): string {
    return `custom@${template.id}`;
}