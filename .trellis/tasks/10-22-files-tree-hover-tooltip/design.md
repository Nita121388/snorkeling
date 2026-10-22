# Design — Files 树节点悬浮信息 Tooltip

## 1. 目标与约束

给 Files Block 目录树的节点加一张 hover-intent 信息卡（Nova 风格），展示大小 / 修改时间 / 路径 / 类型。

硬约束：

- **C1** TreeView 行是 `@tanstack/react-virtual` 渲染的绝对定位元素，**不能插入额外包裹节点**。
- **C2** 行内已有 `title={row.label}` 原生 tooltip，会和浮层 tooltip 打架 → 需要处理。
- **C3** 树是虚拟滚动的：hover 到的行可能因滚动被回收，tooltip 必须跟随/关闭，不能悬空。
- **C4** 现有 `element/tooltip.tsx` 会给 children 包一层 `<div>`，会破坏 C1 → 不能复用其外壳。

## 2. 数据流

```
wshrpc FileList  →  FileInfo{path,name,isdir,mimetype,size,modtime,readonly,notfound,staterror}
        │
        │ preview-explorer.tsx :: toTreeNode(fileInfo, parentId, dirIconColor)
        ▼
TreeNodeData { ...existing, size?: number, modtime?: number }   ← 新增两个可选字段
        │
        │ treeview.tsx :: rows.map(row => <TreeRow …/>)
        ▼
FileMetaTooltip（TreeView 内部单例，锚点 = 被 hover 的行 DOM 节点）
```

### 2.1 TreeNodeData 扩展

```ts
export interface TreeNodeData {
    // …existing
    /** 文件字节数；目录不设置 */
    size?: number;
    /** 最后修改时间（unix 毫秒） */
    modtime?: number;
}
```

两个字段都是**可选**，既有构造点零改动。`toTreeNode()` 里透传：

```ts
size: fileInfo.isdir ? undefined : fileInfo.size,
modtime: fileInfo.modtime,
```

目录不传 `size`（目录的字节数在多数平台无意义，且各家 stat 语义不一致）。

### 2.2 类型 → 可读名

`mimetype` → 展示用类型名。规则（纯函数 `describeMimeType`，便于单测）：

| mimetype | 展示 |
|---|---|
| `text/markdown` | Markdown |
| `application/json` | JSON |
| `text/x-python` | Python |
| `text/typescript` / `application/typescript` | TypeScript |
| `text/javascript` | JavaScript |
| `text/html` | HTML |
| `text/css` | CSS |
| `image/*` | Image |
| `video/*` | Video |
| `audio/*` | Audio |
| `application/pdf` | PDF |
| `directory` | 文件夹 |
| 其它 `type/subtype` | 取 `subtype` 大写化兜底（如 `application/x-tar` → `X-TAR`） |
| 无 mimetype | `文件`（目录则 `文件夹`） |

## 3. 组件设计

### 3.0 格式化函数的归属（复用决策）

代码库里已有 **3 份** size 格式化实现（`aisessions/utils.ts:formatFileSize`、`aipanel/ai-utils.ts:formatFileSize`、
`preview-directory-utils.tsx:getBestUnit`），再加一份就是第 4 份。按 code-reuse 原则先做收敛：

- 新建**叶子模块** `frontend/util/fileformat.ts`（只依赖 dayjs，无 store / 无视图依赖）：
  - `formatFileSize(bytes: number | null | undefined): string` → `"0 B"` / `"4.2 KB"`
    （从 `aisessions/utils.ts` 平移，语义完全一致，其既有单测 `aisessions/utils.test.ts` 继续通过）
  - `getLastModifiedTime(unixMillis: number): string` → `"9月 15 14:32"` / `"2025-12-31"`
    （从 `preview-directory-utils.tsx` 平移，同年/跨年分支原样保留）
- `aisessions/utils.ts` / `preview-directory-utils.tsx` **改为 re-export**，现有 import 路径（`session-row.tsx`、
  `preview-directory.tsx`）零改动，不产生循环依赖：
  - `preview-directory-utils.tsx` 去掉 `dayjs` 依赖（`dayjs` 仅被 `getLastModifiedTime` 使用）
- `getBestUnit`（表格视图的紧凑写法 `"4.2k"`）**留在 `preview-directory-utils.tsx`**：
  它只服务表格 Size 列，Tooltip 用 `formatFileSize` 的 `"4.2 KB"`，两者语义不同，不合并。

**为什么不用 `aipanel/ai-utils.ts` 的 `formatFileSize`**：它是 AI 面板域的助手文件大小（单位只到 GB，
超过 TB 会越界），且从 treeview 引入 ai 域属于反向依赖。

**为什么 treeview 不直接 import `preview-directory-utils`**：该模块依赖 `preview-model`（118KB，
带 jotai store / RPC），会让通用 TreeView 把整个预览域拖进依赖图；叶子模块 `fileformat.ts` 规避了这点。

### 3.1 文件划分

| 文件 | 职责 |
|---|---|
| `frontend/util/fileformat.ts` | 新增。叶子模块：`formatFileSize` / `getLastModifiedTime` |
| `frontend/app/treeview/treeview-file-tooltip.tsx` | 新增。Tooltip 组件 + 纯函数（内容行构造、类型名） |
| `frontend/app/treeview/treeview-file-tooltip.test.ts` | 新增。单测 |
| `frontend/app/treeview/treeview.tsx` | 行渲染接入 hover 事件 + 渲染单例 Tooltip |
| `frontend/app/view/preview/preview-explorer.tsx` | `toTreeNode` 透传 size/modtime |
| `frontend/app/element/hover-timing.ts` | 新增共享延迟常量 |
| `frontend/app/view/aisessions/utils.ts` | 改为 re-export `formatFileSize` |
| `frontend/app/view/preview/preview-directory-utils.tsx` | 改为 re-export `getLastModifiedTime` |

### 3.2 为什么不用 `element/tooltip.tsx`

它给 children 包 `<div>`（C4），且内部 `useHover` 直接挂在包裹层上，行布局会被改。
本方案改为：**Tooltip 组件自己管 floating**，由 TreeView 把「被 hover 的行 DOM 节点」作为
reference 传进去，Tooltip **不包裹任何东西**，只通过 `FloatingPortal` 渲染一个绝对定位的浮层。

### 3.3 交互时序

```
pointerenter(row)  ──►  startTimer(700ms)
                          │
      (timer 未到)         │  pointerleave(row) ──► clearTimer ──► 关闭
                          │
      (timer 到)           ▼
                     tooltip.open = true，锚点 = row 元素
                          │
      pointerleave(row)  ──► 立即 open = false（开始淡出）
      滚动导致行被回收     ──► onScroll ──► 关闭
      淡出结束(140ms)      ──► 摘除 DOM
```

- 用 `pointerenter` / `pointerleave`（不是 mouseover/mouseout），避免子元素冒泡导致抖动。
- 计时器**整棵树共用一个**（虚拟滚动下可能有几十行同时存在，每行一个 timer 会互相打架）。
- 计时逻辑抽成**纯控制器** `createHoverIntentController`（`use-hover-intent.ts`）：
  不依赖 React、不依赖 DOM，用 fake timers 即可确定性单测；
  React 侧只用 `useHoverIntent` 包一层。
- 被 hover 的行信息（node / DOM 节点 / 图标名）在 pointerenter 时记进 `pendingRowRef`，
  计时到期再取，避免闭包捕获过期行。

### 3.4 定位

- `placement: "right"`（树面板通常靠左/中间，右侧空间大），`offset(10)`，`flip()`，
  `shift({ padding: 12, crossAxis: true })`。
- **`crossAxis: true` 是必须的**：`shift` 默认只约束交叉轴（垂直），主轴（水平）溢出靠 `flip` 兜底；
  但两侧都放不下时 `flip` 会维持原位 → 浮层溢出视口被裁切。开启后主轴也会被拉回视口内。
- `autoUpdate` 跟随锚点滚动/缩放。
- 锚点 = 被 hover 的**行元素**（整行），而不是文件名 span → tooltip 垂直居中对齐行。
- 兜底：树在屏幕最右侧时 `flip` 自动翻到左侧。

### 3.5 视觉规格（Nova）

```
┌───────────────────────────────────────┐
│ [icon]  design.md            Markdown │   ← 头部：图标 + 名称 + 类型徽章
├───────────────────────────────────────┤
│  大小              4.2 KB             │   ← 元信息行
│  最后修改          9月 15 14:32       │
├───────────────────────────────────────┤
│  E:\code\snorkeling\design.md          │   ← 路径（等宽、换行）
└───────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| 容器 | `bg-modalbg/95 backdrop-blur-xl border border-border/70 rounded-xl shadow-2xl` + `px-3 py-2.5` + `max-w-[300px]` |
| 头部 | 图标 14px（沿用 `makeIconClass` 的 FA 图标 + 目录色）+ 名称 `text-[13px] font-medium` + 类型徽章 |
| 类型徽章 | `text-[10px] px-1.5 py-0.5 rounded-md bg-surface text-secondary border border-border/60` |
| 元信息行 | 标签 `text-[10px] uppercase tracking-wide text-muted`；值 `text-[12px] text-foreground` 右对齐 |
| 分隔线 | `h-px bg-border/60` |
| 路径 | `font-mono text-[11px] text-muted break-all` |
| 动效 | 入场 `opacity + scale(0.96→1)` 约 120ms，出场更快；跟随鼠标行自动避让边界（flip/shift） |
| 层级 | `z-50 pointer-events-none select-none` |

**入场动画的实现要点**：浮层若带着终态（`opacity:1`）挂载，浏览器没有「变化前样式」，
`transition` 不会触发。因此首次渲染用隐藏态，下一帧（`requestAnimationFrame`）再翻到可见态。
出场采用两段式关闭：先淡出（90ms），140ms 后才摘除 DOM。
缩放用独立的 `scale` CSS 属性而非 `transform`——floating-ui 用 `transform` 做定位 translate，
写 `transform: scale(...)` 会把定位顶掉。

**关键取舍**

- 用 `bg-modalbg/95 + backdrop-blur`（与 `preview-new-files.tsx` / `widgets.tsx` 的 Nova 风格浮层一致），
  而不是 `bg-overlay`（`element/tooltip.tsx` 用的），避免与项目现有浮层风格割裂。
- 不用 `shadcn/ui` 组件包：项目里 shadcn 只有 `lib/utils.ts`（只有 `cn`），没有 Radix 依赖，
  引入整套组件不划算；用 `@floating-ui/react`（已在依赖里）+ Tailwind 原子类即可。

### 3.6 与原生 `title` 的冲突

树行当前有 `title={row.label}`，鼠标停留时浏览器会弹原生 tooltip，与浮层 tooltip 重叠。
处理：**去掉 `title` 属性**，把「完整名字」职责交给浮层 tooltip（名字在 tooltip 里完整展示）。
这同时解决了「名字被 truncate 时看不到全名」的问题。

### 3.7 缺失数据

`buildFileMetaRows(node)` 返回 `{ label, value }[]`，缺数据直接不产出该行：

- 无 `size` → 无「大小」行
- 无 `modtime` → 无「最后修改」行
- `notfound` / `staterror` → 头部下方显示错误说明行（`text-error`），不显示元信息行
- 目录 → 无「大小」行；「最后修改」取目录 mtime
- 路径缺失 → 无路径区

## 4. 测试策略

`frontend/app/treeview/treeview-file-tooltip.test.ts`（vitest，纯函数）：

- `describeMimeType`：markdown / json / directory / 未知 / 缺失
- `buildFileMetaRows`：文件有 size+modtime / 目录 / 缺 size / 缺 modtime / notfound / staterror / 零字节
- `FileTooltipHoverDelayMs` 常量值断言（防止被随手改小导致误触发）

`frontend/app/treeview/use-hover-intent.test.ts`（vitest + fake timers）：

- 延迟未到不打开 / 到点才打开
- 未到点就移开 → 取消打开
- 移开 → 立即 onClose，closeDelay 后才 onUnmount
- 连续 enter/leave（行间移动）→ 只打开一次、不误卸载
- dispose 后计时器不再触发（组件卸载安全）

注：`formatFileSize` / `getLastModifiedTime` 的既有单测在 `aisessions/utils.test.ts`，
平移后仍然覆盖，无需重复造用例。

**为什么不靠截图验收时序**：hover 延迟/关闭时序是纯计时行为，用 fake timers 做单测
比「真实鼠标 + 截图」更确定、更快，也不依赖人工确认。视觉（配色/圆角/排版）
仍然需要人眼在真实 app 里过一遍。

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 虚拟滚动下锚点被回收导致 tooltip 悬空 | `autoUpdate` + 锚点 `isConnected` 检查，detached 即关闭 |
| 每行一个 timer 导致状态打架 | 整个树共用一个 timer（TreeView 顶层 ref） |
| `title` 移除影响可访问性 | tooltip 内容补齐完整文件名；`role="tooltip"` |
| 影响其他 TreeView 消费方 | 新字段可选；tooltip 行为内聚在 TreeView 内，preview 页同样受益且无破坏 |

**回滚**：改动集中在 3 个源文件 + 2 个新文件，`git revert` 即可，无数据/协议变更。
