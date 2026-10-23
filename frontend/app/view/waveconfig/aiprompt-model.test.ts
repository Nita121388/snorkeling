// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildPromptPayload,
    isEmptyPromptPayload,
    previewPrompt,
    resolvePromptDraft,
    PROMPT_FEATURE_FALLBACKS,
    PROMPT_FEATURE_SESSION_NOTE_TAGS,
    PROMPT_FEATURE_SESSION_TITLE,
} from "./aiprompt-model";

const LIMIT_LINE = "Hard limits: note <= 160 characters; tags <= 5.";
const noteMeta = PROMPT_FEATURE_FALLBACKS[PROMPT_FEATURE_SESSION_NOTE_TAGS];
// Runtime shape: PromptTemplates returns the *raw* default and the page appends
// the hard limits once. A default that already embeds the limits is the shape
// that used to duplicate them in the preview.
const noteMetaWithLimits: PromptFeatureMeta = {
    ...noteMeta,
    defaultPrompt: "BASE\n\n" + LIMIT_LINE,
};
const titleMeta = PROMPT_FEATURE_FALLBACKS[PROMPT_FEATURE_SESSION_TITLE];

describe("resolvePromptDraft", () => {
    it("fills built-in defaults when nothing is stored", () => {
        const draft = resolvePromptDraft({}, noteMeta);
        expect(draft.systemPrompt).toBe("");
        expect(draft.maxNoteChars).toBe(160);
        expect(draft.maxTags).toBe(5);
        expect(draft.enabled).toBe(true);
    });

    it("keeps stored overrides", () => {
        const draft = resolvePromptDraft(
            { systemPrompt: "custom", maxNoteChars: 320, maxTags: 8, enabled: false },
            noteMeta
        );
        expect(draft.systemPrompt).toBe("custom");
        expect(draft.maxNoteChars).toBe(320);
        expect(draft.maxTags).toBe(8);
        expect(draft.enabled).toBe(false);
    });

    it("uses the title default for the title feature", () => {
        const draft = resolvePromptDraft({}, titleMeta);
        expect(draft.maxTitleChars).toBe(40);
        expect(draft.maxNoteChars).toBe(0);
    });
});

describe("buildPromptPayload", () => {
    it("omits fields equal to the defaults", () => {
        const draft = resolvePromptDraft({}, noteMeta);
        const payload = buildPromptPayload(draft, noteMeta);
        expect(payload).toEqual({});
        expect(isEmptyPromptPayload(payload)).toBe(true);
    });

    it("keeps overrides and trims mode", () => {
        const payload = buildPromptPayload(
            {
                systemPrompt: "custom",
                extraInstructions: "zh",
                aiMode: " custom@x ",
                maxNoteChars: 200,
                maxTags: 5,
                maxTitleChars: 0,
                enabled: true,
            },
            noteMeta
        );
        expect(payload).toEqual({
            systemPrompt: "custom",
            extraInstructions: "zh",
            aiMode: "custom@x",
            maxNoteChars: 200,
        });
        expect(payload.maxTags).toBeUndefined();
    });

    it("keeps an explicit disabled flag", () => {
        const draft = resolvePromptDraft({}, noteMeta);
        const payload = buildPromptPayload({ ...draft, enabled: false }, noteMeta);
        expect(payload).toEqual({ enabled: false });
    });

    it("omits whitespace-only prompts", () => {
        const draft = { ...resolvePromptDraft({}, noteMeta), systemPrompt: "   ", extraInstructions: "\n" };
        expect(buildPromptPayload(draft, noteMeta)).toEqual({});
    });
});

describe("previewPrompt", () => {
    it("appends hard limits for note/tags", () => {
        const draft = resolvePromptDraft({ systemPrompt: "BASE" }, noteMeta);
        const preview = previewPrompt(draft, noteMeta);
        expect(preview).toContain("BASE");
        expect(preview).toContain(LIMIT_LINE);
    });

    it("appends the title limit", () => {
        const draft = resolvePromptDraft({}, titleMeta);
        const preview = previewPrompt(draft, titleMeta);
        expect(preview).toContain("title <= 40 characters");
    });

    it("adds extra instructions after the base prompt", () => {
        const draft = resolvePromptDraft({ systemPrompt: "BASE", extraInstructions: "中文" }, noteMeta);
        const preview = previewPrompt(draft, noteMeta);
        expect(preview.indexOf("Additional instructions")).toBeGreaterThan(preview.indexOf("BASE"));
        expect(preview).toContain("中文");
    });

    it("does not duplicate limits when the default already carries them", () => {
        const draft = resolvePromptDraft({}, noteMetaWithLimits);
        const preview = previewPrompt(draft, noteMetaWithLimits);
        expect(preview.split(LIMIT_LINE).length - 1).toBe(1);
    });

    it("keeps a single limit line after the tag bound is raised", () => {
        const draft = resolvePromptDraft({}, noteMetaWithLimits);
        const preview = previewPrompt({ ...draft, maxTags: 8 }, noteMetaWithLimits);
        expect(preview.split("Hard limits: note <= 160 characters; tags <= 8.").length - 1).toBe(1);
        expect(preview).not.toContain("tags <= 5");
    });
});