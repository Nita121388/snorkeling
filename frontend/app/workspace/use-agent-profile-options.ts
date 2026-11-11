// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent profile 选项（含**真实探测**）。
//
// 为什么需要这个 hook：`getAgentProfileOptions(settings)` 不传 availableCommands 时，
// isDetectedAgentProfile 会退化成「全部 profile 都算检测到」——于是面板里会列出用户根本没装的
// agent（例：没装 gemini 也显示 Gemini）。New Agent 弹窗一直是传探测结果的，别处要复用它就得
// 一起带上探测，所以把「FindCommand 探测 + getAgentProfileOptions」收口到这里，避免第三份实现。

import { useWaveEnv } from "@/app/waveenv/waveenv";
import {
    getAgentProfileDetectionCommands,
    getAgentProfileOptions,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { fireAndForget } from "@/util/util";
import { useEffect, useMemo, useState } from "react";

/** 各 profile 的命令探测结果（null = 未找到）。 */
export function useAgentCommandPaths(settings: SettingsType | null | undefined): Record<string, string | null> {
    const [agentCommandPaths, setAgentCommandPaths] = useState<Record<string, string | null>>({});
    const env = useWaveEnv();
    useEffect(() => {
        const detectionCommands = getAgentProfileDetectionCommands(settings);
        const entries = Object.entries(detectionCommands);
        let cancelled = false;
        if (entries.length === 0) {
            setAgentCommandPaths({});
            return () => {
                cancelled = true;
            };
        }
        fireAndForget(async () => {
            const detectedEntries = await Promise.all(
                entries.map(async ([profileName, command]) => {
                    try {
                        const path = await env.services.client.FindCommand(command);
                        return [profileName, path == null || path.trim() === "" ? null : path] as const;
                    } catch (error) {
                        console.warn(`Failed to detect agent command ${command}:`, error);
                        return [profileName, null] as const;
                    }
                })
            );
            if (!cancelled) {
                setAgentCommandPaths(Object.fromEntries(detectedEntries));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [env.services.client, settings]);
    return agentCommandPaths;
}

/** 探测后的 agent profile 列表：只保留真的能在 PATH 找到的 agent。 */
export function useDetectedAgentProfileOptions(settings: SettingsType | null | undefined): AgentProfileOption[] {
    const agentCommandPaths = useAgentCommandPaths(settings);
    return useMemo(() => getAgentProfileOptions(settings, agentCommandPaths), [settings, agentCommandPaths]);
}
