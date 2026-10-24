# 技术设计：AI 会话与 Agent TUI 文本选中及上下文复制

> 本文只讲跨子任务的架构与取舍。单点实现细节见各子任务 `prd.md`。

## 1. 出发点：不要重造浮层

现有能力盘点（核查过源码，非推测）：

```
document selectionchange
        │
        ├─► ClipboardFloatActions (app 级, app.tsx:447)
        │      └─► SelectionCopyOverlay 💡
        │             └─► makeSelectionQuickActionMenu
        │                    ├── Copy
        │                    ├── copyMenuItems   ← 注入槽（含 Copy Context）
        │                    ├── Search In Files
        │                    ├── Add/Find Common Text
        │                    └── extraMenuItems  ← 注入槽
        │
        └─► app.tsx:121  右键菜单（同样的 copyContextText 判定）

xterm selectionchange（canvas，无 DOM 选区）
        └─► term.tsx onSelectionTextChange
               └─► SelectionCopyOverlay 💡（本地实例）
                      └── copyMenuItems = [Copy Logical Line, Copy Selection as One Line]
```

结论：**💡 与 Copy Context 的管线已经存在**。缺口是 `getCopyContextTextFromDom()` 只认文件型标注（`data-copy-context-path` + `data-source-line`），会话与终端没有这个标注，所以菜单里那一项永远不出现。

因此本任务不新增浮层、不新增菜单组件，只做两件事：

1. 把「来源信息」作为通用契约暴露出来
2. 写一个不依赖 DOM 的格式化纯函数

## 2. 三层结构

```
┌─────────────────────────────────────────────────┐
│ 契约层   data-copy-context-kind / -meta (DOM)   │
│          data-aisession-key (DOM, 用于回流定位)  │
├─────────────────────────────────────────────────┤
│ 格式化层  copy-context.ts（纯函数）              │
│          formatSessionContext()                  │
│          formatTermContext()                     │
│          fencedBlock()                           │
├─────────────────────────────────────────────────┤
│ 接线层   selection-copy-overlay.tsx（增分支）    │
│          term.tsx（copyMenuItems 注入）          │
│          chat-composer-events.ts（回流）         │
└─────────────────────────────────────────────────┘
```

格式化层是唯一真相。任何入口（💡 Copy Context、hover 按钮、Quote to Input）都必须调用同一函数，测试用字符串相等断言固化这一点。

## 3. 关键取舍

### 3.1 复用全局 💡 而不是给 Session Detail 挂独立浮层

- **取**：Session Detail 是普通 DOM，`document` 级 `selectionchange` 天然覆盖它。挂独立浮层会出现两个 💡 的抑制问题。
- **舍**：全局组件无法感知具体会话状态，跨屏范围信息拿不到（见 3.2）。
- **代价处理**：范围信息由 Session Detail 自己记录在 ref 里，不指望全局组件提供。

### 3.2 跨屏选区：不依赖 DOM

虚拟化会把离屏行卸载，`selection.toString()` 与 `Range` 在拖选跨屏后不可靠。

采用「只信消息 seq，正文从 model 取」：

- Session Detail 在 `selectionchange` 期间持续记录首/尾 seq 到 ref
- Copy Context 的正文不取 DOM 片段，按 seq 范围从 `renderItems` 的 model 数据取完整消息
- 单条消息覆盖时仍取 DOM 选区文本（尊重部分选中）

这样虚拟化只影响「锚点是否还挂在 DOM 上」，而锚点在拖选过程中已被持续记录，问题消失。

### 3.3 终端为什么不走 DOM 契约

xterm 用 canvas 渲染（`useWebGl`），没有 DOM 选区，`getCopyContextTextFromDom` 对终端恒为 null。终端必须在自己的 `copyMenuItems` 里注入。这是能力差异，不是实现偷懒，记录在此避免后续误改。

### 3.4 Quote to Input 为什么需要事件总线

composer 的 `input` 是 `ChatComposerInner` 内部 state（`chat-composer.tsx:140`），外部没有 setter。Session Detail 与 composer 是兄弟关系（composer 在 pane 底部），提升 state 会牵动会话切换/重挂载的既有逻辑（`key={composer-${summary.id}}`）。

模块级事件总线（照 `session-note-events.ts` 的既有范式）是改动面最小的方案，且能天然按 `sessionKey` 隔离。

### 3.5 `data-aisession-key` 与 `data-copy-context-*` 的职责划分

| 属性 | 挂载点 | 用途 |
|---|---|---|
| `data-copy-context-kind` + `-meta` | 单条消息容器 | 告诉格式化层「这条消息来自哪里」 |
| `data-aisession-key` | Session Detail 根容器 | 告诉回流层「这里属于哪个会话的 composer」 |

分开的理由：前者粒度是消息（每条一个），后者粒度是面板（一个）。合成一个属性会让根容器也要带 meta，语义混乱。

## 4. 输出格式（唯一真相）

见父 `prd.md` R2。实现约束：

- 字段顺序固定，不得重排
- 缺失字段整行不输出（不是输出空值）
- 正文截断阈值 8000 字符，常量导出为 `CopyContextMaxChars`
- 围栏按内容最长反引号串升级

## 5. 风险与降级

| 风险 | 影响 | 降级 |
|---|---|---|
| 全局 💡 不传 `extraMenuItems`，Quote to Input 挂不上 | 子任务 3 的方案 A 失败 | 退方案 B：Session Detail 自建局部浮层 + 抑制全局（见子任务 3 `prd.md` D3） |
| Windows 下 Shift+拖选实际不可用 | 终端选中体验缺失 | 补「选择模式」开关（子任务 2 R5.2） |
| 跨屏拖选中途锚点丢失 | Copy Context 范围不准 | 已在 `pointerdown` 时重置、`mouseenter` 时更新；若仍不可靠，退到「按可见渲染行取范围」 |
| 改动 `getCopyContextTextFromDom` 影响 preview / markdown | 既有功能回归 | 新分支在前、旧分支在后，旧分支单测必须全绿；改动面限制在函数内部 |

## 6. 不做的设计

- 不做后端 RPC：全部数据前端已有（`SessionDetail` / block meta）
- 不做跨会话合并：选区天然局限于一个面板
- 不做通用「上下文插件注册表」：当前只有两个 provider（session / term），抽象成注册表是过度设计；契约用两个 const 字符串足够，第三个 provider 出现时再抽
