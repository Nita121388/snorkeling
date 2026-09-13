// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pickMetadataAIMode } from "./agent-ai-config";

const waveQuick = { "ai:provider": "wave", "ai:apitype": "openai-responses", "ai:model": "gpt-5-mini" };
const customModel = { "ai:provider": "openai", "ai:model": "gpt-4o" };

describe("pickMetadataAIMode", () => {
    it("uses the user default mode when it is configured and telemetry is on", () => {
        expect(
            pickMetadataAIMode({
                telemetryEnabled: true,
                defaultMode: "waveai@balanced",
                aiModeConfigs: { "waveai@balanced": waveQuick, "waveai@quick": waveQuick },
            })
        ).toEqual({ available: true, mode: "waveai@balanced" });
    });

    it("falls back to the quick preset when no default mode is set", () => {
        expect(
            pickMetadataAIMode({
                telemetryEnabled: true,
                defaultMode: "",
                aiModeConfigs: { "waveai@quick": waveQuick },
            })
        ).toEqual({ available: true, mode: "waveai@quick" });
    });

    it("rejects wave cloud modes when telemetry is off", () => {
        expect(
            pickMetadataAIMode({
                telemetryEnabled: false,
                defaultMode: "",
                aiModeConfigs: { "waveai@quick": waveQuick },
            })
        ).toMatchObject({ available: false });
    });

    it("allows a custom provider model even when telemetry is off", () => {
        expect(
            pickMetadataAIMode({
                telemetryEnabled: false,
                defaultMode: "openai@global",
                aiModeConfigs: { "openai@global": customModel },
            })
        ).toEqual({ available: true, mode: "openai@global" });
    });

    it("skips a missing default mode and uses the quick preset", () => {
        expect(
            pickMetadataAIMode({
                telemetryEnabled: true,
                defaultMode: "does-not-exist",
                aiModeConfigs: { "waveai@quick": waveQuick },
            })
        ).toEqual({ available: true, mode: "waveai@quick" });
    });

    it("reports a clear reason when nothing is configured", () => {
        const state = pickMetadataAIMode({
            telemetryEnabled: true,
            defaultMode: "",
            aiModeConfigs: {},
        });
        expect(state.available).toBe(false);
        if (state.available === false) {
            expect(state.reason).toContain("No AI model is configured");
        }
    });

    it("points to telemetry when configs exist but all cloud modes are blocked", () => {
        const state = pickMetadataAIMode({
            telemetryEnabled: false,
            defaultMode: "",
            aiModeConfigs: { "waveai@quick": waveQuick, "waveai@balanced": waveQuick },
        });
        expect(state.available).toBe(false);
        if (state.available === false) {
            expect(state.reason).toContain("telemetry");
        }
    });
});