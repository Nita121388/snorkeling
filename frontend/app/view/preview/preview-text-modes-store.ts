// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Reactive wrapper around the pure per-extension HTML open-mode preference.
//
// Lives in its own module (not in preview-model.tsx) so both the PreviewModel and the
// open-entry helpers in preview-open.ts can read/write the same atom without the
// preview-model <-> preview-open module cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import {
    getDefaultHtmlOpenModeStorage,
    readHtmlOpenModeMap,
    resolveHtmlOpenModeFromMap,
    writeHtmlOpenModeMap,
    type HtmlOpenMode,
    type HtmlOpenModeMap,
} from "./preview-text-modes";

export const htmlOpenModePrefsAtom = atom<HtmlOpenModeMap>(readHtmlOpenModeMap(getDefaultHtmlOpenModeStorage()));

/** The mode that applies to `pathOrName` right now (remembered, else the default). */
export function getHtmlOpenMode(pathOrName: string | null | undefined): HtmlOpenMode {
    return resolveHtmlOpenModeFromMap(globalStore.get(htmlOpenModePrefsAtom), pathOrName);
}

/** Persist + publish one extension's mode. Returns the mode that ended up effective. */
export function setHtmlOpenMode(pathOrName: string | null | undefined, mode: HtmlOpenMode): HtmlOpenMode {
    const next = writeHtmlOpenModeMap(getDefaultHtmlOpenModeStorage(), pathOrName, mode);
    if (next != null) {
        globalStore.set(htmlOpenModePrefsAtom, next);
    }
    return mode;
}