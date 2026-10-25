# PRD: 前端 gen-store 与一键生成入口 + titleSource 视觉区分

## 背景（已核查）

- agent card 的两个按钮在 `frontend/app/element/info-card/session-note-section.tsx`，
  走 `state.generateTitle()` / `state.generateMetadata()`（`frontend/app/store/session-note-hook.ts:322/279`），
  是**阻塞提案**：`await GenerateTitle` → 建议面板 → Apply。
- 共享 hook `useSessionNoteState` 被 `AgentHoverCard`、`SessionDetailInfoCard` 共用。
- 事件消费已有：`session-note-cache.ts` 订阅 `aisessions:titleupdated` 并 merge title；
  `aisessions.tsx:1633` / `agent.tsx:698` 订阅 DOM 事件 `aisession-note-updated` → `model.replaceSession`。
- `titleSource` 已到前端（`gotypes.d.ts:2325`），零渲染。
- 列表行动作区：`session-row.tsx` L600 附近（Star / Resume / Copy 同排）。
- Detail 头栏动作区：`session-detail.tsx` L1403 附近（Search / Star / `···`）。
- 批量栏：`session-batch-bar.tsx`，已有 `onCopy/onStar/onClear` 契约。
- 配置可用性判断已有：`resolveMetadataAIMode()`（`frontend/app/view/term/agent-ai-config.ts`）。
- 打开设置入口已有写法：`createBlock({ meta: { view: "waveconfig", file: "waveai.json" } }, false, true)`。

## 目标

1. 新增 `aisession-gen-store`：订阅 `aisessions:generationstatus`，提供按 (connection, key, kind) 的状态查询。
2. 新增 `GenActionButton`：三态图标（idle/queued-running/failed/done）、前置配置校验、Retry。
3. 五个入口接入：agent card（**改造，删阻塞提案**）、列表行、Detail 头栏、`SessionMoreMenu`、批量栏。
4. Note 静默覆盖配 Undo toast（10s，CAS 校验）。
5. `titleSource === "ai"` 在列表行 / Detail 头栏 / Tab 标签显示小魔杖图标 + tooltip。
6. `titleSource === "user"` 的会话：按钮点击走确认（一次），`force=true` 才入队。

## 非目标

- 不做生成历史列表 / 任务队列面板。
- 不改 InfoCard 的 note 预览、tags chips、保存状态逻辑（除按钮区）。
- 不改批量栏已有的复制 / Star 行为。
- 不做 Undo 的跨会话 / 持久化（toast 级即可）。

## 约束

- 请求路径 `resolveMetadataAIMode()` 本地读，不阻塞；RPC 立即返回。
- 事件风暴下前端渲染不得卡：store 按 key 合并 + `done` 3s 回落 + 批量栏聚合计数。
- 远端必须带 `connection`；本地为空串。
- 不新增全局轮询（纯事件驱动）。

## 用户故事

1. 我在 agent card 点 wand，卡片不闪不弹，几秒后标题变了。
2. 我在列表 hover 一行点 wand，选 "Title"，那行标题旁边转圈，完成后图标变勾。
3. 我批量选 12 条点 `AI title`，栏上显示 `3/12 done`，失败的那几条行内标红，我能单独重试。
4. 我手改过标题的会话，点生成弹一次"覆盖自定义标题？"，我取消就什么都不发生。
5. 我的长 note 被 AI 覆盖，底部出现 10 秒 Undo，我点一下就恢复原 note+tags。

## 验收标准

- [ ] agent card 点击后 200ms 内无 `await` 阻塞（代码审查 + 手动体感）。
- [ ] `generationstatus` 事件驱动按钮三态切换；失败终态可 Retry。
- [ ] `titleSource=user` 未确认不入队；确认后 `force=true` 入队。
- [ ] `ids.length > 50` 前端直接提示，不发 RPC。
- [ ] note 覆盖后 Undo toast 出现；10s 后自动消失；Undo 后 note/tags 恢复且 UI 同步。
- [ ] `titleSource === "ai"` 的标题在三处显示小魔杖图标，hover tooltip 为 `AI-generated title`。
- [ ] 模型未配置时点击不发 RPC，显示引导 + 打开设置入口。
- [ ] `npx tsc --noEmit` 无新增错误；`npx vitest run frontend/app/store frontend/app/view/aisessions frontend/app/element/info-card` 通过。
- [ ] 远端场景状态不串台（store key 含 connection）。
