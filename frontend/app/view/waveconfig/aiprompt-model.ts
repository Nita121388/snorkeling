// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI Prompts settings model.
//
// Pure helpers (draft merge / payload build / preview) live here so the settings
// page stays a thin view and the behavior is unit-testable without jsdom. The
// only stateful part is the file write, which follows the same serialized-write
// pattern as waveai-modes.ts: update the local projection, then append the whole
// file to a promise queue so rapid keystrokes cannot reorder writes.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { stringToBase64 } from "@/util/util";

/** Feature keys are backend-defined; keep them in sync with promptregistry.go. */
export const PROMPT_FEATURE_SESSION_NOTE_TAGS = "session-note-tags";
export const PROMPT_FEATURE_SESSION_TITLE = "session-title";
export const PROMPT_FEATURE_SESSION_ANNOTATIONS = "session-annotations";

export const PROMPT_FEATURE_ORDER = [
    PROMPT_FEATURE_SESSION_NOTE_TAGS,
    PROMPT_FEATURE_SESSION_TITLE,
    PROMPT_FEATURE_SESSION_ANNOTATIONS,
];

/** Fallback metadata used before PromptTemplates resolves (and for unknown keys). */
export const PROMPT_FEATURE_FALLBACKS: Record<string, PromptFeatureMeta> = {
    [PROMPT_FEATURE_SESSION_NOTE_TAGS]: {
        key: PROMPT_FEATURE_SESSION_NOTE_TAGS,
        displayName: "Session Note & Tags",
        description: "Generate a summary note and topic tags for an agent session.",
        defaultPrompt: "",
        parameters: [
            { key: "maxNoteChars", label: "Max note chars", defaultValue: 160, min: 40, max: 2000 },
            { key: "maxTags", label: "Max tags", defaultValue: 5, min: 1, max: 10 },
        ],
    },
    [PROMPT_FEATURE_SESSION_TITLE]: {
        key: PROMPT_FEATURE_SESSION_TITLE,
        displayName: "Session Title",
        description: "Propose a short title for an agent session; applied only after confirmation.",
        defaultPrompt: "",
        parameters: [{ key: "maxTitleChars", label: "Max title chars", defaultValue: 40, min: 10, max: 120 }],
    },
    [PROMPT_FEATURE_SESSION_ANNOTATIONS]: {
        key: PROMPT_FEATURE_SESSION_ANNOTATIONS,
        displayName: "Session Annotations",
        description: "Draft node-level annotations for an agent session; saved as drafts for review.",
        defaultPrompt: "",
        parameters: [
            { key: "maxAnnotations", label: "Max annotations", defaultValue: 12, min: 1, max: 30 },
            { key: "maxBodyChars", label: "Max body chars", defaultValue: 600, min: 40, max: 2000 },
            { key: "maxTags", label: "Max tags", defaultValue: 5, min: 1, max: 10 },
        ],
    },
};

export type PromptDraft = {
    systemPrompt: string;
    extraInstructions: string;
    aiMode: string;
    maxNoteChars: number;
    maxTags: number;
    maxTitleChars: number;
    maxAnnotations: number;
    maxBodyChars: number;
    enabled: boolean;
};

export function parameterDefault(meta: PromptFeatureMeta, key: string): number {
    return meta.parameters.find((p) => p.key === key)?.defaultValue ?? 0;
}

/** Stored config for a feature, or an empty object. */
export function getStoredPromptConfig(feature: string): AIPromptConfigType {
    const prompts = globalStore.get(atoms.fullConfigAtom)?.aiprompts;
    return prompts?.[feature] ?? {};
}

/** True when the user has any override for the feature (used for the list dot). */
export function hasPromptOverride(feature: string): boolean {
    const cfg = getStoredPromptConfig(feature);
    return (
        (cfg.systemPrompt ?? "") !== "" ||
        (cfg.extraInstructions ?? "") !== "" ||
        (cfg.aiMode ?? "") !== "" ||
        (cfg.maxNoteChars ?? 0) !== 0 ||
        (cfg.maxTags ?? 0) !== 0 ||
        (cfg.maxTitleChars ?? 0) !== 0 ||
        (cfg.maxAnnotations ?? 0) !== 0 ||
        (cfg.maxBodyChars ?? 0) !== 0 ||
        cfg.enabled === false
    );
}

/** Merge stored overrides with built-in defaults for the edit form. */
export function resolvePromptDraft(stored: AIPromptConfigType, meta: PromptFeatureMeta): PromptDraft {
    return {
        systemPrompt: stored.systemPrompt ?? "",
        extraInstructions: stored.extraInstructions ?? "",
        aiMode: stored.aiMode ?? "",
        maxNoteChars: stored.maxNoteChars || parameterDefault(meta, "maxNoteChars"),
        maxTags: stored.maxTags || parameterDefault(meta, "maxTags"),
        maxTitleChars: stored.maxTitleChars || parameterDefault(meta, "maxTitleChars"),
        maxAnnotations: stored.maxAnnotations || parameterDefault(meta, "maxAnnotations"),
        maxBodyChars: stored.maxBodyChars || parameterDefault(meta, "maxBodyChars"),
        enabled: stored.enabled !== false,
    };
}

/**
 * Build the payload written to aiprompts.json.
 *
 * Fields equal to the built-in default are omitted so the file stays readable
 * and deleting a key restores default behavior. A disabled feature is kept as an
 * explicit `enabled: false` (it is not the default).
 */
export function buildPromptPayload(draft: PromptDraft, meta: PromptFeatureMeta): AIPromptConfigType {
    const payload: AIPromptConfigType = {};
    const systemPrompt = draft.systemPrompt.trim();
    if (systemPrompt !== "") {
        payload.systemPrompt = draft.systemPrompt;
    }
    const extra = draft.extraInstructions.trim();
    if (extra !== "") {
        payload.extraInstructions = draft.extraInstructions;
    }
    if (draft.aiMode.trim() !== "") {
        payload.aiMode = draft.aiMode.trim();
    }
    if (draft.maxNoteChars !== parameterDefault(meta, "maxNoteChars") && draft.maxNoteChars > 0) {
        payload.maxNoteChars = draft.maxNoteChars;
    }
    if (draft.maxTags !== parameterDefault(meta, "maxTags") && draft.maxTags > 0) {
        payload.maxTags = draft.maxTags;
    }
    if (draft.maxTitleChars !== parameterDefault(meta, "maxTitleChars") && draft.maxTitleChars > 0) {
        payload.maxTitleChars = draft.maxTitleChars;
    }
    if (draft.maxAnnotations !== parameterDefault(meta, "maxAnnotations") && draft.maxAnnotations > 0) {
        payload.maxAnnotations = draft.maxAnnotations;
    }
    if (draft.maxBodyChars !== parameterDefault(meta, "maxBodyChars") && draft.maxBodyChars > 0) {
        payload.maxBodyChars = draft.maxBodyChars;
    }
    if (!draft.enabled) {
        payload.enabled = false;
    }
    return payload;
}

export function isEmptyPromptPayload(payload: AIPromptConfigType): boolean {
    return Object.keys(payload).length === 0;
}

/**
 * Approximate the backend ResolvePrompt output for the live preview. Kept in one
 * place so the UI never hand-rolls string concatenation.
 */
export function previewPrompt(draft: PromptDraft, meta: PromptFeatureMeta): string {
    const base = draft.systemPrompt.trim() !== "" ? draft.systemPrompt : meta.defaultPrompt;
    let out = base.trimEnd();
    if (draft.extraInstructions.trim() !== "") {
        out += "\n\nAdditional instructions:\n" + draft.extraInstructions.trim();
    }
    // PromptTemplates may already include the limits (older/newer backend), or the
    // user may have pasted them. Strip trailing limit lines before appending the
    // authoritative one, so the preview never shows the constraint twice.
    out = out.replace(/(\n\nHard limits?: [^\n]*)+$/, "").trimEnd();
    if (meta.key === PROMPT_FEATURE_SESSION_NOTE_TAGS) {
        out += `\n\nHard limits: note <= ${draft.maxNoteChars} characters; tags <= ${draft.maxTags}.`;
    } else if (meta.key === PROMPT_FEATURE_SESSION_TITLE) {
        out += `\n\nHard limit: title <= ${draft.maxTitleChars} characters.`;
    }
    return out;
}

// Serialize file writes. A rejection must not poison the queue, or one failed
// save would silently disable every later save in this page session.
let writeQueue = Promise.resolve();

/**
 * Persist one feature's prompt config. The whole aiprompts.json is rewritten
 * (config files have no partial update), so the current map is read fresh from
 * the atom each time instead of being snapshotted at mount.
 */
/** Synchronously flush a pending draft before switching features. */
export function flushPromptDraft(
    model: WaveConfigViewModel,
    feature: string,
    meta: PromptFeatureMeta,
    draft: PromptDraft
): Promise<void> {
    return savePromptConfig(model, feature, buildPromptPayload(draft, meta));
}

export function savePromptConfig(
    model: WaveConfigViewModel,
    feature: string,
    payload: AIPromptConfigType
): Promise<void> {
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const current = fullConfig?.aiprompts ?? {};
    const next = { ...current };
    if (isEmptyPromptPayload(payload)) {
        delete next[feature];
    } else {
        next[feature] = payload;
    }
    globalStore.set(atoms.fullConfigAtom, { ...fullConfig, aiprompts: next } as FullConfigType);

    const fullPath = `${model.configDir}/aiprompts.json`;
    const data64 = stringToBase64(JSON.stringify(next, null, 2) + "\n");
    const write = writeQueue.then(() =>
        model.env.rpc.FileWriteCommand(TabRpcClient, {
            info: { path: fullPath, mimetype: "application/json" },
            data64,
        })
    );
    // Keep the chain alive for the next caller, but hand the real result (and
    // the real failure) to this one.
    writeQueue = write.then(
        () => {},
        () => {}
    );
    return write;
}
