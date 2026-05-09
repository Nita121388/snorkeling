// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

type BlockMoveMenuItemsContextValue = {
    getMoveMenuItems: () => ContextMenuItem[];
};

const BlockMoveMenuItemsContext = React.createContext<BlockMoveMenuItemsContextValue>(null);

export const BlockMoveMenuItemsProvider = BlockMoveMenuItemsContext.Provider;

export function useBlockMoveMenuItems(): ContextMenuItem[] {
    return React.useContext(BlockMoveMenuItemsContext)?.getMoveMenuItems?.() ?? [];
}

export function appendBlockMoveMenuItems(menu: ContextMenuItem[], moveItems: ContextMenuItem[]): ContextMenuItem[] {
    if (!moveItems?.length) {
        return menu;
    }
    return [...menu, { type: "separator" }, ...moveItems];
}
