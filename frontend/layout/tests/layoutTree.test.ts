// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { findNode, newLayoutNode } from "../lib/layoutNode";
import { computeMoveNode, deleteNode, moveNode } from "../lib/layoutTree";
import {
    DropDirection,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeMergeInlineTabAction,
    LayoutTreeMoveNodeAction,
    LayoutTreeRemoveNodeFromLayoutAction,
} from "../lib/types";
import { newLayoutTreeState } from "./model";

test("layoutTreeStateReducer - compute move", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeA" });
    const node1 = newLayoutNode(undefined, undefined, undefined, { blockId: "node1" });
    const node2 = newLayoutNode(undefined, undefined, undefined, { blockId: "node2" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [nodeA, node1, node2]));
    assert(treeState.rootNode.children!.length === 3, "root should have three children");
    let pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: node1.id,
        direction: DropDirection.Bottom,
    });
    const insertOperation = pendingAction as LayoutTreeMoveNodeAction;
    assert(insertOperation.node === node1, "insert operation node should equal node1");
    assert(!insertOperation.parentId, "insert operation parent should not be defined");
    assert(insertOperation.index === 1, "insert operation index should equal 1");
    assert(insertOperation.insertAtRoot, "insert operation insertAtRoot should be true");
    moveNode(treeState, insertOperation);
    assert(
        treeState.rootNode.data === undefined && treeState.rootNode.children!.length === 3,
        "root node should still have three children"
    );
    assert(treeState.rootNode.children![1].data!.blockId === "node1", "root's second child should be node1");

    pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: node1.id,
        nodeToMoveId: node2.id,
        direction: DropDirection.Bottom,
    });
    const insertOperation2 = pendingAction as LayoutTreeMoveNodeAction;
    assert(insertOperation2.node === node2, "insert operation node should equal node2");
    assert(insertOperation2.parentId === node1.id, "insert operation parent id should be node1 id");
    assert(insertOperation2.index === 1, "insert operation index should equal 1");
    assert(!insertOperation2.insertAtRoot, "insert operation insertAtRoot should be false");
    moveNode(treeState, insertOperation2);
    assert(
        treeState.rootNode.data === undefined && (treeState.rootNode.children!.length as number) === 2,
        "root node should now have two children after node2 moved into node1"
    );
    assert(treeState.rootNode.children![1].children!.length === 2, "root's second child should now have two children");
});

test("compute move previews a node that is not in the tree yet", () => {
    const target = newLayoutNode(undefined, undefined, undefined, { blockId: "target" });
    const sibling = newLayoutNode(undefined, undefined, undefined, { blockId: "sibling" });
    const previewNode = newLayoutNode(undefined, undefined, undefined, { blockId: "preview" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [target, sibling]));

    const pendingAction = computeMoveNode(
        treeState,
        {
            type: LayoutTreeActionType.ComputeMove,
            nodeId: target.id,
            nodeToMoveId: previewNode.id,
            direction: DropDirection.Right,
        },
        previewNode
    ) as LayoutTreeMoveNodeAction;

    assert(pendingAction?.node === previewNode, "preview action should retain the detached node");
    moveNode(treeState, pendingAction);
    assert(findNode(treeState.rootNode, previewNode.id) === previewNode, "move should insert the detached node");
});

test("computeMove - noop action", () => {
    const nodeToMove = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeToMove" });
    const treeState = newLayoutTreeState(
        newLayoutNode(undefined, undefined, [
            nodeToMove,
            newLayoutNode(undefined, undefined, undefined, { blockId: "otherNode" }),
        ])
    );
    let moveAction: LayoutTreeComputeMoveNodeAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Left,
    };
    let pendingAction = computeMoveNode(treeState, moveAction);

    assert(pendingAction === undefined, "inserting a node to the left of itself should not produce a pendingAction");

    moveAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Right,
    };

    pendingAction = computeMoveNode(treeState, moveAction);
    assert(pendingAction === undefined, "inserting a node to the right of itself should not produce a pendingAction");
});

test("computeMove - center drop merges into inline tab instead of swapping", () => {
    const target = newLayoutNode(undefined, undefined, undefined, { blockId: "target" });
    const source = newLayoutNode(undefined, undefined, undefined, { blockId: "source" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [target, source]));

    const pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: target.id,
        nodeToMoveId: source.id,
        direction: DropDirection.Center,
    }) as LayoutTreeMergeInlineTabAction;

    assert(pendingAction.type === LayoutTreeActionType.MergeInlineTab, "center drop should create merge action");
    assert(pendingAction.targetNodeId === target.id, "target node should receive the dragged block");
    assert(pendingAction.sourceNodeId === source.id, "source node should be merged into target");
});

test("deleteNode clears focused and magnified state for removed node", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeA" });
    const nodeB = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeB" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [nodeA, nodeB]));
    treeState.focusedNodeId = nodeA.id;
    treeState.magnifiedNodeId = nodeA.id;

    deleteNode(treeState, {
        type: LayoutTreeActionType.RemoveNodeFromLayout,
        nodeId: nodeA.id,
    } as LayoutTreeRemoveNodeFromLayoutAction);

    assert(treeState.rootNode.children!.length === 1, "root should have one remaining child");
    assert(treeState.rootNode.children![0].data!.blockId === "nodeB", "nodeB should remain in the layout");
    assert(treeState.focusedNodeId === undefined, "removed node should no longer be focused");
    assert(treeState.magnifiedNodeId === undefined, "removed node should no longer be magnified");
});

test("deleteNode clears root focused and magnified state", () => {
    const nodeA = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeA" });
    const treeState = newLayoutTreeState(nodeA);
    treeState.focusedNodeId = nodeA.id;
    treeState.magnifiedNodeId = nodeA.id;

    deleteNode(treeState, {
        type: LayoutTreeActionType.RemoveNodeFromLayout,
        nodeId: nodeA.id,
    } as LayoutTreeRemoveNodeFromLayoutAction);

    assert(treeState.rootNode === undefined, "root should be cleared");
    assert(treeState.focusedNodeId === undefined, "removed root should no longer be focused");
    assert(treeState.magnifiedNodeId === undefined, "removed root should no longer be magnified");
});
