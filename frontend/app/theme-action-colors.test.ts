// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ThemeScss = readFileSync(new URL("./theme.scss", import.meta.url), "utf8");
const TailwindSetup = readFileSync(new URL("../tailwindsetup.css", import.meta.url), "utf8");

const ActionPalettes = [
    { theme: "dark", background: "#58c142", hover: "#76df60", text: "#000000" },
    { theme: "light", background: "#7c49a1", hover: "#955ab8", text: "#ffffff" },
    { theme: "monochrome", background: "#1a1a1a", hover: "#2a2a2a", text: "#ffffff" },
];

function luminance(color: string): number {
    const channels = color
        .slice(1)
        .match(/.{2}/g)
        .map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
    const firstLuminance = luminance(first);
    const secondLuminance = luminance(second);
    return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("theme action colors", () => {
    it.each(ActionPalettes)("keeps $theme action text readable", ({ background, hover, text }) => {
        expect(contrast(background, text)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(hover, text)).toBeGreaterThanOrEqual(4.5);
    });

    it("defines semantic action variables for every theme palette", () => {
        for (const variable of [
            "--action-bg-color",
            "--action-hover-bg-color",
            "--action-text-color",
            "--action-soft-bg-color",
            "--action-soft-text-color",
            "--action-soft-border-color",
        ]) {
            expect(ThemeScss.match(new RegExp(`${variable}:`, "g"))).toHaveLength(4);
        }
    });

    it("maps semantic action variables into Tailwind colors", () => {
        for (const mapping of [
            "--color-action: var(--action-bg-color)",
            "--color-actionhover: var(--action-hover-bg-color)",
            "--color-actiontext: var(--action-text-color)",
            "--color-actionsoft: var(--action-soft-bg-color)",
            "--color-actionsofttext: var(--action-soft-text-color)",
            "--color-actionsoftborder: var(--action-soft-border-color)",
        ]) {
            expect(TailwindSetup).toContain(mapping);
        }
    });
});
