---
template: doc
theme: blueprint
title: Snorkeling 核心功能 → 时间线
subtitle: fork 七个月、132 个自发版：八个功能域各改了什么、什么时候改的
file: snorkeling-feature-timeline
source: git main · 376 tags · docs/project/snorkeling-user-facing-features.md
---

七个月里改动集中在八个功能域：**Agent 工作流**和 **AI Sessions** 是贯穿全程的主线，2026-10 之后整体重心从「浏览器 / 查看器」转向「控制面 / 协作面」。

## A 全景与口径

```kv cols=2
上游基线: waveterm v0.14.5-beta.2（fork 起点 2026-04-17）
当前版本: 0.14.6-beta.0 · snorkeling 0.0.132（2026-11-19）
发布节奏: 132 个自发版 / 约 7 个月，约 0.6 版每天
数据口径: main 分支 3886 次提交 · 376 个 tag；2026-05 之后以实际提交为准，之前以用户功能文档为准
```

主里程碑只挑「换了一档」的时刻：

```timeline v
2026-04-17 | Fork 起点 | 基于上游 waveterm v0.14.5-beta.2 开出 snorkeling 线
*2026-04-19 | 0.0.1 首发 | 品牌与应用身份隔离：app id、图标、更新地址、README 多语言
2026-05-31 | 0.0.32–0.0.33 基础四件套 | Agent 入口 · AI Sessions 浏览 · Files 增强 · VCS 块
2026-07-24 | 0.0.60 Agent 运行态 | per-block cc-switch vendor 隔离 · agent-status 状态点 / ack / done-unread
2026-08-17 | 0.0.75 Provider 扩张 | OpenCode + Pi 解析与内置 profile · 独立 agent block · updater 硬化
2026-10-04 | 0.0.95 工作台化 | WYSIWYG 编辑器 · 定时任务 · AI 生成元数据 · VCS 三 Tab 面板
2026-10-22 | 0.0.100 Sessions 深水区 | 子代理树 · 批注时间线 + AI 审计 · 排序链 · 性能治理
2026-11-06 | 0.0.120 控制与看板 | CommonText 同步引擎 · Overview 看板 · 属性系统 · loop 昼夜台账
*2026-11-19 | 0.0.132 当前 | Persona / Hero 登场 · i18n 全量 · wavesrv 稳定性专项 · 定时任务 agent 化
```

## B 功能域地图

```tree list
Snorkeling 二次开发
  终端内工作流
    Agent 工作流 | 入口 · 上下文继承 · profile · 状态 · 控制面
    AI Sessions | 浏览 · 检索 · 批注 · 属性 · 恢复
    VCS 版本控制 | 三 Tab 面板 · 分支 · 提交图 · 远程跳转
  内容与数据
    CommonText 同步 | transport · 冲突 · 实时推送
    Persona / Hero | 人设数据 · 名册 · 登场 · 记忆
    属性与标签 | 属性 schema · 模板 · AI 生成
  文件面
    Files / Editor / Preview | 定向打开 · WYSIWYG · 图片灯箱
    Tab / 布局 / 主题 | inline tabs · 收起到更多 · 主题选择器
  底座
    稳定性 | wavesrv 内存 · 更新器 · wsh 安装 · fsmonitor
    i18n | 双进程 i18next · 全量迁移 · CI gate
    开发流程 | loop 昼夜台账 · verify 验证台 · Trellis 门链
```

## C 域 × 月份泳道矩阵（现有视图的近似）

单元格里是该阶段「第一次出现」的代表改动，不是全部；带 ✓ 的格表示这一格换过架构或口径。

| 功能域 | 04–05月（→0.0.40） | 06–07月（→0.0.60） | 08–09月（→0.0.95） | 10月（→0.0.110） | 11月（→0.0.132） |
|---|---|---|---|---|---|
| Agent 工作流 | 入口 · 上下文继承 · profile · resume | vendor 隔离 · 状态点 · ack | 独立 agent block · watchdog · 悬浮卡 | 内联编辑 · 属性 · AI 生成 · catalog ✓ | launch/send + MCP · 看板 · 控制面 ✓ |
| AI Sessions | Codex + Claude 浏览 / 恢复 ✓ | path 筛选 · 浅色强调 | OpenCode + Pi · 列表详情拆分 | 子代理树 · 批注 AI · 排序链 · 虚拟化 ✓ | 属性系统 · 渐进读取 · annotate 写入口 ✓ |
| CommonText / 同步 | — | compose 弹窗雏形 | compose 搜索 · 自动保存 | 贴图 · 持久草稿 | 三 transport · 冲突检测 · 实时推送 ✓ |
| VCS | VCS / History / Diff 三块 ✓ | — | 三 Tab 面板 · 多仓切换 · 分支管理 ✓ | inline tab 默认 · 图标化 | 泳道提交图 · 远程跳转 · fsmonitor 收口 |
| Files / Editor | 定向打开 · Copy Context · 搜索替换 ✓ | — | WYSIWYG M1–M7 · 图片灯箱 ✓ | 路径中枢 · Git 分支卡 · 跨 Tab 搜索 | 目录树 VCS 变动标记 |
| Tab / 布局 / 主题 | 品牌与图标 | 主题选择器 · inline tabs 引擎 ✓ | inline tab 锁定 · overflow 更多 | Notion 悬浮卡 · 浅色重做 | 收起到更多 · 空 Tab 引导 · reinitWave 减负 |
| Persona / Hero | — | — | — | — | 数据地基→名册→跨机同步→登场（全月） ✓ |
| 底座（稳定 / i18n / 流程） | 更新器 · 安装 | 隔离 dev 启动 | updater 手动安装 · Tailscale · 定时任务 | os-notify 去噪 | i18n P0–P3 · GOMEMLIMIT + respawn · loop 台账 ✓ |

## D Agent 工作流：从入口到控制面

```timeline v
2026-04 | 入口与上下文 | 右侧 Agent 入口；按终端 / Files 上下文智能启动；codex · claude · gemini · opencode 四档 profile
2026-05 | 会话自动续接 | Codex resume 与 Claude --resume 解析；会话 id 落块，重启后可续
*2026-07 | cc-switch 隔离 + 状态点 | 每块独立 Claude / Codex 配置目录；状态点跨 Tab 悬浮卡 / inline tab / 总览共用 ack
2026-08 | 独立 agent block | 专用块类型；watchdog 判 stale / error；Pi 与 OpenCode 进内置 profile
2026-09 | 悬浮卡上桌 | inline tabs 与 BlockBar 悬浮卡；live session model 异步富化
*2026-10 | 悬浮卡即编辑面 | Note / Tags / 属性就地编辑；emoji persona（provider / session / block 三档）；AI 生成 Note 与标签；agentcatalog 收敛为单一事实源
*2026-11 | 程序化控制面 | wsh agent launch / send + MCP；agentdata patch 管线（card get/set、--prop-add-option）；Overview 看板按状态分列
```

## E AI Sessions：从浏览器到工作台

```timeline v
2026-05 | 浏览器雏形 | 读 ~/.codex/sessions 与 ~/.claude/projects；搜索 / 来源筛选 / 大纲 / Note / mark / 删除 / 恢复
2026-08 | Provider 扩张 | OpenCode 走 SQLite 只读、Pi 走 JSONL v3 树；来源芯片与 Provider 标签同步
2026-09 | 拆分与实时 | 列表与详情拆成独立块；消息队列改 reactive priority store；live-turn 时间线
*2026-10 | 子代理与性能 | pi 子代理按磁盘布局分类折叠成树；详情虚拟化 + memo 链治理重影；批注时间线 + AI 生成 + AI 审计块；Filter Presets 与最多三键排序链
*2026-11 | 属性与写回 | Notion 式属性 P0–P3（含 scope 与模板）；origin 抽象层 + 跨机合并视图；渐进式读取 RPC（info / users / turns / turn）；session annotate 写入口（draft + hash 门禁）
```

## F 终端工作台三面：VCS · Files · Tab

```timeline v
2026-05 | 三块落地 | VCS / File History / File Diff；Files 定向打开（🧭 ←→↑↓）；Copy Context；编辑器搜索替换
2026-06 | inline tabs 引擎 | 布局树与瓦片核心类型先落地，后续所有 Tab 能力的地基
2026-07 | 主题体系 | App Theme 选择器（hover 预览）；黑白 monochrome 主题与 token 化
*2026-09 | 面板重设计 | VCS 三 Tab（changes / branches / history）+ 多仓切换 + 分支管理 UI + 统一进度卡；WYSIWYG 编辑器 M1–M7；overflow「更多」pill
2026-10 | 文件面收拢 | Files 悬浮窗升级为路径中枢；Files Card 显示 Git 分支与未提交变更；Search In Files 跨 Tab；浅色主题层次重做
*2026-11 | 收敛与提速 | Tab 收起到更多 / 收起并切走 → 主进程化跨 renderer 同步；新建空 Tab 引导；reinitWave 增量减负；VCS History 泳道提交图；目录树 VCS 变动标记
```

## G 数据与底座：同步 · Persona · 稳定性

```timeline v
2026-08 | 远程与更新硬化 | 手动安装进度 / 取消 / 重试；慢链路自适应上传超时；Windows wsh 自动安装硬化
2026-09 | 定时任务上线 | 后端调度服务 + 持久化；前端视图；headless agent runner 带历史
*2026-11 上旬 | CommonText 同步引擎 | folder / server / git 三 transport；冲突检测 → 携带双边内容复制给 AI → 写回解决；GUI 常驻引擎 + Sync now；WebSocket 实时推送
*2026-11 中旬 | Persona / Hero 系统 | pkg/persona + wsh CLI → AISessions 分组集成 → 两步创建向导 → 人设名册 Block persona:// → 跨机同步 v1 → journal 写入器 → 🎭 登场 widget
2026-11 中下旬 | i18n 与稳定性 | i18n P0–P3 全量迁移 + CI gate；wavesrv GOMEMLIMIT（默认 1GiB）+ crash respawn；fsmonitor 常驻泄漏收口；wsh mcp serve + Agent Access 面板
2026-11-20 | 定时任务 agent 化 | CLI / MCP 创建，headless 与建块双模式，启动补跑
```

## H 本页视图的不足与后续优化

```callout warn 现有组件能做的 vs 做不到的
**能做的**：`timeline` 单泳道里程碑、Markdown 表格近似「域 × 月」矩阵、`tree` 域地图。
**做不到**：真正的并行泳道（每域一条 swimlane、事件在共享时间轴上对齐）、时间轴缩放、单元格里点开事件详情。
所以 C 面板是「矩阵当泳道图」的临时替代：一行一域、一格一段，读得出节奏，看不出重叠。
```

后续可以按三条路走，成本从低到高：

1. **不改工具**：把 C 面板拆成「每域一条 timeline」的独立面板（本页 D–G 已经是这个形态），泳道感靠并排阅读。
2. **不改工具、换模板**：用 `canvas` 页 + `{x= y=}` 钉坐标，手工摆出真实泳道图并可拖拽；代价是时间轴靠目测，不能缩放。
3. **改工具**：给 answer-me-with-html 提一个 `timeline lanes`（或 `gantt`）组件。规格：每行一条泳道、支持同一时间轴的多个事件、支持点开事件、支持跨域对齐。这属于 D:\Apps\answer-me-with-html 的上游能力扩展，不在本仓库范围。
