import { atoms, getFocusedBlockId, globalStore } from "@/app/store/global";
import * as WOS from "@/app/store/wos";
import { isBlank } from "@/util/util";

const DefaultAgentCommand = "codex";

export const DefaultAgentWidgetId = "defwidget@agent";

export type AgentLaunchContext = {
    connection?: string | null;
    cwd?: string | null;
    inheritWorkspaceContext?: boolean;
};

type AgentContextMeta = Pick<MetaType, "connection" | "cmd:cwd">;

export type AgentLaunchTarget = {
    blockId: string;
    connection: string | null;
    cwd: string | null;
    isLocal: boolean;
    label: string;
    detail: string;
};

export type ResolveWorkspaceAgentContextParams = {
    focusedBlock?: Block | null;
    tab?: Tab | null;
    getBlockById?: (blockId: string) => Block | null | undefined;
};

export function extractTerminalContextMeta(block: Block | null | undefined): AgentContextMeta | null {
    if (block?.meta?.view !== "term") {
        return null;
    }
    const meta: AgentContextMeta = {};
    const connection = block.meta?.connection;
    const cwd = block.meta?.["cmd:cwd"];

    if (typeof connection === "string" && !isBlank(connection)) {
        meta.connection = connection;
    }
    if (typeof cwd === "string" && !isBlank(cwd)) {
        meta["cmd:cwd"] = cwd;
    }
    if (meta.connection == null && meta["cmd:cwd"] == null) {
        return null;
    }
    return meta;
}

function resolveLatestTerminalContextInTab(
    tab: Tab | null | undefined,
    getBlockById?: (blockId: string) => Block | null | undefined
): AgentContextMeta | null {
    if (tab == null || getBlockById == null) {
        return null;
    }
    const blockIds = tab.blockids ?? [];
    for (let idx = blockIds.length - 1; idx >= 0; idx--) {
        const blockId = blockIds[idx];
        if (isBlank(blockId)) {
            continue;
        }
        const block = getBlockById(blockId);
        const terminalMeta = extractTerminalContextMeta(block);
        if (terminalMeta != null) {
            return terminalMeta;
        }
    }
    return null;
}

export function resolveWorkspaceAgentContextMeta(params: ResolveWorkspaceAgentContextParams): AgentContextMeta {
    const focusedTerminalMeta = extractTerminalContextMeta(params.focusedBlock);
    if (focusedTerminalMeta != null) {
        return focusedTerminalMeta;
    }

    const latestTerminalMeta = resolveLatestTerminalContextInTab(params.tab, params.getBlockById);
    if (latestTerminalMeta != null) {
        return latestTerminalMeta;
    }

    const focusedConnection = params.focusedBlock?.meta?.connection;
    if (typeof focusedConnection === "string" && !isBlank(focusedConnection)) {
        return { connection: focusedConnection };
    }

    const tabConnection = params.tab?.meta?.connection;
    if (typeof tabConnection === "string" && !isBlank(tabConnection)) {
        return { connection: tabConnection };
    }

    return {};
}

export function collectAgentLaunchTargetsInTab(
    tab: Tab | null | undefined,
    getBlockById?: (blockId: string) => Block | null | undefined
): AgentLaunchTarget[] {
    if (tab == null || getBlockById == null) {
        return [];
    }
    const targets: AgentLaunchTarget[] = [];
    const blockIds = tab.blockids ?? [];

    for (const blockId of blockIds) {
        if (isBlank(blockId)) {
            continue;
        }
        const block = getBlockById(blockId);
        if (block?.meta?.view !== "term") {
            continue;
        }

        const rawConnection = block.meta?.connection;
        const connection = typeof rawConnection === "string" && !isBlank(rawConnection) ? rawConnection : null;
        const rawCwd = block.meta?.["cmd:cwd"];
        const cwd = typeof rawCwd === "string" && !isBlank(rawCwd) ? rawCwd : null;
        const shortBlockId = (block.oid ?? blockId).slice(0, 8);
        const isLocal = connection == null;
        const label = isLocal ? "local" : connection;
        const detail = cwd == null ? `block ${shortBlockId}` : `${cwd} • block ${shortBlockId}`;

        targets.push({
            blockId,
            connection,
            cwd,
            isLocal,
            label,
            detail,
        });
    }

    return targets;
}

export function getCurrentTabAgentLaunchTargets(): AgentLaunchTarget[] {
    const staticTabId = globalStore.get(atoms.staticTabId);
    if (isBlank(staticTabId)) {
        return [];
    }
    const tabData = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", staticTabId)));
    return collectAgentLaunchTargetsInTab(tabData, (blockId: string) =>
        globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)))
    );
}

function getCurrentWorkspaceContextMeta(): AgentContextMeta {
    const focusedBlockId = getFocusedBlockId();
    const focusedBlock = isBlank(focusedBlockId)
        ? null
        : globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId)));
    const staticTabId = globalStore.get(atoms.staticTabId);
    const tabData = isBlank(staticTabId)
        ? null
        : globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", staticTabId)));

    return resolveWorkspaceAgentContextMeta({
        focusedBlock,
        tab: tabData,
        getBlockById: (blockId: string) => globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))),
    });
}

function resolveContextMeta(context?: AgentLaunchContext): AgentContextMeta {
    const shouldInheritWorkspaceContext = context?.inheritWorkspaceContext ?? true;
    const meta = shouldInheritWorkspaceContext ? getCurrentWorkspaceContextMeta() : {};

    if (context?.connection !== undefined) {
        if (typeof context.connection === "string" && !isBlank(context.connection)) {
            meta.connection = context.connection;
        } else {
            delete meta.connection;
        }
    }
    if (context?.cwd !== undefined) {
        if (typeof context.cwd === "string" && !isBlank(context.cwd)) {
            meta["cmd:cwd"] = context.cwd;
        } else {
            delete meta["cmd:cwd"];
        }
    }

    return meta;
}

export function createDefaultAgentBlockDef(_settings?: SettingsType, context?: AgentLaunchContext): BlockDef {
    const contextMeta = resolveContextMeta(context);
    return {
        meta: {
            view: "term",
            controller: "cmd",
            cmd: DefaultAgentCommand,
            "cmd:shell": false,
            "cmd:runonstart": true,
            ...contextMeta,
        },
    };
}

export function createAgentBlockDefForTarget(settings: SettingsType | undefined, target: AgentLaunchTarget): BlockDef {
    return createDefaultAgentBlockDef(settings, {
        connection: target.connection,
        cwd: target.cwd,
        inheritWorkspaceContext: false,
    });
}
