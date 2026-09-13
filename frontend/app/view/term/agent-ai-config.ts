// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AI 元数据生成的可用性判断与用户引导文案。
//
// Wave AI 的模型配置是可选的：项目默认自带 waveai@quick/balanced/deep（走 WaveCloud
// 代理，通常无需用户配 key），但 WaveCloud 模式要求开启遥测。自定义 provider
// （openai/anthropic 等）则带自己的 API token，与遥测无关。
//
// 我们把「点击生成前先判断有没有可用的默认模型」做成纯逻辑，这样用户在配置为空、
// 遥测关闭、或模式名无效时，看到的是明确的引导而不是晦涩的后端错误。

import { atoms, getSettingsKeyAtom, globalStore } from "@/app/store/global";

export type MetadataAIConfigState =
    | { available: true; mode: string }
    | { available: false; reason: string };

export type MetadataAIConfigInput = {
    telemetryEnabled: boolean;
    defaultMode: string;
    aiModeConfigs: Record<string, AIModeConfigType>;
};

// pickMetadataAIMode 是纯逻辑：给定配置输入，挑一个可用的默认模型，或给出可操作的
// 引导原因。与实际读配置分离，便于单元测试。
export function pickMetadataAIMode(input: MetadataAIConfigInput): MetadataAIConfigState {
    const { telemetryEnabled, defaultMode, aiModeConfigs } = input;

    // 候选按优先级：用户默认模式 → 最快的云端预设。
    const candidates: string[] = [];
    if (defaultMode !== "") {
        candidates.push(defaultMode);
    }
    candidates.push("waveai@quick");

    for (const mode of candidates) {
        const config = aiModeConfigs[mode];
        if (config == null) {
            continue;
        }
        // WaveCloud（waveai@*）需要遥测开启才能用；自定义 provider 带自己的 token。
        if (mode.startsWith("waveai@") && !telemetryEnabled) {
            continue;
        }
        return { available: true, mode };
    }

    // 没有任何可用的候选：区分「完全没配」和「有配置但云端被遥测挡住」。
    const hasAnyMode = Object.keys(aiModeConfigs).length > 0;
    if (hasAnyMode) {
        return {
            available: false,
            reason: "Wave AI cloud modes require telemetry to be enabled. Turn on telemetry in Settings, or add a custom provider model.",
        };
    }
    return {
        available: false,
        reason: "No AI model is configured. Open Wave AI settings to add a model (e.g. a Wave AI cloud mode or a custom provider).",
    };
}

// resolveMetadataAIMode 在点击生成时读取当前配置并挑选可用模型。
export function resolveMetadataAIMode(): MetadataAIConfigState {
    return pickMetadataAIMode({
        telemetryEnabled: globalStore.get(getSettingsKeyAtom("telemetry:enabled")) ?? false,
        defaultMode: globalStore.get(getSettingsKeyAtom("waveai:defaultmode")) ?? "",
        aiModeConfigs: globalStore.get(atoms.waveaiModeConfigAtom) ?? {},
    });
}