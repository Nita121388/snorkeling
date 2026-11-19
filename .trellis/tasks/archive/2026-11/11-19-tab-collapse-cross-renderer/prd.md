# Tab 收起到更多：跨 renderer 状态同步修复

## Goal

「收起到更多」（右键菜单 / 「更多」下拉的收起动作）目前只对当前激活 Tab 的 renderer 生效：
切到别的 Tab 后，被折叠的 Tab 又重新出现在主栏。原因是 `collapsedTabIdsAtom` 是纯
renderer 侧 jotai 状态，而 Snorkeling 每个 Tab 是独立 `WebContentsView`（独立 renderer 进程），
Tab 栏在各 renderer 各渲染一份，collapsed 集合互不相通。

修复：把 collapsed 集合搬到 emain 主进程，renderer 侧 atom 改为「本地乐观写 + IPC 广播同步」，
对齐 `openedThisLaunchTabIds` 的既有模式，保证所有 Tab 栏视图一致。

## Requirements

1. collapsed 集合的真源（source of truth）在 emain 主进程内存（重启即失效，沿用现状语义，不持久化）。
2. `collapseTabIds` / `expandCollapsedTabId` / `clearCollapsedTabIds` / `collapsedTabIdsAtom`
   的模块导出签名不变（tabbar / vtabbar / tab-more-menu / tabcontextmenu / tab-open-state 调用点零改动）。
3. 任一 renderer 发起收起/展开后，主进程向所有已加载 tabView 广播，各 renderer 的
   `collapsedTabIdsAtom` 同步更新 —— 任意 Tab 栏视图一致。
4. 「真正打开 Tab」（main 侧 `markTabOpenedThisLaunch`）同时把该 tab 从 collapsed 集合移除
   并广播（保持现有「从更多下拉点开 → 主栏重新露出」语义）。
5. 新建/复用 Tab renderer 初始化时能读到当前 collapsed 集合（atom 初始值同步读 + wave-init 重初始化时推送）。
6. preview mock（`preview-electron-api.ts`）与 `ElectronApi` 类型同步补齐。

## Acceptance Criteria

- [ ] 真机（或验证台）：Tab A 激活时右键「收起到更多」收起 Tab B → 切到 Tab C，
      Tab B 仍不在主栏、只在「更多」下拉且置灰；切回 A 同样。
      **状态：按用户指示（2026-11-19）跳过真机验证；验证台已建好
      `scripts/verify/tab-collapse-cross-renderer/verify.mjs`（判据 7 条），待环境可用时跑**
- [ ] 「更多」下拉点开被折叠 Tab → 主栏重新露出（原有语义不回归）。
      同上由验证台判据 6 覆盖，未跑；主进程侧语义已由单测锁定
- [x] 单测：`tab-collapse-state` 写函数经 mock api 调用 IPC（collapse/expand/clear 三向），
      广播回调更新 atom；`npx vitest run frontend/app/tab/` → 9 文件 114 例全绿
      （含既有 tabcontextmenu.test.ts / tab-more-model.test.ts）
- [x] typecheck：改动未新增错误（树内 55 个错误均为 baseline 预存，基线 57）；
      eslint 对本包 7 个改动文件 0 error（仅 wave.ts 预存 prefer-const warning 1 条）
- [x] 重启后 collapsed 集合清空：真源在 emain 内存 Set，不持久化（代码层面保证，未真机复验）

## Out of Scope

- collapsed 集合跨重启持久化（重启即失效是既定语义，本包不改）。
- 「收起未使用的 Tab」批量语义变化。
- openedThisLaunchTabIds 相关行为调整。
