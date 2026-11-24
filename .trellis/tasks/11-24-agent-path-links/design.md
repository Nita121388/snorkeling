# 技术设计 — agent 路径链接：OSC8 激活 + 脏路径修复 + Search In Files 兜底

## 1. 模块边界

```
frontend/app/view/term/
  term-link-handler.ts      [新增] createTerminalLinkHandler(deps) —— OSC8/正则链接统一激活逻辑（纯逻辑，可注入 mock）
  term-link-handler.test.ts [新增]
  termwrap.ts               [改] new Terminal({ ...options, linkHandler })；hover/leave 接回 this.onLinkHover
  term-file-url.ts          [改·尽量不动] terminalFilePath 已有；若需补 vscode://file 剥壳，加纯函数 + 单测

frontend/app/element/
  agent-path-ref.ts         [新增] repairAgentPathText / parseAgentPathRef —— 脏路径修复 + 判型（纯函数）
  agent-path-ref.test.ts    [新增]
  agent-path-open.ts        [新增] openAgentPathRef —— 三级打开链（preview → search-in-files → none）
  agent-path-open.test.ts   [新增]
  markdown.tsx              [改] Link.onClick：预览打开失败后先走兜底，再退 openLink
  streamdown.tsx            [改] Link.onClick：同上
```

不新增对 `selection-search-in-files.ts` 的修改；只在 `agent-path-open.ts` 里 import 调用。

## 2. 数据契约

```ts
// agent-path-ref.ts
export type AgentPathKind = "file" | "http" | "other";
export type AgentPathRef = {
    kind: AgentPathKind;          // "file"=本地文件引用；"http"=http(s)；"other"=白名单外（拒绝打开）
    url?: string;                 // kind=file/http 时的规范 URL（file:///、https://...）
    filePath?: string;            // kind=file 时的本地路径（正斜杠，盘符单斜杠）
    lineNumber?: number;
    columnNumber?: number;
    refText: string;              // 修复后的文本（交 parseFileReference 兜底用）
};

export function repairAgentPathText(raw: string): string;   // 只做文本整形，不判型
export function parseAgentPathRef(raw: string): AgentPathRef | null;

// agent-path-open.ts
export type OpenAgentPathResult = "preview" | "search" | "external" | "none";
// 依赖注入只为了单测可断言（真调用点不传 deps，用默认实现）
export type AgentPathOpenDeps = {
    openFileLinkInPreview: (href: string, opts?: unknown) => Promise<boolean>;
    searchSelectionInFiles: (reference: ParsedFileReference, options?: unknown) => Promise<void>;
    openLink: (uri: string) => void;
};
export async function openAgentPathRef(
    raw: string,
    opts?: {
        connection?: string | null;
        baseDir?: string | null;
        onFeedback?: (msg: string, kind: string) => void;
        deps?: AgentPathOpenDeps;   // 测试注入
    }
): Promise<OpenAgentPathResult>;

// term-link-handler.ts
export type TerminalLinkHandlerDeps = {
    isMac: boolean;                          // 平台判定只在这里出现一次（deps 注入，避免两份）
    openNativePath: (path: string) => void;
    openExternal: (uri: string) => void;
    openLinkBlock: (uri: string) => void;    // openTerminalLink（http 分流用）
    onHoverChange?: (uri: string | null, x: number, y: number) => void;
};
export function createTerminalLinkHandler(deps: TerminalLinkHandlerDeps): {
    allowNonHttpProtocols: true;
    activate(event: { ctrlKey?: boolean; metaKey?: boolean; preventDefault?: () => void }, uri: string): void;
    hover(event: { clientX: number; clientY: number }, uri: string): void;
    leave(): void;
};
```

注意：xterm 的 `ILinkHandler.activate` 首参是 DOM `MouseEvent`；这里用结构化最小接口（`Pick`）以便测试注入，
真实接入处 TS 会做鸭子类型兼容（DOM MouseEvent 满足该结构）。Mac 上修饰键用 `metaKey`，
与 `termwrap.ts` WebLinksAddon 现有判定保持同一份逻辑（在 handler 内判 `PLATFORM`，由 deps 注入 `isMac` 更利于测试，
二选一以实现为准，但**不得出现两份平台判定**）。

## 3. 三级识别/打开链

```
原始文本（链接 href / 选区）
  │
  ▼ ① 修复层 repairAgentPathText
  │    剥包裹符 · file:?//+→file:/// · 盘符后//→/ · \→/ · vscode://file/→本地 · 去尾标点 · 安全解码
  │
  ▼ ② 判型 parseAgentPathRef
  │    file:///… → filePath（复用 term-file-url 规则）
  │    https?:// → http
  │    javascript:/其它 → other（拒绝）
  │    无 scheme → 修复文本交 parseFileReference（相对路径/行号/textHint）
  │
  ▼ ③ 打开 openAgentPathRef
       kind=file：statPath 命中 → openPathInPreview（editMode=markdown 判定沿用）
                 未命中  → parseFileReference + searchSelectionInFiles（跨 Tab Files 树 + stat 验证 + 打分）
                 仍未命中→ "none"（终端静默；AI 面板退 openLink）
       kind=http：openTerminalLink（保持现状）
       kind=other：拒绝，返回 "none"
```

终端 `linkHandler.activate` 与 `WebLinksAddon` 的 activate **共用同一个 `createTerminalLinkHandler` 产物**，
避免两份分流规则漂移（历史教训：term-file-url.ts 单独成模块就是为了避免两份 Windows 路径规则）。

## 4. 安全设计（`allowNonHttpProtocols: true` 的代价）

xterm 官方文档要求：开启该选项后 activate 必须自建白名单。

- 白名单：`file:` `http:` `https:`；`vscode://file/…` 显式剥壳成 file；其余一律 `none`。
- `javascript:`、`data:` 等绝不进入任何 open 通道。
- `file://host/…`：沿用 `terminalFilePath` 的 UNC 语义（Windows includeHost），不新增规则。
- 修复层的"安全解码"：仅 `decodeURIComponent` try/catch 后回退原串（与 `safeDecodeURIComponent` 同语义）。

## 5. 兼容性与风险

| 风险 | 处置 |
|---|---|
| OSC 8 链接文本与 WebLinksAddon 正则同时命中同一区域 | xterm 串行询问 provider，行为幂等；activate 无修饰键直接 no-op |
| `openFileLinkInPreview` 语义变化影响 markdown 面板既有链接 | 不改 `openFileLinkInPreview` 本体；只在调用方（Link.onClick）加一层失败兜底 |
| `searchSelectionInFiles` 依赖"有 Files 树打开"，空 workspace 会误报 | 沿用其内部 "No Files tree" 反馈分支（feedback 通道），终端静默由调用方决定 |
| 双斜杠修复把 UNC `//server/share` 弄坏 | 修复规则只收敛**盘符后**的 `//`（`^([A-Za-z]:)//+` → `$1/`）；UNC 前缀不动 |
| 平台判定复制两份 | 通过 deps 注入（`isMac` 或 `PLATFORM` 读取一处） |

## 6. 测试设计（先红后绿）

`agent-path-ref.test.ts`：
- 修复表：`file///E:/x.html`→`file:///E:/x.html`、`E://a/b.html`→`E:/a/b.html`、`(E://xxxx)`→`E:/xxxx`、
  `` `E:/a.ts:12` ``、`vscode://file/E:/a.ts`→`E:/a.ts`、`E:\a\b.html`→`E:/a/b.html`、
  尾标点 `E:/a.html。`、UNC `//server/share/x` 不动。
- 判型表：`file:///E:/x`→file、`https://…`→http、`javascript:alert(1)`→other、
  `D:/xxx/xxxx`（无扩展名）→file+parseFileReference 兜底、相对 `src/foo.ts:12`→file+line。
- 反例：`and/or`、`1.5/2`、空串、纯标点 → null（不识别，不上色不响应）。

`agent-path-open.test.ts`（mock 依赖）：
- 预览打开成功 → "preview"，不再走 search；
- 预览失败 + search 命中 → "search"（断言 searchSelectionInFiles 被以修复后文本调用）；
- 全失败 → "none"；http → 走 openLinkBlock；other → "none"。

`term-link-handler.test.ts`（mock deps）：
- ctrl+click `file:///E:/a.html` → openNativePath("E:/a.html")；
- 无修饰键 → 无任何调用；
- ctrl+click `https://x` → openLinkBlock；
- ctrl+click `vscode://file/E:/a.ts` → openNativePath("E:/a.ts")；
- `javascript:` → 拒绝；fileUrl 解析失败 → openExternal。
- hover/leave → onHoverChange 收到 uri / null。

## 7. 上线回滚

`rollback: git checkout frontend/app/view/term frontend/app/element frontend/app/view/preview`。
新文件删除即可，无数据迁移、无持久化格式变化。
