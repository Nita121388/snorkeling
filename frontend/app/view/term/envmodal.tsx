// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { copyText } from "@/util/clipboard";
import { useEffect, useMemo, useState } from "react";

import "./envmodal.scss";

type EnvModalViewProps = {
    blockId: string;
    connection: string;
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

export function EnvModalView({ blockId, connection }: EnvModalViewProps) {
    const [env, setEnv] = useState<Record<string, string> | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        RpcApi.GetBlockEnvCommand(TabRpcClient, { blockid: blockId, connname: connection ?? "" })
            .then((res) => {
                if (cancelled) return;
                setEnv(res?.env ?? {});
            })
            .catch((e) => {
                if (cancelled) return;
                setError(getErrorMessage(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [blockId, connection]);

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

    return (
        <div className="env-modal-view">
            <div className="env-modal-header">
                <div className="env-modal-title">
                    Terminal Environment
                    {isRemote ? <span className="env-modal-tag-remote">remote</span> : null}
                </div>
                <div className="env-modal-subtitle">
                    {loading
                        ? "loading…"
                        : error
                          ? "error"
                          : isRemote
                            ? `${sortedEntries.length} configured vars · OS baseline not shown for remote`
                            : `${sortedEntries.length} variables`}
                    {sensitiveCount > 0 ? ` · ${sensitiveCount} masked` : ""}
                </div>
            </div>
            <div className="env-modal-toolbar">
                <input
                    className="env-modal-search"
                    type="text"
                    placeholder="filter keys/values…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <button className="env-modal-btn" onClick={copyAll} disabled={loading || !env} title="Copy all env as KEY=VALUE lines">
                    <i className="fa-sharp fa-solid fa-copy" /> Copy All
                </button>
                {sensitiveCount > 0 ? (
                    <>
                        <button className="env-modal-btn" onClick={revealAll}>
                            Show All
                        </button>
                        <button className="env-modal-btn" onClick={hideAll}>
                            Hide All
                        </button>
                    </>
                ) : null}
                <button className="env-modal-btn" onClick={close}>
                    Close
                </button>
            </div>
            {error ? (
                <div className="env-modal-error">{error}</div>
            ) : loading ? (
                <div className="env-modal-loading">Loading…</div>
            ) : filteredEntries.length === 0 ? (
                <div className="env-modal-empty">{sortedEntries.length === 0 ? "No environment variables." : "No matches."}</div>
            ) : (
                <div className="env-modal-table">
                    <div className="env-modal-row env-modal-row-header">
                        <div className="env-modal-key">Key</div>
                        <div className="env-modal-value">Value</div>
                    </div>
                    {filteredEntries.map(({ key, value }) => {
                        const sensitive = isSensitiveKey(key);
                        const revealed = revealedKeys.has(key);
                        const displayValue = sensitive && !revealed ? maskValue(value) : value;
                        return (
                            <div className="env-modal-row" key={key}>
                                <div className="env-modal-key" title={key}>
                                    {key}
                                    {sensitive ? <span className="env-modal-tag" title="masked as sensitive">SENS</span> : null}
                                </div>
                                <div className="env-modal-value">
                                    <span className="env-modal-value-text">{displayValue}</span>
                                    {sensitive ? (
                                        <button
                                            className="env-modal-reveal"
                                            onClick={() => toggleReveal(key)}
                                            title={revealed ? "Hide value" : "Show value"}
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
        </div>
    );
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
