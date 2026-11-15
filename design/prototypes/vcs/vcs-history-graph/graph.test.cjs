/* Self-check for graph.js — run with `node graph.test.js` (no framework needed).
 * These assertions are the ones the real graph-layout.ts should carry over:
 * lane uniqueness, full reachability, convergence, colour stability.
 */

const fs = require("fs");
const path = require("path");

function loadModule(file, exportedNames) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    const shim = { exports: {} };
    return new Function("module", "exports", `${source}\nreturn {${exportedNames.join(",")}};`)(shim, shim.exports);
}

const { MOCK_COMMITS, MOCK_BRANCH_ORDER } = loadModule("data.js", ["MOCK_COMMITS", "MOCK_BRANCH_ORDER"]);
const { computeLayout, rowSvg, gutterSvg, GRAPH_GEO } = loadModule("graph.js", [
    "computeLayout",
    "rowSvg",
    "gutterSvg",
    "GRAPH_GEO",
]);

const BRANCH_PALETTE = ["#3b82f6", "#f97316", "#e74c4c", "#22c55e", "#a855f7", "#eab308"];
const colorForCommit = (commit) => {
    const ref = (commit.refs || []).find((entry) => entry.type === "head" || entry.type === "branch");
    return ref ? BRANCH_PALETTE[MOCK_BRANCH_ORDER.indexOf(ref.name) % BRANCH_PALETTE.length] : null;
};

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures += 1;
        console.log(`  FAIL ${name}\n       ${error.message}`);
    }
}
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const layout = computeLayout(MOCK_COMMITS, { colorForCommit });

console.log("graph-layout self check");

check("every commit is laid out exactly once", () => {
    const ids = layout.rows.map((row) => row.commit.id);
    assert(ids.length === MOCK_COMMITS.length, `row count ${ids.length} != ${MOCK_COMMITS.length}`);
    assert(new Set(ids).size === ids.length, "duplicate commit rows");
});

check("no lane waits for the same commit twice", () => {
    for (const row of layout.rows) {
        const ids = row.bottomLanes.map((lane) => lane.id);
        assert(new Set(ids).size === ids.length, `duplicate lane id after ${row.commit.id}: ${ids.join(",")}`);
    }
});

check("no lane is left dangling at the end", () => {
    const last = layout.rows[layout.rows.length - 1];
    assert(last.bottomLanes.length === 0, `dangling lanes: ${last.bottomLanes.map((l) => l.id).join(",")}`);
});

check("every parent edge is drawable (parent lane exists below)", () => {
    for (const row of layout.rows) {
        for (const parent of row.parents) {
            assert(
                row.parentLanes.some((entry) => entry.id === parent),
                `${row.commit.id} -> ${parent} has no parent lane`
            );
        }
    }
});

check("converging branches keep the main line colour", () => {
    const mainRow = layout.rows.find((row) => row.commit.id === "c15");
    assert(mainRow, "missing c15 row");
    assert(mainRow.nodeLane === 0, `c15 moved to lane ${mainRow.nodeLane}`);
    assert(mainRow.nodeColor === "#3b82f6", `c15 colour ${mainRow.nodeColor} != main blue`);
});

check("three lanes are visible at the same time", () => {
    assert(layout.maxLanes === 3, `maxLanes ${layout.maxLanes} != 3`);
});

check("lane colours come from branch identity, not cursor order", () => {
    const branchRows = {
        "streaming-responses": layout.rows.find((row) =>
            (row.commit.refs || []).some((ref) => ref.name === "streaming-responses")
        ),
        "hybrid-search": layout.rows.find((row) => (row.commit.refs || []).some((ref) => ref.name === "hybrid-search")),
        main: layout.rows.find((row) => (row.commit.refs || []).some((ref) => ref.type === "head")),
    };
    assert(branchRows["streaming-responses"].nodeColor === "#f97316", "streaming-responses colour drift");
    assert(branchRows["hybrid-search"].nodeColor === "#e74c4c", "hybrid-search colour drift");
    assert(branchRows.main.nodeColor === "#f97316" === false, "main should not reuse the streaming colour");
});

check("paged layout (page 2) still renders every commit", () => {
    const page2 = MOCK_COMMITS.slice(20);
    const pageLayout = computeLayout(page2, { colorForCommit });
    assert(pageLayout.rows.length === page2.length, "page 2 row mismatch");
    assert(pageLayout.maxLanes >= 1, "page 2 has no lanes");
});

check("svg output is well formed", () => {
    for (const row of layout.rows) {
        const svg = rowSvg(row, GRAPH_GEO.rowHeight);
        assert(svg.includes("<circle"), `${row.commit.id} has no node`);
        assert(!/NaN|undefined/.test(svg), `${row.commit.id} svg contains NaN/undefined`);
    }
    const gutter = gutterSvg(layout.rows[3].bottomLanes, 120);
    assert(!/NaN|undefined/.test(gutter), "gutter svg contains NaN/undefined");
});

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
