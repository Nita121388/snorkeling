// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// modalOpen 的唯一写入仲裁（任务 11-23-commontext-modal-focus）。
//
// 背景：`atoms.modalOpen` 曾经只有两个写入者——ModalsRenderer（modalsModel 栈长度）与
// tab-target-modal（自己挂载/卸载写 true/false）。直接渲染 `<Modal>` 的弹窗（CommonText
// compose、AgentCardModal、AISessions note 详情等约 40 处）一个都不写，导致这些弹窗
// 打开期间 `modalOpen === false`：
//   - `keymodel.shouldDispatchToBlock` 在焦点掉到 body 时把按键派发给背后聚焦块
//     （终端块会把字符写进 shell）；
//   - `block.tsx focusFromPointerEnter` 的 modalOpen 守卫对它们失效。
// 多写入者直接写同一个 atom 会互相覆盖（栈一关就写 false，把直接渲染的弹窗抹掉），
// 所以收口到本模块：按命名来源计数，只有「全部来源都关闭」才对外报 false。
//
// 设计要点：本模块不 import 任何 store —— `modal.tsx` 被 40+ 模块引用，直接 import
// `@/app/store/global` 会把整张 store 图拉进每个弹窗消费者（含 jsdom 测试）。对外写
// atom 的 sink 由 `app.tsx` 绑定：`bindModalOpenSink((open) => globalStore.set(atoms.modalOpen, open))`。
// 绑定即回放当前状态，覆盖「首个弹窗在绑定前打开」的时序。

import { useEffect, useId } from "react";

export type ModalOpenSink = (open: boolean) => void;

/** 打开中的来源 key 集合。key 唯一即一个来源；重复 claim 幂等。 */
const sources = new Set<string>();
let sink: ModalOpenSink | null = null;

function apply(): void {
    const open = sources.size > 0;
    if (sink == null) return;
    try {
        sink(open);
    } catch (e) {
        // sink 抛错绝不能反噬弹窗渲染：记日志后保持现状。
        console.log("modalOpen sink failed", e);
    }
}

/** 设置一个命名来源的开闭。open=false 删除该来源；状态不变时不通知（幂等）。 */
export function setModalOpenSource(key: string, open: boolean): void {
    const present = sources.has(key);
    if (open === present) {
        return;
    }
    if (open) {
        sources.add(key);
    } else {
        sources.delete(key);
    }
    apply();
}

/**
 * 绑定对外 sink（写 atom）。传 null 解绑。绑定成功时立即回放当前状态，
 * 保证「先开弹窗、后绑 sink」也能把 atom 拉平到正确值。
 */
export function bindModalOpenSink(next: ModalOpenSink | null): void {
    const prev = sink;
    sink = next;
    if (prev === next) {
        return;
    }
    if (sink != null) {
        apply();
    }
}

/** 是否存在任一打开中的弹窗来源。 */
export function modalOpenAny(): boolean {
    return sources.size > 0;
}

/** 当前打开中的来源 key 列表（测试/诊断用）。 */
export function modalOpenSourceKeys(): string[] {
    return [...sources];
}

export function resetModalOpenRegistryForTest(): void {
    sources.clear();
    sink = null;
}

/**
 * React hook：挂载期间登记一个弹窗来源，卸载时释放。
 * keyHint 只用于可读性（诊断时能认出来源）；唯一性由 useId 保证（forwardRef 组件内同样可用）。
 */
export function useModalOpenSource(open: boolean, keyHint?: string): void {
    const reactId = useId();
    useEffect(() => {
        if (!open) {
            return;
        }
        const key = `modal:${keyHint ?? ""}${reactId}`;
        setModalOpenSource(key, true);
        return () => setModalOpenSource(key, false);
    }, [open, keyHint, reactId]);
}
