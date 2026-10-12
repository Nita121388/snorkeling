# Block Editor 最终目标（摘要版）

> 权威全文（含展开细节）：Obsidian `My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/10-最终目标与路线图.md`
> 展开方案：同目录 `08-全块类型对标Wolai-实现方案.md`（55 行全块类型矩阵）；抽离评估：`09-*.md`

## 一句话目标
让 Snorkeling 里的 markdown 笔记拥有 **Wolai 级别的块编辑体验**，但坚持**文件优先**：写的是普通 markdown 文件，不牺牲与 Obsidian / git / 其他工具的兼容，且**编辑时看到的样子就是它真实的样子**。

## 三条第一原则
- **R1 尽量 1:1 对标 Wolai**（除「本地文件 / Obsidian 兼容」降级外）
- **R2 不改主题色**（只取既有 token；禁止新增颜色字面量、禁止悬空 token）
- **R3 编辑态 ≡ 预览态（零差异）**（唯一允许 delta：caret / selection / hover 可供性；由机制 + 测试保证）

## 五条质量红线
1. 每个块类型配完整 UI 测试（渲染 / 编辑 / 往返 / 样式四类）
2. 零差异可验证（同块两态 computed style 逐项比对）
3. 数据安全零回归（写盘守卫、结构操作可逆、真实语料往返可解释）
4. 不改主题与视觉语言
5. 产品 + 资深开发评审双 ≥90 分

## 战略目标：抽离为独立库
```
packages/md-core     纯逻辑（transform / block-model / remark / render / host adapter）
packages/md-react    React 绑定（渲染器、InlineEditOverlay、slash/块菜单/拖拽）
packages/md-schema   对外契约（块类型、sanitize schema、序列化白名单）
```
- `md-core` 能独立构建/测试、**零 `@/` 宿主依赖**（门禁测试锁死）
- 借鉴 Milkdown 的**工程形态**（headless core + 绑定分层 + 插件契约 + playground）；**不采用其内核**（事实源是内存 doc，实测 17/17 文件往返被改写、Obsidian 嵌入图全灭）

## 差异化
- 比 Wolai：资产是本地 markdown，Obsidian 兼容、git 友好、无锁定
- 比 Milkdown / 思源：他们以内存文档树为事实源；我们在**保住原文件语义**的前提下做到所见即所得
- 比三者：编辑态 ≡ 预览态是**硬门禁**，不是口号

## 明确不做
跨块多选；10 类结构性不可表达块（数据表格/同步块/分栏/按钮/提及/面包屑/书签卡片/第三方嵌入）只做降级（只读或 HTML 兜底，不报错不丢内容）；**不做源码模式编辑入口**。

## 路线图
| 阶段 | 状态 |
|---|---|
| P0–P3（渲染器拆分 / 编辑历史 / block-model / 交互质感） | ✅ |
| step1 止血 · step1b（空根防线 + callout 一等块） | ✅ |
| step2 列表结构自持 + 规范化 | ✅ |
| step3 块身份 + 提交定位 + 逆操作记账 | ✅ |
| step4 结构操作统一意图 + 删除/复制/重排 | ✅ |
| 抽离 P0（解反向依赖 + 宿主注入 + 边界门禁） | ✅ |
| 抽离 P1 物理抽包 `packages/md-core` | 🔄 |
| parity 地基（零差异机制 + 契约测试 + CDP 脚本 + token 修复） | 📋 子任务 1 |
| 逐块覆盖（图片 → 脚注/数学 → 交互层 → 表格 → 代码 → 其余） | 📋 子任务 2–7 |
| 抽离 P2（`md-react` / `md-schema` + playground） | 📋 |
