# Design — 图片预览翻页

## 边界与模块划分

```
frontend/app/view/preview/
  image-pager.ts           纯逻辑：图片判定 / 排序比较器 / 序列构造 / 站点解析
  image-pager.test.ts      单测（与 TanStack alphanumeric 对撞）
  image-pager-index.ts     异步索引（RPC + 缓存 + 原子），渐进填充
  image-pager.tsx          UI（‹ › 计数器 / 下一站条目 / 键盘 / 浮出提示）
  preview-streaming.tsx    StreamingImagePreview 挂载 pager（model + fileInfo + conn）
```

分层原则：`image-pager.ts` 不碰 DOM/RPC（可纯单测）；`-index.ts` 只做数据；`-pager.tsx` 只做交互与渲染。

## 数据契约

```ts
type PagerEntry = { path: string; name: string; isdir: boolean; modtime?: number };

type PagerIndex = {
    anchor: string;          // 锚点目录（绝对路径）
    sort: "name" | "modtime";
    // 本层：当前目录的图片，已排序（翻页直接用它）
    layer: string[];
    layerIndex: number;      // 当前图片在 layer 中的下标（-1 = 当前不在本层）
    // 站点：按目录树先序（目录名排序）排列的"含图片文件夹"，只含 anchor 及其后代
    stations: string[];
    stationIndex: number;
    truncated: boolean;      // 命中 5000/深度 8 上限
    building: boolean;
};
```

## 锚点 anchor 解析（优先级）

1. block meta `preview:explorer-root`（用户从目录预览进入时的根）
2. 图片自身的 `dir`
3. 图片路径的目录部分（兜底）

> 理由：用户从 `photos/2024/` 里双击打开，锚点应是 `photos/2024`；从 Markdown 里点图片链接，锚点即图片所在目录。

## 排序比较器（与目录预览逐对一致）

目录预览用 TanStack `sortingFn: "alphanumeric"`（name 列）与 `"datetime"`（modtime 列），
默认排序来自设置 `preview:defaultsort`：

- `name`  → `compareAlphanumeric(a.toLowerCase(), b.toLowerCase())`（数字段按数值比：`1,2,10`）
- `modtime` → 修改时间**降序**（目录预览 `desc: true`）

`compareAlphanumeric` 按 TanStack 实现逐位复刻（split `/([0-9]+)/g` + 数字/字符串分段比较）。
单测用同一批名字对撞 TanStack 的 `sortingFns.alphanumeric`，保证"所见即所得"不是口头承诺。

## 序列构造（本层 + 站点）

```
buildLayer(entries, sort)  → 本层图片路径数组（排序后）
buildStations(dirTree, sort) → 先序遍历：目录名排序，先收集本目录图片（存在才算站点），再递归子目录
```

本层翻页：
- next = `layer[i+1]`；无则"下一站"可用（`stations[stationIndex+1]`）
- prev = `layer[i-1]`；无则"上一站"

站点解析（跨站）：目标是**下一个含图片文件夹的第一张**（反向为上一站最后一张）。

## 渐进索引（防卡死）

```
ensureIndex(conn, anchor, sort):
  cache hit (TTL 60s) → 立即返回
  否则：
    1. 立刻 list(anchor) → 建 layer（本层可翻页）
    2. 后台 DFS：对每个子目录 list，命中图片即登记 station，emit 增量更新
    3. 达到 5000/深度 8 → truncated=true 停止
```

- 每个目录一次 `filelist` RPC；不做递归 `fileliststream`（其返回缺少 dir 相对结构，需二次 join）
- 并发上限 3（避免一次打爆 remote）
- 订阅用 jotai atomFamily（key = `${connKey}|${anchor}|${sort}`），组件销毁不取消已启动的遍历（缓存可复用）

## 交互与冲突处理

| 输入 | 行为 | 冲突处理 |
|---|---|---|
| 左/右悬浮按钮单击 | 上一/下一张；到边界变「上一站/下一站」条目 | — |
| `→` `←` | 本层翻页 | 仅当 `scale === 1` 且 `window.getSelection()` 为空且无 IME 合成 |
| `Shift+→` `Shift+←` | 跨站 | 同上 |
| `Alt+→` `Alt+←` | 新 Tab 打开 | 用新增公开方法 `PreviewModel.openPathInCurrentBlockAsTab` 的包装 `openPathInNewTab(newPath)` |
| `Home` `End` | 本层首/尾 | 同上 |
| 翻页 | `model.goHistory(path, { pathIsDir: false })` | 保留历史栈；脏草稿由既有 draft 逻辑处理 |

焦点前提：仅当图片块或其内部活动元素是本 block 时响应（避免抢别处的方向键）。
`TransformWrapper` 的 `onZoom` 把当前 scale 写入本地 ref；非 1 时按钮仍可用（点击自动 reset 后翻页）。

## 缓存与失效

- key = `conn|anchor|sort`，TTL 60s
- 手动失效：计数器旁 ↻ 按钮（`Shift+R`）
- 不监听文件系统事件（超出本版范围）；TTL 过期即重建

## 风险

| 风险 | 处理 |
|---|---|
| 超大目录拖慢首屏 | 本层 list 优先（1 次 RPC），子目录遍历后台 + 并发 3 + 上限 |
| 远程连接列错机器 | 所有 RPC 都走 `model.env.rpc`/`wshclient` 并显式传 `connection` |
| 翻页打断未保存草稿 | 复用 `discardPreviewSharedDraftIfUnshared` / 既有 dirty 检查（`goHistory` 内已处理） |
| 键盘抢方向键 | 只在图片块聚焦 + scale=1 + 无选区时处理，且 `preventDefault` 仅在自己消费时 |
| 排序与目录预览不一致 | 单测对撞 TanStack 实现；两种 sort 都覆盖 |

## 回滚

单文件开关：`preview-streaming.tsx` 里 `<StreamingImagePreview>` 是否渲染 pager 由常量
`IMAGE_PAGER_ENABLED` 控制；出问题置 false 即回到纯缩放视图，无数据迁移。
