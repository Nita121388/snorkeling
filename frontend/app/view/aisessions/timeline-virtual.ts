// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 会话详情时间线的虚拟化纯逻辑。
 *
 * 为什么需要阈值：绝大多数会话只有几十条消息，全量渲染完全够快；只有
 * 几千条消息的大会话才会把 5000+ 个 DOM 节点塞进滚动容器，导致"拉到最开头
 * 就卡住"。小会话保持原有渲染路径，等价于不改变默认行为。
 *
 * 这里只放不依赖 react / DOM 的纯函数，方便直接单测：
 * - shouldVirtualize：是否启用虚拟化
 * - buildSeqToIndex：消息 seq → 虚拟行号的映射（搜索/批注跳转用）
 * - activeSeqFromVirtualItems：大纲轨 active 刻度（不再依赖 getElementById）
 */

import { anchorHash, messageAnchorKey, type AnnotationAnchorRequest } from "./annotation-model";
import type { SessionDetailRow, SessionDetailTimelineItem } from "./utils";

/** 超过这个行数才启用虚拟化；等于或小于时走原有全量渲染。 */
export const VirtualizeThreshold = 60;

/** 虚拟行的初始估算高度（px）。真实高度由 measureElement 测得后替换。 */
export const EstimatedRowHeight = 96;

/**
 * 按行类型估算虚拟行高度（纯函数，便于单测）。
 *
 * 为什么要按行类型估，而不是共用 96：真实行高分布是 user 气泡 70~110px、
 * tool 行 ~44px、assistant markdown 段落 200~800px。共用 96 会让 assistant 段
 * 误差达 4 倍，快速滚动时未测行先按 96 排、下一帧才被 measureElement 纠正，
 * 补偿没在一帧内完成的瞬间相邻行内容会叠在一起（重影）。按类型估把误差压到 1.4x 内。
 */
export function estimateTimelineRowHeight(item: SessionDetailRow): number {
    if (item.kind === "toolGroup") return ToolGroupRowHeight;
    if (item.kind === "tool") return ToolRowHeight;
    const text = item.message.text ?? "";
    const lines = Math.ceil(text.length / CharsPerLine) || 1;
    if (item.message.role === "user") {
        return Math.min(UserRowMax, UserRowBase + lines * UserRowLine);
    }
    return Math.min(AssistantRowMax, AssistantRowBase + lines * AssistantRowLine);
}

// 估算用的常量：以 12px / 每行约 90 个西文字符的排版密度粗估换行数。
const CharsPerLine = 90;
const ToolRowHeight = 44;
const UserRowBase = 56;
const UserRowLine = 20;
const UserRowMax = 260;
const AssistantRowBase = 40;
const AssistantRowLine = 19;
const AssistantRowMax = 900;
const ToolGroupRowHeight = 32;

/**
 * 把时间线里连续的工具行折叠成一个分组行，其余行原样保留。
 *
 * 为什么：历史详情之前是「一行一个工具卡」，模型跑一串 bash / read 时会把
 * 视口刷满，滚动成本也高。连续多条工具（>=2）合成一行摘要（如「执行命令 ×3」），
 * 单条工具保持原样（摘要没有增量价值）。
 *
 * 约束：分组只影响渲染行数与顺序，不改变消息行；组内 anchorSeq 取首条工具锚定的
 * message seq，保证跳转 / 大纲 / 子代理归位仍能定位。
 */
export function groupConsecutiveTools(items: SessionDetailTimelineItem[]): SessionDetailRow[] {
    const rows: SessionDetailRow[] = [];
    let buffer: Extract<SessionDetailTimelineItem, { kind: "tool" }>[] = [];
    const flush = () => {
        if (buffer.length === 0) return;
        if (buffer.length === 1) {
            rows.push(buffer[0]);
        } else {
            const running = buffer.some((item) => item.liveStatus === "running");
            const failed = buffer.some((item) => item.liveStatus === "failed");
            rows.push({
                kind: "toolGroup",
                tools: buffer.map((item) => item.toolCall),
                anchorSeq: buffer[0].anchorSeq,
                liveStatus: running ? "running" : failed ? "failed" : undefined,
            });
        }
        buffer = [];
    };
    for (const item of items) {
        if (item.kind === "tool") {
            buffer.push(item);
        } else {
            flush();
            rows.push(item);
        }
    }
    flush();
    return rows;
}

/** 虚拟行可视区上下各多渲染几行，避免快速滚动出现空白。 */
export const VirtualOverscan = 6;

export function shouldVirtualize(itemCount: number): boolean {
    return itemCount > VirtualizeThreshold;
}

/**
 * 消息 seq → 时间线行号。只映射 kind === "message" 的行（搜索、批注、
 * 大纲跳转都以消息 seq 为目标）。同 seq 只保留第一次出现的行号。
 */
export function buildSeqToIndex(items: SessionDetailRow[]): Map<number, number> {
    const map = new Map<number, number>();
    items.forEach((item, index) => {
        if (item.kind === "message" && !map.has(item.message.seq)) {
            map.set(item.message.seq, index);
        }
    });
    return map;
}

/**
 * anchorKey（消息/工具节点的稳定 ID）→ 消息 seq。
 *
 * 为什么需要：批注存的是 anchorKey，seq 只是它的一个缓存值；历史批注（AI 生成）
 * 落库时 seq 恒为 0，光靠 seq 查找会直接 miss，表现就是「点 Jump / 点圆点没反应」。
 * 这里用当前的 renderItems 反推 anchorKey 对应的真实 seq，作为 seq 失效时的兜底。
 * 工具行本身没有独立 seq：它挂在 anchorSeq 指向的消息行上。
 */
export function buildAnchorKeyToSeq(items: SessionDetailRow[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const item of items) {
        if (item.kind === "message") {
            const key = messageAnchorKey(item.message);
            if (!map.has(key)) map.set(key, item.message.seq);
            continue;
        }
        if (item.kind === "toolGroup") {
            for (const tool of item.tools) {
                const key = tool.itemKey?.trim();
                if (key && !map.has(key)) map.set(key, item.anchorSeq);
            }
            continue;
        }
        const key = item.toolCall.itemKey?.trim();
        if (key && !map.has(key)) map.set(key, item.anchorSeq);
    }
    return map;
}

/**
 * 由可见虚拟项推导当前 active 的消息 seq（大纲轨高亮）。
 *
 * 虚拟化后不可视的行没有 DOM 节点，不能再逐个 getBoundingClientRect。
 * 这里用可见项的序号与高度信息：取最后一个"起点位于探针之上"的可见项，
 * 若可见项里没有消息项（例如当前全是工具行），则回退到 promptSeqs 第一项。
 *
 * @param virtualItems 可见虚拟项（index + start），index 即时间线行号
 * @param itemSeqs 每行对应的消息 seq（非消息行为 null）
 * @param probeOffset 探针相对滚动容器顶部的偏移（通常是容器高度的 1/4）
 */
export function activeSeqFromVirtualItems(
    virtualItems: ReadonlyArray<{ index: number; start: number }>,
    itemSeqs: ReadonlyArray<number | null>,
    probeOffset: number,
    fallbackSeq: number | null
): number | null {
    let current: number | null = null;
    for (const item of virtualItems) {
        const seq = itemSeqs[item.index];
        if (seq == null) continue;
        if (item.start <= probeOffset) {
            current = seq;
        } else {
            break;
        }
    }
    return current ?? fallbackSeq;
}

/**
 * 滚动到某个 seq 的目标滚动位置。
 *
 * 已测量的行用真实 start；未测量的（尚未进入过视区）用估算高度算一个近似值，
 * 调用方应在下一帧用真实值再修正一次，避免用户看到跳动。
 */
export function scrollTargetForSeq(
    rowStart: number | null,
    rowIndex: number,
    estimatedRowHeight: number = EstimatedRowHeight
): number {
    return rowStart ?? Math.max(0, rowIndex) * estimatedRowHeight;
}

/** 是否已接近底部：用于"跳到最新"胶囊与底部增量拉取判定。 */
export function isNearBottom(totalSize: number, scrollTop: number, clientHeight: number, threshold = 120): boolean {
    if (clientHeight <= 0) return true;
    return totalSize - scrollTop - clientHeight < threshold;
}

/**
 * 渲染 key：消息行用 seq（稳定、可跳转），工具行用 anchorSeq+seq+行号
 * （同一锚点下可能挂多个工具行）。
 */
export function timelineItemKey(item: SessionDetailRow, index: number): string {
    if (item.kind === "message") {
        return `message-${item.message.seq}`;
    }
    if (item.kind === "toolGroup") {
        return `tool-group-${item.anchorSeq}-${item.tools.length}-${index}`;
    }
    return `tool-${item.anchorSeq}-${item.toolCall.seq}-${index}`;
}

/**
 * 虚拟滚动渲染时的 probe 探针位置：容器高度的 1/4 处。
 * 与全量渲染路径（session-outline-rail 的 useActiveOutlineSeq）保持一致。
 */
export function outlineProbeOffset(clientHeight: number): number {
    if (clientHeight <= 0) return 0;
    return clientHeight * 0.25;
}

/** 一帧内多次 schedule 只执行一次的回调合并器。 */
export interface RafCoalescer {
    /** 请求在下一帧执行一次（本帧已排队则忽略）。 */
    schedule(): void;
    /** 取消已排队但尚未执行的回调（卸载时用）。 */
    cancel(): void;
}

/**
 * 滚动事件合并器。
 *
 * 为什么需要：滚轮一次手势会连续抛出 3~8 个 scroll 事件，拖动可达 60~120/s。
 * 如果每个事件都同步 setState，等于每帧重渲染整个详情组件（约 2000 行）并重算
 * 派生数据；同时 scroll handler 读 scrollTop 会和 React 的 DOM 写入交错，构成
 * layout thrash。这里把「读滚动位置 + 提交状态」压到每帧最多一次。
 *
 * request/cancel 可注入，方便在没有 DOM 的环境里做单测。
 */
export function createRafCoalescer(
    callback: () => void,
    request: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle)
): RafCoalescer {
    let handle: number | null = null;
    const run = () => {
        handle = null;
        callback();
    };
    return {
        schedule() {
            if (handle != null) return;
            handle = request(run);
        },
        cancel() {
            if (handle == null) return;
            cancel(handle);
            handle = null;
        },
    };
}

/**
 * 用「渲染用时间线行」重建锚点列表。
 *
 * 为什么不能用 buildAnnotationAnchors(messages, toolCalls)：会话详情里的 Message
 * 来自 SQLite 缓存（ai_session_messages 没有 item_key 列），ItemKey 恒为空；
 * 只有 ToolCall 还带 ItemKey，而 ToolCall.Seq 只是单次加载的顺序计数。
 * renderItems 里工具行的 anchorSeq 才是真实消息行号 —— 这是唯一能把
 * 「工具锚点 → 真实 seq」对上号的地方。
 */
export function buildTimelineAnnotationAnchors(items: SessionDetailTimelineItem[]): AnnotationAnchorRequest[] {
    const anchors: AnnotationAnchorRequest[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (item.kind === "message") {
            const anchorKey = messageAnchorKey(item.message);
            if (seen.has(anchorKey)) continue;
            seen.add(anchorKey);
            anchors.push({
                anchorKey,
                seq: item.message.seq,
                role: item.message.role,
                hash: anchorHash(item.message.text ?? item.message.thinking ?? ""),
            });
            continue;
        }
        const anchorKey = item.toolCall.itemKey?.trim();
        if (!anchorKey || seen.has(anchorKey)) continue;
        seen.add(anchorKey);
        anchors.push({
            anchorKey,
            seq: item.anchorSeq,
            role: "tool",
            hash: anchorHash([item.toolCall.name, item.toolCall.summary].filter(Boolean).join("\n")),
        });
    }
    return anchors;
}
