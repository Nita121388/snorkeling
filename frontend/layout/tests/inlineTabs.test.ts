// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    findInlineTabMergeTarget,
    getLayoutDataActiveBlockId,
    getLayoutDataBlockIds,
    mergeSourceNodeIntoTargetNode,
    removeBlockIdFromInlineTabNode,
    setInlineTabNodeBlockIds,
} from "../lib/inlineTabs";
import { newLayoutNode } from "../lib/layoutNode";
import { FlexDirection, LayoutNodeAdditionalProps } from "../lib/types";
import { newLayoutTreeState } from "./model";

function props(rect: Dimensions): LayoutNodeAdditionalProps {
    return { treeKey: "0", rect };
}

test("inline tab target prefers previous block in the same row", () => {
    const left = newLayoutNode(undefined, undefined, undefined, { blockId: "left" });
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const above = newLayoutNode(undefined, undefined, undefined, { blockId: "above" });
    const treeState = newLayoutTreeState(newLayoutNode(FlexDirection.Row, undefined, [above, left, source]));
    const leafOrder: LeafOrderEntry[] = [
        { nodeid: above.id, blockid: "above" },
        { nodeid: left.id, blockid: "left" },
        { nodeid: source.id, blockid: "source" },
    ];
    const target = findInlineTabMergeTarget(
        "source",
        leafOrder,
        {
            [above.id]: props({ top: 0, left: 0, width: 100, height: 100 }),
            [left.id]: props({ top: 120, left: 0, width: 100, height: 100 }),
            [source.id]: props({ top: 120, left: 120, width: 100, height: 100 }),
        },
        treeState
    );

    assert(target?.targetNode.id === left.id, "source should merge into previous same-row block");
});

test("inline tab target falls back to nearest block in the same column", () => {
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const above = newLayoutNode(undefined, undefined, undefined, { blockId: "above" });
    const below = newLayoutNode(undefined, undefined, undefined, { blockId: "below" });
    const treeState = newLayoutTreeState(newLayoutNode(FlexDirection.Column, undefined, [above, source, below]));
    const leafOrder: LeafOrderEntry[] = [
        { nodeid: above.id, blockid: "above" },
        { nodeid: source.id, blockid: "source" },
        { nodeid: below.id, blockid: "below" },
    ];
    const target = findInlineTabMergeTarget(
        "source",
        leafOrder,
        {
            [above.id]: props({ top: 0, left: 0, width: 100, height: 100 }),
            [source.id]: props({ top: 120, left: 0, width: 100, height: 100 }),
            [below.id]: props({ top: 260, left: 0, width: 100, height: 100 }),
        },
        treeState
    );

    assert(target?.targetNode.id === above.id, "source should merge into nearest same-column block");
});

test("inline tab target falls back to previous block when layout rects are not ready", () => {
    const first = newLayoutNode(undefined, undefined, undefined, { blockId: "first" });
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const treeState = newLayoutTreeState(newLayoutNode(FlexDirection.Row, undefined, [first, source]));
    const leafOrder: LeafOrderEntry[] = [
        { nodeid: first.id, blockid: "first" },
        { nodeid: source.id, blockid: "source" },
    ];
    const target = findInlineTabMergeTarget("source", leafOrder, {}, treeState);

    assert(target?.targetNode.id === first.id, "source should merge into previous block without layout rects");
});

test("merge source block into target tab data", () => {
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const target = newLayoutNode(undefined, undefined, undefined, { blockId: "target" });

    mergeSourceNodeIntoTargetNode(source, target, "source");

    assert.deepEqual(getLayoutDataBlockIds(target.data), ["target", "source"]);
    assert(getLayoutDataActiveBlockId(target.data) === "source", "merged source should become active");
});

test("merge source block appends to existing inline tab group", () => {
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const target = newLayoutNode(undefined, undefined, undefined, {
        blockIds: ["target", "existing"],
        activeBlockId: "existing",
    });

    mergeSourceNodeIntoTargetNode(source, target, "source");

    assert.deepEqual(getLayoutDataBlockIds(target.data), ["target", "existing", "source"]);
    assert(getLayoutDataActiveBlockId(target.data) === "source", "dragged source should become active");
});

test("remove block from inline tab node degrades to single block", () => {
    const node = newLayoutNode(undefined, undefined, undefined, {
        blockIds: ["target", "source"],
        activeBlockId: "source",
        blockTabTitles: { source: "Custom" },
    });

    removeBlockIdFromInlineTabNode(node, "source");

    assert.deepEqual(node.data, { blockId: "target" });
});

test("remove active inline tab block selects the next neighbor", () => {
    const node = newLayoutNode(undefined, undefined, undefined, {
        blockIds: ["one", "two", "three"],
        activeBlockId: "two",
    });

    removeBlockIdFromInlineTabNode(node, "two");

    assert.deepEqual(getLayoutDataBlockIds(node.data), ["one", "three"]);
    assert(getLayoutDataActiveBlockId(node.data) === "three", "active block should move to the next tab");
});

test("filter inline tab block ids switches active block and removes stale titles", () => {
    const node = newLayoutNode(undefined, undefined, undefined, {
        blockIds: ["one", "two", "three"],
        activeBlockId: "two",
        blockTabTitles: {
            one: "One",
            two: "Two",
            three: "Three",
        },
    });

    setInlineTabNodeBlockIds(node, ["one", "three"]);

    assert.deepEqual(getLayoutDataBlockIds(node.data), ["one", "three"]);
    assert(getLayoutDataActiveBlockId(node.data) === "one", "active block should switch to the first remaining tab");
    assert.deepEqual(node.data.blockTabTitles, { one: "One", three: "Three" });
});

test("filter inline tab block ids degrades to single block", () => {
    const node = newLayoutNode(undefined, undefined, undefined, {
        blockIds: ["one", "two"],
        activeBlockId: "two",
        blockTabTitles: { two: "Two" },
    });

    setInlineTabNodeBlockIds(node, ["one"]);

    assert.deepEqual(node.data, { blockId: "one" });
});
