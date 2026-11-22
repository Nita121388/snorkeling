# Design：Overview 新建 Tab（两处入口 + 三选一）

> PRD：本任务 `prd.md`。UX：父任务 `ux-ascii.md` §④

## 1. 边界

纯前端，一个弹窗组件 + 两处入口 + 一个纯函数（选项 → 落库计划）。

后端零改动，用现成的：
- `WorkspaceService.CreateTab(workspaceId, tabName, activateTab=false)` → `tabId`
  （`pkg/service/workspaceservice/workspaceservice.go:157`；返回 id，所以不用 createTab 再查）
- `createAgentBlockDefForProfile(profile, settings, ctx)` + `ObjectService.CreateBlockInTab(tabId, def, opts, activateTargetTab=false, ...)`
  ——与 `overview-add-agent-modal.tsx` 同一链路（11-20 已验证）
- 不激活 Tab（`activateTab=false` / `activateTargetTab=false`），用户留在 Overview。

## 2. 纯函数契约 `overview-new-tab.ts`

```ts
export type NewTabKind = "empty" | "agent" | "template";

export interface NewTabPlan {
    ok: boolean;
    kind: NewTabKind;
    name: string;          // 空名回落 "新 Tab"（i18n 文案由调用方传入 fallbackName）
    addAgent: boolean;
    error: "template-unsupported" | null;
}

export function planNewTab(args: {
    kind: NewTabKind;
    name: string;
    fallbackName: string;
}): NewTabPlan
```

规则：
- `template` → `{ok:false, error:"template-unsupported"}`（本轮占位，按钮本来就 disabled，
  函数兜底防误调用）。
- 名称 trim 后为空 → `fallbackName`。
- 名称不做唯一性校验（PRD 不做项）。

单测 ≥5：empty / agent / template 拒绝 / 空名回落 / 名称 trim。

## 3. 组件 `overview-new-tab-modal.tsx`

- 受控：`open` / `onCancel` / `onCreated(tabId, kind)`。
- 内容：名称输入（自动聚焦）+ 三个 radio（空 Tab / 空 Tab + Agent / 从模板…[disabled]）+ 取消/创建。
- 键盘：`Esc` 取消（capture 阶段，避免被全局 keymodel 吃掉）、`Enter` 创建。
- 创建流程：
  1. `planNewTab` 校验；
  2. `workspace.CreateTab(workspaceId, plan.name, false)` → `tabId`；
  3. `addAgent` 时 `CreateBlockInTab(tabId, agentBlockDef, runtimeOpts, false, false)`；
  4. `onCreated(tabId, kind)`（父层负责插入组行 + 收起弹窗）。
- 失败：弹窗内一行 `⚠ <code> <msg>` + 重试（保持弹窗不关，草稿不丢）。
- 样式复用现有 `DialogShell`（11-02 规范）而非自造 modal 壳。

## 4. 入口

- **工具栏**：`SessionOverviewPanel` 的 filter 组后面加一枚 `＋ 新建 Tab`（`data-overview-new-tab="toolbar"`）。
- **组列表尾部**：`TabGroupSection` 列表末尾一行人形按钮（`data-overview-new-tab="tail"`）。
- 两处都 `setNewTabOpen(true)`；创建成功后 `refreshSeqAtom` 自增（组渲染会带出新组）。

## 5. 数据一致性

- 新 Tab 组出现依赖 `workspace.tabids` 变化 → `useOverviewBlocks`/`buildTabGroups` 已按
  `tabIdsKey` memo，`CreateTab` 返回的 update events 会推进 workspace 版本，无需手工插入。
  （若真机上不刷新，退路是 `refreshSeqAtom` 自增；不额外造本地假组。）
- 不抢焦点：`activateTab=false`。

## 6. i18n

`panel.newTab`「新建 Tab」/ `newTab.title`「新建 Tab」/ `newTab.nameLabel`「名称」/
`newTab.kindEmpty`「空 Tab」/ `newTab.kindAgent`「空 Tab + Agent」/ `newTab.kindTemplate`「从模板…」/
`newTab.templateSoon`「即将支持」/ `newTab.create`「创建」/ `newTab.cancel`「取消」/ `newTab.failed`「创建失败」。

## 7. 回滚

新组件 + 两处入口 + 纯函数；revert 单 commit 即回滚。
