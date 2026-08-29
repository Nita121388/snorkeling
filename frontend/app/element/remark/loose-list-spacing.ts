// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Marks loose lists (mdast `list.spread === true`, i.e. blank lines between items)
 * with `data-loose="true"` so SCSS can restore the visual spacing the blank lines
 * carried. Blank lines INSIDE a list are otherwise invisible in the preview because
 * the blank-line-spacers plugin only operates between top-level blocks — the loose
 * marker is the CommonMark reading-mode convention (Obsidian renders the same).
 */
const remarkLooseListSpacing: Plugin<[], Root> = () => {
    return (tree) => {
        visit(tree, "list", (node) => {
            if (node.spread) {
                node.data ??= {};
                (node.data as any).hProperties ??= {};
                (node.data as any).hProperties["dataLoose"] = "true";
            }
        });
    };
};

export default remarkLooseListSpacing;
