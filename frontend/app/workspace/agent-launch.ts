import { atoms, getApi, getFocusedBlockId, globalStore } from "@/app/store/global";
import * as WOS from "@/app/store/wos";
import { PreviewExplorerRootMetaKey } from "@/app/view/preview/preview-navigation";
import { isBlank } from "@/util/util";

const DefaultAgentCommand = "codex";
const DefaultAgentProfile = "codex";
const DefaultModelFlag = "--model";
const AgentAutoResumeMetaKey = "agent:autoresume";
const AgentProviderMetaKey = "agent:provider";
const DefaultHomeLaunchTargetBlockId = "launch-target:home";
const DefaultHomeLaunchTargetCwd = "~";

export const DefaultAgentWidgetId = "defwidget@agent";
export const DefaultTerminalWidgetId = "defwidget@terminal";

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

type AgentLaunchSource = "terminal" | "files" | "agent" | "home";

export type AgentLaunchTarget = {
    blockId: string;
    connection: string | null;
    cwd: string | null;
    filePath?: string | null;
    source: AgentLaunchSource;
    isLocal: boolean;
    label: string;
    detail: string;
};

type CollectLaunchTargetsOptions = {
    localHomeDir?: string | null;
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
    return lastPart.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
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

function getProfileConfig(settings?: SettingsType, profileName?: string): AgentProfileConfig {
    const selectedProfileName = isBlank(profileName)
        ? isBlank(settings?.["agent:defaultprofile"])
            ? DefaultAgentProfile
            : settings["agent:defaultprofile"]?.trim()
        : profileName.trim();
    const builtInProfile = BuiltinAgentProfiles[selectedProfileName] ?? BuiltinAgentProfiles[DefaultAgentProfile];
    const rawProfiles = settings?.["agent:profiles"];
    const rawSelected = rawProfiles?.[selectedProfileName];
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

function normalizeConnection(rawConnection: unknown): string | null {
    if (typeof rawConnection !== "string" || isBlank(rawConnection)) {
        return null;
    }
    return rawConnection.trim();
}

function normalizePath(rawPath: unknown): string | null {
    if (typeof rawPath !== "string" || isBlank(rawPath)) {
        return null;
    }
    const trimmed = rawPath.trim();
    if (trimmed === "/") {
        return trimmed;
    }
    return trimmed.replace(/\/+$/, "");
}

function normalizeDedupPathSeparators(path: string): string {
    return path.replace(/\\/g, "/");
}

function normalizeLocalHomeDir(rawHomeDir: string | null | undefined): string | null {
    const normalizedHomeDir = normalizePath(rawHomeDir);
    if (normalizedHomeDir == null) {
        return null;
    }
    const dedupHomeDir = normalizeDedupPathSeparators(normalizedHomeDir);
    if (getTildePathSuffix(dedupHomeDir) != null) {
        return null;
    }
    return dedupHomeDir;
}

function getTildePathSuffix(path: string): string | null {
    if (path === "~") {
        return "";
    }
    if (path.startsWith("~/")) {
        return path.slice(2);
    }
    return null;
}

function inferLocalHomeDirsFromLaunchTargets(
    targets: AgentLaunchTarget[],
    explicitLocalHomeDir?: string | null
): string[] {
    const homeDirs = new Set<string>();
    const absolutePaths: string[] = [];
    const tildeSuffixes: string[] = [];
    const normalizedExplicitHomeDir = normalizeLocalHomeDir(explicitLocalHomeDir);
    if (normalizedExplicitHomeDir != null) {
        homeDirs.add(normalizedExplicitHomeDir);
    }

    for (const target of targets) {
        if (!target.isLocal) {
            continue;
        }
        for (const path of getLaunchTargetPathCandidates(target)) {
            const normalizedPath = normalizePath(path);
            if (normalizedPath == null) {
                continue;
            }
            const dedupPath = normalizeDedupPathSeparators(normalizedPath);
            const tildeSuffix = getTildePathSuffix(dedupPath);
            if (tildeSuffix != null) {
                tildeSuffixes.push(tildeSuffix);
                continue;
            }
            if (!dedupPath.startsWith("/") && !/^[A-Za-z]:\//.test(dedupPath)) {
                continue;
            }
            absolutePaths.push(dedupPath);
        }
    }

    for (const suffix of tildeSuffixes) {
        if (suffix === "") {
            continue;
        }
        const absoluteSuffix = `/${suffix}`;
        for (const absolutePath of absolutePaths) {
            if (!absolutePath.endsWith(absoluteSuffix)) {
                continue;
            }
            const homeDir = absolutePath.slice(0, absolutePath.length - absoluteSuffix.length);
            if (!isBlank(homeDir)) {
                homeDirs.add(homeDir);
            }
        }
    }

    return Array.from(homeDirs).sort((a, b) => b.length - a.length);
}

function normalizeLaunchPathForDedup(path: string | null | undefined, homeDirs: string[]): string {
    const normalizedPath = normalizePath(path);
    if (normalizedPath == null) {
        return "";
    }
    const dedupPath = normalizeDedupPathSeparators(normalizedPath);
    if (getTildePathSuffix(dedupPath) != null) {
        return dedupPath;
    }
    for (const homeDir of homeDirs) {
        if (dedupPath === homeDir) {
            return "~";
        }
        if (dedupPath.startsWith(`${homeDir}/`)) {
            return `~/${dedupPath.slice(homeDir.length + 1)}`;
        }
    }
    return dedupPath;
}

function getParentPath(path: string): string | null {
    const normalizedPath = normalizePath(path);
    if (normalizedPath == null || normalizedPath === "/") {
        return normalizedPath;
    }
    const lastSlashIdx = normalizedPath.lastIndexOf("/");
    if (lastSlashIdx <= 0) {
        return "/";
    }
    return normalizedPath.slice(0, lastSlashIdx);
}

function isLikelyFilePath(path: string, editMode: boolean): boolean {
    if (editMode) {
        return true;
    }
    const normalizedPath = normalizePath(path);
    if (normalizedPath == null || normalizedPath === "/") {
        return false;
    }
    const baseName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
    return baseName.includes(".");
}

function resolvePreviewLaunchPath(filePath: string, editMode: boolean): string | null {
    const normalizedPath = normalizePath(filePath);
    if (normalizedPath == null) {
        return null;
    }
    if (isLikelyFilePath(normalizedPath, editMode)) {
        return getParentPath(normalizedPath);
    }
    return normalizedPath;
}

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

function makeTerminalLaunchTarget(blockId: string, block: Block): AgentLaunchTarget | null {
    if (block.meta?.view !== "term") {
        return null;
    }
    const connection = normalizeConnection(block.meta?.connection);
    const cwd = normalizePath(block.meta?.["cmd:cwd"]);
    const source = block.meta?.[AgentAutoResumeMetaKey] === true ? "agent" : "terminal";
    const isLocal = connection == null;
    const label = isLocal ? "local" : connection;
    const detail = cwd ?? "";
    return {
        blockId,
        connection,
        cwd,
        filePath: null,
        source,
        isLocal,
        label,
        detail,
    };
}

function makePreviewLaunchTarget(blockId: string, block: Block): AgentLaunchTarget | null {
    if (block.meta?.view !== "preview") {
        return null;
    }
    const connection = normalizeConnection(block.meta?.connection);
    const metaFilePath = normalizePath(block.meta?.file);
    const explorerRootPath = normalizePath((block.meta as Record<string, unknown>)?.[PreviewExplorerRootMetaKey]);
    const filePath = explorerRootPath ?? metaFilePath;
    const launchPath = filePath;
    const cwd = launchPath == null ? null : resolvePreviewLaunchPath(launchPath, block.meta?.edit === true);
    if (connection == null && cwd == null && filePath == null) {
        return null;
    }
    const isLocal = connection == null;
    const label = isLocal ? "local" : connection;
    const locationDetail =
        filePath != null && cwd != null && filePath !== cwd ? `${filePath} -> ${cwd}` : (cwd ?? filePath);
    const detail = locationDetail ?? "";
    return {
        blockId,
        connection,
        cwd,
        filePath,
        source: "files",
        isLocal,
        label,
        detail,
    };
}

function makeDefaultHomeLaunchTarget(): AgentLaunchTarget {
    return {
        blockId: DefaultHomeLaunchTargetBlockId,
        connection: null,
        cwd: DefaultHomeLaunchTargetCwd,
        filePath: null,
        source: "home",
        isLocal: true,
        label: "local",
        detail: DefaultHomeLaunchTargetCwd,
    };
}

function getLaunchTargetPathCandidates(target: AgentLaunchTarget): string[] {
    const uniquePaths = new Set<string>();
    const addPath = (path: string | null | undefined) => {
        const normalizedPath = normalizePath(path);
        if (normalizedPath != null) {
            uniquePaths.add(normalizedPath);
        }
    };

    addPath(target.cwd);
    if (target.source === "files") {
        addPath(target.filePath);
        const parentPath = getParentPath(target.filePath ?? "");
        addPath(parentPath);
    }

    return Array.from(uniquePaths);
}

function hasFilesLaunchPath(target: AgentLaunchTarget | null): boolean {
    if (target == null || target.source !== "files") {
        return false;
    }
    return getLaunchTargetPathCandidates(target).length > 0;
}

function makeLaunchTargetDedupKey(target: AgentLaunchTarget, homeDirs: string[]): string {
    const connection = normalizeConnection(target.connection) ?? "local";
    const pathCandidates = getLaunchTargetPathCandidates(target);
    const primaryPath = target.isLocal
        ? normalizeLaunchPathForDedup(pathCandidates[0], homeDirs)
        : (normalizePath(pathCandidates[0]) ?? "");
    return `${connection}|${primaryPath}`;
}

function dedupeLaunchTargets(targets: AgentLaunchTarget[], options?: CollectLaunchTargetsOptions): AgentLaunchTarget[] {
    const dedupedTargets = new Map<string, AgentLaunchTarget>();
    const localHomeDirs = inferLocalHomeDirsFromLaunchTargets(targets, options?.localHomeDir);
    for (const target of targets) {
        const dedupeKey = makeLaunchTargetDedupKey(target, localHomeDirs);
        if (dedupedTargets.has(dedupeKey)) {
            continue;
        }
        dedupedTargets.set(dedupeKey, target);
    }
    return Array.from(dedupedTargets.values());
}

function appendDefaultHomeLaunchTarget(
    targets: AgentLaunchTarget[],
    options?: CollectLaunchTargetsOptions
): AgentLaunchTarget[] {
    return dedupeLaunchTargets([...targets, makeDefaultHomeLaunchTarget()], options);
}

function resolvePreferredFilesLaunchTargets(
    tab: Tab,
    getBlockById: (blockId: string) => Block | null | undefined,
    focusedBlockId?: string | null,
    options?: CollectLaunchTargetsOptions
): AgentLaunchTarget[] {
    const blockIds = tab.blockids ?? [];
    const targetCandidates: AgentLaunchTarget[] = [];
    const addTarget = (target: AgentLaunchTarget | null) => {
        if (!hasFilesLaunchPath(target)) {
            return;
        }
        targetCandidates.push(target);
    };

    const normalizedFocusedBlockId = isBlank(focusedBlockId) ? null : focusedBlockId;
    const focusedIsInTab = normalizedFocusedBlockId != null && blockIds.includes(normalizedFocusedBlockId);
    if (focusedIsInTab) {
        const focusedBlock = getBlockById(normalizedFocusedBlockId!);
        addTarget(makePreviewLaunchTarget(normalizedFocusedBlockId!, focusedBlock));
    }

    for (let idx = blockIds.length - 1; idx >= 0; idx--) {
        const blockId = blockIds[idx];
        if (isBlank(blockId)) {
            continue;
        }
        const block = getBlockById(blockId);
        addTarget(makePreviewLaunchTarget(blockId, block));
    }

    return dedupeLaunchTargets(targetCandidates, options);
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
    getBlockById?: (blockId: string) => Block | null | undefined,
    focusedBlockId?: string | null,
    options?: CollectLaunchTargetsOptions
): AgentLaunchTarget[] {
    return collectLaunchTargetsInTab(tab, getBlockById, focusedBlockId, options);
}

export function collectTerminalLaunchTargetsInTab(
    tab: Tab | null | undefined,
    getBlockById?: (blockId: string) => Block | null | undefined,
    focusedBlockId?: string | null,
    options?: CollectLaunchTargetsOptions
): AgentLaunchTarget[] {
    return collectLaunchTargetsInTab(tab, getBlockById, focusedBlockId, options);
}

function collectLaunchTargetsInTab(
    tab: Tab | null | undefined,
    getBlockById?: (blockId: string) => Block | null | undefined,
    focusedBlockId?: string | null,
    options?: CollectLaunchTargetsOptions
): AgentLaunchTarget[] {
    if (tab == null || getBlockById == null) {
        return [];
    }
    const terminalTargets: AgentLaunchTarget[] = [];
    const blockIds = tab.blockids ?? [];

    for (const blockId of blockIds) {
        if (isBlank(blockId)) {
            continue;
        }
        const block = getBlockById(blockId);
        if (block == null) {
            continue;
        }
        const terminalTarget = makeTerminalLaunchTarget(blockId, block);
        if (terminalTarget != null) {
            terminalTargets.push(terminalTarget);
        }
    }

    const filesTargets = resolvePreferredFilesLaunchTargets(tab, getBlockById, focusedBlockId, options);
    let launchTargets: AgentLaunchTarget[];
    if (filesTargets.length === 0) {
        launchTargets = terminalTargets;
    } else if (terminalTargets.length === 0) {
        launchTargets = filesTargets;
    } else {
        launchTargets = dedupeLaunchTargets([...filesTargets, ...terminalTargets], options);
    }
    return appendDefaultHomeLaunchTarget(launchTargets, options);
}

function getLocalHomeDirForLaunchTargets(): string | null {
    try {
        return normalizeLocalHomeDir(getApi()?.getHomeDir?.());
    } catch {
        return null;
    }
}

export function getCurrentTabAgentLaunchTargets(): AgentLaunchTarget[] {
    const staticTabId = globalStore.get(atoms.staticTabId);
    if (isBlank(staticTabId)) {
        return [];
    }
    const tabData = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", staticTabId)));
    const focusedBlockId = getFocusedBlockId();
    return collectAgentLaunchTargetsInTab(
        tabData,
        (blockId: string) => globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))),
        focusedBlockId,
        { localHomeDir: getLocalHomeDirForLaunchTargets() }
    );
}

export function getCurrentTabTerminalLaunchTargets(): AgentLaunchTarget[] {
    const staticTabId = globalStore.get(atoms.staticTabId);
    if (isBlank(staticTabId)) {
        return [];
    }
    const tabData = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", staticTabId)));
    const focusedBlockId = getFocusedBlockId();
    return collectTerminalLaunchTargetsInTab(
        tabData,
        (blockId: string) => globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))),
        focusedBlockId,
        { localHomeDir: getLocalHomeDirForLaunchTargets() }
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
        getBlockById: (blockId: string) =>
            globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))),
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

function mergeContextMeta(baseMeta: MetaType, context?: AgentLaunchContext): MetaType {
    const meta: MetaType = {
        ...baseMeta,
        ...resolveContextMeta(context),
    };

    if (context?.connection !== undefined && (typeof context.connection !== "string" || isBlank(context.connection))) {
        delete meta.connection;
    }
    if (context?.cwd !== undefined && (typeof context.cwd !== "string" || isBlank(context.cwd))) {
        delete meta["cmd:cwd"];
    }

    return meta;
}

export function createTerminalBlockDef(context?: AgentLaunchContext, baseBlockDef?: BlockDef): BlockDef {
    const baseMeta = baseBlockDef?.meta ?? {};
    const blockMeta: MetaType = {
        view: "term",
        controller: "shell",
        ...mergeContextMeta(baseMeta, context),
    };

    return {
        ...baseBlockDef,
        meta: blockMeta,
    };
}

export function createDefaultAgentBlockDef(settings?: SettingsType, context?: AgentLaunchContext): BlockDef {
    return createAgentBlockDef(settings, context);
}

export function createAgentBlockDefForProfile(
    profileName: string,
    settings?: SettingsType,
    context?: AgentLaunchContext
): BlockDef {
    return createAgentBlockDef(settings, context, profileName);
}

function createAgentBlockDef(settings?: SettingsType, context?: AgentLaunchContext, profileName?: string): BlockDef {
    const contextMeta = resolveContextMeta(context);
    const profile = getProfileConfig(settings, profileName);
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
        "cmd:jwt": true,
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

export function createAgentBlockDefForTarget(
    settings: SettingsType | undefined,
    target: AgentLaunchTarget,
    profileName?: string
): BlockDef {
    const context = {
        connection: target.connection,
        cwd: target.cwd,
        inheritWorkspaceContext: false,
    };
    if (isBlank(profileName)) {
        return createDefaultAgentBlockDef(settings, context);
    }
    return createAgentBlockDefForProfile(profileName!, settings, context);
}

export function createTerminalBlockDefForTarget(target: AgentLaunchTarget, baseBlockDef?: BlockDef): BlockDef {
    return createTerminalBlockDef(
        {
            connection: target.connection,
            cwd: target.cwd,
            inheritWorkspaceContext: false,
        },
        baseBlockDef
    );
}
