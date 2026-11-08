export type BlockRemovalAction =
    | { kind: "ux-close-block"; blockId: string }
    | { kind: "layout-close-block"; tabId: string; blockId: string }
    | { kind: "delete-block"; blockId: string };

export function planBlockRemoval(input: {
    tabId: string;
    blockId: string;
    staticTabId: string | null | undefined;
    hasNode: boolean;
    hasOnNodeDelete: boolean;
}): BlockRemovalAction {
    const tabId = input.tabId?.trim() ?? "";
    const blockId = input.blockId?.trim() ?? "";
    if (blockId === "") {
        return { kind: "delete-block", blockId };
    }
    if (tabId !== "" && tabId === input.staticTabId) {
        return { kind: "ux-close-block", blockId };
    }
    if (input.hasNode) {
        return { kind: "layout-close-block", tabId, blockId };
    }
    return { kind: "delete-block", blockId };
}
