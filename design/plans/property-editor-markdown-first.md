# 属性编辑器改造方案（markdown 优先 × Obsidian 语义 × Wolai 交互）

> 时间：2026-09-08
> 前一份 `property-editor-wolai-style.md` 记录了 Wolai 的**交互与视觉**实测数据；本文档重写**内核**：
> Wolai 是有 schema 的数据库产品，我们是「纯文本 frontmatter 为唯一真相源」的 markdown 工具。
> **分工：Wolai 出交互/视觉，Obsidian 出数据语义，markdown 优先出写回约束。**

---

## 1. 定位：Wolai 给我们什么，不给我们什么

| 层 | 采用 | 来源 |
|---|---|---|
| 浮层形态、尺寸、chip、搜索+创建合并行、键盘流 | ✅ 采用 | Wolai（实测，见 §3） |
| 属性有 ID / 选项可重命名·改色·删除 | ❌ 不采用 | 需要 schema 存储，我们没有 |
| 候选 = 属性全局选项集 | 🔄 改为 vault 内同 key 历史值 | Obsidian 同款 |
| 数字格式化、列配置、视图配置 | ❌ 不采用 | 无存储位置 |
| 写回方式 | 🔄 改为最小 diff | markdown 优先（§2） |

---

## 2. 项目内核约束（本方案的硬约束）

1. **唯一真相源 = 文件文本。** 不引入 schema 文件、sidecar、本地 DB、持久化缓存。一切派生数据（候选值、chip 颜色）在运行时从文件推导，可随时丢弃重建。
2. **最小 diff 写回。** 编辑一个属性只改那一处；**保留注释、引号风格、缩进、flow(`[a, b]`)/block(`- a`) 序列风格、其他 key 原样**。理由：frontmatter 是人写的文件，不是机器产物；整块重写会吃掉注释与手写格式，并在 git diff 里产生噪声。
3. **Obsidian 双向兼容。** 我们写出的 YAML，Obsidian 要读成同样的属性；Obsidian 手写的各种合法写法我们要能读、且尽量不破坏。类型推断沿用现有 `inferPropertyType`（已对齐 Obsidian）。
4. **每次编辑的产出必须是合法、可 round-trip 的 YAML 文本。** 卡片不持有"值"之外的任何状态。

> ⚠️ 现状违反第 2 条：`obsidian-properties-card.tsx` → `stringifyFrontmatterData()` 用 `YAML.stringify(data)` **整块重写** frontmatter。这是本次要先修的地基问题。

---

## 3. Wolai 交互/视觉规格（实测，bb-browser 实例 A）

| 项 | 实测值 |
|---|---|
| 触发 | 单击值 → 浮层，**无模态遮罩**（`MuiBackdrop-invisible`），点击外部关闭 |
| 容器 | 宽 **399px**（窄处 clamp）、圆角 6px、`0 0 0 1px rgba(0,0,0,.05) + 0 8px 24px rgba(0,0,0,.2)`、`max-height: calc(100% - 32px)`、`overflow-y:auto` |
| 已选区 | padding `8px 8px 0`，`flex-wrap`；chip 高 **22px**、圆角 3px、`padding:0 8px`、背景 `rgba(色,.2)` + 文字 L5、`margin:0 6px 4px 0`；× 12px |
| 输入框 | 与 chip **同一行流内**，`flex:1 1 0%`、`min-width:60px`、无边框，placeholder「搜索或输入选项」 |
| 分隔 | `box-shadow:0 1px 0 var(--color-basic-200)`（细线，非 border） |
| 候选行 | 高 **30px**：左拖拽手柄（六点 `#BCB3B3`） + chip 预览 + 右「更多」（三点 `#8E8E8E`）；选中/高亮同类 |
| 搜索/创建 | 输入实时过滤（「扩展」→ 1 行，高度 166→76px）；无匹配时**只剩一行「创建 xxx」**带 chip 预览 |
| 单选/多选 | 共用同一组件，只差 toggle / 替换 |
| 配色 | 12 色系 × L1–L5；chip 固定「20% 背景 + L5 文字」 |
| 单元格展示 | `min-height:32px`、`line-height:22px`、`padding:5px 8px`；number 右对齐 + hover「设置数字格式化」 |

**未拿到（标注待验证）**：text / number 的编辑态（合成事件触发不了，需 CDP 真实点击复验）、date/checkbox 类型、列头菜单。

---

## 4. 有意与 Wolai 不同（并说明原因）

| Wolai | 本方案 | 原因 |
|---|---|---|
| 选项有 ID，可重命名/改色/删除 | 选项只是字符串，无身份 | 无 schema 存储；"重命名选项"= 跨文件批量改写，超出属性编辑范围 |
| 候选来自属性选项集 | 候选来自 **vault 扫描**：同目录/工作区 `.md` 的同 key 历史值 | 真相在文件里（Obsidian 同款建议源） |
| chip 颜色存于选项 | **hash(字符串) → 色系**，不落盘 | 保持 markdown 纯净；同值跨文件同色，视觉稳定 |
| 数字格式化等列配置 | 不做 | 无存储位置 |
| 属性可改类型（写 schema） | 改类型 = 改 YAML 值的写法（P2，最小 diff） | 类型由值推断 + key known table，与 Obsidian 一致 |
| 拖拽排序写数据库 | 拖拽 = 改 YAML 数组顺序（合法，是文本的一部分） | ✅ 保留 |

---

## 5. 目标设计

### 5.1 数据层：最小 diff 写回（地基，先做）

新增 `frontmatter-edit.ts`（纯函数，可单测），用 `yaml` 包的 **Document API**（`YAML.parseDocument`）替代整块 stringify：

```ts
setProperty(yamlText, key, value): string   // key 存在 → 就地改；不存在 → 追加（沿用文档缩进风格）
deleteProperty(yamlText, key): string
renameProperty(yamlText, from, to): string
setPropertyOrder(yamlText, key, beforeKey|null): string   // 拖拽排序
```

必须保住的性质（逐条写单测）：
- `# 注释` 与行尾注释**不丢**
- `tags: [a, b]`（flow）编辑后仍是 flow；`- a`（block）编辑后仍是 block
- 单引号/双引号/无引号风格尽量保留；仅在必要时（值含特殊字符）才加引号
- 未涉及的 key 字节级不变；EOL（CRLF/LF）保持
- 重复 key、锚点/别名、多行块标量（`|`/`>`）不崩，最坏情况回退到"整块重写 + 提示"

上层 `ObsidianPropertiesCard` 改调 `setProperty(...)` → 仍走 `replaceFrontmatter` 整块替换**行范围**（行范围替换本身安全）→ `model.newFileContent`（草稿语义不变）。

### 5.2 派生层：候选值索引（整个 vault，性能影响最小 + 体验最好）

目标：**扫描整个 Obsidian vault，但用户零等待、主程序零可感开销。**

#### 5.2.1 四条设计原则

1. **真相源仍是文件，索引只是可丢弃的缓存。** 索引落盘在 `getWaveDataDir()` 下（或渲染侧 IndexedDB），随时可删重建；它不影响 markdown 内容，也不参与写回。
2. **不在用户眼前干活。** 冷启动不扫；只在 idle / 打开 md 时后台跑；结果到了再补，绝不阻塞浮层打开。
3. **按需预取（prefetch），而不是等点击。** 卡片渲染时就后台取好「本文件所有 key 的候选」→ 用户点开浮层时数据已在手，感知延迟 ≈ 0。
4. **按 key 取，不全量推前端。** 前端只要当前属性的候选（一个 key，几十条），不是整个 vault 索引。

#### 5.2.2 时间线（体验侧）

| 时刻 | 发生什么 | 用户感知 |
|---|---|---|
| 启动 | 加载持久索引（ms 级）；idle 后增量扫 mtime 变化的文件 | 无 |
| 打开 md | 卡片渲染；后台 prefetch 本文件所有 key 的候选 | 无 |
| 点击值 | 浮层打开，候选已在手；输入即本地过滤（<1ms） | **瞬时** |
| 冷启动 / 超大 vault | 先显示「当前文件已用值 + 输入即创建」，扫描结果到达后按事件增量补入 | 候选几秒内自己变多，不卡 |

#### 5.2.3 性能侧的具体手段

- **只读文件头 8KB**：frontmatter 必在开头，IO 量降一到两个数量级
- **分片让出主线程**：每 20 个文件 `scheduler.yield()`/`setTimeout(0)` 一次；浮层关闭或切文件即取消
- **增量**：`FileInfo.ModTime` + `Size` 比对（`wshrpctypes_file.go` 已有字段），只重读变化文件
- **自编辑零扫描**：我们自己保存时直接更新内存索引 + 标记待持久化
- **上限与降级**：文件数/耗时/条目数上限（默认 5000 文件、单批 3s、2 万条目）；超限或远端慢 → 降级「当前目录」或「仅当前文件」，UI 不变
- **跳过**：`.git` `node_modules` `.obsidian` `.snorkeling` 等
- **写盘防抖**：idle + 5s 防抖，不在编辑路径同步落盘
- **批量更新界面**：一批结束才更新一次，禁止每文件一次渲染

#### 5.2.4 两档实现（前端接口不变，可平滑替换）

`PropertyValueIndex` 门面接口固定：

```ts
getCandidates(vaultKey, propKey, opts): Promise<Candidate[]>   // 内存命中即同步返回
prefetch(vaultKey, propKeys[]): void                          // 后台预取，不 await
invalidate(vaultKey, filePath): void                          // 保存后增量
```

| 档 | 实现 | 开销位置 | 适用 | 改动 |
|---|---|---|---|---|
| **V1（先做）** | 渲染进程分片扫：`FileListCommand`/`RemoteFileListCommand` + 复用 `base-view/base-filter.ts` 的 `parseFrontmatter`；索引缓存在 IndexedDB（持久）+ 内存 | 渲染进程，但分片 + idle，单次通常 < 数文件 | 大多数 vault | 零后端改动 |
| **V2（终局）** | Go 侧扫：新增 RPC 复用 `wshfs.ListEntriesStream` 递归 + 只读头部，结果存 `getWaveDataDir()`，进度经 `wps` 事件推送 | **Go 侧，渲染进程零 IO** | 上万 md / 远端 vault | 动 Go + wsh，前端零改动 |

排序（体验最好）：当前文件已选 → 同目录用过 → 使用频次 → 最近修改 → 字典序。
输入为空时默认展示「最常用的前 N 个」（比 Wolai 的全量平铺更好用）。

#### 5.2.5 配套：颜色

`property-palette.ts`：12 色系照抄 Wolai 数值（亮色 20% 背景 + L5 文字；暗色 ~14% 背景 + L2 文字，保证对比度）；`hashString(value) → 色系`，稳定、无状态。

### 5.3 UI 层：浮层编辑器（`property-value-popover.tsx` + 按类型编辑器）

浮层壳用已在依赖的 `@floating-ui/react` 直接写（`useFloating` + `useDismiss` + `FloatingPortal` + `flip/shift/size`）。
不用 `app/element/popover.tsx`：它强制把 children 包成 `Button`、内部自管 `isOpen`，且 `.popover-content` 有 `min-height:150px` 要覆盖。

| 类型 | 编辑形态 | 语义约束 |
|---|---|---|
| tags / list（多值） | **Wolai 风格浮层**：已选 chip 流 + 内联搜索 + 候选（过滤/创建/拖拽排序） | 值数组；顺序即文本顺序 |
| tag（单值） | 同上，`multiple=false`（点击即替换并关闭） | 单字符串 |
| text | 浮层内自增高 textarea；`Cmd/Ctrl+Enter` 或失焦提交，Esc 取消 | 纯字符串 |
| number | 浮层内单行输入（右对齐）；非法值红边 + 不提交 | 数字或原文本 |
| boolean | **保持点击直接 toggle**（Obsidian 亦为 checkbox） | `true`/`false` |
| date / datetime | 浮层内日期选择；P1 先用原生 `<input type="date">`，P2 自研面板 | ISO 字符串，与 Obsidian 一致 |
| json | 浮层内 textarea + 实时 `JSON.parse` 校验，错误红字且不提交 | 结构化对象 |
| link | 浮层内输入，保持 `[[wikilink]]` | 字符串 |

键盘流（对齐 Wolai 实测）：打开即聚焦 → 输入过滤 → Enter 选第一项/创建 → Backspace（空输入）删末位 chip → Esc/点击外部关闭并提交。

### 5.4 `#tag` 语义（待你拍板）

现状：`tags`/`tag` key 下无 `#` 的值也判定为 tags 类型，chip 显示原字符串（不带 `#`）。
建议（markdown 纯净优先）：**值保持原文，chip 渲染时按类型补 `#` 前缀显示**，输入时若 key 属 tags 系列则自动补 `#` 写入（可在设置里关）。另一选项是照 Obsidian 新版做法：frontmatter 里不存 `#`，只在 body 内嵌标签用 `#`。
→ 需要你定：写回时自动补 `#` 吗？

---

## 6. 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| NEW | `md-properties/frontmatter-edit.ts` | 最小 diff 写回（Document API） |
| NEW | `md-properties/frontmatter-edit.test.ts` | 注释/引号/flow-block/EOL/异常 保真单测 |
| NEW | `md-properties/property-value-index.ts` | vault 候选值索引（FileListCommand + 内存缓存 + 降级） |
| NEW | `md-properties/property-palette.ts` | 12 色系 + hash 选色 + 暗色映射 |
| NEW | `md-properties/property-value-popover.tsx` | floating-ui 浮层壳 |
| NEW | `md-properties/property-tag-editor.tsx` + `.scss` | Wolai 风格标签/多值编辑器 |
| NEW | `md-properties/property-tag-editor.test.tsx`、`property-palette.test.ts` | |
| MOD | `md-properties/obsidian-properties-card.tsx` | 值区点击 → 浮层；写回改走 `setProperty` |
| MOD | `md-properties/obsidian-properties-card.scss` | 值区 hover 态、清理行内编辑样式 |
| DEP | `md-properties/list-property-editor.tsx` | 被 `property-tag-editor` 取代（验证通过后删） |
| MOD | `md-properties/obsidian-properties-card.test.tsx` | 编辑交互断言更新 |

---

## 7. 分期

- **P0a 地基**：最小 diff 写回 `frontmatter-edit.ts` + 保真单测（独立可交付，立即修掉"整块重写吃掉注释/格式"的问题）
- **P0b 核心诉求**：标签/多值 → Wolai 风格浮层编辑器（chip、搜索+创建、颜色 hash、键盘流）；候选先走当前文件已有值 + 输入即创建
- **P1**：其余类型浮层化（text/number/json/date/link）；vault 候选索引接入；chip 拖拽排序
- **P2**：新增属性（+ → 命名，最小 diff 追加）、改名/改类型/删除、date 自研日历面板

开工前必做：CDP 真实点击复验 Wolai 的 text / number 编辑态（§3 待验证项），避免 P1 照着猜做。

---

## 8. 风险与验收

| 风险 | 缓解 |
|---|---|
| `parseDocument` 对锚点/别名/块标量保真不足 | 单测覆盖；最坏回退整块重写 |
| 目录扫描拖慢 / 远端超时 | 数量与耗时上限、可取消、降级无候选 |
| waveblock 子树重挂载导致浮层被关（Phase 2.5 老坑） | 沿用已修的 `useMemo`/`useCallback` 稳定引用；浮层打开期间不抖动卡片 state |
| inline-edit 冲突 | 卡片无 `data-source-line`，双击不进 markdown inline-edit（已验证） |
| 暗色对比度 | palette 单测断言对比度阈值 |
| 外部改文件导致草稿冲突 | 沿用现有 `newFileContent` 草稿 + Save/Revert 语义 |

验收：
1. `vitest`：`frontmatter-edit.test.ts`（注释/引号/flow-block/EOL 保真）、`property-tag-editor.test.tsx`（过滤、创建、去重、toggle vs 替换、键盘）、`property-palette.test.ts`
2. 实机 CDP：`node scripts/inspect-electron-ui.mjs screenshot` — 浮层打开/搜索/创建/暗色 4 张，量 399px 宽、22px chip、30px 行高
3. 手工：改一个带注释的 frontmatter → 注释仍在、git diff 只有一行变化；浮层编辑后 Save/Cmd+S 落盘、Revert 可退
