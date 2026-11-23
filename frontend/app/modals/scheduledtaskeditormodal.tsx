// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { loadHeroRoster } from "@/app/store/hero-roster";
import { modalsModel } from "@/app/store/modalmodel";
import { describeCron } from "@/app/view/scheduledtasks/cron-describe";
import type { AgentProfileInfo } from "@/app/workspace/agent-catalog";
import { findAgentProfile, loadAgentCatalog, modelOptionsFor, pickDefaultModel } from "@/app/workspace/agent-catalog";
import { makeHeroHomeBase, type HeroRosterEntry } from "@/app/workspace/hero-launch";
import { i18n } from "@/i18n/config";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { heroSelectOptions, normalizeHeroBinding } from "./scheduledtask-hero";

const ScheduleTypes = ["cron", "interval", "daily", "weekly", "once"] as const;

const ScheduleTypeLabelKeys = {
    cron: "modals:scheduledTask.scheduleTypeCron",
    interval: "modals:scheduledTask.scheduleTypeInterval",
    daily: "modals:scheduledTask.scheduleTypeDaily",
    weekly: "modals:scheduledTask.scheduleTypeWeekly",
    once: "modals:scheduledTask.scheduleTypeOnce",
} as const satisfies Record<(typeof ScheduleTypes)[number], string>;

/** Props passed through modalsModel.pushModal("ScheduledTaskEditorModal", ...). */
export type ScheduledTaskEditorModalProps = {
    task: ScheduledTaskType;
    isNew: boolean;
    onSave: (draft: ScheduledTaskType) => Promise<string | null>;
};

/**
 * App-level scheduled-task editor. It used to be an `absolute inset-0` overlay inside the
 * Scheduled Tasks block, which made it tiny and clipped by the block bounds. Rendering it
 * through the global modal layer (Modal portals into #main) gives it the same footprint
 * as the other app dialogs and lets ESC/backdrop close it via modalsModel.
 *
 * Hero 绑定（N-1123-hero-sched-ui）：hero 下拉来自 HeroRoster；选中后 workdir 留空即落到
 * `<hero home>`、provider/model 留空即继承 hero.json（后端 core 包解析），弹窗只负责提示与载荷。
 */
function ScheduledTaskEditorModal({ task, isNew, onSave }: ScheduledTaskEditorModalProps) {
    const { t } = useTranslation("modals");
    const [form, setForm] = React.useState<ScheduledTaskType>(() => ({
        ...task,
        schedule: { ...task.schedule },
    }));
    const [agentCatalog, setAgentCatalog] = React.useState<AgentProfileInfo[]>([]);
    const [heroRoot, setHeroRoot] = React.useState<string>("");
    const [heroes, setHeroes] = React.useState<HeroRosterEntry[]>([]);
    const [catalogLoading, setCatalogLoading] = React.useState(true);
    const [err, setErr] = React.useState<string>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        void loadAgentCatalog().then((profiles) => {
            if (cancelled) return;
            setAgentCatalog(profiles ?? []);
            setCatalogLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // hero 名册只在有 hero 系统时才用：失败解析为空名册，下拉只剩「不绑定」这一项，弹窗仍可用。
    React.useEffect(() => {
        let cancelled = false;
        void loadHeroRoster().then((roster) => {
            if (cancelled) return;
            setHeroRoot(roster?.root ?? "");
            setHeroes(roster?.heroes ?? []);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const close = React.useCallback(() => {
        modalsModel.popModal();
    }, []);

    const set = <K extends keyof (ScheduledTaskType)>(
        k: K,
        v: (ScheduledTaskType)[K]
    ) => setForm((f) => ({ ...f, [k]: v }));
    const setSched = <K extends keyof ScheduledTaskScheduleType>(k: K, v: ScheduledTaskScheduleType[K]) =>
        setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

    const profile = findAgentProfile(agentCatalog, form.agentProfile);
    const modelOptions = modelOptionsFor(profile, form.model);

    // Switching agents re-points the model at that agent's default so a stale model id
    // from the previous agent is never silently carried over.
    const selectAgent = (name: string) => {
        const nextProfile = findAgentProfile(agentCatalog, name);
        setForm((f) => ({ ...f, agentProfile: name, model: pickDefaultModel(nextProfile) }));
    };

    const notify = form.notifyOnComplete || form.notifyOnError;

    const heroId = (form.hero ?? "").trim();
    const heroHome = heroId === "" ? "" : makeHeroHomeBase(heroRoot, heroId);
    const heroOptions = React.useMemo(() => heroSelectOptions(heroes, t("modals:scheduledTask.heroNone")), [heroes, t]);

    const save = async () => {
        setSaving(true);
        // hero 是 json:"hero,omitempty"：选中有值就写入，清空则删键（清除绑定靠键缺失）。
        const e = await onSave(normalizeHeroBinding(form) as ScheduledTaskType);
        setSaving(false);
        if (e) {
            setErr(e);
            return;
        }
        close();
    };

    return (
        <Modal
            className="w-[min(760px,calc(100vw-40px))] max-h-[min(86vh,calc(100vh-56px))] overflow-hidden p-0"
            onClickBackdrop={close}
        >
            <div className="flex h-full min-h-0 w-full flex-col bg-modalbg text-primary">
                <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
                    <span className="text-sm font-semibold">
                        {isNew ? t("modals:scheduledTask.newTitle") : t("modals:scheduledTask.editTitle")}
                    </span>
                    <button
                        className="hover:bg-hoverbg rounded p-1 cursor-pointer"
                        onClick={close}
                        title={t("modals:modal.closeEsc")}
                    >
                        ✕
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 wide-scrollbar">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field label={t("modals:scheduledTask.fieldName")} className="md:col-span-2">
                            <input
                                className={inputCls}
                                value={form.name}
                                onChange={(e) => set("name", e.target.value)}
                                placeholder={t("modals:scheduledTask.namePlaceholder")}
                                autoFocus
                            />
                        </Field>

                        <Field label={t("modals:scheduledTask.fieldHero")}>
                            <select
                                className={inputCls}
                                data-scheduled-task-hero
                                value={heroId}
                                onChange={(e) => set("hero", e.target.value)}
                            >
                                {heroOptions.map((opt) => (
                                    <option key={opt.value || "__none__"} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            {heroId !== "" ? (
                                <span className="text-xs text-muted mt-0.5">
                                    {i18n.t("modals:scheduledTask.heroInheritHint", {
                                        home: heroHome !== "" ? heroHome : "—",
                                    })}
                                </span>
                            ) : null}
                        </Field>

                        <Field label={t("modals:scheduledTask.fieldAgentProfile")}>
                            {agentCatalog.length === 0 ? (
                                // Catalog unavailable (RPC failed): keep the editor usable with free text.
                                <input
                                    className={inputCls}
                                    value={form.agentProfile ?? ""}
                                    onChange={(e) => set("agentProfile", e.target.value)}
                                    placeholder="pi"
                                />
                            ) : (
                                <select
                                    className={inputCls}
                                    value={form.agentProfile ?? ""}
                                    onChange={(e) => selectAgent(e.target.value)}
                                >
                                    {agentCatalog.map((a) => (
                                        <option key={a.name} value={a.name}>
                                            {a.label}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {catalogLoading && (
                                <span className="text-xs text-muted mt-0.5">
                                    {t("modals:scheduledTask.loadingAgents")}
                                </span>
                            )}
                            {!catalogLoading && agentCatalog.length === 0 && (
                                <span className="text-xs text-muted mt-0.5">
                                    {t("modals:scheduledTask.catalogUnavailable")}
                                </span>
                            )}
                        </Field>

                        <Field
                            label={
                                profile != null
                                    ? i18n.t("modals:scheduledTask.fieldModelWithProfile", { profile: profile.label })
                                    : t("modals:scheduledTask.fieldModel")
                            }
                        >
                            {modelOptions.length === 0 ? (
                                <input
                                    className={inputCls}
                                    value={form.model ?? ""}
                                    onChange={(e) => set("model", e.target.value)}
                                    placeholder={
                                        heroId !== ""
                                            ? t("modals:scheduledTask.modelInheritHero")
                                            : t("modals:scheduledTask.modelPlaceholder")
                                    }
                                />
                            ) : (
                                <select
                                    className={inputCls}
                                    value={form.model ?? ""}
                                    onChange={(e) => set("model", e.target.value)}
                                >
                                    {heroId !== "" ? (
                                        <option value="">{t("modals:scheduledTask.modelInheritHero")}</option>
                                    ) : null}
                                    {modelOptions.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.provider != null && m.provider !== ""
                                                ? `${m.label} (${m.provider})`
                                                : m.label}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {profile != null && profile.models.length === 0 && (
                                <span className="text-xs text-muted mt-0.5">
                                    {t("modals:scheduledTask.noModelsPrefix")}
                                    {profile.name}
                                    {t("modals:scheduledTask.noModelsSuffix")}
                                </span>
                            )}
                        </Field>

                        <Field label={t("modals:scheduledTask.fieldPrompt")} className="md:col-span-2">
                            <textarea
                                className={`${inputCls} min-h-[96px] resize-y`}
                                value={form.prompt}
                                onChange={(e) => set("prompt", e.target.value)}
                                placeholder={t("modals:scheduledTask.promptPlaceholder")}
                            />
                        </Field>

                        <Field label={t("modals:scheduledTask.fieldWorkdir")} className="md:col-span-2">
                            <input
                                className={inputCls}
                                value={form.workdir ?? ""}
                                onChange={(e) => set("workdir", e.target.value)}
                                placeholder={
                                    heroId !== "" && heroHome !== ""
                                        ? i18n.t("modals:scheduledTask.workdirHeroPlaceholder", { home: heroHome })
                                        : t("modals:scheduledTask.workdirPlaceholder")
                                }
                            />
                            {heroId !== "" ? (
                                <span className="text-xs text-muted mt-0.5">
                                    {i18n.t("modals:scheduledTask.workdirHeroHint", {
                                        home: heroHome !== "" ? heroHome : "<hero home>",
                                    })}
                                </span>
                            ) : null}
                        </Field>

                        <Field label={t("modals:scheduledTask.fieldScheduleType")}>
                            <select
                                className={inputCls}
                                value={form.schedule?.type ?? "cron"}
                                onChange={(e) => setSched("type", e.target.value)}
                            >
                                {ScheduleTypes.map((typeValue) => (
                                    <option key={typeValue} value={typeValue}>
                                        {t(ScheduleTypeLabelKeys[typeValue])}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        {(form.schedule?.type ?? "cron") === "cron" && (
                            <Field label={t("modals:scheduledTask.fieldCron")}>
                                <input
                                    className={`${inputCls} font-mono`}
                                    value={form.schedule?.cronExpr ?? ""}
                                    onChange={(e) => setSched("cronExpr", e.target.value)}
                                    placeholder="0 9 * * 1-5"
                                />
                                <span className="text-xs text-secondary mt-0.5 min-h-[16px]">
                                    {describeCron(form.schedule?.cronExpr) || "—"}
                                </span>
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "interval" && (
                            <Field label={t("modals:scheduledTask.fieldInterval")}>
                                <input
                                    className={inputCls}
                                    type="number"
                                    value={form.schedule?.intervalMs ?? 3600000}
                                    onChange={(e) => setSched("intervalMs", Number(e.target.value))}
                                />
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "daily" && (
                            <Field label={t("modals:scheduledTask.fieldTime")}>
                                <input
                                    className={inputCls}
                                    value={form.schedule?.timeOfDay ?? ""}
                                    onChange={(e) => setSched("timeOfDay", e.target.value)}
                                    placeholder="09:00"
                                />
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "weekly" && (
                            <>
                                <Field label={t("modals:scheduledTask.fieldTime")}>
                                    <input
                                        className={inputCls}
                                        value={form.schedule?.timeOfDay ?? ""}
                                        onChange={(e) => setSched("timeOfDay", e.target.value)}
                                        placeholder="09:00"
                                    />
                                </Field>
                                <Field label={t("modals:scheduledTask.fieldDayOfWeek")}>
                                    <input
                                        className={inputCls}
                                        type="number"
                                        min={0}
                                        max={6}
                                        value={form.schedule?.dayOfWeek ?? 0}
                                        onChange={(e) => setSched("dayOfWeek", Number(e.target.value))}
                                    />
                                </Field>
                            </>
                        )}
                        {(form.schedule?.type ?? "cron") === "once" && (
                            <Field label={t("modals:scheduledTask.fieldRunAt")}>
                                <input
                                    className={`${inputCls} font-mono`}
                                    value={form.schedule?.runAt ?? ""}
                                    onChange={(e) => setSched("runAt", e.target.value)}
                                    placeholder="2026-09-09T09:00:00Z"
                                />
                            </Field>
                        )}

                        <Field label={t("modals:scheduledTask.fieldTimezone")}>
                            <input
                                className={`${inputCls} font-mono`}
                                value={form.schedule?.timezone ?? ""}
                                onChange={(e) => setSched("timezone", e.target.value)}
                                placeholder="Asia/Shanghai"
                            />
                        </Field>

                        {notify && (
                            <Field label={t("modals:scheduledTask.fieldNotificationMode")}>
                                <select
                                    className={inputCls}
                                    value={form.notificationMode ?? "os"}
                                    onChange={(e) => set("notificationMode", e.target.value)}
                                >
                                    <option value="os">{t("modals:scheduledTask.notificationOs")}</option>
                                    <option value="bell">{t("modals:scheduledTask.notificationBell")}</option>
                                    <option value="both">{t("modals:scheduledTask.notificationBoth")}</option>
                                    <option value="none">{t("modals:scheduledTask.notificationNone")}</option>
                                </select>
                            </Field>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-4">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={(e) => set("enabled", e.target.checked)}
                            />
                            {t("modals:scheduledTask.enabled")}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.notifyOnComplete}
                                onChange={(e) => set("notifyOnComplete", e.target.checked)}
                            />
                            {t("modals:scheduledTask.notifyComplete")}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.notifyOnError}
                                onChange={(e) => set("notifyOnError", e.target.checked)}
                            />
                            {t("modals:scheduledTask.notifyError")}
                        </label>
                    </div>

                    {err != null && <div className="pt-3 text-xs text-error">{err}</div>}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-2">
                    <button className={btnCls} onClick={close}>
                        {t("modals:modal.cancel")}
                    </button>
                    <button
                        className={`${btnCls} bg-accent text-[var(--accent-foreground)]`}
                        disabled={saving || !form.name}
                        onClick={save}
                    >
                        {saving ? t("common:docs.saving") : t("common:common.save")}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

ScheduledTaskEditorModal.displayName = "ScheduledTaskEditorModal";

const inputCls =
    "w-full bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent";

const btnCls = "px-3 py-1 text-xs rounded border border-border hover:bg-hoverbg cursor-pointer";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <label className={`flex flex-col gap-1 ${className ?? ""}`}>
            <span className="text-xs text-muted">{label}</span>
            {children}
        </label>
    );
}

export { ScheduledTaskEditorModal };
