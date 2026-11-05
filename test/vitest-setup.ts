// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// vitest 全局 setup（在 jsdom 环境里补 Node 不提供的东西）。
//
// 背景：Node >= 22.11 的 jsdom 环境**不再默认提供 localStorage**（过去 jsdom 自带）。
// 结果是一批 DOM 测试在 module import 阶段就崩：
//   `TypeError: Cannot read properties of undefined (reading 'getItem')`
//   ← `frontend/app/session-overview/session-overview-model.ts` 构造时读 displayLimit。
// 以前的做法是让每个人手动 `NODE_OPTIONS=--localstorage-file=...`（写在测试注释里），
// 属于"靠人记住"的隐性前置条件 —— 谁忘了谁看到一片红。
//
// 这里用内存实现兜住：所有 Node 版本、所有机器行为一致，测试不再依赖外部环境变量。
// 注意：只在"本来就没有 localStorage"时安装，真实实现存在时不覆盖。

class MemoryStorage implements Storage {
    private readonly map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }

    getItem(key: string): string | null {
        return this.map.has(key) ? (this.map.get(key) as string) : null;
    }

    key(index: number): string | null {
        return Array.from(this.map.keys())[index] ?? null;
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }

    setItem(key: string, value: string): void {
        this.map.set(String(key), String(value));
    }
}

function installMemoryStorage(): void {
    const globalAny = globalThis as unknown as { localStorage?: Storage; window?: { localStorage?: Storage } };
    if (globalAny.localStorage != null) return;
    const storage = new MemoryStorage();
    try {
        globalAny.localStorage = storage;
    } catch {
        // 只读属性：退回到 defineProperty
        Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    }
    if (globalAny.window != null && globalAny.window.localStorage == null) {
        try {
            globalAny.window.localStorage = storage;
        } catch {
            Object.defineProperty(globalAny.window, "localStorage", { value: storage, configurable: true });
        }
    }
}

installMemoryStorage();

// 非 http(s) 的 fetch 在测试环境里必然 DNS 失败（app 的 web 端点桩是 "wave" →
// `getaddrinfo ENOTFOUND wave`），而它往往是从 `fireAndForget` 里发出的 →
// vitest 记为 Unhandled Rejection，**整轮 exit=1**（测试全绿也红）。
// 这里在测试层把非 http(s) 请求就地拦成 500：不掩盖真实 http 行为，也不再有网络抖动。
function installFetchGuard(): void {
    const original = globalThis.fetch;
    if (typeof original !== "function") return;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : typeof (input as Request)?.url === "string"
                    ? (input as Request).url
                    : String(input);
        // 返回 200 + `{data:null}` 而不是 500：app 的 RPC 封装把非 2xx 当异常抛，
        // 而这类请求在 DOM 测试里往往是 fire-and-forget（没人接住）→ Unhandled Rejection → 整轮 exit=1。
        // 返回"空数据成功"等价于"这台机器没有后端"，不影响被断言的真实逻辑。
        const blocked = (reason: string) =>
            new Response(JSON.stringify({ data: null, updates: null, note: `test-env: no backend (${reason})` }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        if (!/^https?:/i.test(url)) {
            return blocked("non-http scheme");
        }
        // 应用在真实运行时用 `http://${WAVE_SERVER_WEB_ENDPOINT}` 连本地 wave server；
        // 测试环境里该变量是桩值 "wave" → 解析成 `http://wave/...` → DNS 必失败。
        // 无点号的主机名（wave / wsh / ...）在测试里一律就地拦掉。
        try {
            const host = new URL(url).hostname;
            const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host);
            if (!isLoopback && !host.includes(".")) {
                return blocked("placeholder host");
            }
        } catch {
            // URL 解析失败就交给真实 fetch，让它按原样报错
        }
        return original(input as RequestInfo, init);
    };
}

installFetchGuard();
