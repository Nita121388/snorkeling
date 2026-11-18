> **Confirmed: 2026-11-18 @nita**

# Tab 收起激活 Tab：收起并切走

> N-1117 的语义修订。原实现把「激活 Tab」也置灰，但用户的真实诉求是
> "这个 Tab 我暂时不用了，收起来去看别的"——激活恰恰是最常被收起的那一个。

## Goal

右键「收起到更多」对**激活 Tab** 从「置灰禁点」改为「**收起并切走**」：

1. 点击激活 Tab 的「收起到更多」→ 先切换到相邻 Tab（右邻优先，其次左邻），
   再把原 Tab 交给 `collapseTabIds`，落入「更多」下拉（置灰行）。
2. 切换目标必须是主栏当前可见的 Tab（不切进下拉里藏着的地方）；目标自身与
   有未阅点的 Tab 不作为切换目标。
3. 工作区只剩这一个 Tab 时（无邻可切）置灰，禁用说明为「至少保留一个 Tab」。
4. **有未阅状态点的 Tab 仍置灰禁点**（未阅优先于收起，收了用户就发现不了新结果）。
5. 非激活且无未阅的 Tab 行为不变。

## 背景

`isTabHiddenFromBar` 的优先级是 激活 > 未阅 > 手动收起 > 本次启动是否打开过。
原实现因此认为"收起激活 Tab 点了也不生效"而置灰。但激活 Tab 本来就不在"折叠"
语义下——正确解法是收起时先切走激活态，优先级自然成立。未读例外保留：
那是"必须被看见"的信号。

## 不做什么

- 不改「更多」下拉的行模型 / 置灰口径（`tab-more-model.ts` 的现有判定不动，
  仅新增切换目标纯函数）。
- 不改键盘 Tab 切换（`keymodel.ts`）与拖拽切换逻辑。
- 不引入"取消收起"之外的任何新交互；从下拉点被收起的 Tab 仍按现行逻辑
  激活并解除收起。

## 关键决策（用户 2026-11-18 会话确认 = G1）

| 决策点 | 结论 |
|---|---|
| 收起激活 Tab | 允许；语义 = 切到相邻 Tab + 收起原 Tab |
| 相邻目标 | 右邻优先，无右邻取左邻；跳过主栏不可见（隐藏/已收起/未打开过）的 Tab |
| 只剩一个 Tab | 置灰：「至少保留一个 Tab」 |
| 有未阅点的 Tab | 保持置灰禁点（原禁用说明不变） |
| 切换动作 | `setActiveTab(target)` 先于 `collapseTabIds([id])`，避免出现"激活 Tab 不在栏上"的中间帧 |

## 交付范围

| 文件 | 改动 |
|---|---|
| `frontend/app/tab/tab-more-model.ts` | 新增纯函数 `pickCollapseSwitchTarget(tabIds, targetTabId, ctx)` |
| `frontend/app/tab/tabcontextmenu.ts` | `visibility` 增 `switchTargetTabId`；去掉 active 置灰分支；click 先切后收；新增仅剩一 Tab 的置灰 |
| `frontend/app/tab/tab.tsx` | `TabEnv.electron` 增 `setActiveTab`；`Tab` 组件接收并传 `switchTargetTabId` |
| `frontend/app/tab/tabbar.tsx` | 调用点解析切换目标并下传 |
| `frontend/app/tab/vtabbar.tsx` | 同上（VTabBar 解析、VTabWrapper 接收） |
| `frontend/app/tab/tabcontextmenu.test.ts` | 契约测试修订：激活可收 + 先切后收、仅剩一 Tab 置灰、未阅仍置灰 |
| `frontend/app/tab/tab-more-model.test.ts` | `pickCollapseSwitchTarget` 纯函数单测 |
| `frontend/i18n/locales/{en,zh}/tab.json` | `collapseToMoreActiveDisabled` → `collapseToMoreLastTabDisabled`（双语） |

## 验收判据

- [ ] `npx vitest run frontend/app/tab/tabcontextmenu.test.ts` → 全绿（新契约）
- [ ] `npx vitest run frontend/app/tab/tab-more-model.test.ts` → 全绿（新增用例）
- [ ] `npm run i18n:check` → 通过（key 双语一致）
- [ ] 红证：新测试在实现前对当前代码实测转红，存 `loop/red/F-1118-tab-collapse-active.txt`
- [ ] G7 人验收（真机）：右键激活 Tab → 可点；点击后切换到右邻且原 Tab 出现在「更多」置灰；
      仅剩一个 Tab 时置灰；有未阅点的 Tab 置灰
