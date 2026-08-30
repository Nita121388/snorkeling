// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Built-in block-editor registrations (方案 06): each capability = one register*() call
 * whose run() is a pure markdown-transform function. `ensureBuiltinBlockEditorCommands`
 * is idempotent; markdown.tsx calls it once at module scope. Future milestones add slash
 * commands (M2) and inline styles (M2) here.
 */

import { registerBlockAction } from "../registry";
import { builtinTurnIntoActions } from "./turn-into";

let registered = false;

export function ensureBuiltinBlockEditorCommands(): void {
    if (registered) {
        return;
    }
    registered = true;
    for (const action of builtinTurnIntoActions()) {
        registerBlockAction(action);
    }
}
