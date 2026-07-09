// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import { atom, useAtom } from "jotai";
import { useState } from "react";

// mirror front/app/view/preview/preview-markdown.tsx:40 — `.md` files enable
// `collapsibleOrderedLists`. toggled by checkbox below.
const collapsibleAtom = atom(true);

// the exact two-line repro from the user's note (front/app/... note 39-40).
const ReproMd = `1. shell \`fork\` 出两个进程，一个跑 \`ls\`，一个跑 \`grep\`
2. 第二条 \`shell\` ...
`;

// control: same content but as a plain paragraph (no list) – should never wrap.
const PlainControl = `shell \`fork\` 出两个进程，一个跑 \`ls\`，一个跑 \`grep\`
`;

// control: list WITHOUT backticks – isolates whether backticks cause the wrap.
const NoBacktick = `1. shell fork 出两个进程，一个跑 ls，一个跑 grep
2. 第二条 shell ...
`;

// control: list with a softbreak inside item 1 (multline li).
const MultiLineLi = `1. shell \`fork\` 出两个进程，
   一个跑 \`ls\`，一个跑 \`grep\`
2. 第二条 \`shell\` ...
`;

const Cases: { key: string; label: string; md: string }[] = [
    { key: "repro", label: "repro (list + 3 backticks)", md: ReproMd },
    { key: "plain", label: "plain paragraph (control)", md: PlainControl },
    { key: "nobacktick", label: "list no backticks (control)", md: NoBacktick },
    { key: "multiline", label: "list + softbreak inside item", md: MultiLineLi },
];

function CaseCard({ label, md, collapsible }: { label: string; md: string; collapsible: boolean }) {
    return (
        <div
            data-md-case
            style={{
                border: "1px solid #444",
                borderRadius: 8,
                padding: 12,
                margin: 8,
                minWidth: 360,
                maxWidth: 520,
            }}
        >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{label}</div>
            <div style={{ border: "1px dashed #777", borderRadius: 6, marginBottom: 8 }}>
                <Markdown text={md} collapsibleOrderedLists={collapsible} scrollable={false} />
            </div>
            <details>
                <summary style={{ cursor: "pointer", color: "#9aa" }}>source</summary>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{md}</pre>
            </details>
        </div>
    );
}

export default function MarkdownPreview() {
    const [collapsible, setCollapsible] = useAtom(collapsibleAtom);
    const [, force] = useState(0);
    return (
        <div style={{ padding: 16, color: "#ddd", background: "#1e1e1e", minHeight: "100vh" }}>
            <div style={{ marginBottom: 12 }}>
                <label style={{ cursor: "pointer" }}>
                    <input
                        type="checkbox"
                        checked={collapsible}
                        onChange={(e) => {
                            setCollapsible(e.target.checked);
                            force((n) => n + 1);
                        }}
                    />{" "}
                    collapsibleOrderedLists (matches `.md` preview)
                </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
                {Cases.map((c) => (
                    <CaseCard key={c.key} label={c.label} md={c.md} collapsible={collapsible} />
                ))}
            </div>
        </div>
    );
}
