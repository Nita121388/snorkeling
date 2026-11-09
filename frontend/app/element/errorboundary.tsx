// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { ReactNode } from "react";

export class ErrorBoundary extends React.Component<
    { children: ReactNode; fallback?: React.ReactElement & { error?: Error } },
    { error: Error }
> {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ error: error });
    }

    render() {
        const { fallback } = this.props;
        const { error } = this.state;
        if (error) {
            if (fallback != null) {
                return React.cloneElement(fallback as any, { error });
            }
            const errorMsg = `Error: ${error?.message}\n\n${error?.stack}`;
            return <pre className="error-boundary">{errorMsg}</pre>;
        } else {
            return <>{this.props.children}</>;
        }
    }
}

export class NullErrorBoundary extends React.Component<
    { children: React.ReactNode; debugName?: string },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode; debugName?: string }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`${this.props.debugName ?? "NullErrorBoundary"} error boundary caught error`, error, info);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

/**
 * App 根节点兜底 —— 整窗白屏的最后一道闸。
 *
 * 为什么必须有：根节点没有 boundary 时，任何 render 期异常都会让 React 卸载**整棵树**，
 * 窗口只剩主题底色（light 主题下就是一片米白），用户唯一出路是重启。
 * 2026-11-09 的 React #310（N-1109）就是这么变成白屏的。
 *
 * 兜住之后：错误可见（消息 + 组件栈）、有 Reload 出口，终端/会话数据不受影响。
 * 注意 `onError` 只是上报通道（主进程 fe-log），不要再往外抛。
 */
export class RootErrorBoundary extends React.Component<
    { children: React.ReactNode; onError?: (error: Error, info: React.ErrorInfo) => void },
    { error: Error; info: React.ErrorInfo }
> {
    constructor(props: { children: React.ReactNode; onError?: (error: Error, info: React.ErrorInfo) => void }) {
        super(props);
        this.state = { error: null, info: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error("RootErrorBoundary caught an error:", error, info);
        try {
            this.props.onError?.(error, info);
        } catch (e) {
            console.error("RootErrorBoundary onError handler failed", e);
        }
        this.setState({ info });
    }

    render() {
        const { error, info } = this.state;
        if (error == null) {
            return this.props.children;
        }
        const detail = [error.message, error.stack, info?.componentStack].filter(Boolean).join("\n\n");
        return (
            <div
                role="alert"
                data-testid="root-error-boundary"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    width: "100%",
                    height: "100%",
                    padding: 24,
                    overflow: "auto",
                    background: "var(--main-bg-color)",
                    color: "var(--main-text-color)",
                    fontFamily: "var(--term-font-family, monospace)",
                }}
            >
                <div style={{ fontSize: 16, fontWeight: 600 }}>界面渲染出错 / UI crashed</div>
                <div style={{ fontSize: 13, opacity: 0.75 }}>
                    窗口本身没坏，是某个面板在渲染时抛错。点 Reload 重新加载即可恢复（终端与 AI 会话数据不受影响）。
                </div>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{
                        alignSelf: "flex-start",
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color, rgba(128,128,128,0.4))",
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                    }}
                >
                    Reload
                </button>
                <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", opacity: 0.85 }}>{detail}</pre>
            </div>
        );
    }
}
