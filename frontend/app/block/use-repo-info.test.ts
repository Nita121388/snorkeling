// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useRepoInfo 纯函数 + 缓存 + single-flight 测试。
//
// 这里不渲染 hook（项目没有 @testing-library/react），所以只覆盖可测的纯逻辑：
// 归一化、缓存命中/过期、负缓存、并发去重、抛错降级。hook 的 150ms 延迟行为
// 由 prd 的性能红线人工复核（快速划过 Tab 栏 0 请求）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearRepoInfoCache,
    fetchRepoInfo,
    normalizeRepoInfo,
    readRepoInfoCache,
    repoInfoCacheKey,
    REPO_INFO_TTL_MS,
    writeRepoInfoCache,
    type RepoInfoFetcher,
} from "./use-repo-info";

function statRtn(overrides: Partial<RemoteVcsStatRtnData> = {}): RemoteVcsStatRtnData {
    return { branch: "main", added: 42, removed: 7, files: 5, ...overrides };
}

beforeEach(() => {
    clearRepoInfoCache();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("repoInfoCacheKey", () => {
    it("separates the same path on different connections", () => {
        expect(repoInfoCacheKey("/repo", "")).not.toBe(repoInfoCacheKey("/repo", "ssh://host"));
    });
});

describe("normalizeRepoInfo", () => {
    it("keeps branch and change counters", () => {
        expect(normalizeRepoInfo(statRtn())).toEqual({ branch: "main", added: 42, removed: 7, files: 5 });
    });

    it("returns null when the path is not a git repo (empty branch)", () => {
        expect(normalizeRepoInfo(statRtn({ branch: "" }))).toBeNull();
        expect(normalizeRepoInfo(statRtn({ branch: undefined }))).toBeNull();
    });

    it("returns null when the backend reports an error", () => {
        expect(normalizeRepoInfo({ branch: "main", added: 0, removed: 0, files: 0, error: "boom" })).toBeNull();
    });

    it("returns null for a null/undefined response", () => {
        expect(normalizeRepoInfo(null)).toBeNull();
        expect(normalizeRepoInfo(undefined)).toBeNull();
    });

    it("floors missing or negative counters to 0", () => {
        expect(
            normalizeRepoInfo({
                branch: "main",
                added: undefined as unknown as number,
                removed: -3,
                files: 2.6,
            })
        ).toEqual({ branch: "main", added: 0, removed: 0, files: 3 });
    });
});

describe("cache", () => {
    it("returns undefined when nothing was cached", () => {
        expect(readRepoInfoCache("/repo", "")).toBeUndefined();
    });

    it("remembers a positive hit", () => {
        const info = { branch: "main", added: 1, removed: 2, files: 3 };
        writeRepoInfoCache("/repo", "", info);
        expect(readRepoInfoCache("/repo", "")).toEqual(info);
    });

    it("remembers a negative hit (not a repo) as null", () => {
        writeRepoInfoCache("/repo", "", null);
        expect(readRepoInfoCache("/repo", "")).toBeNull();
    });

    it("expires after the TTL", () => {
        const now = 1_000_000;
        writeRepoInfoCache("/repo", "", { branch: "main", added: 0, removed: 0, files: 0 }, now);
        expect(readRepoInfoCache("/repo", "", now + REPO_INFO_TTL_MS)).not.toBeUndefined();
        expect(readRepoInfoCache("/repo", "", now + REPO_INFO_TTL_MS + 1)).toBeUndefined();
    });
});

describe("fetchRepoInfo", () => {
    it("caches the normalized result", async () => {
        const fetcher = vi.fn<RepoInfoFetcher>(async () => statRtn());
        await expect(fetchRepoInfo("/repo", "", fetcher)).resolves.toEqual({
            branch: "main",
            added: 42,
            removed: 7,
            files: 5,
        });
        expect(readRepoInfoCache("/repo", "")).toEqual({ branch: "main", added: 42, removed: 7, files: 5 });
    });

    it("writes a negative cache entry when the path is not a repo", async () => {
        const fetcher = vi.fn<RepoInfoFetcher>(async () => statRtn({ branch: "" }));
        await expect(fetchRepoInfo("/not-a-repo", "", fetcher)).resolves.toBeNull();
        expect(readRepoInfoCache("/not-a-repo", "")).toBeNull();
    });

    it("degrades silently when the fetcher throws", async () => {
        const fetcher = vi.fn<RepoInfoFetcher>(async () => {
            throw new Error("rpc down");
        });
        await expect(fetchRepoInfo("/repo", "", fetcher)).resolves.toBeNull();
        expect(readRepoInfoCache("/repo", "")).toBeNull();
    });

    it("dedupes concurrent requests for the same key (single-flight)", async () => {
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fetcher = vi.fn<RepoInfoFetcher>(async () => {
            await gate;
            return statRtn();
        });
        const first = fetchRepoInfo("/repo", "", fetcher);
        const second = fetchRepoInfo("/repo", "", fetcher);
        release?.();
        await Promise.all([first, second]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(await first).toBe(await second);
    });

    it("issues a separate request per connection", async () => {
        const fetcher = vi.fn<RepoInfoFetcher>(async () => statRtn());
        await fetchRepoInfo("/repo", "", fetcher);
        await fetchRepoInfo("/repo", "ssh://host", fetcher);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
