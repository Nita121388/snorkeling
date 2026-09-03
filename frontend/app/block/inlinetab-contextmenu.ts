// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockEnv } from "./blockenv";

// 锁定标签 meta key: 仅作为标记, 不拦截正常关闭; 仅用于「关闭其他/全部(锁定除外)」时保留。
export const BlockLockMetaKey = "block:lock";

export function buildInlineTabContextMenu(
    blockId: string,
    blockIds: string[],
    lockedBlockIds: Set<string>,
    onClose: () => void,
    onCloseOthers: () => void,
    onCloseOthersExceptLocked: () => void,
    onCloseAll: () => void,
    onCloseAllExceptLocked: () => void,
    onToggleLock: () => void,
    onMinimizeGroup: () => void,
    env: BlockEnv,
): ContextMenuItem[] {
    const isLocked = lockedBlockIds.has(blockId);
    const hasLockedOther = blockIds.some((id) => id !== blockId && lockedBlockIds.has(id));
    const hasLocked = lockedBlockIds.size > 0;
    const menu: ContextMenuItem[] = [];
    menu.push({ label: "锁定标签", type: "checkbox", checked: isLocked, click: onToggleLock });
    menu.push({ type: "separator" });
    menu.push({ label: "关闭", click: onClose });
    if (blockIds.length >= 2) {
        menu.push({ label: "关闭其他", click: onCloseOthers });
        // 仅当存在其它锁定标签时显示, 否则与「关闭其他」行为完全相同, 避免菜单冗余。
        if (hasLockedOther) {
            menu.push({ label: "关闭其他（锁定除外）", click: onCloseOthersExceptLocked });
        }
    }
    menu.push({ label: "关闭全部", click: onCloseAll });
    if (hasLocked) {
        menu.push({ label: "关闭全部（锁定除外）", click: onCloseAllExceptLocked });
    }
    menu.push({ label: "复制 BlockId", click: () => navigator.clipboard.writeText(blockId) });
    if (blockIds.length >= 2) {
        menu.push({ type: "separator" });
        menu.push({ label: "Minimize Group to BlockBar", click: onMinimizeGroup });
    }
    return menu;
}
