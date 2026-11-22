// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview「＋ 新建 Tab」弹窗：三选一（空 Tab / 空 Tab + Agent / 从模板…占位）。
//
// 复用面（与 overview-add-agent-modal.tsx 同一范式）：
//   - 容器           <Modal>（frontend/app/modals/modal.tsx，全仓唯一弹窗壳）
//   - agent 探测     useDetectedAgentProfileOptions（FindCommand 真实探测收口），
//                    默认 provider = isDefault 项 ?? 首项（PRD R2「默认 provider」）
//   - 文案           i18n session-overview:newTab 词表
//
// 建链（WorkspaceService.CreateTab → 可选 ObjectService.CreateBlockInTab）在调用方
// session-overview.tsx —— 本组件只产出一次结构化的提交请求（planNewTab 已校验/归一），
// 保持可单测；失败时 onSubmit throw → 这里内联报错 + 重试（弹窗不关、草稿不丢）。

import { Modal } from "@/app/modals/modal";
import { atoms } from "@/app/store/global";
import { useDetectedAgentProfileOptions } from "@/app/workspace/use-agent-profile-options";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { useEffect, useRef, useState } from "react";

import { planNewTab, type NewTabKind } from "./overview-new-tab";

/** 「创建」时回传给调用方的一次性请求；调用方据此 CreateTab（+ 可选建 agent 块）。 */
export type NewTabSubmitRequest = {
    kind: NewTabKind;
    /** planNewTab 归一后（空名已回落 fallbackName）。 */
    name: string;
    addAgent: boolean;
    /** addAgent 时的默认 provider（探测结果）；无探测项时为 null。 */
    profileName: string | null;
};

export type OverviewNewTabModalProps = {
    onClose: () => void;
    /** 派发语义：resolve = CreateTab（及建块）成功（调用方收尾关弹窗 + 刷新组）；
     * throw = 失败（弹窗保留可重试，草稿不丢）。 */
    onSubmit: (request: NewTabSubmitRequest) => Promise<void> | void;
};

export function OverviewNewTabModal({ onClose, onSubmit }: OverviewNewTabModalProps) {
    const settings = jotai.useAtomValue(atoms.settingsAtom);
    // FindCommand 真实探测：没装的 agent 不出现（收口于 use-agent-profile-options）。
    const profileOptions = useDetectedAgentProfileOptions(settings);
    const defaultProfile = profileOptions.find((profile) => profile.isDefault) ?? profileOptions[0] ?? null;

    const [name, setName] = useState("");
    const [kind, setKind] = useState<NewTabKind>("empty");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);

    const fallbackName = i18n.t("session-overview:newTab.defaultName");
    // submit 需要拿到最新 state；keydown 监听器用 ref 载体调最新一次 render 的 submit。
    const submitRef = useRef<() => void>(() => {});

    // 自动聚焦名称框：Enter 直接创建的前提（R2.2）。
    useEffect(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
    }, []);

    const submit = async () => {
        const plan = planNewTab({ kind, name, fallbackName });
        // template 只能从禁用按钮进来；planNewTab 兜底拒绝（函数层第二道锁）。
        if (!plan.ok) {
            setSubmitError({ code: plan.error ?? "invalid", message: i18n.t("session-overview:newTab.templateSoon") });
            return;
        }
        if (plan.addAgent && defaultProfile == null) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit({
                kind: plan.kind,
                name: plan.name,
                addAgent: plan.addAgent,
                profileName: plan.addAgent ? defaultProfile!.name : null,
            });
            // 成功由调用方收尾（关弹窗 + 刷新组）；失败走 catch
        } catch (error) {
            const err = error as { code?: string; message?: string } | null;
            setSubmitError({
                code: typeof err?.code === "string" && err.code !== "" ? err.code : "E_CREATE_TAB",
                message: err?.message ?? String(error),
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Esc 取消 / Enter 创建（R2.2）。capture 阶段挂 window：全局 keymodel 的 Escape
    // 会去 cancelTopModal（对本组件是别人家的弹窗甚至 uxCloseBlock），必须抢在它前面。
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.key === "Escape") {
                // 建 Tab 的 RPC 已在路上：Esc 先不关，否则会出现「Tab 建好了但弹窗早就没了」。
                if (submitting) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
                return;
            }
            if (event.key === "Enter") {
                // 焦点在按钮上时让原生点击走（Cancel + Enter = 取消，不能变成创建）。
                if (event.target instanceof HTMLElement && event.target.closest("button")) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                // 焦点不在名称框 → 先聚焦名称框（再按 Enter 才创建），防误触。
                if (document.activeElement !== nameInputRef.current) {
                    nameInputRef.current?.focus();
                    nameInputRef.current?.select();
                    return;
                }
                if (!submitting) submitRef.current();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [onClose, submitting, kind, name, defaultProfile]);

    submitRef.current = () => {
        void submit();
    };

    const agentKindDisabled = defaultProfile == null;

    return (
        <Modal
            className="session-overview-new-tab-modal"
            onClose={onClose}
            onCancel={onClose}
            cancelLabel={i18n.t("session-overview:newTab.cancel")}
            onOk={submit}
            okLabel={submitting ? i18n.t("session-overview:newTab.creating") : i18n.t("session-overview:newTab.create")}
            okDisabled={submitting || (kind === "agent" && agentKindDisabled)}
            title={i18n.t("session-overview:newTab.title")}
        >
            <div className="session-overview-new-tab-section">
                <div className="session-overview-new-tab-label">{i18n.t("session-overview:newTab.nameLabel")}</div>
                <input
                    ref={nameInputRef}
                    type="text"
                    className="session-overview-new-tab-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={fallbackName}
                    disabled={submitting}
                    aria-label={i18n.t("session-overview:newTab.nameLabel")}
                    data-new-tab-name=""
                />
            </div>
            <div className="session-overview-new-tab-section">
                <div className="session-overview-new-tab-label">{i18n.t("session-overview:newTab.contentLabel")}</div>
                <div className="session-overview-new-tab-kinds" role="radiogroup" aria-label={i18n.t("session-overview:newTab.contentLabel")}>
                    <label className={cn("session-overview-new-tab-kind", kind === "empty" && "is-selected")}>
                        <input
                            type="radio"
                            name="new-tab-kind"
                            data-new-tab-kind="empty"
                            checked={kind === "empty"}
                            onChange={() => setKind("empty")}
                            disabled={submitting}
                        />
                        <span>{i18n.t("session-overview:newTab.kindEmpty")}</span>
                    </label>
                    <label
                        className={cn(
                            "session-overview-new-tab-kind",
                            kind === "agent" && "is-selected",
                            agentKindDisabled && "is-disabled"
                        )}
                        title={agentKindDisabled ? i18n.t("session-overview:newTab.noAgentProfile") : undefined}
                    >
                        <input
                            type="radio"
                            name="new-tab-kind"
                            data-new-tab-kind="agent"
                            checked={kind === "agent"}
                            onChange={() => setKind("agent")}
                            disabled={submitting || agentKindDisabled}
                        />
                        <span>
                            {agentKindDisabled
                                ? i18n.t("session-overview:newTab.kindAgentShort")
                                : i18n.t("session-overview:newTab.kindAgent", { profile: defaultProfile!.label })}
                        </span>
                    </label>
                    {/* 从模板…：本轮占位（置灰 + tooltip「即将支持」），不实现模板系统 */}
                    <label
                        className={cn("session-overview-new-tab-kind", "is-disabled")}
                        title={i18n.t("session-overview:newTab.templateSoon")}
                    >
                        <input
                            type="radio"
                            name="new-tab-kind"
                            data-new-tab-kind="template"
                            checked={kind === "template"}
                            onChange={() => setKind("template")}
                            disabled
                        />
                        <span>{i18n.t("session-overview:newTab.kindTemplate")}</span>
                    </label>
                </div>
                {kind === "agent" && agentKindDisabled ? (
                    <div className="session-overview-new-tab-hint">{i18n.t("session-overview:newTab.noAgentProfile")}</div>
                ) : null}
            </div>
            {/* 创建失败：内联错误 + 重试（弹窗不关、草稿不丢；Tab 没建成功，重试不会重复建） */}
            {submitError != null ? (
                <div className="session-overview-new-tab-error" role="alert">
                    <span>
                        ⚠ {submitError.code} {submitError.message}
                    </span>
                    <button
                        type="button"
                        className="session-overview-new-tab-retry"
                        onClick={() => void submit()}
                        disabled={submitting}
                        data-new-tab-retry=""
                    >
                        {i18n.t("session-overview:newTab.retry")}
                    </button>
                </div>
            ) : null}
        </Modal>
    );
}
