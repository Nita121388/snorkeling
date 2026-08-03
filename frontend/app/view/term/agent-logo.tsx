// Copyright 2026, Command_Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClaudeLogo, GeminiLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/app/view/aisessions/controls";
import * as React from "react";

export function getAgentLogoByProvider(provider: string): { icon: React.ReactNode; iconColor?: string } | null {
    switch (provider.trim().toLowerCase()) {
        case "codex":
            return { icon: React.createElement(OpenAILogo), iconColor: "#74a7cb" };
        case "claude":
            return { icon: React.createElement(ClaudeLogo) };
        case "gemini":
            return { icon: React.createElement(GeminiLogo), iconColor: "#8e7cc3" };
        case "opencode":
            return { icon: React.createElement(OpencodeLogo), iconColor: "#e0b956" };
        case "pi":
            return { icon: React.createElement(PiLogo), iconColor: "#888888" };
        default:
            return null;
    }
}
