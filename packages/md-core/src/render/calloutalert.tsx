// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * CalloutAlert — block renderer for the `<calloutalert>` element produced by
 * `remarkCalloutAlert` (R1 块身份).
 *
 * `remarkCalloutAlert` replaces every blockquote mdast node with a node whose
 * `data.hName` is `calloutalert` and carries the original `position`, so this
 * component only has to emit the custom tag: the host passes the element key
 * ("calloutalert") through react-markdown's `components` map and the renderer
 * adds the source-coordinate attributes (`data-source-line` / -end) that make
 * the whole callout clickable as one inline-edit target.
 *
 * Must be a BLOCK-level element: unknown custom elements default to
 * `display: inline`, which collapses the callout's block children into an
 * inline run (the 10-08 vertical-text bug's root shape). markdown.scss pins
 * `.markdown-alert { display: block; }` for exactly this reason.
 *
 * `domProps` drops react-markdown's injected `node` object so it never reaches
 * the DOM; `srcLineAttrs` still reads it (before the spread) for the source
 * coordinates.
 */

import { createElement } from "react";
import { domProps, srcLineAttrs } from "./shared";

export function CalloutAlert(props: any) {
    // createElement("calloutalert", …) — the tag is not in JSX.IntrinsicElements
    // (it is a custom element, not an HTML one), so keep it out of JSX syntax.
    return createElement("calloutalert", { ...domProps(props), ...srcLineAttrs(props) });
}
