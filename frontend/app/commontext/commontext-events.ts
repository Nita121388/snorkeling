// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommonTextItem } from "./commontext-model";

export const OpenCommonTextSearchEvent = "snorkeling:common-text:open-search";

export type CommonTextSearchDetail = {
    query?: string;
    mode?: "insert-or-copy" | "copy";
    onSelect?: (item: CommonTextItem) => void;
};

export function openCommonTextSearch(detail: CommonTextSearchDetail = {}): void {
    window.dispatchEvent(new CustomEvent<CommonTextSearchDetail>(OpenCommonTextSearchEvent, { detail }));
}

export const OpenCommonTextSaveDialogEvent = "snorkeling:common-text:open-save-dialog";

export type CommonTextSaveDialogDetail = {
    /** Pre-fill the text body (e.g. extracted from the editor or a selection). */
    text?: string;
    /** Pre-fill the title (defaults to the first non-empty line of `text`). */
    title?: string;
    /** If editing an existing item instead of creating a new one, pass its id. */
    existingId?: string;
};

export function openCommonTextSaveDialog(detail: CommonTextSaveDialogDetail = {}): void {
    window.dispatchEvent(new CustomEvent<CommonTextSaveDialogDetail>(OpenCommonTextSaveDialogEvent, { detail }));
}
