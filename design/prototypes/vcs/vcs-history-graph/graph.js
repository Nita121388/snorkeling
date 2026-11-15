/* Swim-lane layout + SVG path generation for the VCS History graph.
 * Pure functions only (no DOM) so it can be unit-tested in Node and ported
 * into frontend/app/view/vcs/graph-layout.ts unchanged.
 */

const LANE_COLORS = ["#3b82f6", "#f97316", "#e74c4c", "#22c55e", "#a855f7", "#eab308", "#14b8a6", "#ec4899"];

const GRAPH_GEO = {
    rowHeight: 46, // commit row height, must match CSS --row-h
    laneWidth: 18, // horizontal distance between lanes
    padLeft: 11, // left padding inside the graph gutter
    nodeRadius: 4.5,
    headRadius: 8, // ring around the HEAD node
};

function laneX(laneIndex) {
    return GRAPH_GEO.padLeft + laneIndex * GRAPH_GEO.laneWidth;
}

function graphWidth(maxLanes) {
    return laneX(Math.max(0, maxLanes - 1)) + GRAPH_GEO.padLeft + 4;
}

function indexOfLane(lanes, id) {
    return lanes.findIndex((lane) => lane != null && lane.id === id);
}

function laneColorOf(lanes, id) {
    const idx = indexOfLane(lanes, id);
    return idx >= 0 ? lanes[idx].color : null;
}

/**
 * Assign every commit to a swim-lane, newest commit first.
 *
 * Model: a lane holds the id of the commit it is still waiting for. Reaching
 * that commit consumes the lane; its first parent takes the lane over, extra
 * parents (merge) open new lanes to the right. When a parent is already
 * awaited by another lane, the two lanes converge instead of duplicating.
 *
 * options.colorForCommit(commit) -> hex|null pins lane colours to branch
 * identity so colours stay stable across pages / filtered views.
 */
function computeLayout(commits, options = {}) {
    const colorForCommit = options.colorForCommit || (() => null);
    const known = new Set(commits.map((c) => c.id));
    let paletteCursor = 0;
    const nextPaletteColor = () => LANE_COLORS[paletteCursor++ % LANE_COLORS.length];
    const newLaneColor = (commit, inheritedColor) => colorForCommit(commit) || inheritedColor || nextPaletteColor();

    let lanes = [];
    const rows = [];

    for (const commit of commits) {
        const topLanes = lanes.slice();
        let lane = indexOfLane(topLanes, commit.id);
        if (lane === -1) {
            lane = topLanes.indexOf(null);
            if (lane === -1) {
                lane = topLanes.length;
                topLanes.push(null);
            }
            topLanes[lane] = { id: commit.id, color: newLaneColor(commit, null) };
        }
        const nodeColor = topLanes[lane].color;
        const parents = (commit.parents || []).filter((id) => known.has(id));

        // Every lane waiting for THIS commit is consumed (converging lanes vanish).
        const bottom = [];
        for (let i = 0; i < topLanes.length; i++) {
            if (i === lane) continue;
            const entry = topLanes[i];
            if (entry != null && entry.id === commit.id) continue;
            if (entry != null) bottom.push(entry);
        }

        // First parent inherits the node lane; if another lane is already
        // waiting for it, that lane converges into the node lane instead.
        let insertAt = Math.min(lane, bottom.length);
        const firstParent = parents[0];
        if (firstParent != null) {
            const existingIdx = indexOfLane(bottom, firstParent);
            const firstParentCommit = commits.find((c) => c.id === firstParent);
            const entry =
                existingIdx !== -1
                    ? { id: firstParent, color: nodeColor } // claim the lane for the node
                    : { id: firstParent, color: newLaneColor(firstParentCommit || { id: firstParent }, nodeColor) };
            if (existingIdx !== -1) {
                bottom.splice(existingIdx, 1);
                insertAt = Math.min(lane, bottom.length);
            }
            bottom.splice(insertAt, 0, entry);
            insertAt += 1;
        }

        // Extra parents (merge) open new lanes to the right.
        parents.slice(1).forEach((parentId) => {
            if (indexOfLane(bottom, parentId) !== -1) return; // already awaited -> converge
            const parentCommit = commits.find((c) => c.id === parentId);
            bottom.splice(insertAt, 0, {
                id: parentId,
                color: newLaneColor(parentCommit || { id: parentId }, null),
            });
            insertAt += 1;
        });

        rows.push({
            commit,
            topLanes,
            bottomLanes: bottom,
            nodeLane: lane,
            nodeColor,
            parents,
            parentLanes: parents
                .map((id) => ({ id, lane: indexOfLane(bottom, id), color: laneColorOf(bottom, id) }))
                .filter((entry) => entry.lane >= 0),
        });

        lanes = bottom;
    }

    const maxLanes = Math.max(1, ...rows.map((row) => Math.max(row.topLanes.length, row.bottomLanes.length)));
    return { rows, maxLanes, width: graphWidth(maxLanes) };
}

function segmentPath(x1, y1, x2, y2) {
    if (Math.abs(x1 - x2) < 0.5) return `M${x1},${y1}L${x2},${y2}`;
    const midY = (y1 + y2) / 2;
    return `M${x1},${y1}C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

/**
 * SVG markup for one commit row: pass-through lanes + the node + one edge per
 * parent lane. Colours come from the lane the edge belongs to.
 */
function rowSvg(row, height = GRAPH_GEO.rowHeight) {
    const half = height / 2;
    const parts = [];
    const nodeX = laneX(row.nodeLane);

    for (let i = 0; i < row.topLanes.length; i++) {
        const lane = row.topLanes[i];
        if (lane == null) continue;
        const x1 = laneX(i);
        if (lane.id === row.commit.id) {
            // inbound edge of the node itself (a newly opened lane starts at the node)
            parts.push(`<path d="${segmentPath(x1, 0, nodeX, half)}" stroke="${lane.color === row.nodeColor ? row.nodeColor : lane.color}" />`);
            continue;
        }
        const bottomIndex = indexOfLane(row.bottomLanes, lane.id);
        if (bottomIndex === -1) continue;
        parts.push(`<path d="${segmentPath(x1, 0, laneX(bottomIndex), height)}" stroke="${lane.color}" />`);
    }

    for (const parent of row.parentLanes) {
        const isFirst = parent.id === row.parents[0];
        parts.push(
            `<path d="${segmentPath(nodeX, half, laneX(parent.lane), height)}" stroke="${
                isFirst ? row.nodeColor : parent.color
            }" />`
        );
    }

    const isHead = (row.commit.refs || []).some((ref) => ref.type === "head");
    const nodeMarkup = isHead
        ? `<circle cx="${nodeX}" cy="${half}" r="${GRAPH_GEO.headRadius}" fill="none" stroke="${row.nodeColor}" stroke-width="1.25" opacity="0.5" />` +
          `<circle cx="${nodeX}" cy="${half}" r="${GRAPH_GEO.nodeRadius}" fill="${row.nodeColor}" />`
        : `<circle cx="${nodeX}" cy="${half}" r="${GRAPH_GEO.nodeRadius}" fill="${row.nodeColor}" />`;

    return `${parts.join("")}${nodeMarkup}`;
}

/** Straight continuation lines rendered in the gutter of an expanded file panel. */
function gutterSvg(bottomLanes, height) {
    return bottomLanes
        .map((lane, index) => `<path d="M${laneX(index)},0L${laneX(index)},${height}" stroke="${lane.color}" />`)
        .join("");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { computeLayout, rowSvg, gutterSvg, graphWidth, laneX, GRAPH_GEO, LANE_COLORS };
}
