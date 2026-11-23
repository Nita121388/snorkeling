// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText Send 目标选择器：split button（主键按当前配置直接发送）+ popover（目标卡 + Agent/Tab/目录三行常显 + 确认）。
// 设计依据：design/prototypes/commontext/commontext-send-compact/（v2）
// 规则：只有 Agent Block（term + agent:* meta）才能作为「已存在」目标；其余组合都会新建 agent block，
// 文本经后端 agentsend 投递（就绪门 + paste + 回车 + 提交确认，与 existing 路径同一入口；R10 同款，2026-11-23）。
// 目录候选随所选 Tab（collectAgentLaunchTargetsInTab），切 Tab 后 folder 重置为跟随。

import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { Button } from "@/app/element/button";
import { SplitButton } from "@/app/element/splitbutton";
import { filterSessionOverviewTabIds } from "@/app/session-overview/session-overview-model";
import { atoms, createBlock, getApi, getFocusedBlockId } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as WOS from "@/app/store/wos";
import { stripSessionTagHashes } from "@/app/view/aisessions/session-tags";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import {
    collectAgentLaunchTargetsInTab,
    createAgentBlockDefForProfile,
    getCurrentWorkspaceContextMeta,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { useDetectedAgentProfileOptions } from "@/app/workspace/use-agent-profile-options";
import { i18n } from "@/i18n/config";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { fireAndForget, stringToBase64 } from "@/util/util";
import { FloatingPortal, offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { sendTextToFocusedTerm } from "./commontext-insert";
import {
    collectFolderCandidatesForTab,
    defaultSendFolder,
    extractAgentBlockInfo,
    planSendActivation,
    resolveFolderScopeTabId,
    resolveSendTarget,
    type AgentBlockInfo,
    type FolderCandidate,
    type SendTabSelection,
} from "./commontext-send-target";

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
    /**
     * 后台执行（默认开）：建块时不跳转目标 Tab（后端 activateTargetTab=false、不调 setActiveTab），
     * 目标 Tab 未激活时临时隐藏挂载等待 TUI 就绪注入。关掉则保留旧的「跳过去再发送」行为。
     */
    background: boolean;
    /** null = 跟随聚焦块的 agent（无聚焦时用 default profile） */
    profile: string | null;
    tab: SendTabSelection;
    /** null = 跟随聚焦块 cwd（无聚焦时用当前工作区 cwd） */
    folder: string | null;
};

export const commontextSendConfigAtom = atom<CommontextSendConfig>({
    mode: "focused",
    background: true,
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
    /** 目录默认值（跟随所选 Tab 的推荐项）；config.folder 显式选择时优先生效 */
    folderDefault?: string;
}): SendTargetPreview {
    const { config, focusedAgent, profiles } = input;
    const profileName = config.profile ?? focusedAgent?.provider ?? defaultProfileName(profiles);
    const profileLabel = profiles.find((p) => p.name === profileName)?.label ?? profileName ?? "Agent";
    const inheritedDefault = (input.folderDefault ?? "").trim();
    const folder =
        config.folder ??
        (inheritedDefault !== "" ? inheritedDefault : defaultSendFolder(focusedAgent, input.workspaceCwd ?? ""));
    if (profileName == null) {
        return {
            kind: "create",
            label: i18n.t("commontext:send.noAgent"),
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
            // existing 判定不用默认值（null = 跟随聚焦块）；仅 create 路径用它作 cwd 兜底
            folderDefault: inheritedDefault !== "" ? inheritedDefault : null,
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
 * 执行一次 Send。existing → 直接注入聚焦块；create → 建块 + 后端 agentsend 投递。
 * 返回 true 表示已成功发起（提交确认由后端异步完成，见 [agentsend] 日志）。
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
        onStatus?.(i18n.t("commontext:send.nothingToSend"), "err");
        return false;
    }
    const preview = previewSendTarget({
        config,
        focusedAgent,
        profiles,
        folderDefault: collectSendFolderCandidates(config)[0]?.path,
    });
    if (preview.profileName == null) {
        onStatus?.(i18n.t("commontext:send.noProfile"), "err");
        return false;
    }
    if (preview.kind === "existing") {
        const blockId = focusedAgent!.blockId;
        // R10（11-18 包）：本地块改走后端 agentsend（就绪等待 + 一次 bracketed paste + 回车，
        // 全链在 blockcontroller.SendInput 单写路径上），不再用前端「paste 后固定 150ms 补回车」
        // 的启发式竞态。远端块（agentsend 本地限制）与 E_UNSUPPORTED 回退旧前端链。
        const connection = typeof focusedAgent!.connection === "string" ? focusedAgent!.connection.trim() : "";
        const isRemote = connection !== "" && connection !== "local" && !connection.startsWith("local:");
        if (!isRemote) {
            // 派发不等待：后台投递（后端做就绪门 + 提交确认，agent 启动慢也不卡弹窗）。
            onStatus?.(i18n.t("commontext:send.sent"), "ok");
            fireAndForget(async () => {
                try {
                    const sendResult = await RpcApi.AgentSendCommand(TabRpcClient, {
                        blockid: blockId,
                        text64: stringToBase64(cleanText),
                        submit: true,
                        async: true,
                        requester: "desktop",
                    });
                    if (sendResult?.submitconfirmed === false) {
                        console.warn("[commontext] 消息已放入输入框但未确认提交", { blockId });
                    }
                } catch (error) {
                    console.warn("[commontext] 发送失败", { blockId, error });
                }
            });
            return true;
        }
        // 远端块：保留前端 paste 链（agentsend 拒绝远端）
        const target = sendTextToFocusedTerm(cleanText, [blockId]);
        if (target == null) {
            onStatus?.(i18n.t("commontext:send.notReady"), "err");
            return false;
        }
        onStatus?.(i18n.t("commontext:send.sent"), "ok");
        return true;
    }
    // create：folder 为空时继承当前工作区 context
    const settings = globalStore.get(atoms.settingsAtom);
    const context =
        preview.cwd === ""
            ? { inheritWorkspaceContext: true }
            : { connection: null, cwd: preview.cwd, inheritWorkspaceContext: false };
    const blockDef = createAgentBlockDefForProfile(preview.profileName, settings, context);
    // undefined 视为开（旧配置对象没有这个字段时默认后台执行）
    const background = config.background !== false;
    const activation = planSendActivation(background);
    try {
        let blockId: string;
        if (config.tab.kind === "current") {
            blockId = await createBlock(blockDef, false);
        } else if (config.tab.kind === "existing") {
            const targetTabIdOfConfig = config.tab.tabId;
            blockId = await ObjectService.CreateBlockInTab(
                targetTabIdOfConfig,
                blockDef,
                DefaultRuntimeOpts,
                activation.backendActivateExisting,
                false
            );
            // 后台执行：绝不切 Tab。旧行为：建块后把用户视线切过去。
            if (activation.frontActivateTab) getApi().setActiveTab(targetTabIdOfConfig);
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
            if (activation.frontActivateTab) getApi().setActiveTab(result.tabid);
        }
        // 建块成功后再发起投递（失败不留空 entry）。后端 agentsend 与 existing 路径同一入口：
        // 就绪门 + paste + 回车 + confirmSubmit（补回车），前端不再 paste、不再固定延迟回车。
        fireAndForget(async () => {
            try {
                const sendResult = await RpcApi.AgentSendCommand(TabRpcClient, {
                    blockid: blockId,
                    text64: stringToBase64(cleanText),
                    submit: true,
                    async: true,
                    wait: true,
                    waitms: 120000,
                    requester: "desktop",
                });
                if (sendResult?.submitconfirmed === false) {
                    console.warn("[commontext] 新建 agent 消息已放入输入框但未确认提交", { blockId });
                    onStatus?.(i18n.t("commontext:send.submitUnconfirmed"), "err");
                }
            } catch (error) {
                const errorMessage = (error as Error)?.message ?? i18n.t("commontext:send.unknownError");
                const failureText = i18n.t("commontext:send.sendFailed", { error: errorMessage });
                // 翻译层没插值（未装载语言包 / 测试 mock）时补上原始错误，保证报错可定位。
                onStatus?.(
                    failureText.includes(errorMessage) ? failureText : `${failureText} [${errorMessage}]`,
                    "err"
                );
                console.warn("[commontext] 新建 agent 发送失败", { blockId, error });
            }
        });
        onStatus?.(
            background
                ? i18n.t("commontext:send.sentBackground", { agent: preview.profileLabel })
                : i18n.t("commontext:send.sentPending", { agent: preview.profileLabel }),
            "ok"
        );
        return true;
    } catch (error) {
        onStatus?.(
            i18n.t("commontext:send.sendFailed", {
                error: (error as Error)?.message ?? i18n.t("commontext:send.unknownError"),
            }),
            "err"
        );
        return false;
    }
}

// ───────────────────────── UI ─────────────────────────

/** 目标模式 chip（与 Agents 行同款视觉：accent 软底 + 左强调条 + 选中 ✓）。 */
function TargetChip(props: {
    mode: "focused" | "create";
    selected: boolean;
    icon: React.ReactNode;
    label: string;
    title: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            data-commontext-send-mode={props.mode}
            className={clsx(
                "relative inline-flex items-center gap-2 h-[28px] px-2.5 rounded-md text-xs transition-colors cursor-pointer border-0",
                props.selected
                    ? "bg-accent/12 text-foreground"
                    : "bg-transparent text-muted hover:bg-surface-soft hover:text-secondary"
            )}
            onClick={props.onClick}
            title={props.title}
            aria-pressed={props.selected}
        >
            {props.selected ? <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-accent rounded-full" /> : null}
            <span className="shrink-0">{props.icon}</span>
            <span className="shrink-0">{props.label}</span>
            <i className={clsx("fa-solid fa-check text-[10px]", props.selected ? "text-accent" : "invisible")} />
        </button>
    );
}

const menuItemClass =
    "split-menu-item flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-left text-[12px] cursor-pointer bg-transparent border-0 text-[color:var(--main-text-color)] hover:bg-hoverbg";

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
                className="rounded-lg border border-border/70 bg-modalbg/95 backdrop-blur-2xl shadow-2xl p-1.5 flex flex-col gap-1 max-h-[280px] overflow-y-auto overflow-x-hidden"
                style={{ ...floatingStyles, zIndex: 1001, width: "min(440px, 94vw)" }}
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
    const { t } = useTranslation("commontext");
    const [config, setConfig] = useAtomConfig();
    const personaMap = useAgentPersonas();
    const focusedAgent = useAtomValue(focusedAgentBlockInfoAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const tabCandidates = useAtomValue(sendTabCandidatesAtom);
    const profiles = useDetectedAgentProfileOptions(settings);
    const [menuOpen, setMenuOpen] = React.useState<"tab" | "folder" | null>(null);
    const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

    const workspaceCwd = getWorkspaceContextCwd();
    const preview = previewSendTarget({
        config,
        focusedAgent,
        profiles,
        workspaceCwd,
        folderDefault: collectSendFolderCandidates(config)[0]?.path,
    });
    const folderCandidates: FolderCandidate[] = React.useMemo(() => collectSendFolderCandidates(config), [config]);

    const openMenu = (kind: "tab" | "folder", event: React.MouseEvent<HTMLElement>) => {
        setMenuAnchor(event.currentTarget);
        setMenuOpen(kind);
    };

    const closeMenu = () => setMenuOpen(null);

    // Tab / 目录切换统一在这里发生：切 Tab 一律把 folder 重置为「跟随该 Tab」
    const applyTab = (tab: SendTabSelection) => setConfig({ ...config, tab, folder: null });

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

    const currentTabName = tabCandidates.find((tab) => tab.isCurrent)?.name;
    const selectedTabName =
        config.tab.kind === "current"
            ? (currentTabName ?? i18n.t("commontext:send.tabCurrentTab"))
            : config.tab.kind === "new"
              ? i18n.t("commontext:send.tabNewTab")
              : (tabCandidates.find((tc) => tc.tabId === (config.tab as { tabId: string }).tabId)?.name ??
                i18n.t("commontext:send.tabFallback"));
    const tabNote =
        config.tab.kind === "current"
            ? t("commontext:send.tabCurrent")
            : config.tab.kind === "new"
              ? t("commontext:send.tabNoteNew")
              : t("commontext:send.tabExisting");

    const profileIcon =
        preview.profileName == null ? null : getAgentIcon(preview.profileName, { personas: personaMap });
    const dirLabel = preview.folder !== "" ? preview.folder : t("commontext:send.inheritWorkspace");
    const cardSub = `${selectedTabName} · ${preview.folder !== "" ? preview.folder : t("commontext:send.inheritWorkspace")}`;

    const pickerClass =
        "flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-surface-soft px-2.5 py-2 text-[12px] cursor-pointer hover:border-border";
    const rowLabelClass = "w-9 shrink-0 text-[10px] text-muted";
    const squareButtonClass =
        "h-[34px] w-[36px] shrink-0 rounded-md border border-dashed border-border grid place-items-center text-[12px] text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--accent-color)_45%,transparent)] hover:bg-actionsoft cursor-pointer";

    return (
        <div
            className="flex flex-col"
            data-commontext-send-popover
            /* 2026-11-19 追加：弹层太挤。宽度收口到这里（唯一权威）：宽视口 440px ≥ 420，
               窄视口（≤420px）回落 94vw 不溢出；menu 用 w-fit! 贴合本宽度。 */
            style={{ width: "min(440px, 94vw)" }}
        >
            {/* 1. 目标：chip（聚焦块 / 新建）+ 一张目标卡。落点信息只在这里出现一次。 */}
            <div className="px-3 pt-2.5 pb-2.5">
                <div className="mb-2.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 text-xxs text-muted">
                        <i className="fa-solid fa-crosshairs text-[9px]" />
                        {t("commontext:send.chooseTarget")}
                    </span>
                    <span className="ml-auto flex items-center gap-1" data-commontext-send-modes>
                        {focusedAgent != null ? (
                            <TargetChip
                                mode="focused"
                                selected={preview.kind === "existing"}
                                icon={<i className="fa-solid fa-bullseye text-[10px]" />}
                                label={t("commontext:send.focusedBlock")}
                                title={t("commontext:send.focusedBlockTitle")}
                                onClick={() =>
                                    setConfig({
                                        ...config,
                                        mode: "focused",
                                        profile: null,
                                        tab: { kind: "current" },
                                        folder: null,
                                    })
                                }
                            />
                        ) : null}
                        <TargetChip
                            mode="create"
                            selected={preview.kind === "create"}
                            icon={<i className="fa-solid fa-plus text-[10px]" />}
                            label={t("commontext:send.createNew")}
                            title={t("commontext:send.createNewTitle")}
                            onClick={() => setConfig({ ...config, mode: "create" })}
                        />
                    </span>
                </div>
                <div
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-soft px-3 py-2.5"
                    data-commontext-send-target-card
                >
                    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                        {profileIcon == null ? (
                            <i className="fa-solid fa-robot text-[13px]" />
                        ) : profileIcon.kind === "emoji" ? (
                            <span className="agent-emoji-icon">{profileIcon.emoji}</span>
                        ) : (
                            profileIcon.icon
                        )}
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[12.5px] font-medium leading-tight">
                            {preview.kind === "existing"
                                ? t("commontext:send.focusedBlock")
                                : t("commontext:send.createNew")}
                            <span className="text-muted"> · </span>
                            {preview.profileLabel}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] leading-tight text-muted" title={cardSub}>
                            {cardSub}
                        </div>
                    </div>
                    <span
                        className={clsx(
                            "shrink-0 rounded-full px-1.5 py-px text-[9.5px]",
                            preview.kind === "existing" ? "bg-accent/12 text-accent" : "bg-surface-soft text-muted"
                        )}
                    >
                        {preview.kind === "existing"
                            ? t("commontext:send.badgeExisting")
                            : t("commontext:send.badgeCreate")}
                    </span>
                </div>
            </div>

            {/* 2. 三个选择器常显：Agent / Tab / 目录 */}
            <div
                className="flex flex-col border-t border-border/60 px-3 py-2.5"
                data-commontext-send-rows
                /* 行间距 inline 表达（≥8px）：jsdom 可读 computed rowGap 做数字断言，真实 app 同样生效 */
                style={{ rowGap: "10px" }}
            >
                <div className="flex items-center gap-2.5" data-commontext-agent-row>
                    <span className={rowLabelClass}>{t("commontext:send.rowAgent")}</span>
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pb-0.5">
                        {profiles.map((profile) => {
                            const isSelected = preview.profileName === profile.name;
                            const iconSpec = getAgentIcon(profile.name, { personas: personaMap });
                            return (
                                <button
                                    key={profile.name}
                                    type="button"
                                    data-commontext-agent-chip={profile.name}
                                    className={clsx(
                                        "relative h-[32px] w-[32px] shrink-0 grid place-items-center rounded-md border-0 cursor-pointer transition-colors",
                                        isSelected
                                            ? "bg-accent/12 text-foreground"
                                            : "bg-transparent text-muted hover:bg-surface-soft hover:text-secondary"
                                    )}
                                    onClick={() => setConfig({ ...config, profile: profile.name })}
                                    title={
                                        profile.isDefault
                                            ? i18n.t("commontext:send.defaultProfile", { label: profile.label })
                                            : profile.label
                                    }
                                    aria-label={profile.label}
                                    aria-pressed={isSelected}
                                >
                                    {isSelected ? (
                                        <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-accent" />
                                    ) : null}
                                    {iconSpec == null ? null : iconSpec.kind === "emoji" ? (
                                        <span className="agent-emoji-icon">{iconSpec.emoji}</span>
                                    ) : (
                                        iconSpec.icon
                                    )}
                                    {profile.isDefault ? (
                                        <span
                                            className="absolute right-1 top-1 h-1 w-1 rounded-full bg-accent"
                                            title={t("commontext:send.defaultAgent")}
                                        />
                                    ) : null}
                                </button>
                            );
                        })}
                        {profiles.length === 0 ? (
                            <span className="py-1 text-[11.5px] text-muted">{t("commontext:send.noAgents")}</span>
                        ) : null}
                    </div>
                </div>

                <div className="flex items-center gap-2.5" data-commontext-tab-row>
                    <span className={rowLabelClass}>{t("commontext:send.rowTab")}</span>
                    <button
                        type="button"
                        className={pickerClass}
                        onClick={(e) => (menuOpen === "tab" ? closeMenu() : openMenu("tab", e))}
                        onKeyDown={(e) => {
                            if (e.key === "Escape" && menuOpen === "tab") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeMenu();
                            }
                        }}
                        title={t("commontext:send.chooseTab")}
                        data-commontext-tab-trigger
                        aria-haspopup="menu"
                        aria-expanded={menuOpen === "tab"}
                    >
                        <i className="fa-solid fa-table-columns text-[10px] text-secondary" />
                        <span className="truncate">{selectedTabName}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted">{tabNote}</span>
                        <i className="fa-solid fa-chevron-down text-[9px] text-muted" />
                    </button>
                    <button
                        type="button"
                        className={squareButtonClass}
                        onClick={() => applyTab({ kind: "new" })}
                        title={t("commontext:send.newTab")}
                    >
                        <i className="fa-solid fa-plus" />
                    </button>
                </div>

                <div className="flex items-center gap-2.5" data-commontext-dir-row>
                    <span className={rowLabelClass}>{t("commontext:send.rowFolder")}</span>
                    <button
                        type="button"
                        className={pickerClass}
                        onClick={(e) => (menuOpen === "folder" ? closeMenu() : openMenu("folder", e))}
                        onKeyDown={(e) => {
                            if (e.key === "Escape" && menuOpen === "folder") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeMenu();
                            }
                        }}
                        title={dirLabel}
                        data-commontext-dir-trigger
                        aria-haspopup="menu"
                        aria-expanded={menuOpen === "folder"}
                    >
                        <i className="fa-solid fa-folder text-[10px] text-secondary" />
                        <span className="truncate font-mono text-[10px]">{dirLabel}</span>
                        <span
                            className={clsx(
                                "ml-auto shrink-0 text-[10px]",
                                config.folder == null ? "text-accent" : "text-muted"
                            )}
                            data-commontext-dir-note
                        >
                            {config.folder == null ? t("commontext:send.dirAuto") : t("commontext:send.dirPicked")}
                        </span>
                        <i className="fa-solid fa-chevron-down text-[9px] text-muted" />
                    </button>
                    <button
                        type="button"
                        className={squareButtonClass}
                        onClick={() => browseFolder(setConfig, config, props.onStatus)}
                        title={t("commontext:send.browseOther")}
                    >
                        <i className="fa-solid fa-ellipsis" />
                    </button>
                </div>
            </div>

            {/* 3. footer：后台执行 + 取消 / 主按钮（按钮文案即落点） */}
            <div className="flex items-center gap-2.5 border-t border-border/60 px-3 py-2.5" data-commontext-send-footer>
                <button
                    type="button"
                    role="switch"
                    aria-checked={config.background !== false}
                    aria-label={t("commontext:send.background")}
                    title={t("commontext:send.backgroundHint")}
                    className={clsx(
                        "relative h-[16px] w-[28px] shrink-0 rounded-full border-0 p-0 transition-colors cursor-pointer",
                        config.background !== false ? "bg-accent" : "bg-surface-soft border border-border"
                    )}
                    onClick={() => setConfig({ ...config, background: config.background === false })}
                >
                    {/* 滑块必须是真白：tailwindsetup.css 把 --color-white 重定义成了主文本色，
                        浅色主题下 bg-white 会变成深棕，滑块在 accent 轨道上糊成一团。 */}
                    <span
                        className={clsx(
                            "absolute top-[2px] h-[12px] w-[12px] rounded-full bg-[#fff] transition-all",
                            config.background !== false ? "left-[14px]" : "left-[2px]"
                        )}
                    />
                </button>
                <span className="whitespace-nowrap text-[11.5px] text-secondary">
                    {t("commontext:send.background")}
                </span>
                <span className="ml-auto" />
                <Button className="grey" onClick={props.close}>
                    {t("commontext:send.cancel")}
                </Button>
                <Button
                    className="green"
                    onClick={doSend}
                    disabled={preview.profileName == null}
                    title={preview.label}
                    data-commontext-send-submit
                >
                    <i className="fa-solid fa-paper-plane mr-1" />
                    {preview.kind === "existing" ? t("commontext:send.send") : t("commontext:send.sendCreateOnly")}
                </Button>
            </div>

            {/* Type / Folder 的二级下拉（portal 到 body，不被面板 overflow 裁剪） */}
            <AnchoredMenu
                open={menuOpen === "tab"}
                anchor={menuOpen === "tab" ? menuAnchor : null}
                label={t("commontext:send.chooseTab")}
                onClose={closeMenu}
            >
                {tabCandidates.map((tab) => (
                    <button
                        key={tab.tabId}
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                            applyTab(tab.isCurrent ? { kind: "current" } : { kind: "existing", tabId: tab.tabId });
                            closeMenu();
                        }}
                    >
                        <i className="fa-regular fa-square text-[10px] text-secondary" />
                        <span className="truncate">{tab.name}</span>
                        <span className="ml-auto text-[10px] text-muted font-mono">
                            {tab.isCurrent ? t("commontext:send.tabCurrent") : t("commontext:send.tabExisting")}
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    className={menuItemClass + " border-t border-border/60 mt-1 pt-1.5"}
                    onClick={() => {
                        applyTab({ kind: "new" });
                        closeMenu();
                    }}
                >
                    <i className="fa-solid fa-plus text-[10px] text-secondary" />
                    <span>{t("commontext:send.newTab")}</span>
                </button>
            </AnchoredMenu>
            <AnchoredMenu
                open={menuOpen === "folder"}
                anchor={menuOpen === "folder" ? menuAnchor : null}
                label={t("commontext:send.chooseFolderTitle")}
                onClose={closeMenu}
            >
                <button
                    type="button"
                    className={menuItemClass}
                    onClick={() => {
                        setConfig({ ...config, folder: null });
                        closeMenu();
                    }}
                >
                    <i className="fa-solid fa-wand-magic-sparkles text-[10px] text-secondary" />
                    <span>{t("commontext:send.dirFollowTab")}</span>
                    <span className="ml-auto text-[10px] text-accent">{t("commontext:send.dirAuto")}</span>
                </button>
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
        onStatus(
            i18n.t("commontext:send.pickFailed", {
                error: (error as Error)?.message ?? i18n.t("commontext:send.unknown"),
            }),
            "err"
        );
    }
}

/** 收集当前 tab 内 agent/term 块的 cwd（Folder 候选次序：聚焦块 → 同 tab 块 → 工作区 → home）。 */
/**
 * 目录候选：按 config.tab 解析目标 Tab，收集该 Tab 打开块的 cwd（agent / files / terminal）→ 工作区 → home。
 * current → 当前 Tab；existing → 该 tabId；new → 无块候选。tabId 失效时退化为无块候选，不抛错。
 */
function collectSendFolderCandidates(config: CommontextSendConfig): FolderCandidate[] {
    const workspaceCwd = getWorkspaceContextCwd();
    const homeDir = getHomeDir();
    const scopeTabId = resolveFolderScopeTabId(config.tab, globalStore.get(atoms.staticTabId));
    const fallback = () =>
        collectFolderCandidatesForTab({
            cwds: [],
            workspaceCwd,
            homeDir: homeDir === "" ? null : homeDir,
        });
    if (scopeTabId == null) return fallback();
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", scopeTabId)));
    if (tab == null) return fallback();
    const targets = collectAgentLaunchTargetsInTab(
        tab,
        (blockId) => globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))),
        getFocusedBlockId(),
        { localHomeDir: homeDir === "" ? null : homeDir }
    );
    return collectFolderCandidatesForTab({
        cwds: targets.map((target) => ({ cwd: target.cwd, source: target.source })),
        workspaceCwd,
        homeDir: homeDir === "" ? null : homeDir,
    });
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
    const { t } = useTranslation("commontext");
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
                label={t("commontext:send.label")}
                onPrimaryClick={quickSend}
                primaryTitle={i18n.t("commontext:send.primaryTitle", { target: preview.label })}
                primaryDisabled={preview.profileName == null && preview.kind === "create"}
                caretTitle={t("commontext:send.caretTitle")}
                caretAriaLabel={t("commontext:send.caretAria")}
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
                /* 宽度以 [data-commontext-send-popover] 的 inline min(440px,94vw) 为唯一权威；
                   menu 必须贴合内容（w-fit! 压过 inline menuWidth），否则 440px 面板被 380px menu 裁掉。 */
                menuWidth={460}
                menuClassName="commontext-send-target-panel w-fit!"
                render={({ close }) => (
                    <SendTargetPanel text={text} onSent={onSent} onStatus={onStatus} close={close} />
                )}
            />
        </div>
    );
};
