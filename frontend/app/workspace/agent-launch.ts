import { atoms, getApi, getFocusedBlockId, globalStore } from "@/app/store/global";
import * as WOS from "@/app/store/wos";
import { PreviewExplorerRootMetaKey, PreviewPathIsDirMetaKey } from "@/app/view/preview/preview-navigation";
import type { CcSwitchVendor } from "@/app/workspace/ccswitch-vendors";
import { isBlank } from "@/util/util";

const DefaultAgentCommand = "codex";
const DefaultAgentProfile = "codex";
const DefaultModelFlag = "--model";
const AgentAutoResumeMetaKey = "agent:autoresume";
const AgentProviderMetaKey = "agent:provider";
// Per-block cc-switch vendor binding. When present, this Claude Code block was launched against a specific
// cc-switch provider's env, not the global ~/.claude/settings.json env — supports per-block vendor isolation.
const AgentClaudeVendorIdMetaKey = "agent:claudevendorid";
const AgentClaudeVendorNameMetaKey = "agent:claudevendorname";
const AgentCodexVendorIdMetaKey = "agent:codexvendorid";
const AgentCodexVendorNameMetaKey = "agent:codexvendorname";
const AgentOpenCodeVendorIdMetaKey = "agent:opencodevendorid";
const AgentOpenCodeVendorNameMetaKey = "agent:opencodevendorname";
const AgentPiVendorIdMetaKey = "agent:pivendorid";
const AgentPiVendorNameMetaKey = "agent:pivendorname";
const AgentIsolationModeMetaKey = "agent:isolationmode";
const AgentRequestedModelMetaKey = "agent:requestedmodel";
const DefaultHomeLaunchTargetBlockId = "launch-target:home";
const DefaultHomeLaunchTargetCwd = "~";

export const DefaultAgentWidgetId = "defwidget@agent";
export const DefaultTerminalWidgetId = "defwidget@terminal";
export const AgentDefaultLaunchTargetMetaKey = "agent:defaultlaunchtarget";
export const TerminalDefaultLaunchTargetMetaKey = "term:defaultlaunchtarget";

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

export type AgentProfileOption = {
    name: string;
    label: string;
    cmd: string;
    isDefault: boolean;
};

export type AgentCommandResolver = (command: string, connection: string, cwd: string) => Promise<string>;

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
    pi: {
        cmd: "pi",
        modelflag: "--model",
    },
};

const BuiltinAgentProfileLabels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude Code",
    gemini: "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
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

function isRemoteExecutionConnection(connection: unknown): boolean {
    const normalizedConnection = normalizeConnection(connection);
    return (
        normalizedConnection != null && normalizedConnection !== "local" && !normalizedConnection.startsWith("local:")
    );
}

function isWindowsShimCommand(cmd: string): boolean {
    const trimmed = cmd.trim();
    if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith("\\\\")) {
        return true;
    }
    return /\.(cmd|bat|ps1|exe)$/i.test(trimmed);
}

function resolveAgentCommandForContext(cmd: string, provider: string, contextMeta: AgentContextMeta): string {
    if (!isRemoteExecutionConnection(contextMeta.connection)) {
        return cmd;
    }
    if (!isWindowsShimCommand(cmd)) {
        return cmd;
    }
    return extractCommandBaseName(cmd) === provider ? provider : cmd;
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

function getConfiguredDefaultProfileName(settings?: SettingsType): string {
    if (isBlank(settings?.["agent:defaultprofile"])) {
        return DefaultAgentProfile;
    }
    return settings["agent:defaultprofile"]!.trim().toLowerCase();
}

function getProfileConfig(settings?: SettingsType, profileName?: string): AgentProfileConfig {
    const selectedProfileName = isBlank(profileName) ? getConfiguredDefaultProfileName(settings) : profileName.trim();
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

function getAgentProfileNames(settings?: SettingsType): string[] {
    const names = new Set(Object.keys(BuiltinAgentProfiles));
    const configuredProfiles = settings?.["agent:profiles"] ?? {};
    for (const name of Object.keys(configuredProfiles).sort()) {
        if (!isBlank(name)) {
            names.add(name.trim().toLowerCase());
        }
    }
    return Array.from(names);
}

function getAgentProfileCandidateConfig(
    settings: SettingsType | undefined,
    profileName: string
): AgentProfileConfig | null {
    const builtInProfile = BuiltinAgentProfiles[profileName];
    const rawProfile = settings?.["agent:profiles"]?.[profileName];
    const selectedProfile = normalizeProfile(rawProfile);
    if (builtInProfile == null && selectedProfile?.cmd == null) {
        return null;
    }
    return {
        ...builtInProfile,
        ...selectedProfile,
        args: selectedProfile?.args ?? builtInProfile?.args,
        env: selectedProfile?.env ?? builtInProfile?.env,
    };
}

export function getAgentProfileDetectionCommands(settings?: SettingsType): Record<string, string> {
    const commands: Record<string, string> = {};
    for (const profileName of getAgentProfileNames(settings)) {
        const profile = getAgentProfileCandidateConfig(settings, profileName);
        if (!isBlank(profile?.cmd)) {
            commands[profileName] = profile!.cmd!.trim();
        }
    }
    return commands;
}

function makeDetectedAgentCommandSet(
    availableCommands?: Record<string, string | null | undefined>
): Set<string> | null {
    if (availableCommands == null) {
        return null;
    }
    const detectedCommands = new Set<string>();
    for (const [name, path] of Object.entries(availableCommands)) {
        if (isBlank(path)) {
            continue;
        }
        const normalizedName = name.trim().toLowerCase();
        const normalizedPath = path!.trim().toLowerCase();
        detectedCommands.add(normalizedName);
        detectedCommands.add(extractCommandBaseName(normalizedName));
        detectedCommands.add(normalizedPath);
        detectedCommands.add(extractCommandBaseName(normalizedPath));
    }
    return detectedCommands;
}

function isDetectedAgentProfile(profileName: string, cmd: string, detectedCommands: Set<string> | null): boolean {
    if (detectedCommands == null) {
        return true;
    }
    const normalizedName = profileName.trim().toLowerCase();
    const normalizedCmd = cmd.trim().toLowerCase();
    return (
        detectedCommands.has(normalizedName) ||
        detectedCommands.has(extractCommandBaseName(normalizedName)) ||
        detectedCommands.has(normalizedCmd) ||
        detectedCommands.has(extractCommandBaseName(normalizedCmd))
    );
}

export function getAgentProfileOptions(
    settings?: SettingsType,
    availableCommands?: Record<string, string | null | undefined>
): AgentProfileOption[] {
    const defaultProfileName = getConfiguredDefaultProfileName(settings);
    const detectedCommands = makeDetectedAgentCommandSet(availableCommands);
    const options: AgentProfileOption[] = [];
    for (const profileName of getAgentProfileNames(settings)) {
        const profile = getAgentProfileCandidateConfig(settings, profileName);
        if (profile == null || isBlank(profile.cmd)) {
            continue;
        }
        if (!isDetectedAgentProfile(profileName, profile.cmd!, detectedCommands)) {
            continue;
        }
        options.push({
            name: profileName,
            label: BuiltinAgentProfileLabels[profileName] ?? profileName,
            cmd: profile.cmd!.trim(),
            isDefault: profileName === defaultProfileName,
        });
    }
    return options;
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

function resolvePreviewLaunchPath(filePath: string, editMode: boolean, pathIsDir?: boolean | null): string | null {
    const normalizedPath = normalizePath(filePath);
    if (normalizedPath == null) {
        return null;
    }
    if (pathIsDir === true) {
        return normalizedPath;
    }
    if (pathIsDir === false) {
        return getParentPath(normalizedPath);
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
    const pathIsDir = (block.meta as Record<string, unknown>)?.[PreviewPathIsDirMetaKey];
    const launchPathIsDir = explorerRootPath != null ? true : typeof pathIsDir === "boolean" ? pathIsDir : null;
    const cwd =
        launchPath == null ? null : resolvePreviewLaunchPath(launchPath, block.meta?.edit === true, launchPathIsDir);
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

export function canSetLaunchTargetDefault(target: AgentLaunchTarget | null | undefined): boolean {
    // "Home" is a creatable fallback (always launchable) but cannot be pinned as the default
    // launch target — the default must point at a real terminal/files/agent target.
    if (target == null) {
        return false;
    }
    if (target.source === "home") {
        return false;
    }
    return true;
}

export function getSelectableLaunchTargets(targets: AgentLaunchTarget[]): AgentLaunchTarget[] {
    return targets.filter(canSetLaunchTargetDefault);
}

export function getLaunchCreatableTargets(targets: AgentLaunchTarget[]): AgentLaunchTarget[] {
    return targets;
}

export function moveDefaultProfileFirst(
    options: AgentProfileOption[],
    defaultProfileName: string | undefined
): AgentProfileOption[] {
    if (isBlank(defaultProfileName)) {
        return options;
    }
    const idx = options.findIndex((o) => o.name === defaultProfileName);
    if (idx <= 0) {
        return options;
    }
    return [options[idx], ...options.slice(0, idx), ...options.slice(idx + 1)];
}

export function moveDefaultTargetFirst(
    targets: AgentLaunchTarget[],
    defaultTargetKey: string | undefined
): AgentLaunchTarget[] {
    if (isBlank(defaultTargetKey)) {
        return targets;
    }
    const idx = targets.findIndex((t) => getLaunchTargetDefaultKey(t) === defaultTargetKey);
    if (idx <= 0) {
        return targets;
    }
    return [targets[idx], ...targets.slice(0, idx), ...targets.slice(idx + 1)];
}

export function getLaunchTargetDefaultKey(target: AgentLaunchTarget | null | undefined): string {
    if (target == null) {
        return "";
    }
    const connection = normalizeConnection(target.connection) ?? "local";
    const path = normalizeDedupPathSeparators(normalizePath(target.cwd ?? target.filePath) ?? "");
    return `${target.source}|${connection}|${path}`;
}

export function resolveDefaultLaunchTarget(
    targets: AgentLaunchTarget[],
    defaultTargetKey?: string | null
): AgentLaunchTarget | null {
    const selectableTargets = getSelectableLaunchTargets(targets);
    if (!isBlank(defaultTargetKey)) {
        const defaultTarget = selectableTargets.find(
            (target) => getLaunchTargetDefaultKey(target) === defaultTargetKey
        );
        if (defaultTarget != null) {
            return defaultTarget;
        }
    }
    return selectableTargets[0] ?? targets[0] ?? null;
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

export function createDefaultAgentBlockDef(
    settings?: SettingsType,
    context?: AgentLaunchContext,
    vendorOptions?: CcSwitchVendor[],
    vendorId?: string,
    vendorModel?: string
): BlockDef {
    return createAgentBlockDef(settings, context, undefined, vendorOptions, vendorId, vendorModel);
}

export function createAgentBlockDefForProfile(
    profileName: string,
    settings?: SettingsType,
    context?: AgentLaunchContext,
    vendorOptions?: CcSwitchVendor[],
    vendorId?: string,
    vendorModel?: string
): BlockDef {
    return createAgentBlockDef(settings, context, profileName, vendorOptions, vendorId, vendorModel);
}

function createAgentBlockDef(
    settings?: SettingsType,
    context?: AgentLaunchContext,
    profileName?: string,
    vendorOptions?: CcSwitchVendor[],
    vendorId?: string,
    vendorModel?: string
): BlockDef {
    const contextMeta = resolveContextMeta(context);
    const profile = getProfileConfig(settings, profileName);
    const cmd = !isBlank(profile.cmd) ? profile.cmd : DefaultAgentCommand;
    const provider = resolveAgentProvider(settings, cmd);
    const resolvedCmd = resolveAgentCommandForContext(cmd, provider, contextMeta);
    const cmdArgs = sanitizeArgs(profile.args);
    const profileModel = !isBlank(profile.model) ? profile.model!.trim() : null;
    const modelFlag = !isBlank(profile.modelflag) ? profile.modelflag : DefaultModelFlag;
    let requestedModel = profileModel;
    if (!isBlank(vendorId) && !isBlank(vendorModel)) {
        requestedModel = vendorModel!.trim();
    }
    if (requestedModel != null) {
        if (!isBlank(modelFlag)) {
            cmdArgs.push(modelFlag, requestedModel);
        } else {
            cmdArgs.push(requestedModel);
        }
    }
    const cmdEnv = sanitizeEnv(profile.env);

    // Resolve the cc-switch vendor (only meaningful for Claude Code blocks). Vendor env is layered ON TOP
    // of profile.env: profile.env is the user's settings.json default, vendor is the user's explicit per-block
    // pick at launch time → vendor wins. If vendorId is blank or not found in options, the layer is a no-op
    // and the block lands exactly as it would have before (zero-invasive).
    //
    // IMPORTANT well-spent gotcha: Claude Code applies ~/.claude/settings.json's "env" block on top of the
    // process env it inherits from us (per https://code.claude.com/docs/en/env-vars — "When the same
    // variable is set in both your shell and a settings file env block, the settings file value applies").
    // So the ANTHROPIC_BASE_URL we put in cmd:env gets *overwritten* by whatever the user's global
    // settings.json says, silently reverting every block back to the user's default vendor.
    //
    // To make the per-block pick actually stick, we also inject CLAUDE_CONFIG_DIR -> the vendor's
    // materialized settings dir (see reader.go materializeClaudeConfigDir). Claude then reads
    // *that* settings.json (containing only this vendor's env) instead of ~/.claude/settings.json,
    // so our vendor.env wins by construction. We still inject the env values themselves into cmd:env
    // for the case where claude_config_dir is empty (reader skipped materialization, e.g. write failed)
    // — that path keeps the old OS-env-injection behavior as a fallback.
    //
    // Codex mirrors this: vendor.env holds OPENAI_API_KEY (whitelisted in reader.go) and we inject
    // CODEX_HOME -> the materialized per-vendor codex home (auth.json + config.toml + hooks.json +
    // cc-switch-model-catalog.json). We deliberately do NOT set OPENAI_BASE_URL here — base_url is a
    // config.toml resource (in [model_providers.<name>]) and an env OPENAI_BASE_URL would silently
    // clobber it. When the picked codex vendor has no codex_config_dir (codex-official / blank rows),
    // we skip CODEX_HOME injection entirely so the spawned codex falls back to the user's global ~/.codex/
    // (official OAuth login path).
    let selectedVendor: CcSwitchVendor | undefined = undefined;
    const isClaudeProvider = provider === "claude" || provider === "anthropic";
    const isCodexProvider = provider === "codex";
    const isOpenCodeProvider = provider === "opencode";
    const isPiProvider = provider === "pi";
    const isVendorAwareProvider = isClaudeProvider || isCodexProvider || isOpenCodeProvider || isPiProvider;
    if (isVendorAwareProvider && !isBlank(vendorId) && Array.isArray(vendorOptions)) {
        selectedVendor = vendorOptions.find((v) => v != null && v.id === vendorId);
    }
    if (selectedVendor != null && selectedVendor.env != null) {
        for (const [k, v] of Object.entries(selectedVendor.env)) {
            cmdEnv[k] = v;
        }
    }
    if (isClaudeProvider && selectedVendor != null && !isBlank(selectedVendor.claude_config_dir)) {
        cmdEnv["CLAUDE_CONFIG_DIR"] = selectedVendor.claude_config_dir;
    } else if (isCodexProvider && selectedVendor != null && !isBlank(selectedVendor.codex_config_dir)) {
        cmdEnv["CODEX_HOME"] = selectedVendor.codex_config_dir;
    } else if (isOpenCodeProvider && selectedVendor != null && !isBlank(selectedVendor.opencode_config_dir)) {
        cmdEnv["OPENCODE_HOME"] = selectedVendor.opencode_config_dir;
    } else if (isPiProvider && selectedVendor != null && !isBlank(selectedVendor.pi_config_dir)) {
        cmdEnv["PI_CODING_AGENT_SESSION_DIR"] = selectedVendor.pi_config_dir;
    }

    const blockMeta: MetaType = {
        view: "term",
        controller: "cmd",
        cmd: resolvedCmd,
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
    blockMetaRecord[AgentIsolationModeMetaKey] = selectedVendor == null ? "system" : "vendor";
    if (requestedModel != null) {
        blockMetaRecord[AgentRequestedModelMetaKey] = requestedModel;
    }
    if (selectedVendor != null) {
        // Persist the per-block vendor binding so the block's vendor survives Wave restart
        // and other UI can show "this <profile> block is using <vendorName>". The two sets of
        // meta keys are kept separate (rather than a single "agent:vendorid") because a vendor
        // identity in cc-switch is scoped by app_type — the same id could in principle exist for
        // both claude and codex providers, and the profile disambiguates which set to read.
        if (isClaudeProvider) {
            blockMetaRecord[AgentClaudeVendorIdMetaKey] = selectedVendor.id;
            blockMetaRecord[AgentClaudeVendorNameMetaKey] = selectedVendor.name;
        } else if (isCodexProvider) {
            blockMetaRecord[AgentCodexVendorIdMetaKey] = selectedVendor.id;
            blockMetaRecord[AgentCodexVendorNameMetaKey] = selectedVendor.name;
        } else if (isOpenCodeProvider) {
            blockMetaRecord[AgentOpenCodeVendorIdMetaKey] = selectedVendor.id;
            blockMetaRecord[AgentOpenCodeVendorNameMetaKey] = selectedVendor.name;
        } else if (isPiProvider) {
            blockMetaRecord[AgentPiVendorIdMetaKey] = selectedVendor.id;
            blockMetaRecord[AgentPiVendorNameMetaKey] = selectedVendor.name;
        }
    }

    return {
        meta: blockMeta,
    };
}

export function createAgentBlockDefForTarget(
    settings: SettingsType | undefined,
    target: AgentLaunchTarget,
    profileName?: string,
    vendorOptions?: CcSwitchVendor[],
    vendorId?: string,
    vendorModel?: string
): BlockDef {
    const context = {
        connection: target.connection,
        cwd: target.cwd,
        inheritWorkspaceContext: false,
    };
    if (isBlank(profileName)) {
        return createDefaultAgentBlockDef(settings, context, vendorOptions, vendorId, vendorModel);
    }
    return createAgentBlockDefForProfile(profileName!, settings, context, vendorOptions, vendorId, vendorModel);
}

export async function resolveAgentBlockCommandForLaunch(
    blockDef: BlockDef,
    resolveCommand: AgentCommandResolver
): Promise<BlockDef> {
    const meta = blockDef.meta ?? {};
    const cmd = typeof meta.cmd === "string" ? meta.cmd.trim() : "";
    const connection = normalizeConnection(meta.connection);
    if (isBlank(cmd) || !isRemoteExecutionConnection(connection)) {
        return blockDef;
    }
    const cwd = normalizePath(meta["cmd:cwd"]) ?? "";
    const resolvedCmd = (await resolveCommand(cmd, connection!, cwd)).trim();
    if (isBlank(resolvedCmd)) {
        throw new Error(
            `Agent command "${cmd}" was not found on ${connection}. Install it on that machine or add it to that machine's PATH.`
        );
    }
    if (resolvedCmd === cmd) {
        return blockDef;
    }
    return {
        ...blockDef,
        meta: {
            ...meta,
            cmd: resolvedCmd,
        },
    };
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
