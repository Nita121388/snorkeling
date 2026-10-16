# HANDOFF（2026-10-15 会话）

> 这份文件是给**下一个会话**的交接说明。上一版（2026-10-13）的内容已过时，此处重写。

## 0. 一句话现状

A3「在位编辑」的**文本类块已交付并实测零差异**；P0 数据损坏已修并收口；
`md-dom` 抽包完成到「只剩会话驱动」。**下一步是按已确认的目标架构做 Phase 1**（见 §4）。

## 1. 仓库与基线（照这个判断是否回归）

- 分支 `feat/wysiwyg-block-editor`；本轮最后一个提交见 `git log -1`
- **`npx tsc --noEmit` → 68**（既有错误，**修正前后逐条 diff 必须完全一致**，只数个数不够）
  - 用 `grep "error TS" | sed 's/([0-9]*,[0-9]*)//' | sort` 后 diff 两份输出
- **全量 vitest 的失败是"既有集合"，判据是"相对基线是否新增"，不是"是否全绿"**：
  ```
  frontend/app/view/preview/plugins/export/html-export.test.ts
  frontend/app/view/preview/plugins/md-properties/obsidian-properties-card.test.tsx
  frontend/app/view/preview/preview-directory-utils.test.ts
  frontend/preview/mock/mockwaveenv.test.ts
  ```
  另有隔离跑即过的 flaky（`blockregistry`）。**别把 flaky 当成自己改坏了。**
- `packages/*` + `frontend/app/element` 约 **1096 用例全绿**，可作为局部回归的第一道门

## 2. 用户的核心诉求（最高优先级，且**已澄清过一次**）

1. **编辑态 ≡ 预览态，零差异**。不是逐项对齐，而是**单一渲染真源**：
   渲染产出一份 DOM，编辑在**同一份 DOM 上**加担保（A3 的原理）。文件优先（markdown 是事实源）。
2. **产品目标 =「卡片里的内容支持 md 预览和编辑」**（用户原话）。
   即 journal 的卡片 `content` 字段（`extension/features/card-editor.js`，现在是纯 `<textarea>` 存纯文本）。
   「抽一个通用库」是**手段**，不是目的。
3. **评判标准（用户明确指定）**：**性能 / 可扩展性 / 复用性 / 易用性 优先；开发成本与改动大小不作约束。**

## 3. 已确认的目标架构（用户已同意「按这个方式开始」）

```
   host          适配层：每个项目一份，**全部可选、全部有默认实现**
    ↑
 md-react        React 绑定：薄（挂载 + 生命周期），不管 DOM 内容
    ↑
  md-dom         编辑引擎：caret / 种子 / 提交 / 往返 / 块级更新调度
    ↑
  md-core        模型 + 渲染：remark 管线、块模型、DOM↔markdown、DOM 渲染、契约、
                 **块类型描述符**、sanitize
```

**依赖规则（门禁锁死）**：只能向下依赖；`md-core` / `md-dom` 内**零框架**；
`md-react` 是唯一 React 层；每个包**零必需 CSS**。

**修正一处文档谬误**：设计文档写 `md-core 无 DOM`，但它的 `transform/dom-to-markdown.ts`
本来就是 DOM 代码。**正确边界是「无框架」，不是「无 DOM」。**

## 4. 路线图（成本不敏感，按依赖与风险排）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **1** | **DOM 契约文档化 + 块类型描述符（六项门禁）** | ← **正在做** |
| 2 | 框架无关渲染真源上线（统一 DOM 产出） | ⬜ |
| 3 | 编辑引擎接到同一份 DOM（A3 推广全类型，**退役 overlay 双轨**） | ⬜ |
| 4 | 块级增量更新 + **性能门禁（大文档基准）** | ⬜ |
| 5 | 交互层集中（键盘/多选/拖拽/块菜单） | ⬜ |
| 6 | dist 打包 + journal 接入 + fixture playground | ⬜ |

## 5. 为什么是「块类型描述符」（可扩展性的量化依据）

**实测**：一个块类型的知识现在散在 **6 个文件**——

```
packages/md-core/src/render/renderer-registry.tsx          渲染器（24 个 key）
packages/md-core/src/transform/dom-to-markdown.ts          DOM→markdown（22 个 case 分支）
packages/md-core/src/shared/markdown-sanitize-schema.ts    sanitize 白名单
packages/md-dom/src/seed.ts                                渲染 DOM → 编辑器种子
packages/md-dom/src/lossy.ts                               往返有损判定
packages/md-dom/src/block-syntax.ts                        块语法 / 空壳守卫
```

→ 加一个新块类型要同时改 6 处，**漏改就是数据事故**（本会话两类数据损坏正是
「渲染认识、序列化不认识」造成的静默改写）。

**目标**：六项集中在一处声明，**门禁机器检查六项齐全**（缺一项直接红）。
与 ProseMirror `NodeSpec` / Lexical `Node` 同构。第三方可注册块类型而不 fork 内核。

## 6. 用户明确认同的三条「反对」（别违反）

1. **不自研富文本内核**（不做第二个 ProseMirror）：不要内存文档树当事实源；
   保存不得重写整个文件。要写块模型/块身份/可逆 op，但不写 schema+事务+选区引擎。
2. **不允许我们自己维护第二套渲染实现长期存在**：第三方按契约实现**支持**，
   我们两套实现**同步维护**才是问题。自查信号：加一个语法要改两个渲染文件。
3. **不允许 overlay 与在位编辑长期双轨**：本会话实测代价 = overlay 专属样式通道 60 处、
   CSS 镜像台账 60 条、提交守卫两套且**已经不一致**、callout 背景色 parity 缺口。
   退役 ≠ 删功能，而是机制单轨。

## 7. 踩过的坑（不要重犯；本会话新增的都在后半）

1. 子代理在本仓库多次超时零产出 → 窄任务或主线亲自做。
2. 子代理驱动 Electron UI 会死循环 → 用 jsdom 单测 + 沙箱。
3. **点击类验证前后必须比 md5，测完立即还原**（会误点任务框等控件）。
4. 起沙箱用 `SNORKELING_DEV_TASK=electron:quickdev`（默认任务会交叉编译 wsh 十几分钟）。
   CDP 点击前必须先用 `scripts/cdp-focus-hold.mjs` 长连接置前，否则 `visibilityState=hidden` 输入不投递。
5. **改 vite 别名后必须重启 dev server**（别名在启动时解析）——
   否则 `Failed to resolve import "@md/dom/..."` 会被误判成代码写错。
6. **CDP 有两个 page target**：`Wave Terminal - T1` 才是真应用，不带 `--target` 会量到 67 字符空壳。
7. **应用启动失败时 DOM 是空壳，「看 DOM」什么都看不到** → 用 `scripts/cdp-errors.mjs` 抓 console/exceptionThrown。
8. **`rehype-sanitize` 会静默剥掉未放行的 `data-*`** → 表现为"代码在、测试全绿、真机 DOM 上没有属性"，
   每一层单独看都对，归因极难。新增 `data-*` 必须同时放行 sanitize schema。
9. **断言前要拿真机 DOM，别用手写 fixture 冒充证据**（本会话因此错了两次：
   脚注的 `<sup>` class、remark-gfm 重复引用是否有标注）。
10. **反向选区不能用 `range.setStart(4)+setEnd(1)` 造**（Range 自动归一成折叠选区，测试会假通过），
    必须用 `selection.setBaseAndExtent`。
11. **`export { type X } from` 不会把 X 带进本模块作用域** —— 既要再导出又要本地用必须成对写 import；
    vitest（esbuild 剥类型）照不出这类错误，**只有 tsc 能**。
12. `grep` 模式以 `--` 开头会被当选项 → 写 `grep -- "--token"`。

## 8. 本会话已完成（避免重复劳动）

- **A3 在位编辑**：p/h/quote/callout/list 已交付，沙箱实测两态 computed style **0 差异**；
  `wysiwyg-inplace` flag 转正为默认开（显式写 `off` 仍可回落）
- **P0 数据损坏修复 + 收口**：`ff16ef19`（拦住渲染有损的块）→ `a6f714c8`/`cc6b4157`/`cefc0317`
  （wiki 链接 / 脚注 / 图片**学会逐字节往返**，含它们的段落重新可原位编辑）
- **`md-dom` 抽包**：`block-syntax` / `commit-prep` / `seed` / `edit-target` / `commit-plan` /
  `edit-anchor` / `caret` / `lossy` —— 纯层全部搬完，**只剩会话驱动**
- **消除双份实现的两处**：`planBlockCommit`（提交四道守卫收敛）、`resolveEditAnchor`（会话基准收敛）
- 新增 `scripts/cdp-errors.mjs`（抓渲染进程异常，启动失败时唯一有用的工具）

## 9. 已知缺口（明确记账，别当没有）

- 清空标题会写入裸 `###`（而非删块）—— 产品决策，未擅自实施
- overlay 回落路径的 callout 背景色有 1 项 parity 缺口（既有，非本会话引入）
- 两条提交路径的守卫**语义已对齐、代码尚未合一**（overlay 多一道双源对比 + placeholder/insertMode 分支）
- `md-dom` 会话驱动未抽出（`useInlineEdit` 仍是 React hook）
- **渲染缺口**：md-core 的渲染器是 React，无框架无关产出路径 → 这是 journal 验收差的那一块
