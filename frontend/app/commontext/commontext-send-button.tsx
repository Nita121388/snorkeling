// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器：split button（主键按当前配置直接发送）+ popover（三项正交选择 + 确认）。
// 设计依据：design/prototypes/commontext/commontext-send-agent-block/
// 规则：只有 Agent Block（term + agent:* meta）才能作为「已存在」目标；其余组合都会新建 agent block，
// 文本经 pending-input 排队，TUI 就绪后由 term 视图注入。

import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { useAgentReadContext } from "@/app/agent-status/use-agent-status-view";
import { createPortal } from "react-dom";
import { blockComponentModelMap } from "@/app/store/global-atoms";
import { Button } from "@/app/element/button";
import { AgentStatusChip } from "@/app/session-overview/agent-status-chip";
import { filterSessionOverviewTabIds } from "@/app/session-overview/session-overview-model";
import { atoms, createBlock, getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { ObjectService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import {
    createAgentBlockDefForProfile,
    getCurrentWorkspaceContextMeta,
    getAgentProfileOptions,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import * as React from "react";
import { stripSessionTagHashes } from "@/app/view/aisessions/session-tags";
import { sendTextToFocusedTerm } from "./commontext-insert";
import { registerPendingInput } from "./pending-input";
import {
    collectFolderCandidates,
    defaultSendFolder,
    extractAgentBlockInfo,
    resolveSendTarget,
    type AgentBlockInfo,
    type FolderCandidate,
    type SendTabSelection,
} from "./commontext-send-target";

// ───────────────────────── 共享配置（弹窗内多处 Send 共用） ─────────────────────────

export type CommontextSendConfig = {
    /** null = 跟随聚焦块的 agent（无聚焦时用 default profile） */
    profile: string | null;
    tab: SendTabSelection;
    /** null = 跟随聚焦块 cwd（无聚焦时用当前工作区 cwd） */
    folder: string | null;
};

export const commontextSendConfigAtom = atom<CommontextSendConfig>({
    profile: null,
    tab: { kind: "current" },
    folder: null,
});

export type SendStatusKind = "info" | "ok" | "err";
export type SendStatusHandler = (message: string, kind?: SendStatusKind) => void;

const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

/** popover 挂 body：.modal 有 overflow:hidden，inline 渲染会被截断。 */
function Portal({ children }: { children: React.ReactNode }): React.ReactPortal {
    return createPortal(children, document.body);
}

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
            blockId = await ObjectService.CreateBlockInTab(
                targetTabId,
                blockDef,
                DefaultRuntimeOpts,
                true,
                false
            );
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

const popoverShellClass =
    "fixed z-[var(--zindex-tooltip,1000)] w-[380px] max-w-[92vw] rounded-[10px] border border-border bg-modalbg shadow-[0_16px_40px_rgba(0,0,0,0.4)] p-2 flex flex-col gap-0.5";

const sectionHeadClass = "flex items-center gap-1.5 px-1.5 pb-1.5 text-[10.5px] uppercase tracking-wider text-muted";

/** Type（Tab）候选行 + Folder 候选行共用的下拉菜单 */
function PickerMenu(props: {
    open: boolean;
    anchorRect: DOMRect | null;
    onClose: () => void;
    children: React.ReactNode;
}) {
    if (!props.open || props.anchorRect == null) return null;
    const top = Math.min(props.anchorRect.bottom + 6, window.innerHeight - 240);
    const left = Math.max(8, Math.min(props.anchorRect.left, window.innerWidth - 392));
    return (
        <Portal>
            <div className="fixed inset-0" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}>
                <div
                    className={popoverShellClass}
                    style={{ top, left }}
                    onClick={(e) => e.stopPropagation()}
                    data-commontext-send-picker=""
                >
                    {props.children}
                </div>
            </div>
        </Portal>
    );
}

const menuItemClass =
    "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-[12px] hover:bg-hoverbg cursor-pointer bg-transparent border-0 text-[color:var(--main-text-color)]";

// ─── Send 目标 popover ───

function SendTargetPopover(props: {
    anchorRect: DOMRect;
    text: string;
    onSent: () => void;
    onStatus: SendStatusHandler;
    onClose: () => void;
}) {
    const [config, setConfig] = useAtomConfig();
    const focusedAgent = useAtomValue(focusedAgentBlockInfoAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const tabCandidates = useAtomValue(sendTabCandidatesAtom);
    const profiles = React.useMemo(() => getAgentProfileOptions(settings), [settings]);
    const [menuOpen, setMenuOpen] = React.useState<"tab" | "folder" | null>(null);
    const [menuAnchor, setMenuAnchor] = React.useState<DOMRect | null>(null);

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
        setMenuAnchor(event.currentTarget.getBoundingClientRect());
        setMenuOpen(kind);
    };

    const doSend = () => {
        fireAndForget(async () => {
            const ok = await executeCommonTextSend({ text: props.text, config, focusedAgent, profiles, onStatus: props.onStatus });
            if (ok) props.onSent();
        });
    };

    const currentTabName = tabCandidates.find((t) => t.isCurrent)?.name;
    const selectedTabName =
        config.tab.kind === "current"
            ? currentTabName ?? "当前 Tab"
            : config.tab.kind === "new"
              ? "新 Tab"
              : tabCandidates.find((t) => t.tabId === (config.tab as { tabId: string }).tabId)?.name ?? "Tab";

    return (
        <Portal>
            <div className="fixed inset-0" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}>
                <div
                    className={popoverShellClass}
                    style={{
                        top: Math.min(props.anchorRect.bottom + 6, window.innerHeight - 300),
                        right: Math.max(8, window.innerWidth - props.anchorRect.right),
                    }}
                    onClick={(e) => e.stopPropagation()}
                    data-commontext-send-popover
                >
                    {/* 1. 聚焦 Agent Block */}
                    <div className="px-1 pb-1">
                        <div className={sectionHeadClass}>
                            <i className="fa-solid fa-crosshairs text-[9px]" />
                            聚焦的 Agent Block
                            <span className="ml-auto font-mono normal-case tracking-normal">已存在</span>
                        </div>
                        {focusedAgent != null ? (
                            <button
                                type="button"
                                className={menuItemClass + (preview.kind === "existing" ? " bg-actionsoft" : "")}
                                onClick={() =>
                                    setConfig({ profile: null, tab: { kind: "current" }, folder: null })
                                }
                                title="使用聚焦块：Agent / Type / Folder 三项跟随聚焦块"
                            >
                                <div className="min-w-0 flex-1">
                                    <AgentMiniCard info={focusedAgent} />
                                </div>
                                <i
                                    className={
                                        "fa-solid fa-check text-[11px] text-accent " +
                                        (preview.kind === "existing" ? "" : "invisible")
                                    }
                                />
                            </button>
                        ) : (
                            <>
                                <div className="px-2 py-2 text-[11.5px] text-muted">
                                    当前聚焦块不是 Agent Block — 不可直接发送
                                </div>
                                <div className="mx-1 mb-1 flex items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--error-color,orange)_26%,transparent)] bg-[color-mix(in_srgb,var(--error-color,orange)_10%,transparent)] px-2 py-1.5 text-[11px] text-[color:var(--error-color,orange)]">
                                    <i className="fa-solid fa-triangle-exclamation text-[10px] mt-0.5" />
                                    <span>请用下方选择 Agents / Type / Folder 新建一个 Agent Block。</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 2. 选择 Agents */}
                    <div className="px-1 pb-1 border-t border-border-soft">
                        <div className={sectionHeadClass}>
                            <i className="fa-solid fa-robot text-[9px]" />
                            选择 Agents
                        </div>
                        <div className="flex flex-wrap gap-1.5 px-0.5">
                            {profiles.map((profile) => (
                                <button
                                    key={profile.name}
                                    type="button"
                                    className={
                                        "text-[11.5px] px-2 py-1 rounded-md border cursor-pointer " +
                                        (preview.profileName === profile.name
                                            ? "bg-actionsoft text-accent border-[color-mix(in_srgb,var(--accent-color)_34%,transparent)]"
                                            : "bg-surface-soft text-secondary border-border-soft hover:text-[color:var(--main-text-color)]")
                                    }
                                    onClick={() => setConfig({ ...config, profile: profile.name })}
                                    title={profile.isDefault ? `${profile.label}（default）` : profile.label}
                                >
                                    {profile.label}
                                    {profile.isDefault ? <i className="fa-solid fa-star text-[9px] ml-1 text-[color:var(--error-color,orange)]" /> : null}
                                </button>
                            ))}
                            {profiles.length === 0 ? (
                                <span className="text-[11.5px] text-muted py-1">未探测到可用 agent</span>
                            ) : null}
                        </div>
                    </div>

                    {/* 3. 选择 Type（Tab） */}
                    <div className="px-1 pb-1 border-t border-border-soft">
                        <div className={sectionHeadClass}>
                            <i className="fa-solid fa-table-columns text-[9px]" />
                            选择 Type
                            <span className="ml-auto font-mono normal-case tracking-normal">默认 = 当前 Tab</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-0.5">
                            <button
                                type="button"
                                className="flex-1 min-w-0 flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border border-border-soft bg-surface-soft hover:border-border cursor-pointer"
                                onClick={(e) => openMenu("tab", e)}
                                title="选择目标 Tab"
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
                    <div className="px-1 pb-1 border-t border-border-soft">
                        <div className={sectionHeadClass}>
                            <i className="fa-solid fa-folder-open text-[9px]" />
                            选择 Folder
                            <span className="ml-auto font-mono normal-case tracking-normal">默认 = 聚焦块目录</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-0.5">
                            <button
                                type="button"
                                className="flex-1 min-w-0 flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md border border-border-soft bg-surface-soft hover:border-border cursor-pointer"
                                onClick={(e) => openMenu("folder", e)}
                                title="选择项目目录（cwd）"
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
                    <div className="flex items-center gap-2 px-1.5 pt-2 border-t border-border-soft">
                        <span className="min-w-0 flex-1 text-[10.5px] text-muted truncate">
                            目标 ={" "}
                            <b className="font-medium text-secondary">
                                {preview.kind === "existing" ? "聚焦块（已存在）" : "新建"}
                                {preview.kind === "create" && preview.cwd ? ` · ${preview.cwd}` : ""}
                            </b>
                        </span>
                        <Button className="grey" onClick={props.onClose}>
                            取消
                        </Button>
                        <Button className="green" onClick={doSend} disabled={preview.profileName == null} title={preview.label}>
                            <i className="fa-solid fa-paper-plane mr-1" />
                            发送
                        </Button>
                    </div>
                </div>
            </div>

            {/* Type / Folder 的二级下拉 */}
            <PickerMenu
                open={menuOpen === "tab"}
                anchorRect={menuAnchor}
                onClose={() => setMenuOpen(null)}
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
                            setMenuOpen(null);
                        }}
                    >
                        <i className="fa-regular fa-square text-[10px] text-secondary" />
                        <span className="truncate">{tab.name}</span>
                        <span className="ml-auto text-[10px] text-muted font-mono">{tab.isCurrent ? "当前" : "已存在"}</span>
                    </button>
                ))}
                <button
                    type="button"
                    className={menuItemClass + " border-t border-border-soft mt-1 pt-1.5"}
                    onClick={() => {
                        setConfig({ ...config, tab: { kind: "new" } });
                        setMenuOpen(null);
                    }}
                >
                    <i className="fa-solid fa-plus text-[10px] text-secondary" />
                    <span>新建 Tab</span>
                    <i className="fa-solid fa-check text-[10px] ml-auto text-accent invisible" />
                </button>
            </PickerMenu>
            <PickerMenu
                open={menuOpen === "folder"}
                anchorRect={menuAnchor}
                onClose={() => setMenuOpen(null)}
            >
                {folderCandidates.map((candidate) => (
                    <button
                        key={candidate.path}
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                            setConfig({ ...config, folder: candidate.path });
                            setMenuOpen(null);
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
            </PickerMenu>
        </Portal>
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
 * Send split button：主键按当前配置直接发送；caret 打开目标选择 popover。
 * 弹窗内多处共用一个配置 atom（commontextSendConfigAtom）。
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
    const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
    const buttonRef = React.useRef<HTMLDivElement | null>(null);
    const config = useAtomValue(commontextSendConfigAtom);
    const focusedAgent = useAtomValue(focusedAgentBlockInfoAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const profiles = React.useMemo(() => getAgentProfileOptions(settings), [settings]);
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

    const openPopover = () => {
        if (buttonRef.current != null) {
            setAnchorRect(buttonRef.current.getBoundingClientRect());
        }
        setPopoverOpen(true);
    };

    return (
        <div ref={buttonRef} className="inline-flex" data-commontext-send-button>
            <Button
                className="grey rounded-r-none border-r-0"
                onClick={quickSend}
                title={`Send（${preview.label}）— 点右侧箭头选择目标`}
                disabled={preview.profileName == null && preview.kind === "create"}
            >
                <i className="fa-solid fa-paper-plane mr-1" />
                Send
            </Button>
            <Button
                className="grey rounded-l-none"
                onClick={openPopover}
                title="选择 Agent / Type / Folder"
                aria-label="选择发送目标"
                aria-haspopup="menu"
                aria-expanded={popoverOpen}
            >
                <i className="fa-solid fa-chevron-down text-[9px]" />
            </Button>
            {popoverOpen && anchorRect != null ? (
                <SendTargetPopover
                    anchorRect={anchorRect}
                    text={text}
                    onSent={onSent}
                    onStatus={onStatus}
                    onClose={() => setPopoverOpen(false)}
                />
            ) : null}
        </div>
    );
};
