// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { templateModeKey, templateToAIMode, WaveAITemplates } from "@/app/view/waveconfig/waveai-templates";
import { describe, expect, it } from "vitest";

describe("waveai templates", () => {
    it("provides distinct template ids and mode keys", () => {
        const ids = WaveAITemplates.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const t of WaveAITemplates) {
            const key = templateModeKey(t);
            expect(key.startsWith("custom@")).toBe(true);
            expect(key).toBe(`custom@${t.id}`);
        }
    });

    it("maps a template to a valid AIModeConfigType fragment", () => {
        const t = WaveAITemplates.find((x) => x.id === "openai-responses")!;
        const cfg = templateToAIMode(t);
        expect(cfg["display:name"]).toBe("OpenAI Responses");
        expect(cfg["ai:provider"]).toBe("openai");
        expect(cfg["ai:apitype"]).toBe("openai-responses");
        expect(cfg["ai:model"]).toBe("gpt-5-mini");
        expect(cfg["ai:endpoint"]).toContain("api.openai.com");
        expect(cfg["ai:apitokensecretname"]).toBe("OPENAI_KEY");
    });

    it("carries a full endpoint for every template", () => {
        for (const t of WaveAITemplates) {
            expect(t.endpoint, t.id).toBeTruthy();
        }
    });

    it("covers the api types the editor offers", () => {
        const apiTypes = new Set(WaveAITemplates.map((t) => t.apiType));
        expect(apiTypes.has("openai-responses")).toBe(true);
        expect(apiTypes.has("openai-chat")).toBe(true);
        expect(apiTypes.has("anthropic-messages")).toBe(true);
        expect(apiTypes.has("google-gemini")).toBe(true);
    });
});
