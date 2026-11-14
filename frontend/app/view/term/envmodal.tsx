// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as WOS from "@/app/store/wos";
import { copyText } from "@/util/clipboard";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";

import "./envmodal.scss";

type EnvModalViewProps = {
    blockId: string;
    connection: string;
    // Launch mode: when onSaveCustomEnv is provided, Save hands the edited custom env back to the
    // caller instead of writing RPC — the target block does not exist yet (New Agent / New Terminal
    // launch dialogs), and the caller merges it into the new block def's "cmd:env" at create time.
    // In this mode the custom env applies ONLY to the new block being launched (not persisted to any
    // existing block / connection / defaults).
    initialCustomEnv?: Record<string, string>;
    onSaveCustomEnv?: (env: Record<string, string>) => void;
    // Launch mode reference: the selected launch target's existing block (if any). When provided, the
    // read-only resolved-env table is shown as a reference so the user can compare with the current
    // environment before overriding values for the new launch.
    existingBlockId?: string;
    existingConnection?: string;
};

// Keys whose values are treated as secrets and masked by default.
// Match is case-insensitive; the substring appearing anywhere in the key triggers masking.
const SENSITIVE_KEY_SUBSTRS = ["JWT", "TOKEN", "KEY", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "APIKEY"];

function isSensitiveKey(key: string): boolean {
    if (!key) return false;
    const upper = key.toUpperCase();
    return SENSITIVE_KEY_SUBSTRS.some((substr) => upper.includes(substr));
}

function maskValue(value: string): string {
    if (!value) return "";
    return "••••••••";
}

export function EnvModalView({
    blockId,
    connection,
    initialCustomEnv,
    onSaveCustomEnv,
    existingBlockId,
    existingConnection,
}: EnvModalViewProps) {
    const { t } = useTranslation("term");
    const launchMode = onSaveCustomEnv != null;
    // 现有变量解析目标：block 模式 = 自身 block；launch 模式 = 选中 target 的现有 block（参考）
    const resolveBlockId = launchMode ? existingBlockId : blockId;
    const resolveConnName = launchMode ? existingConnection : connection;
    // 参考表格恒显示：有 block 解析既有环境，无 block 解析默认环境（GetDefaultEnvCommand），均作参考；
    // 解析失败（referenceFailed）或 block 模式无目标时才隐藏。
    const showEnvTable = true;
    const [env, setEnv] = useState<Record<string, string> | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    // launch 模式参考表格解析失败（如合成 target 无真实 block）时静默隐藏，不抛错
    const [referenceFailed, setReferenceFailed] = useState(false);
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    // 本次启动自定义变量（可编辑 KV 行）
    const [customRows, setCustomRows] = useState<{ key: string; value: string }[]>(() => {
        if (initialCustomEnv == null) return [{ key: "", value: "" }];
        const entries = Object.entries(initialCustomEnv);
        return entries.length === 0 ? [{ key: "", value: "" }] : entries.map(([key, value]) => ({ key, value }));
    });

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        setReferenceFailed(false);
        const conn = (launchMode ? existingConnection : connection) ?? "";
        if (launchMode && isBlankValue(existingBlockId)) {
            // launch 模式目标无既有 block（home 等合成 target）：展示默认环境（OS 基线 + 连接默认）作参考
            RpcApi.GetDefaultEnvCommand(TabRpcClient, { connname: conn })
                .then((res) => {
                    if (cancelled) return;
                    setEnv(res?.env ?? {});
                })
                .catch((e) => {
                    if (cancelled) return;
                    setReferenceFailed(true);
                    setEnv(null);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
            return () => {
                cancelled = true;
            };
        }
        const targetId = launchMode ? existingBlockId : blockId;
        if (isBlankValue(targetId)) {
            setEnv(null);
            setLoading(false);
            return;
        }
        RpcApi.GetBlockEnvCommand(TabRpcClient, {
            blockid: targetId!,
            connname: conn,
        })
            .then((res) => {
                if (cancelled) return;
                setEnv(res?.env ?? {});
            })
            .catch((e) => {
                if (cancelled) return;
                if (launchMode) {
                    // 参考解析失败：静默降级，隐藏现有变量表格（不打断自定义变量编辑）
                    setReferenceFailed(true);
                    setEnv(null);
                } else {
                    setError(getErrorMessage(e));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [launchMode, existingBlockId, existingConnection, blockId, connection]);

    // Mirrors pkg/remote/conncontroller.IsLocalConnName on the client side:
    // "local:*" / "local" / "" are local; anything else is remote.
    const isRemote = connection !== "" && !connection.startsWith("local:") && connection !== "local";

    const sortedEntries = useMemo(() => {
        if (!env) return [];
        const keys = Object.keys(env).sort((a, b) => a.localeCompare(b));
        return keys.map((k) => ({ key: k, value: env[k] ?? "" }));
    }, [env]);

    const filteredEntries = useMemo(() => {
        const q = search.trim().toUpperCase();
        if (!q) return sortedEntries;
        return sortedEntries.filter((e) => e.key.toUpperCase().includes(q) || e.value.toUpperCase().includes(q));
    }, [sortedEntries, search]);

    const sensitiveCount = useMemo(
        () => sortedEntries.reduce((n, e) => (isSensitiveKey(e.key) ? n + 1 : n), 0),
        [sortedEntries]
    );

    const toggleReveal = (key: string) => {
        setRevealedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const revealAll = () => {
        setRevealedKeys(new Set(sortedEntries.filter((e) => isSensitiveKey(e.key)).map((e) => e.key)));
    };

    const hideAll = () => {
        setRevealedKeys(new Set());
    };

    const copyAll = () => {
        if (!env) return;
        const text = Object.keys(env)
            .sort()
            .map((k) => `${k}=${env[k]}`)
            .join("\n");
        copyText(text);
    };

    const close = () => modalsModel.popModal();

    // 自定义变量：空 KEY 行忽略；敏感 key 的 VALUE 行默认掩码输入，可逐行 reveal
    const customCount = customRows.filter((row) => row.key.trim() !== "").length;
    // KEY 输入联想：从参考环境（现有/默认变量）里选择已有变量名，选中预填现有值便于覆盖修改
    const envKeys = useMemo(() => (env ? Object.keys(env).sort((a, b) => a.localeCompare(b)) : []), [env]);
    const [suggestFor, setSuggestFor] = useState<number | null>(null);
    const suggestions = useMemo(() => {
        if (suggestFor == null || env == null) return [];
        const q = (customRows[suggestFor]?.key || "").trim().toLowerCase();
        const base = q ? envKeys.filter((k) => k.toLowerCase().includes(q)) : envKeys;
        return base.slice(0, 8);
    }, [suggestFor, env, envKeys, customRows]);
    const setRow = (idx: number, patch: Partial<{ key: string; value: string }>) => {
        setCustomRows((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
    };
    const removeRow = (idx: number) => {
        setCustomRows((rows) => rows.filter((_, i) => i !== idx));
    };
    const addRow = () => {
        setCustomRows((rows) => [...rows, { key: "", value: "" }]);
    };
    const customEnvMap = (): Record<string, string> => {
        const rtn: Record<string, string> = {};
        customRows.forEach((row) => {
            const k = row.key.trim();
            if (!k) return;
            rtn[k] = row.value;
        });
        return rtn;
    };

    const save = async () => {
        const custom = customEnvMap();
        if (launchMode) {
            onSaveCustomEnv!(custom);
            close();
            return;
        }
        // Block 模式：把自定义变量 merge 到 block 现有 cmd:env 之上，避免整 map 替换
        // 冲掉创建时注入的 vendor key（如 ANTHROPIC_BASE_URL / OPENAI_API_KEY / CODEX_HOME）。
        try {
            const oref = WOS.makeORef("block", blockId);
            const meta = await RpcApi.GetMetaCommand(TabRpcClient, { oref });
            const existing = (meta?.["cmd:env"] as Record<string, string> | undefined) ?? {};
            await RpcApi.SetMetaCommand(TabRpcClient, { oref, meta: { "cmd:env": { ...existing, ...custom } } });
            close();
        } catch (e) {
            setError(getErrorMessage(e));
        }
    };

    return (
        <Modal className="env-modal-shell" onClose={close} onClickBackdrop={close} padding={false}>
            <div className="env-modal-view">
            <div className="env-modal-header">
                <div className="env-modal-title">
                    {t("term:env.title")}
                    {!launchMode && isRemote ? <span className="env-modal-tag-remote">{t("term:env.remoteTag")}</span> : null}
                </div>
                <div className="env-modal-subtitle">
                    {launchMode
                        ? t("term:env.launchSubtitle") +
                          (showEnvTable && env
                              ? i18n.t("term:env.launchReference", {
                                    mode: isBlankValue(existingBlockId)
                                        ? t("term:env.referenceDefault")
                                        : t("term:env.referenceExisting"),
                                    num: sortedEntries.length,
                                })
                              : "")
                        : loading
                          ? t("term:env.loading")
                          : error
                            ? t("term:env.error")
                            : isRemote
                              ? i18n.t("term:env.configuredVarsRemote", { num: sortedEntries.length })
                              : i18n.t("term:env.variables", { num: sortedEntries.length })}
                    {sensitiveCount > 0 ? i18n.t("term:env.masked", { num: sensitiveCount }) : ""}
                </div>
            </div>
            {/* 滚动收敛到中间内容区：header/footer 固定，滚动条不与右上角关闭按钮重叠 */}
            <div className="env-modal-scroll">
            {/* 本次启动自定义变量（新增可编辑区，launch 与 block 模式共用） */}
            <div className="env-modal-section-label">
                {t("term:env.customSection")}
                <span className="env-modal-section-count">
                    {i18n.t("term:env.customSectionCount", { num: customCount })}
                </span>
            </div>
            <div className="env-modal-custom">
                {customRows.map((row, idx) => {
                    const sensitive = isSensitiveKey(row.key);
                    const trimmedKey = row.key.trim();
                    const overridesExisting = env != null && trimmedKey !== "" && env[trimmedKey] != null && env[trimmedKey] !== row.value;
                    return (
                        <div key={idx}>
                        <div className="env-modal-custom-row">
                            <div className="env-modal-custom-key-wrap">
                                <input
                                    className="env-modal-custom-input env-modal-custom-key"
                                    type="text"
                                    placeholder={t("term:env.keyPlaceholder")}
                                    spellCheck={false}
                                    value={row.key}
                                    onFocus={() => setSuggestFor(idx)}
                                    onChange={(e) => {
                                        setRow(idx, { key: e.target.value });
                                        setSuggestFor(idx);
                                    }}
                                    onBlur={() => {
                                        setTimeout(() => {
                                            setSuggestFor((cur) => (cur === idx ? null : cur));
                                        }, 150);
                                    }}
                                />
                                {suggestFor === idx && suggestions.length > 0 ? (
                                    <div className="env-modal-suggest">
                                        {suggestions.map((k) => (
                                            <button
                                                type="button"
                                                key={k}
                                                className="env-modal-suggest-item"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    setRow(idx, { key: k, value: env?.[k] ?? "" });
                                                    setSuggestFor(null);
                                                }}
                                            >
                                                <span className="env-modal-suggest-key">{k}</span>
                                                <span className="env-modal-suggest-val">{env?.[k]}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                            <div className="env-modal-custom-value-wrap">
                                <input
                                    className="env-modal-custom-input env-modal-custom-value"
                                    type={sensitive ? "password" : "text"}
                                    placeholder={t("term:env.valuePlaceholder")}
                                    spellCheck={false}
                                    value={row.value}
                                    onChange={(e) => setRow(idx, { value: e.target.value })}
                                />
                                {sensitive ? (
                                    <span className="env-modal-custom-sens" title={t("term:env.sensitiveTitle")}>
                                        {t("term:env.sensitiveTag")}
                                    </span>
                                ) : null}
                            </div>
                            <button
                                className="env-modal-custom-del"
                                onClick={() => removeRow(idx)}
                                title={t("term:env.deleteRow")}
                            >
                                <i className="fa-sharp fa-solid fa-trash-can" />
                            </button>
                        </div>
                        {overridesExisting ? (
                            <div className="env-modal-override-hint">
                                <Trans
                                    ns={"term" as const}
                                    i18nKey={"term:env.overridesExisting" as never}
                                    t={t}
                                    values={{ from: env?.[trimmedKey], to: row.value }}
                                    components={{ code: <code /> }}
                                />
                            </div>
                        ) : null}
                        </div>
                    );
                })}
            </div>
            <button className="env-modal-btn env-modal-add" onClick={addRow}>
                <i className="fa-sharp fa-solid fa-plus" /> {t("term:env.addVariable")}
            </button>
            <div className="env-modal-hint">
                <Trans
                    ns={"term" as const}
                    i18nKey={"term:env.hint" as never}
                    t={t}
                    components={{ code: <code /> }}
                />
            </div>
            {showEnvTable && !referenceFailed ? (
                <>
                    <div className="env-modal-sub-label">{t("term:env.existingSection")}</div>
                    <div className="env-modal-toolbar">
                        <input
                            className="env-modal-search"
                            type="text"
                            placeholder={t("term:env.filterPlaceholder")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <button
                            className="env-modal-btn"
                            onClick={copyAll}
                            disabled={loading || !env}
                            title={t("term:env.copyAllTitle")}
                        >
                            <i className="fa-sharp fa-solid fa-copy" /> {t("term:env.copyAll")}
                        </button>
                        {sensitiveCount > 0 ? (
                            <>
                                <button className="env-modal-btn" onClick={revealAll}>
                                    {t("term:env.showAll")}
                                </button>
                                <button className="env-modal-btn" onClick={hideAll}>
                                    {t("term:env.hideAll")}
                                </button>
                            </>
                        ) : null}
                        {launchMode ? null : (
                            <button className="env-modal-btn" onClick={close}>
                                {t("term:env.close")}
                            </button>
                        )}
                    </div>
                    {error ? (
                        <div className="env-modal-error">{error}</div>
                    ) : loading ? (
                        <div className="env-modal-loading">{t("term:env.loadingTable")}</div>
                    ) : filteredEntries.length === 0 ? (
                        <div className="env-modal-empty">
                            {sortedEntries.length === 0
                                ? t("term:env.noEnvironmentVariables")
                                : t("term:env.noMatches")}
                        </div>
                    ) : (
                        <div className="env-modal-table">
                            <div className="env-modal-row env-modal-row-header">
                                <div className="env-modal-key">{t("term:env.keyColumn")}</div>
                                <div className="env-modal-value">{t("term:env.valueColumn")}</div>
                            </div>
                            {filteredEntries.map(({ key, value }) => {
                                const sensitive = isSensitiveKey(key);
                                const revealed = revealedKeys.has(key);
                                const displayValue = sensitive && !revealed ? maskValue(value) : value;
                                return (
                                    <div className="env-modal-row" key={key}>
                                        <div className="env-modal-key" title={key}>
                                            {key}
                                            {sensitive ? (
                                                <span className="env-modal-tag" title={t("term:env.sensitiveTitle")}>
                                                    {t("term:env.sensitiveTag")}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="env-modal-value">
                                            <span className="env-modal-value-text">{displayValue}</span>
                                            {sensitive ? (
                                                <button
                                                    className="env-modal-reveal"
                                                    onClick={() => toggleReveal(key)}
                                                    title={revealed ? t("term:env.hideValue") : t("term:env.showValue")}
                                                >
                                                    <i className={`fa-sharp fa-solid ${revealed ? "fa-eye-slash" : "fa-eye"}`} />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : null}

            <div className="env-modal-footer">
                <div className="env-modal-saved-tip">
                    {error ? <span className="env-modal-error-inline">{error}</span> : null}
                </div>
                <button className="env-modal-btn ghost" onClick={close}>
                    {t("term:env.cancel")}
                </button>
                <button className="env-modal-btn primary" onClick={save}>
                    {t("term:env.save")}
                </button>
            </div>
            </div>
            </div>
        </Modal>
    );
}

function isBlankValue(v: string | null | undefined): boolean {
    return v == null || v.trim() === "";
}

EnvModalView.displayName = "EnvModalView";

// Local error formatter to keep this component dependency-light.
// Mirrors the shape of @/app/view/aisessions/utils getErrorMessage without the import.
function getErrorMessage(e: unknown): string {
    if (!e) return "unknown error";
    if (typeof e === "string") return e;
    const anyE = e as { message?: string; error?: string };
    return anyE.message || anyE.error || String(e);
}
