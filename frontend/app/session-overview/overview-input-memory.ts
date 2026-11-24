// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 输入记忆（11-24 R3/R4，`11-24-overview-input-memory`）的纯逻辑 + storage 适配层。
//
// 为什么纯函数：localStorage 是全局副作用，直接在组件里读写会让"记住上次选择 / 草稿
// 持久化"这些行为没法单测。这里把读写/裁剪/清空全部做成可注入 storage 的纯逻辑，
// 组件侧只调用（防抖在调用侧做，见 overview-card-send-panel / overview-add-agent-modal）。
//
// 通道选择（决策 D2）：localStorage，先例 displayLimit / viewMode / blockViewedAt
// （session-overview-model.ts 同族）。不用 settings：逐键写会走 RPC + 落 wconfig，且要加 Go 字段。
//
// 防膨胀三闸（design §3.1）：maxEntries 50（LRU）、maxAgeMs 14 天、单条 8KB 截断。

export const OverviewSendDraftStorageKey = "sessionoverview:senddrafts";
export const OverviewAddAgentPrefsStorageKey = "sessionoverview:addagent";

export const SendDraftMaxEntries = 50;
export const SendDraftMaxAgeMs = 14 * 24 * 60 * 60 * 1000;
/** 单条草稿文本上限（字符近似 8KB；超出截断并记一次 warn，不丢用户可见部分）。 */
export const SendDraftMaxTextChars = 8000;

/** 最小 storage 接口（真机 = window.localStorage；单测注入内存实现）。 */
export type SendDraftStorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

export type SendDraftRecordEntry = { text: string; updatedAt: number };
export type SendDraftRecord = Record<string, SendDraftRecordEntry>;

export type AddAgentPrefs = { profile: string | null; message: string };

export type PruneOptions = { now?: number; maxEntries?: number; maxAgeMs?: number };

function safeParse(raw: string | null): Record<string, unknown> | null {
    if (raw == null || raw === "") return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function readDraftRecord(storage: SendDraftStorageLike): SendDraftRecord {
    const parsed = safeParse(storage.getItem(OverviewSendDraftStorageKey));
    if (parsed == null) return {};
    const record: SendDraftRecord = {};
    for (const [blockId, value] of Object.entries(parsed)) {
        if (value == null || typeof value !== "object") continue;
        const entry = value as Partial<SendDraftRecordEntry>;
        if (typeof entry.text !== "string" || typeof entry.updatedAt !== "number") continue;
        record[blockId] = { text: entry.text, updatedAt: entry.updatedAt };
    }
    return record;
}

function writeDraftRecord(storage: SendDraftStorageLike, record: SendDraftRecord): void {
    const keys = Object.keys(record);
    if (keys.length === 0) {
        storage.removeItem(OverviewSendDraftStorageKey);
        return;
    }
    storage.setItem(OverviewSendDraftStorageKey, JSON.stringify(record));
}

/** LRU + 过期清理：过期的先删，剩下的按 updatedAt 降序保留 maxEntries 条。 */
export function pruneSendDrafts(
    record: SendDraftRecord,
    opts: PruneOptions = {}
): SendDraftRecord {
    const now = opts.now ?? Date.now();
    const maxEntries = opts.maxEntries ?? SendDraftMaxEntries;
    const maxAgeMs = opts.maxAgeMs ?? SendDraftMaxAgeMs;
    const alive = Object.entries(record).filter(([, entry]) => now - entry.updatedAt < maxAgeMs);
    alive.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const kept = alive.slice(0, maxEntries);
    return Object.fromEntries(kept);
}

/** 单条超长截断（防整库膨胀的第三道闸）。 */
export function truncateSendDraftText(text: string): string {
    if (text.length <= SendDraftMaxTextChars) return text;
    console.warn("[overview-input-memory] 草稿超长截断", {
        chars: text.length,
        limit: SendDraftMaxTextChars,
    });
    return text.slice(0, SendDraftMaxTextChars);
}

/** 读一个块的草稿（做过期/LRU 清理后顺带落盘，防“只读不涨”）。now 可注入供单测。 */
export function readSendDraft(storage: SendDraftStorageLike, blockId: string, now?: number): string {
    const at = now ?? Date.now();
    const pruned = pruneSendDrafts(readDraftRecord(storage), { now: at });
    writeDraftRecord(storage, pruned);
    return pruned[blockId]?.text ?? "";
}

/** 读全部草稿并落盘清理（useCardSendState 的初值来源）。now 可注入供单测。 */
export function readAllSendDrafts(storage: SendDraftStorageLike, now?: number): Record<string, string> {
    const at = now ?? Date.now();
    const pruned = pruneSendDrafts(readDraftRecord(storage), { now: at });
    writeDraftRecord(storage, pruned);
    const out: Record<string, string> = {};
    for (const [blockId, entry] of Object.entries(pruned)) {
        out[blockId] = entry.text;
    }
    return out;
}

/** 写一个块草稿（调用侧防抖；这里只做截断 + 记录更新时间）。 */
export function writeSendDraft(storage: SendDraftStorageLike, blockId: string, text: string, now?: number): void {
    if (blockId === "") return;
    if (text == null || text === "") {
        clearSendDraft(storage, blockId);
        return;
    }
    // 内部两道 prune 与条目 updatedAt 必须用同一个时钟：混用注入 now 与真实 now 会把
    // 「现在写入的条目」判成两年前 → 全被过期裁掉（LRU 测试踩中）。
    const at = now ?? Date.now();
    const record = pruneSendDrafts(readDraftRecord(storage), { now: at });
    record[blockId] = { text: truncateSendDraftText(text), updatedAt: at };
    writeDraftRecord(storage, pruneSendDrafts(record, { now: at }));
}

/** 清一个块草稿（发送成功后调用；草稿语义见 overview-card-send）。 */
export function clearSendDraft(storage: SendDraftStorageLike, blockId: string): void {
    const record = readDraftRecord(storage);
    if (!(blockId in record)) return;
    delete record[blockId];
    writeDraftRecord(storage, record);
}

/** 读「新建 agent」弹窗记忆（D1：只记 agent 类型 + 未提交草稿；路径仍随 Tab）。 */
export function readAddAgentPrefs(storage: SendDraftStorageLike): AddAgentPrefs {
    const parsed = safeParse(storage.getItem(OverviewAddAgentPrefsStorageKey));
    if (parsed == null) return { profile: null, message: "" };
    const profile = typeof parsed.profile === "string" && parsed.profile !== "" ? parsed.profile : null;
    const message = typeof parsed.message === "string" ? parsed.message : "";
    return { profile, message };
}

/** 写「新建 agent」弹窗记忆（profile 选择低频直接写；message 高频由调用侧防抖）。 */
export function writeAddAgentPrefs(storage: SendDraftStorageLike, prefs: AddAgentPrefs): void {
    storage.setItem(
        OverviewAddAgentPrefsStorageKey,
        JSON.stringify({ profile: prefs.profile ?? "", message: truncateSendDraftText(prefs.message ?? "") })
    );
}

/** 浏览器环境兜底（非 browser 上下文返回 no-op storage，不抛错）。 */
export function getSafeLocalStorage(): SendDraftStorageLike | null {
    try {
        if (typeof window === "undefined" || window.localStorage == null) return null;
        return window.localStorage;
    } catch {
        // 某些嵌入环境 localStorage 访问会直接抛 SecurityError。
        return null;
    }
}
