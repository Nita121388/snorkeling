// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

import { GRAPH_GEO, gutterLines, rowShapes, type GraphCommit, type GraphLane, type GraphRow } from "./graph-layout";

/**
 * SVG swim-lane cell for one commit row: pass-through lanes, the node itself
 * and one edge per parent. Geometry comes from the pure `graph-layout` module.
 */
export function CommitGraphCell({
    row,
    width,
    height = GRAPH_GEO.rowHeight,
}: {
    row: GraphRow<GraphCommit>;
    width: number;
    height?: number;
}) {
    const shapes = rowShapes(row, height);
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="block overflow-visible"
            aria-hidden="true"
            data-vcs-graph-cell="1"
        >
            {shapes.edges.map((edge, index) => (
                <path key={`edge-${index}`} d={edge.d} stroke={edge.color} />
            ))}
            {shapes.node.isHead && (
                <circle
                    cx={shapes.node.x}
                    cy={shapes.node.y}
                    r={GRAPH_GEO.headRadius}
                    stroke={shapes.node.color}
                    strokeWidth={1.25}
                    opacity={0.5}
                    data-vcs-graph-head="1"
                />
            )}
            <circle cx={shapes.node.x} cy={shapes.node.y} r={GRAPH_GEO.nodeRadius} fill={shapes.node.color} />
        </svg>
    );
}

/**
 * Lane continuation drawn in the gutter beside an expanded file panel so the
 * lines do not visually break when a row opens.
 */
export function CommitGraphGutter({
    lanes,
    width,
    height,
}: {
    lanes: GraphLane[];
    width: number;
    height: number;
}) {
    const lines = gutterLines(lanes);
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="block"
            aria-hidden="true"
        >
            {lines.map((line, index) => (
                <path key={`lane-${index}`} d={`M${line.x},0L${line.x},${height}`} stroke={line.color} />
            ))}
        </svg>
    );
}
