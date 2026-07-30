// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Paragraph } from "mdast";

export interface BlankSpacerOptions {
    /**
     * How many source lines one spacer represents. Defaults to 1.
     * 2 = "one blank line creates one spacer line". 1.5 isn't supported.
     */
    linesPerSpacer?: number;
    /**
     * Minimum blank-line count required to emit a spacer. Defaults to 1.
     * Below this threshold the gap is treated as "normal paragraph spacing"
     * and no spacer paragraph is inserted.
     */
    minSpacerLines?: number;
    /**
     * When true, leading blank lines at the top of the file are also
     * rendered. Defaults to true so authored spacing is preserved verbatim.
     */
    renderLeadingBlanks?: boolean;
    /**
     * When true, trailing blank lines at the bottom of the file are
     * rendered. Defaults to true.
     */
    renderTrailingBlanks?: boolean;
}

export const DEFAULT_BLANK_SPACER_OPTIONS: Required<BlankSpacerOptions> = {
    linesPerSpacer: 1,
    minSpacerLines: 1,
    renderLeadingBlanks: true,
    renderTrailingBlanks: true,
};

/**
 * Stable className + hProperties factory for spacer paragraphs. Kept in one
 * place so CSS and JS agree on what a spacer looks like, and so a future
 * "render spacers as divs" toggle only needs to flip `hName`.
 */
export const SPACER_DATA = {
    hName: "p",
    hProperties: (spacerLines: number) =>
        ({
            className: ["paragraph", "blank-spacer"],
            "data-spacer-lines": String(spacerLines),
            "data-empty-spacer": "true",
        }) as Record<string, unknown>,
} as const;

export interface SpacerParagraph extends Paragraph {
    data?: {
        hName?: string;
        hProperties?: Record<string, unknown>;
    };
}
