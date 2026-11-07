// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// RepoLine DOM 契约测试（jsdom）。
//
// 覆盖两件事：
//  1. formatRepoChanges 的展示文本（纯函数）；
//  2. 缓存命中时 RepoLine 同步渲染分支与变更 —— 命中路径不发 RPC，
//     所以这里可以放心直接渲染 hook 组件（未命中要等 150ms，见 use-repo-info.test.ts）。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoLine, formatRepoChanges } from "./repo-line";
import { clearRepoInfoCache, writeRepoInfoCache } from "./use-repo-info";

// React 19 的 act() 需要显式声明测试环境，否则 jsdom 下会告警。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactNode): void {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(node);
    });
}

beforeEach(() => {
    clearRepoInfoCache();
});

afterEach(() => {
    act(() => {
        root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    clearRepoInfoCache();
});

describe("formatRepoChanges", () => {
    it("formats added / removed / file count", () => {
        expect(formatRepoChanges({ branch: "main", added: 42, removed: 7, files: 5 })).toBe("+42 \u22127 \u00b7 5f");
    });

    it("keeps zero counters visible", () => {
        expect(formatRepoChanges({ branch: "main", added: 0, removed: 0, files: 0 })).toBe("+0 \u22120 \u00b7 0f");
    });
});

describe("RepoLine", () => {
    it("renders branch and change counters on a cache hit", () => {
        writeRepoInfoCache("/repo", "", { branch: "feat/x", added: 3, removed: 1, files: 2 });
        render(<RepoLine path="/repo" />);
        expect(container?.textContent).toContain("Branch");
        expect(container?.textContent).toContain("feat/x");
        expect(container?.textContent).toContain("+3");
        expect(container?.textContent).toContain("2f");
    });

    it("renders nothing when the path is known to be outside a repo", () => {
        writeRepoInfoCache("/tmp/notes.md", "", null);
        render(<RepoLine path="/tmp/notes.md" />);
        expect(container?.textContent).toBe("");
    });

    it("renders nothing before the hover threshold elapses", () => {
        // 无缓存 + 立即断言：150ms 定时器未到，不得出现分区（也不得发请求）。
        render(<RepoLine path="/repo" />);
        expect(container?.textContent).toBe("");
    });
});
