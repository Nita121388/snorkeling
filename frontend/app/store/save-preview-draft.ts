// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure resolver for the global Cmd/Ctrl+S handler (keymodel.saveFocusedPreviewDraft):
// decides whether the focused block is a preview model that can save to disk and
// returns its handleFileSave for the caller to fire. Kept dependency-free so the
// decision logic is unit-testable without pulling in the whole keymodel graph.

export interface PreviewSaveTargetViewModel {
    viewType?: string;
    handleFileSave?: () => Promise<void>;
}

export function resolvePreviewSaveTarget(
    focusedBlockId: string | null | undefined,
    getViewModel: (blockId: string) => { viewModel?: PreviewSaveTargetViewModel } | undefined
): PreviewSaveTargetViewModel | null {
    if (focusedBlockId == null || focusedBlockId === "") {
        return null;
    }
    const viewModel = getViewModel(focusedBlockId)?.viewModel;
    if (viewModel?.viewType !== "preview" || typeof viewModel.handleFileSave !== "function") {
        return null;
    }
    return viewModel;
}
