// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockEnv } from "./blockenv";

export function buildInlineTabContextMenu(
    blockId: string,
    blockIds: string[],
    onCloseCurrent: () => void,
    onCloseOthers: () => void,
    onCloseAll: () => void,
    env: BlockEnv,
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    menu.push({ label: "关闭", click: onCloseCurrent });
    if (blockIds.length >= 2) {
        menu.push({ label: "关闭其他", click: onCloseOthers });
    }
    menu.push(
        { label: "关闭全部", click: onCloseAll },
        { type: "separator" },
        { label: "复制 BlockId", click: () => navigator.clipboard.writeText(blockId) },
    );
    return menu;
}
