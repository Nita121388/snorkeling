// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// GenActionButton — 一键后台 AI 生成的通用按钮。
//
// 点击即入队并立即返回（RPC 不等待模型），按钮只表达 queued/running/failed/done。
// 结果通过既有 titleupdated / note-updated 广播刷新各 surface，本组件不落库。
//
// 前置校验：没有可用模型时直接引导，不发 RPC。
// 覆盖保护：titleSource=user 且非 force 时先走确认（默认 window.confirm，
// 调用方可用 onNeedsForce 换成自己的弹窗）。

import { createBlock } from "@/app/store/global";
import { AISessionsServiceType } from "@/app/store/services";
import { resolveMetadataAIMode } from "@/app/view/term/agent-ai-config";
import { cn } from "@/util/util";
import * as React from "react";
import { autoGenerate, useSessionGenerationStatus } from "./aisession-gen-store";

export type GenKindValue = "title" | "metadata" | "both";

const serviceByDefault = new AISessionsServiceType();

const KindLabels: Record<GenKindValue, string> = {
    title: "Generate title with AI",
    metadata: "Generate note & tags with AI",
    both: "Generate title, note & tags with AI",
};

function openAISettings(): void {
    void createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true);
}

export function GenActionButton({
    sessionKey,
    connection,
    kind,
    force = false,
    titleSource,
    size = "sm",
    label,
    className,
    onNeedsForce,
    onBeforeGenerate,
    onError,
    onDone,
}: {
    sessionKey: string;
    connection?: string;
    kind: GenKindValue;
    force?: boolean;
    /** 当前会话标题来源；= "user" 且非 force 时先确认覆盖。 */
    titleSource?: string;
    size?: "xs" | "sm";
    label?: string;
    className?: string;
    onNeedsForce?: () => void;
    /** 点击时、真正入队前调用：供调用方快照旧值（如 Undo 用的 note/tags）。 */
    onBeforeGenerate?: () => void;
    onError?: (message: string) => void;
    onDone?: () => void;
}) {
    const status = useSessionGenerationStatus(sessionKey, connection, kind);
    const [busy, setBusy] = React.useState(false);
    const prevDoneRef = React.useRef(false);

    React.useEffect(() => {
        const done = status?.state === "done";
        if (done && !prevDoneRef.current) {
            onDone?.();
        }
        prevDoneRef.current = done;
    }, [onDone, status?.state]);

    const state = status?.state ?? null;
    const running = busy || state === "queued" || state === "running";
    const failed = state === "failed";

    const handleClick = React.useCallback(
        async (event: React.MouseEvent) => {
            event.stopPropagation();
            event.preventDefault();
            if (running || sessionKey === "") {
                return;
            }
            const aiConfig = resolveMetadataAIMode();
            if (aiConfig.available === false) {
                onError?.(aiConfig.reason);
                window.setTimeout(() => {
                    openAISettings();
                }, 0);
                return;
            }
            if (kind !== "metadata" && titleSource === "user" && !force) {
                if (onNeedsForce != null) {
                    onNeedsForce();
                    return;
                }
                const confirmed = window.confirm(
                    "This session has a custom title. Replace it with an AI-generated one?"
                );
                if (!confirmed) {
                    return;
                }
            }
            setBusy(true);
            onBeforeGenerate?.();
            try {
                const result = await autoGenerate(serviceByDefault, {
                    ids: [sessionKey],
                    connection,
                    kind,
                    force: force || (titleSource === "user" && kind !== "metadata"),
                    aiMode: aiConfig.mode,
                });
                if (!result.ok) {
                    onError?.(result.error);
                }
            } finally {
                setBusy(false);
            }
        },
        [connection, force, kind, onBeforeGenerate, onError, onNeedsForce, running, sessionKey, titleSource]
    );

    const tooltip = failed
        ? `${status?.error || "Generation failed"} — click to retry`
        : running
          ? status?.state === "running"
              ? `Generating… (attempt ${status.attempt}/${status.maxAttempts})`
              : "Queued…"
          : state === "done"
            ? "Generated"
            : (label ?? KindLabels[kind]);

    const icon = running
        ? "fa-spinner animate-spin"
        : failed
          ? "fa-triangle-exclamation text-warning"
          : state === "done"
            ? "fa-check text-accent"
            : "fa-wand-magic-sparkles";

    return (
        <button
            type="button"
            className={cn(
                "shrink-0 rounded text-secondary transition-colors hover:bg-hover hover:text-primary",
                size === "xs" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs",
                running && "cursor-default opacity-80",
                className
            )}
            title={tooltip}
            aria-label={tooltip}
            disabled={sessionKey === ""}
            onClick={handleClick}
            data-row-action="true"
        >
            <i className={cn("fa-sharp fa-solid", icon)} />
        </button>
    );
}
