---
id: N-1117-tab-collapse-to-more
title: "Tab 右键菜单「收起到更多」+ 激活/未读 Tab 置灰"
type: feature
priority: P2
severity: S3
status: open
origin: internal
source: "回填包（2026-11-17）：代码先落地 commit f44ec0942，未建包未进账；本文件补建。红证后补（回退 tabcontextmenu.ts/vtabbar.tsx/tab.tsx 跑同套测试 5 failed）。"
task: 11-17-tab-collapse-to-more
order: 100
touch: [frontend/app/tab/tabcontextmenu.ts, frontend/app/tab/tabcontextmenu.test.ts, frontend/app/tab/vtabbar.tsx, frontend/app/tab/tab.tsx, frontend/i18n/locales/en/tab.json, frontend/i18n/locales/zh/tab.json, scripts/verify/**, docs/project/verify-ledger.md, .trellis/tasks/**, .trellis/spec/**, loop/**]
rollback: "git revert f44ec0942；新增菜单项为纯增量，collapseTabIds 状态与「更多」下拉共用不变，无数据迁移"
budget: {minutes: 60, retries: 1}
releaseCandidate: false
createdAt: "2026-11-17T10:30:00Z"
feature: tab-system
---

# Tab 右键菜单「收起到更多」+ 激活/未读 Tab 置灰

## 背景

「更多」下拉是溢出 Tab 的收纳器，`collapseTabIds` 是驱动它的单一状态；此前没有"主动把某个 Tab 收进去"的入口。
语义陷阱：激活 Tab 与有未阅状态点的 Tab 在 `isTabHiddenFromBar` 里是高优先级常驻，收起会被立刻放回来 ——
所以这两类必须 **置灰**（带禁用说明）而不是允许点击后静默无效。

## 来源

- internal：回填包。代码已在 `f44ec0942`（2026-11-17 13:03 +0800）落地，任务与 loop 包后补。
- 关联：`N-1114-tab-restore-all-r3` / `N-1105-tab-hover-clip` 同属 Tab 栏族，但本包只动右键菜单，不重叠。

## 验收判据

- [ ] `npx vitest run frontend/app/tab/tabcontextmenu.test.ts` → `5/5`（红证见 `loop/red/N-1117-tab-collapse-to-more.txt`，5 failed）
- [ ] `npm run i18n:check` → `i18n ok`
- [ ] `npm run verify` 或 `node scripts/verify/index.mjs --area vtab`（环境恢复后补跑；本机 Electron dev init 3-4 分钟，同 L-0006c）

## 记录

- 2026-11-17：补建包（原代码提交 `f44ec0942` 未进账）。红证本机补造：临时回退 `tabcontextmenu.ts` /
  `vtabbar.tsx` / `tab.tsx` 到 `f44ec0942^`，同套 5 例全 FAIL，还原后 5/5 passed；红证存
  `loop/red/N-1117-tab-collapse-to-more.txt`。
- 2026-11-17：G1（需求签字）/ G2（红证入库）/ G5（合规）**待引擎侧处理**——本机 queue.mjs 不可用
  （`E:/primary/projects/loop`），见 `loop/INBOX.md` 欠账行。G7 人验收待真机走查三件事（见任务 prd）。
