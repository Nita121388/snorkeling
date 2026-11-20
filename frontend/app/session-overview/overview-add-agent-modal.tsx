// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview「＋ 新建 Agent」弹窗：chrome 与 New Agent 弹窗（hero-launch-window.tsx）同款，
// 但容器用全局 <Modal> 居中（用户 2026-11-20 定稿：居中 + New Agent 同款样式 + 滚动路径列表 + 极简文案）。
//
// 复用面：
//   - 容器            <Modal>（frontend/app/modals/modal.tsx，全仓唯一弹窗壳）
//   - profile 探测     useDetectedAgentProfileOptions（FindCommand 真实探测收口）
//   - 模型候选        loadAgentCatalog（agentprofilelist RPC，与定时任务编辑器同一数据源）
//   - 路径候选        targets 由调用方（session-overview.tsx）用 collectAgentLaunchTargetsInTab 收集；
//                     行组装走纯函数 collectAddAgentPathRows
//   - 文案            全部复用 workspace:agentLaunch / workspace:heroLaunch 词表，不自造新词
//
// 建块（CreateBlockInTab + createAgentBlockDefForProfile）与首发消息（AgentSendCommand）在
// 调用方 session-overview.tsx —— 本组件只产出一次结构化的提交请求，保持可单测（dom.test 断言请求体）。
//
// 2026-11-20 v2（用户反馈定稿）：
//   - 顶部增加「发送内容」多行输入：非空 = 新建 agent 并立即发送（这是本入口的产品语义，不是只建空块）
//   - 点选 agent chip 后展示该 agent 的模型并支持切换（loadAgentCatalog + modelOptionsFor）
//   - 远端路径不能发送（agentsend 本地限制）：选中远端行时禁用消息输入并给出提示
//   - 建块成功但消息发送失败：弹窗保持打开、内联展示错误，footer 变「关闭」——绝不允许重试建第二个块

import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import type { AgentLaunchTarget } from "@/app/workspace/agent-launch";
import {
    findAgentProfile,
    loadAgentCatalog,
    modelOptionsFor,
    pickDefaultModel,
    type AgentProfileInfo,
} from "@/app/workspace/agent-catalog";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { useDetectedAgentProfileOptions } from "@/app/workspace/use-agent-profile-options";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { useEffect, useMemo, useState } from "react";

import { collectAddAgentPathRows, normalizeAddAgentMessage } from "./overview-add-agent";

/** 「创建」时回传给调用方的一次性请求；调用方据此建块 + 发送。 */
export type AddAgentSubmitRequest = {
    tabId: string;
    tabName: string;
    profileName: string;
    connection: string | null;
    cwd: string | null;
    /** 发送内容（normalizeAddAgentMessage 归一后非空才算，null = 只建块不发送）。 */
    message: string | null;
    /** 模型选择（用户在弹窗里显式切换的模型；null = 跟随 profile 默认）。 */
    modelOverride: string | null;
};

/** onSubmit 的回执：建块总会发生（拿到 blockId），ok=false 表示消息没送出去。 */
export type AddAgentSubmitResult = {
    ok: boolean;
    blockId: string;
    error?: string;
};

export type OverviewAddAgentModalProps = {
    tabId: string;
    tabName: string;
    /** 该 Tab 的路径候选（collectAgentLaunchTargetsInTab 产物）。 */
    targets: readonly AgentLaunchTarget[];
    /** 随 Tab 的默认 cwd（resolveWorkspaceAgentContextMeta 解析出的该 Tab context）。 */
    defaultPath: string | null;
    onClose: () => void;
    onSubmit: (request: AddAgentSubmitRequest) => Promise<AddAgentSubmitResult> | AddAgentSubmitResult | void;
};

export function OverviewAddAgentModal({
    tabId,
    tabName,
    targets,
    defaultPath,
    onClose,
    onSubmit,
}: OverviewAddAgentModalProps) {
    const settings = jotai.useAtomValue(atoms.settingsAtom);
    // FindCommand 真实探测：没装的 agent 不出现在 chip 行（收口于 use-agent-profile-options）。
    const profileOptions = useDetectedAgentProfileOptions(settings);
    const [profileName, setProfileName] = useState<string | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    // v2：发送内容 + 模型选择 + 发送失败内联错误（失败后不能再建第二个块）
    const [message, setMessage] = useState("");
    const [modelPick, setModelPick] = useState<string | null>(null);
    const [sendFailure, setSendFailure] = useState<{ blockId: string; error: string } | null>(null);

    // 模型目录（agentprofilelist RPC，60s 缓存，与定时任务编辑器同一数据源）。探测失败回空数组，
    // 模型选择器退化成手填输入框，不阻塞建块。
    const [catalog, setCatalog] = useState<AgentProfileInfo[]>([]);
    useEffect(() => {
        let cancelled = false;
        loadAgentCatalog()
            .then((profiles) => {
                if (!cancelled) setCatalog(profiles);
            })
            .catch(() => {
                // loadAgentCatalog 内部已兜空数组，这里只防未捕获 rejection
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const pathRows = useMemo(() => collectAddAgentPathRows(targets, defaultPath), [targets, defaultPath]);
    // 未手选时跟随默认项（随 Tab）
    const effectivePath = useMemo(() => {
        const hit = selectedPath != null ? pathRows.find((row) => row.key === selectedPath) : undefined;
        return hit ?? pathRows.find((row) => row.isDefault) ?? pathRows[0] ?? null;
    }, [pathRows, selectedPath]);
    const isRemotePath = effectivePath != null && effectivePath.isLocal === false;
    const selectedProfile =
        profileName != null ? profileOptions.find((p) => p.name === profileName) : profileOptions[0];

    // 该 agent 在模型目录里的条目（探测到的 profile 不一定在目录里：用户自定义 profile 无模型配置）
    const catalogProfile = useMemo(
        () => findAgentProfile(catalog, selectedProfile?.name),
        [catalog, selectedProfile?.name]
    );
    // 显式切换才形成 override；「默认」= null（跟随 profile 配置，行为与 v1 一致）
    const modelOverride = modelPick != null && modelPick !== "" ? modelPick : null;
    // 下拉默认展示 profile 默认模型（用户要「点 agent 看到对应模型」），没探测到则空
    const catalogDefaultModel = pickDefaultModel(catalogProfile);
    const modelOptions = useMemo(
        () => modelOptionsFor(catalogProfile, modelOverride ?? undefined),
        [catalogProfile, modelOverride]
    );

    const submit = async () => {
        if (sendFailure != null) {
            // 块已经建出来了（只是消息没送到）：关闭，不给「再建一个」的机会
            onClose();
            return;
        }
        if (selectedProfile == null || effectivePath == null) return;
        const normalizedMessage = isRemotePath ? null : normalizeAddAgentMessage(message);
        setSubmitting(true);
        try {
            const result = (await onSubmit({
                tabId,
                tabName,
                profileName: selectedProfile.name,
                connection: effectivePath.isLocal ? null : effectivePath.sub || null,
                cwd: effectivePath.key,
                message: normalizedMessage,
                modelOverride,
            })) as AddAgentSubmitResult | undefined | void;
            if (result != null && result.ok === false) {
                setSendFailure({ blockId: result.blockId, error: result.error ?? "" });
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            className="session-overview-add-agent-modal"
            onClose={onClose}
            onCancel={sendFailure != null ? undefined : onClose}
            cancelLabel={i18n.t("workspace:heroLaunch.cancel")}
            onOk={submit}
            okLabel={
                sendFailure != null
                    ? i18n.t("session-overview:addAgent.close")
                    : i18n.t("workspace:agentLaunch.create")
            }
            okDisabled={submitting || (sendFailure == null && (selectedProfile == null || effectivePath == null))}
            title={i18n.t("workspace:agentLaunch.newAgent")}
            headerExtra={<span className="session-overview-add-agent-tabname">{tabName}</span>}
        >
            {/* ① 发送内容（v2：本入口的产品语义是「新建 agent 并发送」，不是只建空块） */}
            <div className="session-overview-add-agent-section">
                <div className="session-overview-add-agent-label">
                    {i18n.t("session-overview:addAgent.messageLabel")}
                </div>
                <textarea
                    className="session-overview-add-agent-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={i18n.t("session-overview:addAgent.messagePlaceholder")}
                    disabled={isRemotePath || sendFailure != null}
                    rows={3}
                />
                {isRemotePath ? (
                    <div className="session-overview-add-agent-hint">
                        {i18n.t("session-overview:addAgent.messageRemoteBlocked")}
                    </div>
                ) : null}
            </div>
            {/* ② 选 agent 类型 + 模型（与 New Agent 弹窗同款 chip 行；点选后展示该 agent 的模型并支持切换） */}
            <div className="session-overview-add-agent-section">
                <div className="session-overview-add-agent-label">{i18n.t("workspace:agentLaunch.selectAgentType")}</div>
                {profileOptions.length === 0 ? (
                    <div className="session-overview-add-agent-empty">{i18n.t("workspace:agentLaunch.noDetectedAgents")}</div>
                ) : (
                    <div className="session-overview-add-agent-chips">
                        {profileOptions.map((profile) => {
                            const isSelected = selectedProfile?.name === profile.name;
                            const icon = getAgentIcon(profile.name, {});                            return (
                                <div
                                    key={profile.name}
                                    className={cn("session-overview-add-agent-chip", isSelected && "is-selected")}
                                >
                                    <button
                                        type="button"
                                        className="session-overview-add-agent-chip-btn"
                                        onClick={() => {
                                            setProfileName(profile.name);
                                            // 切 agent 时模型选择回位：不同 agent 的模型 id 互不通用
                                            setModelPick(null);
                                        }}
                                        title={profile.cmd}
                                    >
                                        {icon == null ? null : icon.kind === "emoji" ? (
                                            <span className="agent-emoji-icon">{icon.emoji}</span>
                                        ) : (
                                            <span className="session-overview-add-agent-chip-logo">{icon.icon}</span>
                                        )}
                                        {profile.label}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* 模型选择器：目录有模型 → 下拉（默认项 = profile 默认模型）；没有 → 手填。仅在选中 agent 后渲染 */}
                {selectedProfile != null ? (
                    <div className="session-overview-add-agent-model">
                        {modelOptions.length > 0 ? (
                            <select
                                className="session-overview-add-agent-model-select"
                                value={modelPick ?? ""}
                                onChange={(e) => setModelPick(e.target.value)}
                                disabled={sendFailure != null}
                                aria-label={i18n.t("workspace:agentLaunch.modelLabel")}
                            >
                                <option value="">
                                    {catalogDefaultModel === ""
                                        ? i18n.t("session-overview:addAgent.modelDefaultOnly")
                                        : i18n.t("session-overview:addAgent.modelDefault", {
                                              model: catalogDefaultModel,
                                          })}
                                </option>
                                {modelOptions.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {model.label !== "" && model.label !== model.id
                                            ? `${model.label} · ${model.id}`
                                            : model.id}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                className="session-overview-add-agent-model-input"
                                value={modelPick ?? ""}
                                onChange={(e) => setModelPick(e.target.value)}
                                placeholder={i18n.t("workspace:agentLaunch.modelPlaceholder")}
                                disabled={sendFailure != null}
                                aria-label={i18n.t("workspace:agentLaunch.modelLabel")}
                            />
                        )}
                    </div>
                ) : null}
            </div>
            {/* ③ 选择一个路径。（可滚动候选列表，默认随 Tab；第二行仅远端显示 connection） */}
            <div className="session-overview-add-agent-section">
                <div className="session-overview-add-agent-label">{i18n.t("workspace:agentLaunch.selectPath")}</div>
                {pathRows.length === 0 ? (
                    <div className="session-overview-add-agent-empty">{i18n.t("workspace:agentLaunch.noPaths")}</div>
                ) : (
                    <div className="session-overview-add-agent-paths" role="listbox" aria-label={i18n.t("workspace:agentLaunch.selectPath")}>
                        {pathRows.map((row) => {
                            const isSelected = effectivePath?.key === row.key;
                            return (
                                <button
                                    key={row.key}
                                    type="button"
                                    className={cn("session-overview-add-agent-path", isSelected && "is-selected")}
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => setSelectedPath(row.key)}
                                    title={row.detail}
                                    disabled={sendFailure != null}
                                >
                                    <span className="session-overview-add-agent-path-icon">
                                        <i className={makePathIconClass(row.source)} />
                                    </span>
                                    <span className="session-overview-add-agent-path-body">
                                        <span className="session-overview-add-agent-path-detail">{row.detail}</span>
                                        {row.sub !== "" ? (
                                            <span className="session-overview-add-agent-path-sub">{row.sub}</span>
                                        ) : null}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            {/* 建块成功但消息没送到：内联错误（块保留，关闭即结束——重试只会建第二个块，不给） */}
            {sendFailure != null ? (
                <div className="session-overview-add-agent-error" role="alert">
                    {i18n.t("session-overview:addAgent.sendFailed", { error: sendFailure.error })}
                </div>
            ) : null}
        </Modal>
    );
}

/** 与 New Agent 弹窗 path list 同一套图标语义（widgets.tsx：home/terminal/agent → folder）。 */
function makePathIconClass(source: string): string {
    if (source === "home") return "fa-sharp fa-regular fa-house";
    if (source === "terminal" || source === "agent") return "fa-sharp fa-regular fa-terminal";
    return "fa-sharp fa-regular fa-folder";
}
