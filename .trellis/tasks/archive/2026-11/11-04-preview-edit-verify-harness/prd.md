# 预览编辑自验证闭环：机器可判定的 observe → oracle → loop

## Background

### 触发

用户报告 md 预览列表编辑"文字位置偏移 / 样式变化 / 内容被截断"。上一轮修复了（`f2661b96`），
但用户反馈**效果仍然没有实现**，并指出真正的问题不是某个 bug，而是：

> 需要你自己能够验证当下的效果，为以后实现预览编辑的自我进化 agent loop 做基础。

### 上一轮验证为什么失效（本任务的起点）

上一轮我"验证通过"了，但用户的观感是没修好。复盘出三个硬缺口：

| 缺口 | 具体表现 | 后果 |
|---|---|---|
| 环境不是真机 | 跑在 `frontend/preview` 组件预览页（mock 页面） | 真实 app 的 Wave 主题变量、`.md` preview 的 `contentClassName`、block grip / node controls 都不同 |
| 手势不是真手势 | `el.dispatchEvent(new MouseEvent("dblclick"))` | 绕过命中测试、单击/双击判定、选区抑制、caret 定位 |
| 判定只有数字 | 只断言 Δx/Δy 与 `scrollHeight` | **一张图都没有**。"数字对了"≠"看起来对了"，视觉效果从未被验证 |

结论：**没有可复现的实验台，就没有资格声称"修好了"**。本任务交付的是实验台本身。

### 代码库现状（已核实的可复用资产）

| 资产 | 位置 | 可复用点 |
|---|---|---|
| CDP 检查脚本 | `scripts/inspect-electron-ui.mjs` | `state / elements / style / click / screenshot / eval`，已封装 CDP 连接 |
| 隔离 dev 实例 | `scripts/dev-isolated.mjs` | `--profile / --vite-port / --cdp-port`，独立 `.runcfg/<profile>`，不干扰用户实例 |
| inline-edit 调试环 | `window.__inlineEditLog`（`markdown-inline-edit.tsx`） | measure / target-lost / scroll 事件的时序环形缓冲，可直接当结构化证据 |
| 图像库 | `pngjs@7`（已在 deps） | 像素差，无需新增依赖 |
| 参考脚本 | `scripts/shot-timeline.mjs`、`shot-card.mjs` | 已有的截图驱动范式 |
| 外部打开入口 | `emain/emain-open.ts` | 进程 argv 里的路径会被当 preview block 打开 |

### 一个必须记录的可行性发现

**这一版 Wave 的布局存在 DB 里**（`pkg/wcore/layout.go` + `.runcfg/data/db`），**没有 `wave.lay`
文件**。因此"预置布局文件让 app 启动即就位"这条最理想的路走不通，打开 fixture 必须走：
1. 启动参数传文件路径（`emain-open.ts` 会转成 preview block），或
2. 渲染进程内调 app 自己的 RPC 创建 block（vite dev 下模块可直接 import）。

## Goals

1. **agent 能自己判断"效果实现了没有"**：一条命令返回 `verdict: pass|fail` + 证据，不需要人在旁边看图。
2. **判定必须覆盖"视觉"**，不只是几何数字：编辑前 / 编辑中 / 退出后三态截图 + 像素差。
3. **实验台自身可被验证**：支持 `--expect=broken`，能在"旧实现"上稳定跑红；红不了就说明实验无效。
4. **lf 收敛判据可机器读**：多次运行之间能回答"这次改动是变好还是变坏"（新增失败项 = 变坏）。
5. **判据可累积**：每修一个 bug 就沉淀成一条常驻 rule，规则库单调增长，同一类坑不再复发。
6. **case 声明式**：新场景加 JSON + fixture 即可，不写代码（为将来表格 / 代码块 / quote / 图片铺路）。

## Non-Goals

- 不做视觉模型（VLM）门禁：语义判定只作软告警，不阻塞流水线。
- 不做 CI 集成、不做多平台（当前只 Windows + 现有 dev 流程）。
- 不重构 inline-edit 本身；本任务只新增 `scripts/verify/` 与 `fixtures/`，不动机能代码。
- 不做"像素基线全量截图库"：优先用**自证对比**（阅读态 = 基准），只有无法自证时才引基线。

## Acceptance Criteria

- [ ] **AC1** `node scripts/verify/preview-edit/run.mjs --json` 输出符合 schema 的
      `{verdict, cases[{id, pass, checks[], evidence, images}]}`，退出码 0/1 与 verdict 一致。
- [ ] **AC2** 至少 4 个 case 覆盖：无序项、有序项、折叠式多行有序项、6 项长列表（含嵌套）。
      每个 case 都有 `before/during/afterEsc` 三张图。
- [ ] **AC3** 判定包含：文字零位移（≤1px）、不裁剪、单层缩进、marker 真在画、干净退出、
      无 measure 抖动 —— 每条都是**独立 rule 文件**，可单独启用/禁用。
- [ ] **AC4** `--expect=broken`（注入旧实现 CSS）必须 fail，且 failing 项能指向具体 rule；
      `--expect=fixed` 必须 pass。两者在同一台机器上可重复复现（连跑 3 次结果一致）。
- [ ] **AC5** 全部在**真实 app**（隔离 dev 实例 + CDP）里跑，用**真实指针事件**
      （CDP `Input.dispatchMouseEvent`），不用合成的 `dispatchEvent`。
- [ ] **AC6** 单轮（app 已启动，`--attach`）耗时 < 10s；冷启动全流程 < 3min。
- [ ] **AC7** `Taskfile.yml` 提供 `verify:preview-edit`；脚本 `--help` 自解释。
- [ ] **AC8** 规则语义与"为什么需要这条规则"写入 `.trellis/spec`，并与 `rules/` 里的 id 一一对应。

## Risks

| 风险 | 影响 | 缓解 |
|---|---|---|
| 启动 app + `vite build` 慢（首跑 ~90s） | 循环体验差 | 支持 `--attach` 复用一个常驻 verify 实例；循环时用热更新 |
| 像素对比受字体抗锯齿/子像素影响 | 误报 fail | mask 外的差异允许 2/255 容差 + 少量噪点像素；字体先 `document.fonts.ready` |
| mask 定太宽导致漏判 | 误报 pass（更危险） | mask 由 `::before` 的实测 rect 反推，不手写死数字；每次 fail/pass 都留 diff 图供人复核 |
| 打开 fixture 的入口不稳（DB 布局、argv 差异） | 实验台起不来 | 三级策略链 + 健康检查（等到 `.markdown-render-root`），失败时给出明确诊断 |
| 规则只对当前 fixture 成立（过拟合） | 假绿 | 每条 rule 至少被 2 个 case 覆盖，脚本对单覆盖 rule 报 warn |
| 旧实现对照靠"注入 CSS"而非真旧代码 | 对照不真 | `--legacy` 用 `git stash`/`git worktree` 真跑旧代码一次作为验收证据（M2） |
