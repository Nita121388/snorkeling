# 执行计划：收起激活 Tab

前置：`prd.md`（G1 已由用户 2026-11-18 会话确认）、`design.md` 已落。
loop 包：`F-1118-tab-collapse-active`（feature，G1 已签）。

## 顺序清单

- [x] 1. 测试先行（红证采集）
  - `frontend/app/tab/tabcontextmenu.test.ts` 按新契约改写：
    - 激活 Tab + switchTarget 可点，click → `setActiveTab(target)` **先于** `collapseTabIds`
    - 激活 Tab + switchTarget 为 null → 置灰 `collapseToMoreLastTabDisabled`
    - 未阅点 → 仍置灰（不变）
    - 非激活 → 可点且不切
    - 无 visibility → 可点（兼容）
  - `frontend/app/tab/tab-more-model.test.ts` 新增 `pickCollapseSwitchTarget` 用例
  - 运行：`npx vitest run frontend/app/tab/tabcontextmenu.test.ts frontend/app/tab/tab-more-model.test.ts`
  - **预期：新用例红** → 输出存 `loop/red/F-1118-tab-collapse-active.txt`
- [x] 2. 实现
  - `tab-more-model.ts`：新增 `pickCollapseSwitchTarget`
  - `tabcontextmenu.ts`：`TabContextMenuVisibility` 增 `switchTargetTabId`；去掉 active 置灰分支；click 先切后收
  - `tab.tsx`：`TabEnv.electron` 增 `setActiveTab`；`TabV`/`Tab` props 增 `collapseSwitchTarget?: string | null` 传入菜单
  - `tabbar.tsx`：计算目标下传（仅激活 Tab 需要）
  - `vtabbar.tsx`：`VTabBar` 计算目标、`VTabWrapper` 接收下传
  - i18n：en/zh `collapseToMoreActiveDisabled` → `collapseToMoreLastTabDisabled`
- [x] 3. 绿证 + 全量回归
  - `npx vitest run frontend/app/tab/tabcontextmenu.test.ts frontend/app/tab/tab-more-model.test.ts` → 全绿
  - `npx vitest run frontend/app/tab/`（Tab 族回归）
  - `npm run i18n:check`
  - tsc / lint 按仓库脚本（改动文件为准）
- [x] 4. loop 台账（主 agent 专属）
  - `queue add`（若引擎侧未入库）→ `gate --id F-1118 --gate g1 --by chemclin`（G1 会话确认）
  - `run --id F-1118-tab-collapse-active --dry-run` 门检 → `--emit-pick`
  - `prove --id F-1118-tab-collapse-active` 判据数字
  - G5 合规跑 `verify` 相关检查
- [x] 5. commit（白名单内文件）
- [x] 6. G7 停泊等人工验收（真机走查四件事：激活可收 / 先切后收 / 仅剩一 Tab 置灰 / 未阅仍置灰）

## 验证命令

```bash
npx vitest run frontend/app/tab/tabcontextmenu.test.ts frontend/app/tab/tab-more-model.test.ts
npm run i18n:check
```

## 回滚点

- 单 commit 回退即可；状态无迁移。

## 执行记录（2026-11-18）

- 1 红证：base 0789f225e，`8 failed | 29 passed` → `loop/red/F-1118-tab-collapse-active.txt`
- 2 实现：`tab-more-model.ts`(pickCollapseSwitchTarget) / `tabcontextmenu.ts`(enabled + 先切后收) /
  `tab.tsx`(TabEnv.setActiveTab + prop) / `tabbar.tsx` / `vtabbar.tsx` / i18n 双语 key 替换
- 3 绿证：目标套 `37 passed`；Tab 族 `113 passed`；`i18n:check` parity diff 0；
  tsc 当前 55 条全为既有文件（本包改动文件 0 条）
- 4 台账：G1/G2/G5 已签，pick 已落，prove ok
- 6 **G7 真机走查 skipped**：用户 2026-11-18 明确指示"不需要真机验证，本机性能不够"，
  未起任何 Electron 实例；验收证据仅单测 + 静态检查
