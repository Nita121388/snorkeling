// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Wave Config visual panel for the external-agent control surface (design
// §10.5.3 plan B: "Settings → Agent Access").
//
// This panel is a thin UX layer. Every action goes through the same RPC the CLI
// uses (AgentAuthGrantCommand / AgentAuthListCommand / AgentAuthRevokeCommand /
// AgentSkillInstallCommand / AgentMCPConfigCommand), so the panel and `wsh` can
// never disagree about what a grant means.
//
// Deliberate omission: the minted token is never displayed. It is written to
// the chosen file with 0600 and the user is shown the *path*. A token on screen
// ends up in screenshots, chat logs and clipboard history; the path does not.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { i18n } from "@/i18n/config";
import { cn, fireAndForget } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const SCOPES = [
    {
        id: "observe",
        labelKey: "waveconfig:agentAccess.scopeObserve",
        hintKey: "waveconfig:agentAccess.scopeHintObserve",
    },
    {
        id: "navigate",
        labelKey: "waveconfig:agentAccess.scopeNavigate",
        hintKey: "waveconfig:agentAccess.scopeHintNavigate",
    },
    { id: "data", labelKey: "waveconfig:agentAccess.scopeData", hintKey: "waveconfig:agentAccess.scopeHintData" },
] as const;

const TTLS = [
    { seconds: 900, labelKey: "waveconfig:agentAccess.ttl15m" },
    { seconds: 1800, labelKey: "waveconfig:agentAccess.ttl30m" },
    { seconds: 3600, labelKey: "waveconfig:agentAccess.ttl1h" },
    { seconds: 28800, labelKey: "waveconfig:agentAccess.ttl8h" },
] as const;

const DEFAULT_TOKEN_PATH = "~/.config/snorkeling/agent-token.json";

type Notice = { kind: "ok" | "err"; text: string } | null;

export function scopeSummary(scopes: string[] | undefined, fallback = "observe"): string {
    if (!scopes || scopes.length === 0) return fallback;
    return scopes.join(", ");
}

/** Human-readable state for a token row. Order matters: revoked wins over expired. */
export function tokenState(token: { revoked: boolean; expired: boolean }): "revoked" | "expired" | "live" {
    if (token.revoked) return "revoked";
    if (token.expired) return "expired";
    return "live";
}

export function formatExpiry(expiresAt: number, now: number): string {
    if (!expiresAt) return i18n.t("waveconfig:agentAccess.expiryNone");
    const ms = expiresAt - now;
    if (ms <= 0) return i18n.t("waveconfig:agentAccess.expiryExpired");
    const mins = Math.round(ms / 60000);
    if (mins < 60) return i18n.t("waveconfig:agentAccess.expiryMinutes", { count: mins });
    const hours = Math.round(mins / 60);
    if (hours < 48) return i18n.t("waveconfig:agentAccess.expiryHours", { count: hours });
    return i18n.t("waveconfig:agentAccess.expiryDays", { count: Math.round(hours / 24) });
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-4 py-3">
            <div className="flex-1 min-w-0">
                <div className="text-sm text-primary">{title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
            </div>
            <div className="shrink-0 flex items-center gap-2 pt-0.5">{children}</div>
        </div>
    );
}

function Notice2({ notice }: { notice: Notice }) {
    if (!notice) return null;
    return (
        <div
            className={cn(
                "mt-2 text-xs rounded px-2 py-1",
                notice.kind === "ok" ? "bg-accent/40 text-primary" : "bg-error/15 text-error"
            )}
            role={notice.kind === "err" ? "alert" : "status"}
        >
            {notice.text}
        </div>
    );
}

const AgentAccessSettingsContent = memo(() => {
    const { t } = useTranslation("waveconfig");
    const [tokens, setTokens] = useState<AgentAuthTokenInfo[]>([]);
    const [registryPath, setRegistryPath] = useState("");
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<Notice>(null);
    const [name, setName] = useState("external-agent");
    const [scopes, setScopes] = useState<string[]>(["observe"]);
    const [ttl, setTtl] = useState<number>(1800);
    const [outPath, setOutPath] = useState(DEFAULT_TOKEN_PATH);
    const [mcpHost, setMcpHost] = useState("claude");
    const [mcpConfig, setMcpConfig] = useState("");
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await RpcApi.AgentAuthListCommand(TabRpcClient);
            setTokens(res?.tokens ?? []);
            setRegistryPath(res?.path ?? "");
        } catch (e) {
            setNotice({
                kind: "err",
                text: i18n.t("waveconfig:agentAccess.noticeListFailed", { error: String(e) }),
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fireAndForget(refresh);
    }, [refresh]);

    const toggleScope = useCallback((id: string) => {
        setScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
    }, []);

    const grant = useCallback(() => {
        setNotice(null);
        if (!name.trim()) {
            setNotice({ kind: "err", text: i18n.t("waveconfig:agentAccess.noticeNameRequired") });
            return;
        }
        if (scopes.length === 0) {
            setNotice({ kind: "err", text: i18n.t("waveconfig:agentAccess.noticeScopeRequired") });
            return;
        }
        setBusy(true);
        fireAndForget(async () => {
            try {
                // The app writes the file with 0600 (agentaccess.WriteTokenFile),
                // the same call the CLI uses. The panel never touches the token
                // bytes, so it cannot leak through the renderer.
                const res = await RpcApi.AgentAuthGrantCommand(TabRpcClient, {
                    name: name.trim(),
                    scope: scopes,
                    ttlseconds: ttl,
                    out: outPath,
                });
                setNotice({
                    kind: "ok",
                    text: i18n.t("waveconfig:agentAccess.noticeTokenSaved", {
                        name: res.name,
                        path: res.outpath || outPath,
                        scopes: scopeSummary(res.scopes),
                    }),
                });
                await refresh();
            } catch (e) {
                setNotice({ kind: "err", text: String(e) });
            } finally {
                setBusy(false);
            }
        });
    }, [name, scopes, ttl, outPath, refresh]);

    const revoke = useCallback(
        (selector: { name?: string; jti?: string; all?: boolean }, label: string) => {
            if (!confirm(i18n.t("waveconfig:agentAccess.revokeConfirm", { label }))) return;
            setBusy(true);
            fireAndForget(async () => {
                try {
                    const res = await RpcApi.AgentAuthRevokeCommand(TabRpcClient, selector);
                    setNotice({
                        kind: "ok",
                        text: res?.revoked
                            ? i18n.t("waveconfig:agentAccess.revokedCount", { count: res.revoked })
                            : i18n.t("waveconfig:agentAccess.nothingToRevoke"),
                    });
                    await refresh();
                } catch (e) {
                    setNotice({ kind: "err", text: String(e) });
                } finally {
                    setBusy(false);
                }
            });
        },
        [refresh]
    );

    const installSkill = useCallback(() => {
        setBusy(true);
        setNotice(null);
        fireAndForget(async () => {
            try {
                const res = await RpcApi.AgentSkillInstallCommand(TabRpcClient);
                const installed = res?.installed ?? [];
                const skipped = res?.skipped ?? [];
                if (installed.length === 0) {
                    setNotice({
                        kind: "err",
                        text: i18n.t("waveconfig:agentAccess.noticeNoSkillDir"),
                    });
                } else {
                    setNotice({
                        kind: "ok",
                        text:
                            i18n.t("waveconfig:agentAccess.noticeSkillInstalled", {
                                count: installed.length,
                                places: installed.join(", "),
                            }) +
                            (skipped.length
                                ? i18n.t("waveconfig:agentAccess.noticeSkillSkipped", { count: skipped.length })
                                : ""),
                    });
                }
            } catch (e) {
                setNotice({ kind: "err", text: String(e) });
            } finally {
                setBusy(false);
            }
        });
    }, []);

    const buildMCPConfig = useCallback(() => {
        setNotice(null);
        fireAndForget(async () => {
            try {
                const res = await RpcApi.AgentMCPConfigCommand(TabRpcClient, mcpHost);
                setMcpConfig(res?.config ?? "");
            } catch (e) {
                setNotice({ kind: "err", text: String(e) });
            }
        });
    }, [mcpHost]);

    const copyMCPConfig = useCallback(() => {
        if (!mcpConfig) return;
        fireAndForget(async () => {
            await navigator.clipboard.writeText(mcpConfig);
            setNotice({
                kind: "ok",
                text: i18n.t("waveconfig:agentAccess.noticeMcpCopied"),
            });
        });
    }, [mcpConfig]);

    const now = Date.now();
    const liveCount = tokens.filter((t) => tokenState(t) === "live").length;

    return (
        <div className="flex flex-col h-full overflow-y-auto px-4 pb-6">
            <div className="text-sm text-secondary mt-3 mb-1">
                {t("waveconfig:agentAccess.introPrefix")} <em>{t("waveconfig:agentAccess.introEmphasis")}</em>{" "}
                {t("waveconfig:agentAccess.introSuffix")}
            </div>

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-5">
                {t("waveconfig:agentAccess.createTokenTitle")}
            </div>
            <div className="divide-y divide-border">
                <Row
                    title={t("waveconfig:agentAccess.nameTitle")}
                    description={t("waveconfig:agentAccess.nameDescription")}
                >
                    <input
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm w-56"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-label={t("waveconfig:agentAccess.nameAria")}
                    />
                </Row>
                <Row
                    title={t("waveconfig:agentAccess.scopesTitle")}
                    description={t("waveconfig:agentAccess.scopesDescription")}
                >
                    <div className="flex items-center gap-3">
                        {SCOPES.map((s) => (
                            <label key={s.id} className="flex items-center gap-1 text-xs" title={t(s.hintKey)}>
                                <input
                                    type="checkbox"
                                    checked={scopes.includes(s.id)}
                                    onChange={() => toggleScope(s.id)}
                                    aria-label={i18n.t("waveconfig:agentAccess.scopeAria", { scope: t(s.labelKey) })}
                                />
                                {t(s.labelKey)}
                            </label>
                        ))}
                    </div>
                </Row>
                <Row
                    title={t("waveconfig:agentAccess.lifetimeTitle")}
                    description={t("waveconfig:agentAccess.lifetimeDescription")}
                >
                    <select
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm"
                        value={ttl}
                        onChange={(e) => setTtl(Number(e.target.value))}
                        aria-label={t("waveconfig:agentAccess.lifetimeAria")}
                    >
                        {TTLS.map((ttlOpt) => (
                            <option key={ttlOpt.seconds} value={ttlOpt.seconds}>
                                {t(ttlOpt.labelKey)}
                            </option>
                        ))}
                    </select>
                </Row>
                <Row
                    title={t("waveconfig:agentAccess.saveToTitle")}
                    description={t("waveconfig:agentAccess.saveToDescription")}
                >
                    <input
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm w-72 font-mono"
                        value={outPath}
                        onChange={(e) => setOutPath(e.target.value)}
                        aria-label={t("waveconfig:agentAccess.saveToAria")}
                    />
                </Row>
                <Row
                    title={t("waveconfig:agentAccess.generateTitle")}
                    description={t("waveconfig:agentAccess.generateDescription")}
                >
                    <button
                        className="border border-border rounded px-3 py-1 text-sm hover:bg-hoverbg disabled:opacity-50"
                        onClick={grant}
                        disabled={busy}
                    >
                        {t("waveconfig:agentAccess.generateButton")}
                    </button>
                </Row>
            </div>
            <Notice2 notice={notice} />

            <div className="flex items-center justify-between mt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("waveconfig:agentAccess.activeTokens")}{" "}
                    {loading
                        ? ""
                        : i18n.t("waveconfig:agentAccess.activeTokensCount", {
                              live: liveCount,
                              total: tokens.length,
                          })}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="border border-border rounded px-2 py-1 text-xs hover:bg-hoverbg"
                        onClick={() => fireAndForget(refresh)}
                    >
                        {t("waveconfig:agentAccess.refresh")}
                    </button>
                    <button
                        className="border border-border rounded px-2 py-1 text-xs text-error hover:bg-hoverbg disabled:opacity-50"
                        onClick={() => revoke({ all: true }, i18n.t("waveconfig:agentAccess.revokeAllLabel"))}
                        disabled={busy || liveCount === 0}
                    >
                        {t("waveconfig:agentAccess.revokeAll")}
                    </button>
                </div>
            </div>
            <div className="mt-2 border border-border rounded">
                {tokens.length === 0 ? (
                    <div className="text-xs text-muted-foreground px-3 py-3">
                        {loading ? t("waveconfig:agentAccess.loadingTokens") : t("waveconfig:agentAccess.noTokens")}
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                            <tr className="text-left">
                                <th className="px-3 py-1.5 font-normal">{t("waveconfig:agentAccess.thName")}</th>
                                <th className="px-3 py-1.5 font-normal">{t("waveconfig:agentAccess.thScopes")}</th>
                                <th className="px-3 py-1.5 font-normal">{t("waveconfig:agentAccess.thExpires")}</th>
                                <th className="px-3 py-1.5 font-normal">{t("waveconfig:agentAccess.thState")}</th>
                                <th className="px-3 py-1.5 font-normal">jti</th>
                                <th className="px-3 py-1.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {tokens.map((tk) => {
                                const state = tokenState(tk);
                                return (
                                    <tr key={`${tk.name}-${tk.jtiprefix}`}>
                                        <td className="px-3 py-1.5">{tk.name}</td>
                                        <td className="px-3 py-1.5 font-mono">{scopeSummary(tk.scopes)}</td>
                                        <td className="px-3 py-1.5">{formatExpiry(tk.expiresat, now)}</td>
                                        <td
                                            className={cn(
                                                "px-3 py-1.5",
                                                state === "live" ? "text-primary" : "text-muted-foreground"
                                            )}
                                        >
                                            {state === "live"
                                                ? t("waveconfig:agentAccess.stateLive")
                                                : state === "expired"
                                                  ? t("waveconfig:agentAccess.stateExpired")
                                                  : t("waveconfig:agentAccess.stateRevoked")}
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{tk.jtiprefix}</td>
                                        <td className="px-3 py-1.5 text-right">
                                            <button
                                                className="border border-border rounded px-2 py-0.5 hover:bg-hoverbg disabled:opacity-30"
                                                onClick={() =>
                                                    revoke(
                                                        { jti: tk.jtiprefix },
                                                        i18n.t("waveconfig:agentAccess.revokeOneLabel", {
                                                            jti: tk.jtiprefix,
                                                        })
                                                    )
                                                }
                                                disabled={busy || state === "revoked"}
                                            >
                                                {t("waveconfig:agentAccess.revoke")}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            {registryPath && (
                <div className="text-xs text-muted-foreground mt-1 font-mono truncate" title={registryPath}>
                    {t("waveconfig:agentAccess.registryPrefix")} {registryPath} {t("waveconfig:agentAccess.registryNote")}
                </div>
            )}

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-6">
                {t("waveconfig:agentAccess.skillTitle")}
            </div>
            <div className="divide-y divide-border">
                <Row
                    title={t("waveconfig:agentAccess.installSkillTitle")}
                    description={t("waveconfig:agentAccess.installSkillDescription")}
                >
                    <button
                        className="border border-border rounded px-3 py-1 text-sm hover:bg-hoverbg disabled:opacity-50"
                        onClick={installSkill}
                        disabled={busy}
                    >
                        {t("waveconfig:agentAccess.install")}
                    </button>
                </Row>
            </div>

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-6">
                {t("waveconfig:agentAccess.mcpTitle")}
            </div>
            <div className="divide-y divide-border">
                <Row
                    title={t("waveconfig:agentAccess.hostTitle")}
                    description={t("waveconfig:agentAccess.hostDescription")}
                >
                    <select
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm"
                        value={mcpHost}
                        onChange={(e) => setMcpHost(e.target.value)}
                        aria-label={t("waveconfig:agentAccess.hostAria")}
                    >
                        <option value="claude">Claude Code / Cursor</option>
                        <option value="codex">Codex</option>
                    </select>
                    <button
                        className="border border-border rounded px-2 py-1 text-sm hover:bg-hoverbg"
                        onClick={buildMCPConfig}
                    >
                        {t("waveconfig:agentAccess.build")}
                    </button>
                </Row>
            </div>
            {mcpConfig && (
                <div className="mt-2">
                    <pre className="text-xs font-mono bg-black/20 border border-border rounded p-2 overflow-x-auto">
                        {mcpConfig}
                    </pre>
                    <button
                        className="mt-1 border border-border rounded px-2 py-1 text-xs hover:bg-hoverbg"
                        onClick={copyMCPConfig}
                    >
                        {t("waveconfig:agentAccess.copyConfig")}
                    </button>
                </div>
            )}

            <div className="mt-6 text-xs text-muted-foreground">
                {t("waveconfig:agentAccess.auditPrefix")}{" "}
                <span className="font-mono">agent-data/audit/control-audit.jsonl</span>{" "}
                {t("waveconfig:agentAccess.auditSuffix")}
            </div>
        </div>
    );
});

AgentAccessSettingsContent.displayName = "AgentAccessSettingsContent";

export { AgentAccessSettingsContent };
