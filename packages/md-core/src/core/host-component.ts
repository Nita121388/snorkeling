// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 宿主 UI 组件的「延迟 import() 兜底」装载器（md-core 物理抽包 10-12）。
 *
 * ## 为什么需要它
 * 渲染层的三处宿主 UI（`TableBlock` / `CopyButton` / `IconButton`）必须在**渲染期同步**
 * 拿到组件引用，而 md-core 不允许静态 import 宿主模块。本模块把「动态 import」包成一个
 * **同步可用的组件**：
 *   - 模块求值即触发 `import()`（不是首次渲染才触发）；
 *   - 装载完成后组件引用写进模块级缓存，`getSnapshot()` 同步返回；
 *   - 装载完成前渲染 `null`，并用 `useSyncExternalStore` 订阅，装载完成后自动重渲染。
 *
 * ## 为什么首帧不会退化
 * `start()` 在**模块求值期**就调用。宿主 bundle 里这些模块本来就在同一份 chunk 里，promise 在
 * 首个 microtask 就 resolve；而应用真正 mount React 树要晚得多（`createRoot` + 首帧调度），
 * 所以第一次 render 时缓存**已经就绪** → 渲染出的是真实宿主组件，DOM 与抽包前逐字节一致。
 * 即使某次真的没赶上，也只会多一帧 null，随后自动补上（不会崩、不会丢交互）。
 */

import { createElement, useSyncExternalStore, type ComponentType } from "react";

/**
 * 把「返回组件模块的 loader」包装成一个同步可渲染的组件。
 *
 * @param name 仅用于 `displayName` / 加载失败时的诊断日志。
 * @param loader 动态 import thunk；resolve 出的模块可以是 `{ default: C }`（命名导出被 loader 包成 default）。
 */
export function defineLazyHostComponent<P>(name: string, loader: () => Promise<unknown>): ComponentType<P> {
    let loaded: ComponentType<P> | null = null;
    let started = false;
    const listeners = new Set<() => void>();

    const publish = (component: ComponentType<P>) => {
        loaded = component;
        // 拷贝一份再遍历：订阅者在回调里可能会 unsubscribe。
        for (const listener of [...listeners]) {
            listener();
        }
    };

    const start = () => {
        if (started || loaded != null) {
            return;
        }
        started = true;
        void loader()
            .then((mod: any) => {
                const component = (mod?.default ?? mod) as ComponentType<P>;
                if (component == null) {
                    throw new Error(`lazy host component "${name}" not found in module`);
                }
                publish(component);
            })
            .catch((err) => {
                // 允许下一次订阅重试；不让一个加载失败把整个渲染树带下去。
                started = false;
                console.error(`[md-core] failed to load lazy host component "${name}"`, err);
            });
    };

    const subscribe = (onStoreChange: () => void) => {
        listeners.add(onStoreChange);
        start();
        return () => {
            listeners.delete(onStoreChange);
        };
    };

    const getSnapshot = () => loaded;
    const getServerSnapshot = () => loaded;

    function LazyHostComponent(props: P) {
        const Resolved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
        if (Resolved == null) {
            return null;
        }
        return createElement(Resolved as any, props as any);
    }
    LazyHostComponent.displayName = `LazyHostComponent(${name})`;

    // 模块求值即预热 —— 见文件头「为什么首帧不会退化」。
    start();

    return LazyHostComponent as ComponentType<P>;
}
