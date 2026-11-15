// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Swim-lane layout for the VCS History commit graph.
 *
 * Pure functions only (no DOM, no React) — mirrors the validated prototype
 * `design/prototypes/vcs/vcs-history-graph/graph.js`, with the invariants
 * covered by `graph-layout.test.ts`:
 *
 *  1. every commit gets exactly one row
 *  2. a row's bottom lanes never wait for the same commit twice
 *  3. the last row has no dangling lanes
 *  4. every parent edge has a drawable parent lane
 *  5. converging branches keep the main line colour
 *  6. lane colours are driven by branch identity, not allocation order
 */

export type LaneColor = string;

export interface GraphCommit {
    hash: string;
    parents?: string[];
    refs?: string[];
}

export interface GraphLane {
    /** hash of the commit this lane is still waiting for */
    id: string;
    color: LaneColor;
}

export interface GraphParentLane {
    id: string;
    lane: number;
    color: LaneColor;
}

export interface GraphRow<C extends GraphCommit> {
    commit: C;
    topLanes: (GraphLane | null)[];
    bottomLanes: GraphLane[];
    nodeLane: number;
    nodeColor: LaneColor;
    parents: string[];
    parentLanes: GraphParentLane[];
    isHead: boolean;
}

export interface GraphLayout<C extends GraphCommit> {
    rows: GraphRow<C>[];
    maxLanes: number;
    width: number;
}

export interface GraphLayoutOptions<C extends GraphCommit> {
    /**
     * Pins a lane colour to branch identity so colours stay stable across
     * pages and filtered views. Return null to fall back to inheritance.
     */
    colorForCommit?: (commit: C) => LaneColor | null;
}

/** Lane palette; index 0 is the main branch blue. */
export const LANE_COLORS: LaneColor[] = [
    "#3b82f6",
    "#f97316",
    "#e74c4c",
    "#22c55e",
    "#a855f7",
    "#eab308",
    "#14b8a6",
    "#ec4899",
];

export const GRAPH_GEO = {
    /** commit row height in px — must stay in sync with the row CSS */
    rowHeight: 46,
    /** horizontal distance between lanes in px */
    laneWidth: 18,
    /** left padding inside the graph gutter in px */
    padLeft: 11,
    nodeRadius: 4.5,
    /** ring radius drawn around the HEAD node */
    headRadius: 8,
};

export function laneX(laneIndex: number): number {
    return GRAPH_GEO.padLeft + laneIndex * GRAPH_GEO.laneWidth;
}

export function graphWidth(maxLanes: number): number {
    return laneX(Math.max(0, maxLanes - 1)) + GRAPH_GEO.padLeft + 4;
}

function indexOfLane(lanes: (GraphLane | null)[], id: string): number {
    return lanes.findIndex((lane) => lane != null && lane.id === id);
}

function laneColorOf(lanes: (GraphLane | null)[], id: string): LaneColor | null {
    const index = indexOfLane(lanes, id);
    return index >= 0 ? lanes[index].color : null;
}

export function computeLayout<C extends GraphCommit>(
    commits: C[],
    options: GraphLayoutOptions<C> = {}
): GraphLayout<C> {
    const colorForCommit = options.colorForCommit ?? (() => null);
    const known = new Set(commits.map((commit) => commit.hash));
    const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
    let paletteCursor = 0;
    const nextPaletteColor = () => LANE_COLORS[paletteCursor++ % LANE_COLORS.length];
    const newLaneColor = (commit: GraphCommit | undefined, inheritedColor: LaneColor | null): LaneColor =>
        (commit ? colorForCommit(commit as C) : null) ?? inheritedColor ?? nextPaletteColor();

    let lanes: (GraphLane | null)[] = [];
    const rows: GraphRow<C>[] = [];

    for (const commit of commits) {
        const topLanes = lanes.slice();
        let lane = indexOfLane(topLanes, commit.hash);
        if (lane === -1) {
            lane = topLanes.indexOf(null);
            if (lane === -1) {
                lane = topLanes.length;
                topLanes.push(null);
            }
            topLanes[lane] = { id: commit.hash, color: newLaneColor(commit, null) };
        }
        const nodeColor = topLanes[lane].color;
        const parents = (commit.parents ?? []).filter((parent) => known.has(parent));

        // Every lane waiting for THIS commit is consumed (converging lanes vanish).
        const bottom: GraphLane[] = [];
        for (let index = 0; index < topLanes.length; index++) {
            if (index === lane) continue;
            const entry = topLanes[index];
            if (entry != null && entry.id === commit.hash) continue;
            if (entry != null) bottom.push(entry);
        }

        // First parent inherits the node lane; if another lane is already waiting
        // for it, that lane converges into the node lane instead (keeps main colour).
        let insertAt = Math.min(lane, bottom.length);
        const firstParent = parents[0];
        if (firstParent != null) {
            const existingIndex = indexOfLane(bottom, firstParent);
            const entry: GraphLane =
                existingIndex !== -1
                    ? { id: firstParent, color: nodeColor }
                    : { id: firstParent, color: newLaneColor(byHash.get(firstParent), nodeColor) };
            if (existingIndex !== -1) {
                bottom.splice(existingIndex, 1);
                insertAt = Math.min(lane, bottom.length);
            }
            bottom.splice(insertAt, 0, entry);
            insertAt += 1;
        }

        // Extra parents (merge) open new lanes to the right.
        for (const parentId of parents.slice(1)) {
            if (indexOfLane(bottom, parentId) !== -1) continue;
            bottom.splice(insertAt, 0, {
                id: parentId,
                color: newLaneColor(byHash.get(parentId), null),
            });
            insertAt += 1;
        }

        rows.push({
            commit,
            topLanes,
            bottomLanes: bottom,
            nodeLane: lane,
            nodeColor,
            parents,
            parentLanes: parents
                .map((id) => ({ id, lane: indexOfLane(bottom, id), color: laneColorOf(bottom, id) }))
                .filter((entry): entry is GraphParentLane => entry.lane >= 0 && entry.color != null),
            isHead: (commit.refs ?? []).some((ref) => ref.trim() === "HEAD" || ref.trim().startsWith("HEAD ->")),
        });

        lanes = bottom;
    }

    const maxLanes = Math.max(
        1,
        ...rows.map((row) => Math.max(row.topLanes.length, row.bottomLanes.length))
    );
    return { rows, maxLanes, width: graphWidth(maxLanes) };
}

function segmentPath(x1: number, y1: number, x2: number, y2: number): string {
    if (Math.abs(x1 - x2) < 0.5) return `M${x1},${y1}L${x2},${y2}`;
    const midY = (y1 + y2) / 2;
    return `M${x1},${y1}C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

export interface GraphRowShapes {
    /** path + colour pairs for lane lines and parent edges */
    edges: { d: string; color: LaneColor }[];
    node: { x: number; y: number; color: LaneColor; isHead: boolean };
}

/** Geometry for one commit row; rendered by the SVG component. */
export function rowShapes(row: GraphRow<GraphCommit>, height: number = GRAPH_GEO.rowHeight): GraphRowShapes {
    const half = height / 2;
    const nodeX = laneX(row.nodeLane);
    const edges: { d: string; color: LaneColor }[] = [];

    for (let index = 0; index < row.topLanes.length; index++) {
        const lane = row.topLanes[index];
        if (lane == null) continue;
        const x1 = laneX(index);
        if (lane.id === row.commit.hash) {
            edges.push({ d: segmentPath(x1, 0, nodeX, half), color: row.nodeColor });
            continue;
        }
        const bottomIndex = indexOfLane(row.bottomLanes, lane.id);
        if (bottomIndex === -1) continue;
        edges.push({ d: segmentPath(x1, 0, laneX(bottomIndex), height), color: lane.color });
    }

    for (const parent of row.parentLanes) {
        const isFirst = parent.id === row.parents[0];
        edges.push({
            d: segmentPath(nodeX, half, laneX(parent.lane), height),
            color: isFirst ? row.nodeColor : parent.color,
        });
    }

    return {
        edges,
        node: { x: nodeX, y: half, color: row.nodeColor, isHead: row.isHead },
    };
}

/** Straight continuation lines drawn in the gutter of an expanded file panel. */
export function gutterLines(bottomLanes: GraphLane[]): { x: number; color: LaneColor }[] {
    return bottomLanes.map((lane, index) => ({ x: laneX(index), color: lane.color }));
}
