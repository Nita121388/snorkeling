// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { i18n } from "@/i18n/config";
import { localeTextAtom } from "@/i18n/i18nmodel";
import { atom } from "jotai";
import { blockViewToIcon, blockViewToNameKey } from "./blockutil";

const BlockRegistry: Map<string, ViewModelClass> = new Map();

function registerViewModel(viewType: string, ctor: ViewModelClass): void {
    BlockRegistry.set(viewType, ctor);
}

function makeDefaultViewModel(viewType: string): ViewModel {
    // The display name must stay reactive: a default model is created once per
    // block, so a literal `atom(blockViewToName(viewType))` would pin the locale
    // that was active when the block opened. `localeTextAtom` re-resolves the
    // key on every `ui:locale` change.
    const titleKey = blockViewToNameKey(viewType);
    const viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom(blockViewToIcon(viewType)),
        viewName: titleKey == null ? atom(viewType) : localeTextAtom(() => i18n.t(titleKey as never)),
        preIconButton: atom(null),
        endIconButtons: atom(null),
        viewComponent: null,
    };
    return viewModel;
}

function makeViewModel(
    blockId: string,
    blockView: string,
    nodeModel: BlockNodeModel,
    tabModel: TabModel,
    waveEnv: WaveEnv
): ViewModel {
    const ctor = BlockRegistry.get(blockView);
    if (ctor != null) {
        return new ctor({ blockId, nodeModel, tabModel, waveEnv });
    }
    return makeDefaultViewModel(blockView);
}

export { makeViewModel, registerViewModel };
