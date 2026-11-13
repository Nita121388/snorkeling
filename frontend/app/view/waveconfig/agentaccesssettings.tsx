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
import { cn, fireAndForget } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

const SCOPES = [
    { id: "observe", label: "Observe", hint: "Read UI state, blocks, sessions, cards" },
    { id: "navigate", label: "Navigate", hint: "Open blocks, create / switch tabs" },
    { id: "data", label: "Data", hint: "Write session title / note / tags" },
] as const;

const TTLS = [
    { seconds: 900, label: "15 minutes" },
    { seconds: 1800, label: "30 minutes" },
    { seconds: 3600, label: "1 hour" },
    { seconds: 28800, label: "8 hours" },
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
    if (!expiresAt) return "no expiry";
    const ms = expiresAt - now;
    if (ms <= 0) return "expired";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `in ${hours}h`;
    return `in ${Math.round(hours / 24)}d`;
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
            setNotice({ kind: "err", text: `Could not list tokens: ${String(e)}` });
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
            setNotice({ kind: "err", text: "Give the agent a name so the audit log can attribute calls." });
            return;
        }
        if (scopes.length === 0) {
            setNotice({ kind: "err", text: "Pick at least one scope." });
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
                    text: `Token for "${res.name}" saved to ${res.outpath || outPath} (${scopeSummary(
                        res.scopes
                    )}). The token itself is never displayed.`,
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
            if (!confirm(`Revoke ${label}? The agent's next call will be refused.`)) return;
            setBusy(true);
            fireAndForget(async () => {
                try {
                    const res = await RpcApi.AgentAuthRevokeCommand(TabRpcClient, selector);
                    setNotice({
                        kind: "ok",
                        text: res?.revoked ? `Revoked ${res.revoked} token(s).` : "Nothing was live to revoke.",
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
                        text: `No agent skill directory found. Install manually with: wsh agent install-skill --root <dir>`,
                    });
                } else {
                    setNotice({
                        kind: "ok",
                        text: `Skill installed to ${installed.length} place(s): ${installed.join(", ")}${
                            skipped.length ? ` (skipped ${skipped.length} unused agent dirs)` : ""
                        }`,
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
            setNotice({ kind: "ok", text: "MCP config copied. Paste it into your agent host's config file." });
        });
    }, [mcpConfig]);

    const now = Date.now();
    const liveCount = tokens.filter((t) => tokenState(t) === "live").length;

    return (
        <div className="flex flex-col h-full overflow-y-auto px-4 pb-6">
            <div className="text-sm text-secondary mt-3 mb-1">
                Let an agent <em>outside</em> Snorkeling (Claude Code, Codex, pi) read and navigate this app. External
                processes never receive the app's own key: they get a short-lived scoped token that you can revoke here.
            </div>

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-5">
                Create a token
            </div>
            <div className="divide-y divide-border">
                <Row title="Agent name" description="Shown in the audit log, so make it recognisable.">
                    <input
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm w-56"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-label="Agent name"
                    />
                </Row>
                <Row title="Scopes" description="Least privilege: observe is read-only. Destructive is never issued.">
                    <div className="flex items-center gap-3">
                        {SCOPES.map((s) => (
                            <label key={s.id} className="flex items-center gap-1 text-xs" title={s.hint}>
                                <input
                                    type="checkbox"
                                    checked={scopes.includes(s.id)}
                                    onChange={() => toggleScope(s.id)}
                                    aria-label={`${s.label} scope`}
                                />
                                {s.label}
                            </label>
                        ))}
                    </div>
                </Row>
                <Row title="Lifetime" description="Short is better. Expiry is enforced by the signed token itself.">
                    <select
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm"
                        value={ttl}
                        onChange={(e) => setTtl(Number(e.target.value))}
                        aria-label="Token lifetime"
                    >
                        {TTLS.map((t) => (
                            <option key={t.seconds} value={t.seconds}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </Row>
                <Row title="Save to" description="Written 0600, never displayed. Point your host's env var here.">
                    <input
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm w-72 font-mono"
                        value={outPath}
                        onChange={(e) => setOutPath(e.target.value)}
                        aria-label="Token file path"
                    />
                </Row>
                <Row
                    title="Generate"
                    description="Creates the token and writes the file. Nothing is printed to the terminal."
                >
                    <button
                        className="border border-border rounded px-3 py-1 text-sm hover:bg-hoverbg disabled:opacity-50"
                        onClick={grant}
                        disabled={busy}
                    >
                        Create token
                    </button>
                </Row>
            </div>
            <Notice2 notice={notice} />

            <div className="flex items-center justify-between mt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Active tokens {loading ? "" : `(${liveCount} live / ${tokens.length} total)`}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="border border-border rounded px-2 py-1 text-xs hover:bg-hoverbg"
                        onClick={() => fireAndForget(refresh)}
                    >
                        Refresh
                    </button>
                    <button
                        className="border border-border rounded px-2 py-1 text-xs text-error hover:bg-hoverbg disabled:opacity-50"
                        onClick={() => revoke({ all: true }, "ALL tokens")}
                        disabled={busy || liveCount === 0}
                    >
                        Revoke all
                    </button>
                </div>
            </div>
            <div className="mt-2 border border-border rounded">
                {tokens.length === 0 ? (
                    <div className="text-xs text-muted-foreground px-3 py-3">
                        {loading ? "Loading…" : "No token has been created yet."}
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                            <tr className="text-left">
                                <th className="px-3 py-1.5 font-normal">Name</th>
                                <th className="px-3 py-1.5 font-normal">Scopes</th>
                                <th className="px-3 py-1.5 font-normal">Expires</th>
                                <th className="px-3 py-1.5 font-normal">State</th>
                                <th className="px-3 py-1.5 font-normal">jti</th>
                                <th className="px-3 py-1.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {tokens.map((t) => {
                                const state = tokenState(t);
                                return (
                                    <tr key={`${t.name}-${t.jtiprefix}`}>
                                        <td className="px-3 py-1.5">{t.name}</td>
                                        <td className="px-3 py-1.5 font-mono">{scopeSummary(t.scopes)}</td>
                                        <td className="px-3 py-1.5">{formatExpiry(t.expiresat, now)}</td>
                                        <td
                                            className={cn(
                                                "px-3 py-1.5",
                                                state === "live" ? "text-primary" : "text-muted-foreground"
                                            )}
                                        >
                                            {state}
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{t.jtiprefix}</td>
                                        <td className="px-3 py-1.5 text-right">
                                            <button
                                                className="border border-border rounded px-2 py-0.5 hover:bg-hoverbg disabled:opacity-30"
                                                onClick={() => revoke({ jti: t.jtiprefix }, `token ${t.jtiprefix}`)}
                                                disabled={busy || state === "revoked"}
                                            >
                                                Revoke
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
                    registry: {registryPath} (stores no tokens)
                </div>
            )}

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-6">
                Give your agent the skill
            </div>
            <div className="divide-y divide-border">
                <Row
                    title="Install skill"
                    description="Copies the bundled skill into the agent directories that exist on this machine (~/.claude, ~/.codex, ~/.agents)."
                >
                    <button
                        className="border border-border rounded px-3 py-1 text-sm hover:bg-hoverbg disabled:opacity-50"
                        onClick={installSkill}
                        disabled={busy}
                    >
                        Install
                    </button>
                </Row>
            </div>

            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-6">
                Register the MCP server
            </div>
            <div className="divide-y divide-border">
                <Row title="Host" description="Pick the agent host you are configuring.">
                    <select
                        className="bg-transparent border border-border rounded px-2 py-1 text-sm"
                        value={mcpHost}
                        onChange={(e) => setMcpHost(e.target.value)}
                        aria-label="MCP host"
                    >
                        <option value="claude">Claude Code / Cursor</option>
                        <option value="codex">Codex</option>
                    </select>
                    <button
                        className="border border-border rounded px-2 py-1 text-sm hover:bg-hoverbg"
                        onClick={buildMCPConfig}
                    >
                        Build
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
                        Copy config
                    </button>
                </div>
            )}

            <div className="mt-6 text-xs text-muted-foreground">
                Every call is written to <span className="font-mono">agent-data/audit/control-audit.jsonl</span> (time,
                command, agent name, jti prefix, allowed/denied). Tokens are rate limited to 60 calls per minute. The
                MCP transport is stdio only — no port is opened.
            </div>
        </div>
    );
});

AgentAccessSettingsContent.displayName = "AgentAccessSettingsContent";

export { AgentAccessSettingsContent };
