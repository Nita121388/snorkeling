// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 编辑器内的 AI 生成控件（列表行内编辑器 / 两个 Note 弹窗共用）。
//
// 与 GenActionButton 的区别：编辑器里不能把 AI 结果直接落库（会覆盖用户
// 正在输入的内容），所以这里调用「提案」接口 GenerateMetadata，成功后：
//   - 草稿为空 → 直接填入草稿；
//   - 草稿非空 → 显示建议条，点 Apply 才写入。
// 生成期间不锁 textarea、不抢焦点；瞬时失败自动重试 2 次。

import { createBlock } from "@/app/store/global";
import { AISessionsServiceType } from "@/app/store/services";
import { resolveMetadataAIMode } from "@/app/view/term/agent-ai-config";
import { cn } from "@/util/util";
import * as React from "react";

export type NoteAIStatus = "idle" | "loading" | "ready" | "error";
export type NoteAISuggestion = { note: string; tags: string[] };

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function openAISettings(): void {
    void createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true);
}

export function useNoteAIGenerate(sessionId: string, connection: string | null | undefined) {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const [status, setStatus] = React.useState<NoteAIStatus>("idle");
    const [error, setError] = React.useState("");
    const [configError, setConfigError] = React.useState(false);
    const [suggestion, setSuggestion] = React.useState<NoteAISuggestion | null>(null);
    const seqRef = React.useRef(0);

    const generate = React.useCallback(async () => {
        const aiConfig = resolveMetadataAIMode();
        if (aiConfig.available === false) {
            setError(aiConfig.reason);
            setConfigError(true);
            setStatus("error");
            return;
        }
        const seq = ++seqRef.current;
        setStatus("loading");
        setError("");
        setConfigError(false);
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const result = await service.GenerateMetadata({
                    id: sessionId,
                    connection: connection?.trim() || undefined,
                    aiMode: aiConfig.mode,
                });
                if (seq !== seqRef.current) return;
                setSuggestion({ note: result.suggestion.note ?? "", tags: result.suggestion.tags ?? [] });
                setStatus("ready");
                return;
            } catch (err) {
                if (seq !== seqRef.current) return;
                if (attempt >= 2) {
                    setError(err instanceof Error ? err.message : String(err));
                    setStatus("error");
                    return;
                }
                await delay(attempt === 0 ? 1500 : 4000);
            }
        }
    }, [connection, service, sessionId]);

    const dismiss = React.useCallback(() => {
        seqRef.current++;
        setStatus("idle");
        setSuggestion(null);
        setError("");
        setConfigError(false);
    }, []);

    return { status, error, configError, suggestion, generate, dismiss, openAISettings };
}

export function NoteAIButton({
    status,
    onGenerate,
    disabled,
}: {
    status: NoteAIStatus;
    onGenerate: () => void;
    disabled?: boolean;
}) {
    const loading = status === "loading";
    return (
        <button
            type="button"
            className="shrink-0 rounded text-secondary transition-colors hover:bg-hover hover:text-primary"
            title={loading ? "Generating with AI…" : "Generate note & tags with AI"}
            aria-label={loading ? "Generating with AI" : "Generate note & tags with AI"}
            disabled={disabled || loading}
            onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onGenerate();
            }}
            data-row-action="true"
        >
            <i
                className={cn(
                    "fa-sharp fa-solid text-[10px]",
                    loading ? "fa-spinner animate-spin" : "fa-wand-magic-sparkles"
                )}
            />
        </button>
    );
}

export function NoteAISuggestionBar({
    suggestion,
    status,
    error,
    configError,
    onApply,
    onRegenerate,
    onDismiss,
    onOpenSettings,
}: {
    suggestion: NoteAISuggestion | null;
    status: NoteAIStatus;
    error: string;
    configError: boolean;
    onApply: (suggestion: NoteAISuggestion) => void;
    onRegenerate: () => void;
    onDismiss: () => void;
    onOpenSettings: () => void;
}) {
    if (status !== "ready" && status !== "error") {
        return null;
    }
    if (status === "error") {
        return (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-error/40 bg-error/10 px-2 py-1 text-[10px] text-error">
                <span className="min-w-0 flex-1 break-words">{error}</span>
                {configError ? (
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded border border-error/40 px-1.5 py-0.5 text-error hover:bg-error/10"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenSettings();
                        }}
                    >
                        Open AI settings
                    </button>
                ) : (
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded border border-error/40 px-1.5 py-0.5 text-error hover:bg-error/10"
                        onClick={(event) => {
                            event.stopPropagation();
                            onRegenerate();
                        }}
                    >
                        Retry
                    </button>
                )}
                <button
                    type="button"
                    className="shrink-0 cursor-pointer text-error/80 hover:text-error"
                    title="Dismiss"
                    aria-label="Dismiss"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDismiss();
                    }}
                >
                    <i className="fa-sharp fa-solid fa-xmark" />
                </button>
            </div>
        );
    }
    if (suggestion == null) {
        return null;
    }
    return (
        <div className="mt-1 space-y-1 rounded border border-border bg-surface-soft p-2" data-row-action="true">
            <div className="line-clamp-2 text-[11px] leading-4 text-primary">{suggestion.note || "(empty note)"}</div>
            {suggestion.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {suggestion.tags.map((tag) => (
                        <span
                            key={tag}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary"
                        >
                            #{tag}
                        </span>
                    ))}
                </div>
            ) : null}
            <div className="flex justify-end gap-1.5">
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDismiss();
                    }}
                >
                    Dismiss
                </button>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRegenerate();
                    }}
                >
                    Regenerate
                </button>
                <button
                    type="button"
                    className="cursor-pointer rounded bg-action px-1.5 py-0.5 text-[10px] text-actiontext hover:bg-actionhover"
                    onClick={(event) => {
                        event.stopPropagation();
                        onApply(suggestion);
                    }}
                >
                    Apply
                </button>
            </div>
        </div>
    );
}
