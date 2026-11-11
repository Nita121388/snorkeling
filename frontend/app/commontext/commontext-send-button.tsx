// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器：split button（主键按当前配置直接发送）+ popover（三项正交选择 + 确认）。
// 设计依据：design/prototypes/commontext/commontext-send-agent-block/
// 规则：只有 Agent Block（term + agent:* meta）才能作为「已存在」目标；其余组合都会新建 agent block，
// 文本经 pending-input 排队，TUI 就绪后由 term 视图注入。

import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { useAgentReadContext } from "@/app/agent-status/use-agent-status-view";
import { Button } from "@/app/element/button";
import { SplitButton } from "@/app/element/splitbutton";
import { AgentStatusChip } from "@/app/session-overview/agent-status-chip";
import { filterSessionOverviewTabIds } from "@/app/session-overview/session-overview-model";
import { atoms, createBlock, getApi } from "@/app/store/global";
import { blockComponentModelMap } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { ObjectService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { stripSessionTagHashes } from "@/app/view/aisessions/session-tags";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import {
    createAgentBlockDefForProfile,
    getCurrentWorkspaceContextMeta,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { useDetectedAgentProfileOptions } from "@/app/workspace/use-agent-profile-options";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { fireAndForget } from "@/util/util";
import { FloatingPortal, offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import * as React from "react";
import { sendTextToFocusedTerm } from "./commontext-insert";
import {
    collectFolderCandidates,
    defaultSendFolder,
    extractAgentBlockInfo,
    resolveSendTarget,
    type AgentBlockInfo,
    type FolderCandidate,
    type SendTabSelection,
} from "./commontext-send-target";
import { registerPendingInput } from "./pending-input";

// ───────────────────────── 共享配置（弹窗内多处 Send 共用） ─────────────────────────

export type CommontextSendMode = "focused" | "create";

export type CommontextSendConfig = {
    /**
     * 目标模式（显式二选一，2026-11-11 起）：
     *   "focused" = 优先发送到聚焦的 Agent Block（三项与聚焦块全等时落 existing，否则新建）；
     *   "create"  = 强制新建，即使三项与聚焦块全等（「同款新建」）。
     * 旧实现只靠「三项全等」推导 ✓，导致聚焦块与所选 agent 同款时无法切到新建。
     */
    mode: CommontextSendMode;
    /** null = 跟随聚焦块的 agent（无聚焦时用 default profile） */
    profile: string | null;
    tab: SendTabSelection;
    /** null = 跟随聚焦块 cwd（无聚焦时用当前工作区 cwd） */
    folder: string | null;
};

export const commontextSendConfigAtom = atom<CommontextSendConfig>({
    mode: "focused",
    profile: null,
    tab: { kind: "current" },
    folder: null,
});

export type SendStatusKind = "info" | "ok" | "err";
export type SendStatusHandler = (message: string, kind?: SendStatusKind) => void;

const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

// ───────────────────────── 派生 atoms ─────────────────────────

/** 当前聚焦的 Agent Block（term + agent:* meta）；普通终端返回 null。 */
export const focusedAgentBlockInfoAtom = atom<AgentBlockInfo | null>((get) => {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) return null;
    const focusedNode = get(layoutModel.focusedNode);
    const blockId = getLayoutDataActiveBlockId(focusedNode?.data);
    if (blockId == null) return null;
    const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
    return extractAgentBlockInfo(block ?? null, blockId);
});

export type SendTabCandidate = { tabId: string; name: string; isCurrent: boolean };

/** Type 候选：workspace 的可见 tab（过滤 session-overview 虚拟 tab），当前 tab 标记。 */
export const sendTabCandidatesAtom = atom<SendTabCandidate[]>((get) => {
    const workspace = get(atoms.workspace);
    if (workspace == null) return [];
    const currentTabId = get(atoms.staticTabId);
    const tabIds = filterSessionOverviewTabIds(workspace.tabids ?? [], (tabId) =>
        get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)))
    );
    return tabIds.map((tabId) => {
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        return { tabId, name: tab?.name || "Tab", isCurrent: tabId === currentTabId };
    });
});

function getWorkspaceContextCwd(): string {
    const meta = getCurrentWorkspaceContextMeta();
    return typeof meta?.["cmd:cwd"] === "string" ? meta["cmd:cwd"] : "";
}

function getHomeDir(): string {
    try {
        return getApi().getHomeDir();
    } catch {
        return "";
    }
}

function defaultProfileName(options: AgentProfileOption[]): string | null {
    if (options.length === 0) return null;
    const preferred = options.find((option) => option.isDefault);
    return (preferred ?? options[0]).name;
}

export type SendTargetPreview = {
    kind: "existing" | "create";
    /** 供按钮 hint / 摘要使用的目标描述 */
    label: string;
    profileName: string | null;
    profileLabel: string;
    folder: string;
    /** create 时的 cwd（folder 为空时已填聚焦块/工作区 cwd） */
    cwd: string;
};

/**
 * 把（共享配置 + 聚焦块 + profile 列表）解析成本次发送的落点预览。
 * 与 resolveSendTarget 同一判定：三项全等 → existing，其余 create。
 */
export function previewSendTarget(input: {
    config: CommontextSendConfig;
    focusedAgent: AgentBlockInfo | null;
    profiles: AgentProfileOption[];
    workspaceCwd?: string;
}): SendTargetPreview {
    const { config, focusedAgent, profiles } = input;
    const profileName = config.profile ?? focusedAgent?.provider ?? defaultProfileName(profiles);
    const profileLabel = profiles.find((p) => p.name === profileName)?.label ?? profileName ?? "Agent";
    const folder = config.folder ?? defaultSendFolder(focusedAgent, input.workspaceCwd ?? "");
    if (profileName == null) {
        return {
            kind: "create",
            label: "无可用 agent",
            profileName: null,
            profileLabel: "Agent",
            folder,
            cwd: folder,
        };
    }
    const resolved = resolveSendTarget(
        {
            agentProfile: profileName,
            provider: profileName,
            tab: config.tab,
            folder: config.folder ?? "",
            forceCreate: config.mode === "create",
        },
        focusedAgent,
        { profileLabel }
    );
    if (resolved.kind === "existing") {
        return {
            kind: "existing",
            label: resolved.label,
            profileName,
            profileLabel,
            folder,
            cwd: focusedAgent?.cwd ?? "",
        };
    }
    return {
        kind: "create",
        label: resolved.label,
        profileName,
        profileLabel,
        folder,
        cwd: resolved.cwd,
    };
}

// ───────────────────────── 执行 ─────────────────────────

/**
 * 执行一次 Send。existing → 直接注入聚焦块；create → 建块 + pending input 排队。
 * 返回 true 表示已成功发起（注入可能仍在后台等待 TUI 就绪）。
 */
export async function executeCommonTextSend(input: {
    text: string;
    config: CommontextSendConfig;
    focusedAgent: AgentBlockInfo | null;
    profiles: AgentProfileOption[];
    onStatus?: SendStatusHandler;
}): Promise<boolean> {
    const { text, config, focusedAgent, profiles, onStatus } = input;
    const cleanText = stripSessionTagHashes(text);
    if (cleanText.trim() === "") {
        onStatus?.("Nothing to send", "err");
        return false;
    }
    const preview = previewSendTarget({ config, focusedAgent, profiles });
    if (preview.profileName == null) {
        onStatus?.("No agent profile available", "err");
        return false;
    }
    if (preview.kind === "existing") {
        const target = sendTextToFocusedTerm(cleanText, [focusedAgent!.blockId]);
        if (target == null) {
            onStatus?.("Agent block not ready — focus it and retry, or create a new block", "err");
            return false;
        }
        onStatus?.("Sent", "ok");
        return true;
    }
    // create：folder 为空时继承当前工作区 context
    const settings = globalStore.get(atoms.settingsAtom);
    const context =
        preview.cwd === ""
            ? { inheritWorkspaceContext: true }
            : { connection: null, cwd: preview.cwd, inheritWorkspaceContext: false };
    const blockDef = createAgentBlockDefForProfile(preview.profileName, settings, context);
    try {
        let blockId: string;
        if (config.tab.kind === "current") {
            blockId = await createBlock(blockDef, false);
        } else if (config.tab.kind === "existing") {
            const targetTabId = config.tab.tabId;
            blockId = await ObjectService.CreateBlockInTab(targetTabId, blockDef, DefaultRuntimeOpts, true, false);
            getApi().setActiveTab(targetTabId);
        } else {
            const workspace = globalStore.get(atoms.workspace);
            if (workspace?.oid == null) {
                throw new Error("No workspace available");
            }
            const result = await ObjectService.CreateBlockInNewTab(
                workspace.oid,
                "tab",
                blockDef,
                DefaultRuntimeOpts,
                false
            );
            blockId = result.blockid;
            getApi().setActiveTab(result.tabid);
        }
        registerPendingInput(blockId, cleanText);
        onStatus?.(`Sent — will inject when ${preview.profileLabel} is ready`, "ok");
        return true;
    } catch (error) {
        onStatus?.(`Send failed: ${(error as Error)?.message ?? "unknown error"}`, "err");
        return false;
    }
}

// ───────────────────────── UI ─────────────────────────

/** 聚焦块 agent 小卡：头像 + 标题 + cwd + 状态 chip（复用 AgentStatusChip，不新增状态映射）。 */
const AgentMiniCard = ({ info }: { info: AgentBlockInfo }) => {
    const statusAtom = React.useMemo(() => AgentStatusStore.getInstance().acquire(info.blockId), [info.blockId]);
    React.useEffect(() => {
        const store = AgentStatusStore.getInstance();
        return () => store.release(info.blockId);
    }, [info.blockId]);
    const status = useAtomValue(statusAtom);
    const readContext = useAgentReadContext(info.blockId, status);
    const providerLabel = info.provider ? info.provider.charAt(0).toUpperCase() + info.provider.slice(1) : "Agent";
    const title = info.model ? `${providerLabel} · ${info.model}` : providerLabel;
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            <div
                className="shrink-0 h-[30px] w-[30px] rounded-lg grid place-items-center text-[13px] font-semibold bg-actionsoft text-accent"
                data-agent-avatar={info.provider}
            >
                {providerLabel.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{info.title ?? title}</div>
                <div className="text-[10.5px] text-muted font-mono truncate">
                    {info.provider}
                    {info.model ? ` · ${info.model}` : ""}
                    {info.cwd ? ` · ${info.cwd}` : ""}
                </div>
            </div>
            <div className="shrink-0">
                <AgentStatusChip
                    variant="card"
                    status={status}
                    now={Date.now()}
                    unread={readContext.read === "unread"}
                    blockId={info.blockId}
                />
            </div>
        </div>
    );
};

const sectionHeadClass = "flex items-center gap-1.5 text-xxs text-muted mb-1.5";

const menuItemClass =
    "split-menu-item flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-[12px] cursor-pointer bg-transparent border-0 text-[color:var(--main-text-color)] hover:bg-hoverbg";

// ─── 面板内下拉（Type / Folder 二级菜单） ───
// 面板本体（SplitButton 弹层）带 max-height + overflow:auto，绝对定位子元素会被裁剪，
// 所以二级菜单自己走 FloatingPortal（body 上无定位容器，zIndex 1001 稳定在面板之上）。
// 挂在面板 children 里（React 树内）→ 面板的 useDismiss outsidePress 拿得到 insideReactTree，
// 点二级菜单不会误关面板；Escape 在这里拦截（stopPropagation），只关本级菜单。
function AnchoredMenu(props: {
    open: boolean;
    anchor: HTMLElement | null;
    label: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const { refs, floatingStyles, context } = useFloating({
        open: props.open,
        onOpenChange: (open) => {
            if (!open) props.onClose();
        },
        placement: "bottom-start",
        strategy: "fixed",
        elements: { reference: props.anchor },
        middleware: [offset(6)],
    });
    // Escape 由下方 onKeyDown 手动处理（要 stopPropagation，避免连面板一起关）
    const dismiss = useDismiss(context, { escapeKey: false, outsidePress: true });
    const { getFloatingProps } = useInteractions([dismiss]);
    if (!props.open || props.anchor == null) return null;
    return (
        <FloatingPortal>
            <div
                ref={refs.setFloating}
                role="menu"
                aria-label={props.label}
                data-commontext-send-picker=""
                className="rounded-lg border border-border/70 bg-modalbg/95 backdrop-blur-2xl shadow-2xl p-1 flex flex-col gap-0.5 max-h-[280px] overflow-y-auto overflow-x-hidden"
                style={{ ...floatingStyles, zIndex: 1001, width: "min(360px, 92vw)" }}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        props.onClose();
                    }
                }}
                {...getFloatingProps()}
            >
                {props.children}
            </div>
        </FloatingPortal>
    );
}

// ─── Send 目标面板（挂在 SplitButton 弹层内） ───

function SendTargetPanel(props: { text: string; onSent: () => void; onStatus: SendStatusHandler; close: () => void }) {
    const [config, setConfig] = useAtomConfig();
    const personaMap = useAgentPersonas();
    const focusedAgent = useAtomValue(focusedAgentBlockInfoAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const tabCandidates = useAtomValue(sendTabCandidatesAtom);
    const profiles = useDetectedAgentProfileOptions(settings);
    const [menuOpen, setMenuOpen] = React.useState<"tab" | "folder" | null>(null);
    const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

    const workspaceCwd = getWorkspaceContextCwd();
    const homeDir = getHomeDir();
    const preview = previewSendTarget({ config, focusedAgent, profiles, workspaceCwd });

    const folderCandidates: FolderCandidate[] = collectFolderCandidates({
        focusedAgent,
        blocks: collectTabAgentBlocks(),
        workspaceCwd,
        homeDir: homeDir === "" ? null : homeDir,
    });

    const openMenu = (kind: "tab" | "folder", event: React.MouseEvent<HTMLElement>) => {
        setMenuAnchor(event.currentTarget);
        setMenuOpen(kind);
    };

    const closeMenu = () => setMenuOpen(null);

    const doSend = () => {
        fireAndForget(async () => {
            const ok = await executeCommonTextSend({
                text: props.text,
                config,
                focusedAgent,
                profiles,
                onStatus: props.onStatus,
            });
            if (ok) props.onSent();
        });
    };

    const currentTabName = tabCandidates.find((t) => t.isCurrent)?.name;
    const selectedTabName =
        config.tab.kind === "current"
            ? (currentTabName ?? "当前 Tab")
            : config.tab.kind === "new"
              ? "新 Tab"
              : (tabCandidates.find((t) => t.tabId === (config.tab as { tabId: string }).tabId)?.name ?? "Tab");

    return (
        <div className="flex flex-col gap-0.5" data-commontext-send-popover>
            {/* 1. 发送目标：显式二选一（聚焦块 / 新建）
                ✓ 跟着「实际落点」走（preview.kind），不再只靠三项推导：
                聚焦块与所选 agent 同款时，用户仍能显式选「新建 Agent Block」。
                data-* 供真机验证台定位两个目标模式行。 */}
            <div className="px-2.5 pt-2 pb-1.5">
                <div className={sectionHeadClass}>
                    <i className="fa-solid fa-crosshairs text-[9px]" />
                    发送目标
                    <span className="ml-auto font-mono normal-case tracking-normal">二选一</span>
                </div>

                {/* 1a. 聚焦的 Agent Block（有聚焦 agent block 才可选） */}
                {focusedAgent != null ? (
                    <button
                        type="button"
                        data-commontext-send-mode="focused"
                        className={menuItemClass + (preview.kind === "existing" ? " bg-actionsoft" : "")}
                        onClick={() =>
                            setConfig({ mode: "focused", profile: null, tab: { kind: "current" }, folder: null })
                        }
                        title="发送到聚焦块：Agent / Type / Folder 三项跟随聚焦块"
                        aria-pressed={preview.kind === "existing"}
                    >
                        <div className="min-w-0 flex-1">
                            <AgentMiniCard info={focusedAgent} />
                        </div>
                        <span className="shrink-0 text-[9.5px] px-1.5 py-px rounded-full bg-surface-soft text-muted">
                            已存在
                        </span>
                        <i
                            className={
                                "fa-solid fa-check text-[11px] text-accent " +
                                (preview.kind === "existing" ? "" : "invisible")
                            }
                        />
                    </button>
                ) : (
                    <div className="px-2 py-1 text-[11.5px] text-muted">当前聚焦块不是 Agent Block — 不可直接发送</div>
                )}

                {/* 1b. 新建 Agent Block（始终可选：即使 Agent/Type/Folder 与聚焦块全等） */}
                <button
                    type="button"
                    data-commontext-send-mode="create"
                    className={menuItemClass + (preview.kind === "create" ? " bg-actionsoft" : "")}
                    onClick={() => setConfig({ ...config, mode: "create" })}
                    title="新建一个 Agent Block（保留当前 Agents / Type / Folder 选择）"
                    aria-pressed={preview.kind === "create"}
                >
                    <i className="fa-solid fa-plus text-[10px] text-secondary shrink-0" />
                    <span className="min-w-0 flex-1 truncate">新建 Agent Block</span>
                    <span className="shrink-0 text-[9.5px] px-1.5 py-px rounded-full bg-surface-soft text-muted">
                        新建
                    </span>
                    <i
                        className={
                            "fa-solid fa-check text-[11px] text-accent " +
                            (preview.kind === "create" ? "" : "invisible")
                        }
                    />
                </button>

                {focusedAgent == null ? (
                    <div className="mx-1 mb-1 mt-0.5 flex items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--error-color,orange)_26%,transparent)] bg-[color-mix(in_srgb,var(--error-color,orange)_10%,transparent)] px-2 py-1.5 text-[11px] text-[color:var(--error-color,orange)]">
                        <i className="fa-solid fa-triangle-exclamation text-[10px] mt-0.5" />
                        <span>请用下方选择 Agents / Type / Folder 新建一个 Agent Block。</span>
                    </div>
                ) : null}
            </div>

            {/* 2. 选择 Agents（样式对齐 New Agent 弹窗的 agent 选择行：左强调条 + 图标 + 默认勾） */}
            <div className="px-2.5 pt-2 pb-1.5 border-t border-border/60">
                <div className={sectionHeadClass}>
                    <i className="fa-solid fa-robot text-[9px]" />
                    选择 Agents
                </div>
                <div className="flex flex-wrap gap-0.5 px-0.5">
                    {profiles.map((profile) => {
                        const isSelected = preview.profileName === profile.name;
                        const iconSpec = getAgentIcon(profile.name, { personas: personaMap });
                        return (
                            <div
                                key={profile.name}
                                className={clsx(
                                    "group inline-flex items-center h-[30px] rounded-md transition-colors cursor-pointer",
                                    isSelected ? "bg-accent/12 relative" : "hover:bg-surface-soft"
                                )}
                            >
                                {isSelected ? (
                                    <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-accent rounded-full" />
                                ) : null}
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 h-full pl-2.5 pr-1 rounded-l-md text-xs font-medium border-none bg-transparent cursor-pointer"
                                    onClick={() => setConfig({ ...config, profile: profile.name })}
                                    title={profile.isDefault ? `${profile.label}（default）` : profile.label}
                                    aria-pressed={isSelected}
                                >
                                    <span
                                        className={clsx(
                                            "shrink-0 flex items-center justify-center transition-colors",
                                            isSelected ? "text-foreground" : "text-muted group-hover:text-secondary"
                                        )}
                                    >
                                        {iconSpec == null ? null : iconSpec.kind === "emoji" ? (
                                            <span className="agent-emoji-icon">{iconSpec.emoji}</span>
                                        ) : (
                                            iconSpec.icon
                                        )}
                                    </span>
                                    <span
                                        className={clsx(
                                            isSelected ? "text-foreground" : "text-muted group-hover:text-secondary"
                                        )}
                                    >
                                        {profile.label}
                                    </span>
                                </button>
                                <span
                                    className={clsx(
                                        "w-5 h-5 shrink-0 inline-flex items-center justify-center",
                                        profile.isDefault ? "text-accent" : "text-transparent"
                                    )}
                                    aria-label={profile.isDefault ? "default agent" : undefined}
                                    title={profile.isDefault ? "默认 agent" : undefined}
                                >
                                    {profile.isDefault ? <i className="fa-solid fa-check text-[10px]" /> : null}
                                </span>
                            </div>
                        );
                    })}
                    {profiles.length === 0 ? (
                        <span className="text-[11.5px] text-muted py-1">未探测到可用 agent</span>
                    ) : null}
                </div>
            </div>

            {/* 3. 选择 Type（Tab） */}
            <div className="px-2.5 pt-2 pb-1.5 border-t border-border/60">
                <div className={sectionHeadClass}>
                    <i className="fa-solid fa-table-columns text-[9px]" />
                    选择 Type
                    <span className="ml-auto font-mono normal-case tracking-normal">默认 = 当前 Tab</span>
                </div>
                <div className="flex items-center gap-1.5 px-0.5">
                    <button
                        type="button"
                        className="flex-1 min-w-0 flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border border-border/60 bg-surface-soft hover:border-border cursor-pointer"
                        onClick={(e) => (menuOpen === "tab" ? closeMenu() : openMenu("tab", e))}
                        onKeyDown={(e) => {
                            if (e.key === "Escape" && menuOpen === "tab") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeMenu();
                            }
                        }}
                        title="选择目标 Tab"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen === "tab"}
                    >
                        <i className="fa-solid fa-table-columns text-[10px] text-secondary" />
                        <span className="truncate">{selectedTabName}</span>
                        <span
                            className={
                                "text-[9.5px] px-1.5 py-px rounded-full " +
                                (config.tab.kind === "current"
                                    ? "bg-actionsoft text-accent"
                                    : "bg-surface-soft text-muted")
                            }
                        >
                            {config.tab.kind === "current" ? "当前" : config.tab.kind === "new" ? "新建" : "已存在"}
                        </span>
                        <i className="fa-solid fa-chevron-down text-[9px] text-muted ml-auto" />
                    </button>
                    <button
                        type="button"
                        className="h-[32px] w-[32px] shrink-0 rounded-md border border-dashed border-border grid place-items-center text-[12px] text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--accent-color)_45%,transparent)] hover:bg-actionsoft cursor-pointer"
                        onClick={() => setConfig({ ...config, tab: { kind: "new" } })}
                        title="新建 Tab"
                    >
                        <i className="fa-solid fa-plus" />
                    </button>
                </div>
            </div>

            {/* 4. 选择 Folder（cwd） */}
            <div className="px-2.5 pt-2 pb-1.5 border-t border-border/60">
                <div className={sectionHeadClass}>
                    <i className="fa-solid fa-folder-open text-[9px]" />
                    选择 Folder
                    <span className="ml-auto font-mono normal-case tracking-normal">默认 = 聚焦块目录</span>
                </div>
                <div className="flex items-center gap-1.5 px-0.5">
                    <button
                        type="button"
                        className="flex-1 min-w-0 flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border border-border/60 bg-surface-soft hover:border-border cursor-pointer"
                        onClick={(e) => (menuOpen === "folder" ? closeMenu() : openMenu("folder", e))}
                        onKeyDown={(e) => {
                            if (e.key === "Escape" && menuOpen === "folder") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeMenu();
                            }
                        }}
                        title="选择项目目录（cwd）"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen === "folder"}
                    >
                        <i className="fa-solid fa-folder text-[10px] text-secondary" />
                        <span className="truncate font-mono text-[11px]">{preview.folder || "继承工作区目录"}</span>
                        <span
                            className={
                                "text-[9.5px] px-1.5 py-px rounded-full " +
                                (config.folder == null ? "bg-actionsoft text-accent" : "bg-surface-soft text-muted")
                            }
                        >
                            {config.folder == null ? "跟随" : "已选"}
                        </span>
                        <i className="fa-solid fa-chevron-down text-[9px] text-muted ml-auto" />
                    </button>
                    <button
                        type="button"
                        className="h-[32px] w-[32px] shrink-0 rounded-md border border-dashed border-border grid place-items-center text-[12px] text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--accent-color)_45%,transparent)] hover:bg-actionsoft cursor-pointer"
                        onClick={() => browseFolder(setConfig, config, props.onStatus)}
                        title="浏览其他目录…"
                    >
                        <i className="fa-solid fa-ellipsis" />
                    </button>
                </div>
            </div>

            {/* 5. 确认行 */}
            <div className="flex items-center gap-2 px-2.5 py-2 border-t border-border/60">
                <span className="min-w-0 flex-1 text-[10.5px] text-muted truncate">
                    目标 ={" "}
                    <b className="font-medium text-secondary">
                        {preview.kind === "existing" ? "聚焦块（已存在）" : "新建"}
                        {preview.kind === "create" && preview.cwd ? ` · ${preview.cwd}` : ""}
                    </b>
                </span>
                <Button className="grey" onClick={props.close}>
                    取消
                </Button>
                <Button className="green" onClick={doSend} disabled={preview.profileName == null} title={preview.label}>
                    <i className="fa-solid fa-paper-plane mr-1" />
                    发送
                </Button>
            </div>

            {/* Type / Folder 的二级下拉（portal 到 body，zIndex 1001，不被面板 overflow 裁剪） */}
            <AnchoredMenu
                open={menuOpen === "tab"}
                anchor={menuOpen === "tab" ? menuAnchor : null}
                label="选择目标 Tab"
                onClose={closeMenu}
            >
                {tabCandidates.map((tab) => (
                    <button
                        key={tab.tabId}
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                            // 选中的就是当前 tab → 回到「跟随当前」态，而不是显式 existing。
                            setConfig({
                                ...config,
                                tab: tab.isCurrent ? { kind: "current" } : { kind: "existing", tabId: tab.tabId },
                            });
                            closeMenu();
                        }}
                    >
                        <i className="fa-regular fa-square text-[10px] text-secondary" />
                        <span className="truncate">{tab.name}</span>
                        <span className="ml-auto text-[10px] text-muted font-mono">
                            {tab.isCurrent ? "当前" : "已存在"}
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    className={menuItemClass + " border-t border-border/60 mt-1 pt-1.5"}
                    onClick={() => {
                        setConfig({ ...config, tab: { kind: "new" } });
                        closeMenu();
                    }}
                >
                    <i className="fa-solid fa-plus text-[10px] text-secondary" />
                    <span>新建 Tab</span>
                </button>
            </AnchoredMenu>
            <AnchoredMenu
                open={menuOpen === "folder"}
                anchor={menuOpen === "folder" ? menuAnchor : null}
                label="选择项目目录"
                onClose={closeMenu}
            >
                {folderCandidates.map((candidate) => (
                    <button
                        key={candidate.path}
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                            setConfig({ ...config, folder: candidate.path });
                            closeMenu();
                        }}
                    >
                        <i className="fa-regular fa-folder text-[10px] text-secondary" />
                        <span className="truncate font-mono text-[11px]">{candidate.path}</span>
                        <span className="ml-auto text-[10px] text-muted">{candidate.note}</span>
                    </button>
                ))}
                {folderCandidates.length === 0 ? (
                    <span className="px-2 py-1.5 text-[11px] text-muted">无可用目录</span>
                ) : null}
            </AnchoredMenu>
        </div>
    );
}

async function browseFolder(
    setConfig: (config: CommontextSendConfig) => void,
    config: CommontextSendConfig,
    onStatus: SendStatusHandler
): Promise<void> {
    try {
        const dir = await getApi().pickDirectory();
        if (dir != null && dir !== "") {
            setConfig({ ...config, folder: dir });
        }
    } catch (error) {
        onStatus(`Pick directory failed: ${(error as Error)?.message ?? "unknown"}`, "err");
    }
}

/** 收集当前 tab 内 agent/term 块的 cwd（Folder 候选次序：聚焦块 → 同 tab 块 → 工作区 → home）。 */
function collectTabAgentBlocks(): { blockId: string; info: AgentBlockInfo }[] {
    const out: { blockId: string; info: AgentBlockInfo }[] = [];
    for (const [blockId, bcm] of blockComponentModelMap.entries()) {
        if (blockId == null || bcm == null) continue;
        if (bcm.viewModel?.viewType !== "term") continue;
        const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        const info = extractAgentBlockInfo(block ?? null, blockId);
        if (info != null && info.cwd != null) {
            out.push({ blockId, info });
        }
    }
    return out;
}

function useAtomConfig(): [CommontextSendConfig, (config: CommontextSendConfig) => void] {
    const config = useAtomValue(commontextSendConfigAtom);
    const setConfig = React.useCallback((next: CommontextSendConfig) => {
        globalStore.set(commontextSendConfigAtom, next);
    }, []);
    return [config, setConfig];
}

/**
 * Send split button：主段按当前配置直接发送；caret 段打开目标选择面板。
 * 弹窗内多处共用一个配置 atom（commontextSendConfigAtom）。
 *
 * 历史 bug（2026-11-11）：旧实现自建 <div class="fixed inset-0"> 遮罩把弹层挂 body，
 * 遮罩 position:fixed + z-index:auto 自成层叠上下文，把内部 z-1000 困在 .modal-wrapper(z:500)
 * 之下 → 弹层开了但完全看不见/不可点。现改为 SplitButton（floating-ui，无定位 body 容器）。
 */
export const CommontextSendButton = ({
    text,
    onSent,
    onStatus,
}: {
    text: string;
    onSent: () => void;
    onStatus: SendStatusHandler;
}) => {
    const [popoverOpen, setPopoverOpen] = React.useState(false);
    const config = useAtomValue(commontextSendConfigAtom);
    const focusedAgent = useAtomValue(focusedAgentBlockInfoAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const profiles = useDetectedAgentProfileOptions(settings);
    const preview = React.useMemo(
        () => previewSendTarget({ config, focusedAgent, profiles, workspaceCwd: getWorkspaceContextCwd() }),
        [config, focusedAgent, profiles]
    );

    const quickSend = () => {
        fireAndForget(async () => {
            const ok = await executeCommonTextSend({ text, config, focusedAgent, profiles, onStatus });
            if (ok) onSent();
        });
    };

    return (
        <div className="inline-flex" data-commontext-send-button>
            <SplitButton
                icon={<i className="fa-solid fa-paper-plane" />}
                label="Send"
                onPrimaryClick={quickSend}
                primaryTitle={`Send（${preview.label}）— 点右侧箭头选择目标`}
                primaryDisabled={preview.profileName == null && preview.kind === "create"}
                caretTitle="选择 Agent / Type / Folder"
                caretAriaLabel="选择发送目标"
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
                menuLabel="发送目标"
                menuWidth={380}
                menuClassName="commontext-send-target-panel"
                render={({ close }) => (
                    <SendTargetPanel text={text} onSent={onSent} onStatus={onStatus} close={close} />
                )}
            />
        </div>
    );
};
