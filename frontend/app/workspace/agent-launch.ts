import { atoms, getFocusedBlockId, globalStore } from "@/app/store/global";
import * as WOS from "@/app/store/wos";
import { isBlank } from "@/util/util";

const DefaultAgentCommand = "codex";
const DefaultAgentProfile = "codex";
const DefaultModelFlag = "--model";
const AgentAutoResumeMetaKey = "agent:autoresume";
const AgentProviderMetaKey = "agent:provider";

export const DefaultAgentWidgetId = "defwidget@agent";

export type AgentLaunchContext = {
    connection?: string | null;
    cwd?: string | null;
    inheritWorkspaceContext?: boolean;
};

type AgentContextMeta = Pick<MetaType, "connection" | "cmd:cwd">;

type AgentProfileConfig = {
    cmd?: string;
    args?: string[];
    model?: string;
    modelflag?: string;
    env?: Record<string, string>;
};

const BuiltinAgentProfiles: Record<string, AgentProfileConfig> = {
    codex: {
        cmd: "codex",
        modelflag: "--model",
    },
    claude: {
        cmd: "claude",
        modelflag: "--model",
    },
    gemini: {
        cmd: "gemini",
        modelflag: "--model",
    },
    opencode: {
        cmd: "opencode",
        modelflag: "--model",
    },
};

export type AgentLaunchTarget = {
    blockId: string;
    connection: string | null;
    cwd: string | null;
    isLocal: boolean;
    label: string;
    detail: string;
};

function sanitizeArgs(args: unknown): string[] {
    if (!Array.isArray(args)) {
        return [];
    }
    return args.filter((arg): arg is string => typeof arg === "string" && !isBlank(arg));
}

function sanitizeEnv(env: unknown): Record<string, string> {
    if (env == null || typeof env !== "object") {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (!isBlank(key) && typeof value === "string") {
            result[key] = value;
        }
    }
    return result;
}

function extractCommandBaseName(cmd: string): string {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) {
        return "";
    }
    const slashNormalized = trimmed.replace(/\\/g, "/");
    const parts = slashNormalized.split("/");
    const lastPart = parts[parts.length - 1] ?? "";
    return lastPart.toLowerCase();
}

function normalizeProfile(rawProfile: unknown): AgentProfileConfig | null {
    if (rawProfile == null || typeof rawProfile !== "object") {
        return null;
    }
    const profile = rawProfile as Record<string, unknown>;
    const normalized: AgentProfileConfig = {};

    if (typeof profile.cmd === "string" && !isBlank(profile.cmd)) {
        normalized.cmd = profile.cmd.trim();
    }
    const args = sanitizeArgs(profile.args);
    if (args.length > 0) {
        normalized.args = args;
    }
    if (typeof profile.model === "string" && !isBlank(profile.model)) {
        normalized.model = profile.model.trim();
    }
    if (typeof profile.modelflag === "string" && !isBlank(profile.modelflag)) {
        normalized.modelflag = profile.modelflag.trim();
    }
    const env = sanitizeEnv(profile.env);
    if (Object.keys(env).length > 0) {
        normalized.env = env;
    }
    return normalized;
}

function getProfileConfig(settings?: SettingsType): AgentProfileConfig {
    const defaultProfileName = isBlank(settings?.["agent:defaultprofile"])
        ? DefaultAgentProfile
        : settings["agent:defaultprofile"]?.trim();
    const builtInProfile = BuiltinAgentProfiles[defaultProfileName] ?? BuiltinAgentProfiles[DefaultAgentProfile];
    const rawProfiles = settings?.["agent:profiles"];
    const rawSelected = rawProfiles?.[defaultProfileName];
    const selectedProfile = normalizeProfile(rawSelected);

    return {
        ...builtInProfile,
        ...selectedProfile,
        args: selectedProfile?.args ?? builtInProfile.args,
        env: selectedProfile?.env ?? builtInProfile.env,
    };
}

function resolveAgentProvider(settings?: SettingsType, cmd?: string): string {
    if (!isBlank(cmd)) {
        return extractCommandBaseName(cmd!);
    }
    const defaultProfileName = isBlank(settings?.["agent:defaultprofile"])
        ? DefaultAgentProfile
        : settings?.["agent:defaultprofile"]?.trim().toLowerCase();
    if (!isBlank(defaultProfileName)) {
        return defaultProfileName!;
    }
    return DefaultAgentProfile;
}

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

export function createDefaultAgentBlockDef(settings?: SettingsType, context?: AgentLaunchContext): BlockDef {
    const contextMeta = resolveContextMeta(context);
    const profile = getProfileConfig(settings);
    const cmd = !isBlank(profile.cmd) ? profile.cmd : DefaultAgentCommand;
    const provider = resolveAgentProvider(settings, cmd);
    const cmdArgs = sanitizeArgs(profile.args);
    const model = !isBlank(profile.model) ? profile.model : null;
    const modelFlag = !isBlank(profile.modelflag) ? profile.modelflag : DefaultModelFlag;
    if (model != null) {
        if (!isBlank(modelFlag)) {
            cmdArgs.push(modelFlag, model);
        } else {
            cmdArgs.push(model);
        }
    }
    const cmdEnv = sanitizeEnv(profile.env);

    const blockMeta: MetaType = {
        view: "term",
        controller: "cmd",
        cmd,
        "cmd:shell": false,
        "cmd:runonstart": true,
        ...contextMeta,
    };
    if (cmdArgs.length > 0) {
        blockMeta["cmd:args"] = cmdArgs;
    }
    if (Object.keys(cmdEnv).length > 0) {
        blockMeta["cmd:env"] = cmdEnv;
    }
    const blockMetaRecord = blockMeta as Record<string, unknown>;
    blockMetaRecord[AgentAutoResumeMetaKey] = true;
    blockMetaRecord[AgentProviderMetaKey] = provider;

    return {
        meta: blockMeta,
    };
}

export function createAgentBlockDefForTarget(settings: SettingsType | undefined, target: AgentLaunchTarget): BlockDef {
    return createDefaultAgentBlockDef(settings, {
        connection: target.connection,
        cwd: target.cwd,
        inheritWorkspaceContext: false,
    });
}
