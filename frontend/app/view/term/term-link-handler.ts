// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 终端链接统一激活逻辑（OSC 8 `linkHandler` 与 `WebLinksAddon` 共用）。
 *
 * `Terminal.options.linkHandler` 开启 `allowNonHttpProtocols` 后，xterm 才不会把
 * 非 http(s) 的 OSC 8 链接整个丢弃；代价是 activate 必须自建白名单：
 *
 * - `file:…` → `openNativePath`（`.html` 走系统默认浏览器；解析失败退 `openExternal`）
 * - `vscode://file/…` → 剥前缀后按本地文件打开
 * - `http(s)://…` → `openLinkBlock`（保持既有 `openTerminalLink` 行为）
 * - 其余 scheme（`javascript:` / `data:` …）一律拒绝
 *
 * 平台修饰键判定只在本模块出现一次（`deps.isMac` 注入，避免与 termwrap 各写一份）。
 * 事件参数用结构化最小接口（Pick），便于单测注入；真实接入处由 DOM MouseEvent 鸭子类型兼容。
 */

import { parseAgentPathRef } from "@/app/element/agent-path-ref";

export type TerminalLinkActivateEvent = {
    ctrlKey?: boolean;
    metaKey?: boolean;
    preventDefault?: () => void;
};

export type TerminalLinkHoverEvent = {
    clientX: number;
    clientY: number;
};

export type TerminalLinkHandlerDeps = {
    /** 注入的平台判定（termwrap 传 `PLATFORM === PlatformMacOS`），修饰键分支只此一份。 */
    isMac: boolean;
    openNativePath: (path: string) => void;
    openExternal: (uri: string) => void;
    /** `openTerminalLink`（http 分流用）。 */
    openLinkBlock: (uri: string) => void;
    onHoverChange?: (uri: string | null, x: number, y: number) => void;
};

export type TerminalLinkHandler = {
    allowNonHttpProtocols: true;
    activate: (event: TerminalLinkActivateEvent, uri: string) => void;
    hover: (event: TerminalLinkHoverEvent, uri: string) => void;
    leave: () => void;
};

export function createTerminalLinkHandler(deps: TerminalLinkHandlerDeps): TerminalLinkHandler {
    const activate = (event: TerminalLinkActivateEvent, uri: string): void => {
        event?.preventDefault?.();
        const modifierPressed = deps.isMac ? event?.metaKey === true : event?.ctrlKey === true;
        if (!modifierPressed) {
            return;
        }
        const ref = parseAgentPathRef(uri);
        if (ref == null) {
            return;
        }
        if (ref.kind === "http") {
            deps.openLinkBlock(ref.url ?? uri);
            return;
        }
        if (ref.kind !== "file") {
            return;
        }
        if (ref.filePath == null) {
            // file:// 解析不出原生路径：退化为交给系统浏览器。
            deps.openExternal(uri);
            return;
        }
        deps.openNativePath(ref.filePath);
    };

    return {
        allowNonHttpProtocols: true,
        activate,
        hover: (event: TerminalLinkHoverEvent, uri: string): void => {
            deps.onHoverChange?.(uri, event.clientX, event.clientY);
        },
        leave: (): void => {
            deps.onHoverChange?.(null, 0, 0);
        },
    };
}
