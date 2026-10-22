# 执行计划：会话详情块单 Header 化

> 状态：**未启动**。方案拍板后执行 `python .trellis/scripts/task.py start .trellis/tasks/10-22-aisessions-detail-single-header` 才进入实现。
> 当前只完成方案设计与交互原型。
>
> **2026-10-22 决策记录：先记录在案，方案选择与是否实现留待后续决策。** 本文件保持未启动状态。

## 0. 前置（拍板前不做）

- [x] 根因定位：`frontend/app/block/block.scss:192` + `frontend/app/view/aisessions/session-detail.tsx:1163` 两条下边框相邻
- [x] 四方案对比与推荐（方案 A），记在 `design.md` §2
- [x] 交互原型 `design/prototypes/session-detail-block-header/index.html`（明暗主题 + 4 变体）
- [x] 答案页 `docs/answers/session-detail-block-双header美化方案-*.html`
- [ ] **用户拍板**：方案 A / B / C
- [ ] **用户拍板**：是否进入实现阶段

## 1. 拍板后第一批：开关与状态搬家

- [ ] `AiSessionsViewModel` 增加 `sessionListCollapsedAtom`（初值读 `aisessions:sessionlistcollapsed` meta）
- [ ] `AiSessionsViewModel` 增加 `renamingAtom` / `titleDraftAtom`
- [ ] `AiSessionsView` 改为读 `sessionListCollapsedAtom`（`aisessions.tsx:1120` 附近）
- [ ] `SessionDetailPane` 的 `renaming` / `titleDraft` 改为从 model atom 读写，行为不变
- [ ] 加回滚开关（view model 级常量或 `aisessions:singleheader` meta），默认开
- 验证：`pnpm vitest run frontend/app/view/aisessions` 全绿；界面上改名、展开列表行为与改动前一致

**回滚点 1**：只搬状态不改外观。开关关掉应与改动前完全一致。

## 2. 第二批：`viewText` 承载会话身份

- [ ] `AiSessionsViewModel` 增加 `viewText`（`jotai.atom<HeaderElem[]>`）
  - 详情块 / 列表收起态：返回 `[标题 text | 改名 input, div(来源 chip, 模型 chip)]`
  - 其他态：返回 `[]`
- [ ] 标题用 `HeaderText`（`onClick` 里用 `e.detail >= 2` 判双击），改名态用 `HeaderInput`
- [ ] chip 用 `HeaderElem` 的 `div` + `children`（`text` + class）
- [ ] 新增 `frontend/app/block/block.scss` 样式：`.block-frame-session-title`、`.block-frame-session-chip`
- 验证：`viewText` 产出的结构有单测；标题/双 chip 在块框头可见且常显

**回滚点 2**：只加 `viewText`，暂不隐藏面板头 → 会出现「块框头有标题 + 下面还有一条头」，但不影响功能。

## 3. 第三批：常显按钮进 `endIconButtons`

- [ ] `endIconButtons` 增加：搜索、星标、会话菜单（全部 `zone: "pinned"`）
- [ ] 会话菜单按 `design.md` §3.5 D1 的结论落地（推荐：`this.env.showContextMenu`）
- [ ] 搜索浮层开关状态能从 model 读到（`searchExpanded` 视情况搬进 model）
- [ ] 检查 `block.scss:632` 的自动刷新徽标宽度不与新按钮冲突
- 验证：5 个常显按钮都在；hover 才出现的放大/合并/块菜单行为不变

## 4. 第四批：隐藏详情块的面板头

- [ ] `session-detail.tsx:1163` 那一行在「单 Header 生效」时整行不渲染
- [ ] 列表展开并排态仍渲染面板头（`design.md` §3.5 D2 结论）
- [ ] 消息区顶部 padding 调整，去掉多出来的视觉缝隙
- 验证：详情块只有一条 Header；列表并排态与改动前一致

**回滚点 3**：关开关即可恢复双 Header。

## 5. 第五批：视觉打磨与验证

- [ ] 标题字号/字重定到 13px / 600（主文字色）
- [ ] chip 高度 22px、`rounded-full`、11px
- [ ] 需要时把该块的 `--header-height` 局部提到 36px
- [ ] 明暗主题各截一张图对比原型
- [ ] 窄块（300px）下标题 ellipsis、chip 不撑破

## 6. 收尾

- [ ] `node scripts/sync-audit/audit-sync.mjs` 或 `node docs/sync-audit/audit-sync.mjs` 无「镜像缺失」告警
- [ ] 更新 `design/prototypes/session-detail-block-header/README.md` 状态标记为 `●`
- [ ] 更新 `design/prototypes/__REVIEW_GUIDE__.md` 总表
- [ ] 本任务 `design.md` §3.5 的三个开口点结论回写
- [ ] `python .trellis/scripts/task.py finish` → `archive`

## 验证命令

```bash
# 单元测试（改动目录）
pnpm vitest run frontend/app/view/aisessions

# 类型 + lint（改动文件）
pnpm tsc --noEmit
pnpm eslint frontend/app/view/aisessions frontend/app/block/block.scss

# 视觉验证（应用需带 --remote-debugging-port=9222 启动）
node scripts/inspect-electron-ui.mjs screenshot
node scripts/inspect-electron-ui.mjs style "block-frame-session-title"
```

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| `viewText` 的 `iconbutton` / `menubutton` 默认隐藏（`block.scss:479`） | 中 | 常显按钮一律走 `endIconButtons` pinned 区 |
| 改名状态从组件搬到 model，改动面比看上去大 | 中 | 分两批做，先搬状态不改外观 |
| 会话菜单从自定义下拉变原生 context menu | 中 | 拍板时确认；备选走 `design.md` §3.5 D1 的第 3 条 |
| 窄块下标题 + 5 个常显按钮挤 | 低 | 标题 `min-width: 0` + ellipsis；必要时把刷新按钮收进 hover 区 |
| 列表并排态语义混乱 | 低 | 按 D2 结论：并排态不显示会话身份 |
