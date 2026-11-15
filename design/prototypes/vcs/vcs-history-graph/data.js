/* Mock data for the VCS History graph prototype.
 * Shape mirrors wshrpc.VcsCommitInfo + the fields the redesign needs
 * (parents / refs / author email), so the prototype can be mapped 1:1 onto
 * the planned Go `git log --pretty=format:%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%P%x1f%D` output.
 */

const REF = {
    head: "head",
    branch: "branch",
    tag: "tag",
    remote: "remote",
};

// Newest first (git log order). `parents` reference other commit ids (like %P).
// Two branches (streaming-responses / hybrid-search) overlap so three lanes are
// visible at once, matching the reference screenshots.
const MOCK_COMMITS = [
    {
        id: "c21",
        hash: "e41b7c2d9a8f4b61c0d5e3a72f9b8c14d6e05a37",
        parents: ["c20"],
        subject: "Released v2.4",
        author: "Maya Chen",
        email: "maya.chen@example.com",
        time: "2m",
        refs: [
            { type: REF.head, name: "main" },
            { type: REF.tag, name: "v2.4" },
            { type: REF.remote, name: "origin/main" },
        ],
    },
    {
        id: "c20",
        hash: "9b3d5f70c1a24e8d6f0b93c57a1e48d26b0f3c85",
        parents: ["c19", "b3"],
        subject: "Merge branch 'streaming-responses' into main",
        author: "Jonas Weber",
        email: "jonas.weber@example.com",
        time: "18m",
        refs: [],
    },
    {
        id: "b3",
        hash: "4c7e1a93d0b85f26e4a91c7385d0b6f2a7c48e19",
        parents: ["b2"],
        subject: "Rendered assistant replies token by token",
        author: "Priya Raman",
        email: "priya.raman@example.com",
        time: "40m",
        refs: [{ type: REF.branch, name: "streaming-responses" }],
    },
    {
        id: "c19",
        hash: "1a9c6e35b7d02f48a6c19e0b8d3f57c24a90e6b1",
        parents: ["c18", "s3"],
        subject: "Merge branch 'hybrid-search' into main",
        author: "Jonas Weber",
        email: "jonas.weber@example.com",
        time: "1h",
        refs: [],
    },
    {
        id: "s3",
        hash: "6e0b4d97c5a83f12e6907c4b1d8a35f09e7c2b64",
        parents: ["s2"],
        subject: "Cached embeddings for repeated document chunks",
        author: "Sofia Novak",
        email: "sofia.novak@example.com",
        time: "1h",
        refs: [{ type: REF.branch, name: "hybrid-search" }],
    },
    {
        id: "b2",
        hash: "7d2f8b06a4c39e51d7b08f2c6a94e13d5b7c90af",
        parents: ["b1"],
        subject: "Buffered partial tool calls while streaming",
        author: "Priya Raman",
        email: "priya.raman@example.com",
        time: "2h",
        refs: [],
    },
    {
        id: "s2",
        hash: "2f8d1c60a9b74e35d0c8a61f4b72e09d3c5a8f41",
        parents: ["s1"],
        subject: "Reranked retrieved passages before answering",
        author: "Sofia Novak",
        email: "sofia.novak@example.com",
        time: "2h",
        refs: [],
    },
    {
        id: "c18",
        hash: "8b5e2a71d6c04f93a8b15d0e7c3f92a64d1e0b8c",
        parents: ["c17"],
        subject: "Fixed citation links in generated answers",
        author: "Leo Martins",
        email: "leo.martins@example.com",
        time: "3h",
        refs: [],
    },
    {
        id: "b1",
        hash: "5f0a3d87c2b61e94f0a38d7c2b6e19a54c7f0d38",
        parents: ["c15"],
        subject: "Handled stream aborts and retried partial frames",
        author: "Priya Raman",
        email: "priya.raman@example.com",
        time: "5h",
        refs: [],
    },
    {
        id: "s1",
        hash: "0b7e2c95a4d38f61b7e2c45a9d3f80e16b2d7c04",
        parents: ["c15"],
        subject: "Tuned chunk overlap for retrieval quality",
        author: "Sofia Novak",
        email: "sofia.novak@example.com",
        time: "6h",
        refs: [],
    },
    {
        id: "c17",
        hash: "3d9a7f24c1b68e05d3a97c2f6b48e1a0d5c93f7b",
        parents: ["c16"],
        subject: "Logged token usage per conversation",
        author: "Daniel Okafor",
        email: "daniel.okafor@example.com",
        time: "8h",
        refs: [],
    },
    {
        id: "c16",
        hash: "5c1f8e30b9a47d62e5c08b1f7a3d94e26c8b0d51",
        parents: ["c15"],
        subject: "Shortened default system prompt",
        author: "Amara Diallo",
        email: "amara.diallo@example.com",
        time: "1d",
        refs: [],
    },
    {
        id: "c15",
        hash: "7c4b1e08d5a93f27c4b10e8d5a39f72c6b1e4d90",
        parents: ["c14"],
        subject: "Combined keyword and vector search",
        author: "Maya Chen",
        email: "maya.chen@example.com",
        time: "1d",
        refs: [],
    },
    {
        id: "c14",
        hash: "7f4b0e19c8d35a62f7b04e1c9d3a58e26b0f7c48",
        parents: ["c13"],
        subject: "Indexed documents with BM25 alongside embeddings",
        author: "Jonas Weber",
        email: "jonas.weber@example.com",
        time: "1d",
        refs: [],
    },
    {
        id: "c13",
        hash: "9c2e7a04b6d19f38c2e07a4b1d6f93e58a0c2b71",
        parents: ["c12"],
        subject: "Added eval suite for answer accuracy",
        author: "Leo Martins",
        email: "leo.martins@example.com",
        time: "2d",
        refs: [],
    },
    {
        id: "c12",
        hash: "4a8f1d63c0b92e75a8f13d6c0b9e42a57d3c8b06",
        parents: ["c11"],
        subject: "Retried rate-limited model calls with backoff",
        author: "Daniel Okafor",
        email: "daniel.okafor@example.com",
        time: "2d",
        refs: [],
    },
    {
        id: "c11",
        hash: "6b0c9e42a7d15f83b0c94e2a7d5f18c36e9b0a74",
        parents: ["c10"],
        subject: "Redacted personal data before indexing",
        author: "Amara Diallo",
        email: "amara.diallo@example.com",
        time: "3d",
        refs: [],
    },
    {
        id: "c10",
        hash: "1e5d8b30c7a92f64e5d08b3c7a2f95e16b4d8c07",
        parents: ["c9"],
        subject: "Moved prompts into versioned templates",
        author: "Maya Chen",
        email: "maya.chen@example.com",
        time: "3d",
        refs: [],
    },
    {
        id: "c9",
        hash: "8d3a6f01b5c92e47d3a06f1b5c9e28a47b0d3f61",
        parents: ["c8"],
        subject: "Added feedback buttons to assistant replies",
        author: "Jonas Weber",
        email: "jonas.weber@example.com",
        time: "4d",
        refs: [],
    },
    {
        id: "c8",
        hash: "2c6f9b4d0a81e57c6f09b4d0a8e51c73f9b2d6e0",
        parents: ["c7"],
        subject: "Streamed model output over server-sent events",
        author: "Leo Martins",
        email: "leo.martins@example.com",
        time: "5d",
        refs: [],
    },
    {
        id: "c7",
        hash: "0b7e2c95a4d38f61b7e2c45a9d3f80e26b2d7c04",
        parents: ["c6"],
        subject: "Connected vector store to document uploads",
        author: "Amara Diallo",
        email: "amara.diallo@example.com",
        time: "6d",
        refs: [],
    },
    {
        id: "c6",
        hash: "0b7e2c95a4d38f61b7e2c45a9d3f80e36b2d7c04",
        parents: ["c5"],
        subject: "Routed model calls through a gateway with fallbacks",
        author: "Daniel Okafor",
        email: "daniel.okafor@example.com",
        time: "6d",
        refs: [],
    },
    {
        id: "c5",
        hash: "0b7e2c95a4d38f61b7e2c45a9d3f80e46b2d7c04",
        parents: [],
        subject: "Set up chat interface and conversation storage",
        author: "Maya Chen",
        email: "maya.chen@example.com",
        time: "1w",
        refs: [],
    },
];

// Deterministic per-commit changed-file lists (enough to show the expanded panel).
const FILE_POOL = [
    { path: "frontend/app/view/vcs/vcs-history-tab.tsx", code: "M" },
    { path: "frontend/app/view/vcs/vcs-graph.tsx", code: "A" },
    { path: "frontend/app/view/vcs/graph-layout.test.ts", code: "A" },
    { path: "pkg/wshrpc/wshremote/vcs.go", code: "M" },
    { path: "pkg/wshrpc/wshrpctypes.go", code: "M" },
    { path: "frontend/app/view/vcs/vcs-tabs.tsx", code: "M" },
    { path: "docs/project/vcs-history-graph.md", code: "A" },
    { path: "frontend/app/view/vcs/vcs-commit-row.tsx", code: "M" },
    { path: "frontend/app/theme.scss", code: "M" },
    { path: "pkg/wshrpc/wshremote/vcs_test.go", code: "M" },
    { path: "frontend/app/view/vcs/vcs-filter.ts", code: "D" },
];

function makeFiles(seed) {
    const count = 2 + (seed % 4);
    const stat = { M: [12, 4], A: [86, 0], D: [0, 31] };
    const files = [];
    for (let i = 0; i < count; i++) {
        const item = FILE_POOL[(seed * 3 + i * 5) % FILE_POOL.length];
        if (files.some((f) => f.path === item.path)) continue;
        const [added, deleted] = stat[item.code];
        files.push({
            path: item.path,
            code: item.code,
            added: item.code === "M" ? added + ((seed + i * 7) % 30) : added,
            deleted: item.code === "M" ? deleted + ((seed + i * 3) % 12) : deleted,
        });
    }
    return files;
}

MOCK_COMMITS.forEach((commit, index) => {
    if (!commit.files) commit.files = makeFiles(index + 1);
});

const MOCK_BRANCH_ORDER = ["main", "streaming-responses", "hybrid-search"];
