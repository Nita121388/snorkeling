// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openCommonTextSearch } from "@/app/commontext/commontext-events";

const CommonTextSearchWidgetAction = "commontext:search";

function runWidgetAction(action?: string): boolean {
    if (action == null || action === "") {
        return false;
    }
    switch (action) {
        case CommonTextSearchWidgetAction:
            openCommonTextSearch();
            return true;
        default:
            console.warn(`Unknown widget action: ${action}`);
            return false;
    }
}

export { CommonTextSearchWidgetAction, runWidgetAction };
