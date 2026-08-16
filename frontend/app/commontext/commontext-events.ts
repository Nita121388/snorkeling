// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommonTextItem } from "./commontext-model";

export const OpenCommonTextSearchEvent = "snorkeling:common-text:open-search";

export type CommonTextSearchDetail = {
    query?: string;
    mode?: "insert-or-copy" | "copy";
    onSelect?: (item: CommonTextItem) => void;
    editItemId?: string;
};

export function openCommonTextSearch(detail: CommonTextSearchDetail = {}): void {
    window.dispatchEvent(new CustomEvent<CommonTextSearchDetail>(OpenCommonTextSearchEvent, { detail }));
}
