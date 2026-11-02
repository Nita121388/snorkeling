// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 悬浮卡的纯逻辑层。
//
// 这里只放「输入数据 → 展示文案 / 归类」的判定，不 import React、不读 store，
// 因此可以脱离 jsdom 直接单测（tab-info-card-model.test.ts）。
//
// 拆出来的原因：卡片结构改版时（Notion 风格 pill / 分组标题 / 属性 chips），
// 判定逻辑要先能测，否则只能靠真机截图回归。

import { isChatBlockMeta, isSessionDetailBlockMeta } from "@/app/block/block-info-card-meta";
import { isAgentTerminalMeta } from "@/app/view/term/agent-meta";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";
import type { AgentDisplayState, AgentPhase } from "@/app/agent-status/agent-status-types";

// ── block 类型分类 ──

export type TabBlockKind = "agent" | "chat" | "file" | "note" | "terminal" | "other";

export type TabBlockCounts = Record<TabBlockKind, number>;

/**
 * 把一个 block 归到卡片上的某一类。
 *
 * 顺序不能动：会话类 block 同时带 `aisessions:*` 与 `view: "term"`，
 * 必须先判定 chat，否则会落进 terminal / other。
 */
export function classifyTabBlock(block: Block | null): TabBlockKind {
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    if (isSessionDetailBlockMeta(meta) || isChatBlockMeta(meta)) {
        return "chat";
    }
    if (isAgentTerminalMeta(block?.meta ?? null)) {
        return "agent";
    }
    if (meta[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote) {
        return "note";
    }
    if (meta.view === "preview") {
        return "file";
    }
    if (meta.view === "term") {
        return "terminal";
    }
    return "other";
}

/** 一次遍历算出各类 block 数量。 */
export function countTabBlocks(blocks: readonly (Block | null)[]): TabBlockCounts {
    const counts: TabBlockCounts = { agent: 0, chat: 0, file: 0, note: 0, terminal: 0, other: 0 };
    for (const block of blocks) {
        counts[classifyTabBlock(block)]++;
    }
    return counts;
}

const NonAgentChipOrder: readonly TabBlockKind[] = ["chat", "file", "note", "terminal", "other"];
const NonAgentChipNoun: Record<TabBlockKind, string> = {
    agent: "agent",
    chat: "chat",
    file: "file",
    note: "note",
    terminal: "term",
    other: "other",
};

/** 非 agent 类型的内容构成 chips（`2 chat` / `12 file` …）；数量为 0 的类型不产出。 */
export function nonAgentChips(counts: TabBlockCounts): { kind: TabBlockKind; label: string }[] {
    const chips: { kind: TabBlockKind; label: string }[] = [];
    for (const kind of NonAgentChipOrder) {
        const n = counts[kind];
        if (n <= 0) {
            continue;
        }
        const noun = NonAgentChipNoun[kind];
        chips.push({ kind, label: `${n} ${noun}${n > 1 ? "s" : ""}` });
    }
    return chips;
}

// ── Agent 状态呈现 ──

export type AgentStateKind =
    | "working"
    | "thinking"
    | "idle"
    | "done"
    | "blocked"
    | "error"
    | "rate-limited"
    | "stale";

/** 卡片只需这三个字段，不 import store 的完整 AgentStatus 类型。 */
export interface AgentStateInput {
    state?: AgentDisplayState | string | null;
    phase?: AgentPhase | string | null;
    toolName?: string | null;
}

export interface AgentStatePresentation {
    kind: AgentStateKind;
    /** UI 文案：`Tool · bash` / `Idle` / `Done` … */
    label: string;
}

/**
 * 状态 → 行样式类别 + 文案。
 *
 * 无状态（null）与 `unknown` 一律按 Idle 处理：旧实现显示 `—`，看起来像坏值。
 */
export function presentAgentState(status: AgentStateInput | null | undefined): AgentStatePresentation {
    if (status == null) {
        return { kind: "idle", label: "Idle" };
    }
    const state = (status.state ?? "").trim();
    if (state === "working") {
        if (status.phase === "thinking") {
            return { kind: "thinking", label: "Thinking" };
        }
        if (status.phase === "tool") {
            const toolName = (status.toolName ?? "").trim();
            return { kind: "working", label: toolName !== "" ? `Tool · ${toolName}` : "Tools" };
        }
        return { kind: "working", label: "Working" };
    }
    switch (state) {
        case "done":
            return { kind: "done", label: "Done" };
        case "blocked":
            return { kind: "blocked", label: "Blocked" };
        case "error":
            return { kind: "error", label: "Error" };
        case "rate-limited":
            return { kind: "rate-limited", label: "Rate limited" };
        case "stale":
            return { kind: "stale", label: "Stale" };
        default:
            return { kind: "idle", label: "Idle" };
    }
}

// ── 分组标题 ──

/**
 * provider 全部相同 → `Agents · pi ×4`（行内不再重复 provider 文本）；
 * 混合 provider → `Agents`（每行仍需各自显示 provider）。
 */
export function agentGroupLabel(providers: readonly string[]): string {
    if (providers.length === 0) {
        return "Agents";
    }
    const normalized = providers.map((p) => p.trim().toLowerCase());
    const first = normalized[0];
    if (first !== "" && normalized.every((p) => p === first)) {
        return `Agents · ${providers[0].trim()} ×${providers.length}`;
    }
    return "Agents";
}

/** 分组标题里已经写了 provider 时，行内不再重复显示。 */
export function agentGroupHidesProvider(providers: readonly string[]): boolean {
    return agentGroupLabel(providers) !== "Agents";
}
