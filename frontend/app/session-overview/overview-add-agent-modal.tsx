// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview「＋ 新建 Agent」弹窗：chrome 与 New Agent 弹窗（hero-launch-window.tsx）同款，
// 但容器用全局 <Modal> 居中（用户 2026-11-20 定稿：居中 + New Agent 同款样式 + 滚动路径列表 + 极简文案）。
//
// 复用面：
//   - 容器            <Modal>（frontend/app/modals/modal.tsx，全仓唯一弹窗壳）
//   - profile 探测     useDetectedAgentProfileOptions（FindCommand 真实探测收口）
//   - 路径候选        targets 由调用方（session-overview.tsx）用 collectAgentLaunchTargetsInTab 收集；
//                     行组装走纯函数 collectAddAgentPathRows
//   - 文案            全部复用 workspace:agentLaunch / workspace:heroLaunch 词表，不自造新词
//
// 建块（CreateBlockInTab + createAgentBlockDefForProfile）在调用方 session-overview.tsx ——
// 本组件只产出一次结构化的提交请求，保持可单测（dom.test 断言请求体）。

import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import type { AgentLaunchTarget } from "@/app/workspace/agent-launch";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { useDetectedAgentProfileOptions } from "@/app/workspace/use-agent-profile-options";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { useMemo, useState } from "react";

import { collectAddAgentPathRows } from "./overview-add-agent";

/** 「创建」时回传给调用方的一次性请求；调用方据此建块。 */
export type AddAgentSubmitRequest = {
    tabId: string;
    tabName: string;
    profileName: string;
    connection: string | null;
    cwd: string | null;
    /** 模型输入框手填值（trim 后非空才算，null = 不覆盖 profile 默认）。 */
    modelOverride: string | null;
};

export type OverviewAddAgentModalProps = {
    tabId: string;
    tabName: string;
    /** 该 Tab 的路径候选（collectAgentLaunchTargetsInTab 产物）。 */
    targets: readonly AgentLaunchTarget[];
    /** 随 Tab 的默认 cwd（resolveWorkspaceAgentContextMeta 解析出的该 Tab context）。 */
    defaultPath: string | null;
    onClose: () => void;
    onSubmit: (request: AddAgentSubmitRequest) => void | Promise<void>;
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

    const pathRows = useMemo(() => collectAddAgentPathRows(targets, defaultPath), [targets, defaultPath]);
    // 未手选时跟随默认项（随 Tab）
    const effectivePath = useMemo(() => {
        const hit = selectedPath != null ? pathRows.find((row) => row.key === selectedPath) : undefined;
        return hit ?? pathRows.find((row) => row.isDefault) ?? pathRows[0] ?? null;
    }, [pathRows, selectedPath]);
    const selectedProfile =
        profileName != null ? profileOptions.find((p) => p.name === profileName) : profileOptions[0];

    const submit = async () => {
        if (selectedProfile == null || effectivePath == null) return;
        setSubmitting(true);
        try {
            await onSubmit({
                tabId,
                tabName,
                profileName: selectedProfile.name,
                connection: effectivePath.isLocal ? null : effectivePath.sub || null,
                cwd: effectivePath.key,
                // 模型覆盖本期不提供输入框；字段保留给后续版本，恒 null（= 用 profile 默认）
                modelOverride: null,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            className="session-overview-add-agent-modal"
            onClose={onClose}
            onCancel={onClose}
            cancelLabel={i18n.t("workspace:heroLaunch.cancel")}
            onOk={submit}
            okLabel={i18n.t("workspace:agentLaunch.create")}
            okDisabled={selectedProfile == null || effectivePath == null || submitting}
            title={i18n.t("workspace:agentLaunch.newAgent")}
            headerExtra={<span className="session-overview-add-agent-tabname">{tabName}</span>}
        >
            {/* ① 选 agent 类型（与 New Agent 弹窗同款 chip 行）。模型覆盖本期不提供，modelOverride 恒 null */}
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
                                        onClick={() => setProfileName(profile.name)}
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
            </div>
            {/* ② 选择一个路径。（可滚动候选列表，默认随 Tab；第二行仅远端显示 connection） */}
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
        </Modal>
    );
}

/** 与 New Agent 弹窗 path list 同一套图标语义（widgets.tsx：home/terminal/agent → folder）。 */
function makePathIconClass(source: string): string {
    if (source === "home") return "fa-sharp fa-regular fa-house";
    if (source === "terminal" || source === "agent") return "fa-sharp fa-regular fa-terminal";
    return "fa-sharp fa-regular fa-folder";
}
