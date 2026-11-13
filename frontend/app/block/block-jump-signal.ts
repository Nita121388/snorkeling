// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 跨 renderer 的「定位到块」信号（2026-11-10 任务 11-09-overview-card-jump 修复）。
//
// 背景：每个 tab 是独立的渲染进程（Electron WebContentsView），staticTabId 在每个
// renderer 的生命周期内固定不变。因此 setBlockHighlight / refocusNode（内部经
// getLayoutModelForStaticTab）只作用于「发起跳转的那个 renderer」。从 Overview 跳到
// 其他 tab 的块时，必须让目标 tab 自己的 renderer 执行高亮 + refocus 才有意义——
// 否则只完成了切 tab，块上什么都不会发生。
//
// localStorage 的 storage 事件是本仓库成熟的跨 renderer 通道（persona-store /
// tab-recency-store / persisted-enum / agent-status-done-ack-store 等十余处在用）：
// 写入方不收自己触发的 storage 事件，其余同 session 的 renderer 都能收到。
// 信号里带 tabId，各 renderer 自行判断「这个块是不是我的」。

import { BlockModel } from "@/app/block/block-model";
import { atoms, globalStore, refocusNode } from "@/app/store/global";

export const BlockJumpStorageKey = "snorkeling:block-jump";

type BlockJumpSignal = {
    tabId: string;
    blockId: string;
    seq: number;
};

/**
 * 信号新鲜度窗口。目标 tab 的 view 若在跳转后才创建（storage 事件没赶上新 renderer），
 * 新 renderer 启动时会补读一次最近信号；超出窗口的旧信号一律忽略。
 */
const FreshWindowMs = 8000;

/**
 * 高亮 TTL。比同 tab 跳转（1.2s）长：要覆盖「storage 事件送达（可能目标 renderer 还在
 * 后台、定时器被节流）+ 主进程切 view」的整段时间，用户切过来看时高亮还在。
 */
const HighlightTtlMs = 2600;

// refocus 重试节拍：0ms 立即执行，250/1000ms 补拍（目标 renderer 在后台时 0ms 拍
// 可能被 Chromium 节流推迟，块也可能尚未挂载完成）。
const RefocusDelaysMs = [0, 250, 1000];

let installed = false;
let storageHandler: ((event: StorageEvent) => void) | null = null;

/**
 * 广播跨 tab「定位到块」信号。目标 tab 已加载的 renderer 通过 storage 事件收到后，
 * 在自己的上下文里执行高亮 + refocus。
 */
export function broadcastBlockJumpSignal(tabId: string, blockId: string): void {
    if (typeof window === "undefined" || tabId === "" || blockId === "") return;
    try {
        const signal: BlockJumpSignal = { tabId, blockId, seq: Date.now() };
        window.localStorage.setItem(BlockJumpStorageKey, JSON.stringify(signal));
    } catch {
        // localStorage 不可用（隐私模式等）：退化为切 tab + focusednodeid 落库，无高亮。
    }
}

function parseSignal(raw: string | null | undefined): BlockJumpSignal | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<BlockJumpSignal>;
        if (
            typeof parsed?.tabId !== "string" ||
            typeof parsed?.blockId !== "string" ||
            typeof parsed?.seq !== "number"
        ) {
            return null;
        }
        return parsed as BlockJumpSignal;
    } catch {
        return null;
    }
}

/** 在当前 renderer 里执行「定位到块」的视觉部分：高亮 + 数拍 refocus + TTL 撤高亮。 */
function applyBlockJump(blockId: string): void {
    BlockModel.getInstance().setBlockHighlight({ blockId, icon: "location-crosshairs" });
    for (const delay of RefocusDelaysMs) {
        window.setTimeout(() => refocusNode(blockId), delay);
    }
    window.setTimeout(() => BlockModel.getInstance().setBlockHighlight(null), HighlightTtlMs);
}

function handleSignal(signal: BlockJumpSignal): void {
    if (typeof window === "undefined") return;
    // atoms 尚未初始化（renderer 加载早期）：忽略信号，绝不抛异常。
    // 回归背景（2026-11-13）：曾因模块顶层 install 早于 initGlobal 就绪、加上 localStorage
    // 残留信号，在此处抛 TypeError，导致整个 renderer 模块图报废、窗口永不 show、黑屏死锁。
    if (atoms == null) return;
    if (signal.tabId !== globalStore.get(atoms.staticTabId)) return;
    if (Date.now() - signal.seq > FreshWindowMs) return;
    applyBlockJump(signal.blockId);
}

/**
 * 安装跨 renderer 定位信号监听。由 blockframe 在首个 BlockFrame 挂载时调用——每个会渲染块的
 * renderer 恰好装一次（模块级 installed 防重入）。安装时补读一次最近信号，覆盖
 * 「目标 view 在跳转后才创建」的场景。
 *
 * 注意：必须在 initGlobal/initGlobalAtoms 之后安装。模块求值期（import 链）调用时 atoms
 * 还未赋值，曾经的模块顶层调用因此导致整个 renderer 启动失败。
 */
export function installBlockJumpSignalListener(): void {
    if (installed || typeof window === "undefined") return;
    installed = true;
    storageHandler = (event: StorageEvent) => {
        const signal = parseSignal(event.key === BlockJumpStorageKey ? event.newValue : null);
        if (signal != null) handleSignal(signal);
    };
    window.addEventListener("storage", storageHandler);
    const initial = parseSignal(window.localStorage.getItem(BlockJumpStorageKey));
    if (initial != null) handleSignal(initial);
}

/** 仅供测试：卸载监听并重置安装标记（生产代码不得调用）。 */
export function resetBlockJumpSignalListenerForTest(): void {
    if (storageHandler != null && typeof window !== "undefined") {
        window.removeEventListener("storage", storageHandler);
        storageHandler = null;
    }
    installed = false;
}
