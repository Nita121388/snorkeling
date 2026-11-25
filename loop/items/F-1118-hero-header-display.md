---
id: F-1118-hero-header-display
title: "Hero Block Header 显示 Hero 名而非据点哈希路径"
type: bug
priority: P2
severity: S3
solution: fixed
status: accepted
origin: self
source: "nita 2026-11-18 报：打开的 Hero，Agent Block Header 显示目录名 E:/primary/heros/hero-feaa3f86 不友好（哈希后缀 + 混合分隔符，看不出是哪个 Hero）"
task: 11-18-hero-block-header-display
feature: hero-identity
order: 100
touch: [frontend/app/workspace/hero-launch.ts, frontend/app/workspace/hero-launch.test.ts, frontend/app/view/term/term-model.ts, frontend/app/view/term/, frontend/app/block/block.tsx, frontend/app/block/, frontend/util/util.ts, frontend/i18n/**, docs/project/verify-ledger.md, .trellis/tasks/11-18-hero-block-header-display/**, .trellis/spec/**, loop/**]
rollback: null
budget: {minutes: 60, retries: 2}
releaseCandidate: false
score: {value: 5, by: nita, at: "2026-11-25T03:47:02Z", note: null}
createdAt: "2026-11-18T03:45:29Z"
---

# Hero Block Header 显示 Hero 名而非据点哈希路径

## 背景

Hero 登场块的 Agent Block Header 三处显示据点目录（basename(cmd:cwd) = hero-<hash8>）：block.tsx defaultTitle、term-model buildCmdCwdHeaderElem、block.tsx fullPath tooltip。磁盘不变量（ValidateID 目录名==id）不动，只改显示层：启动时写 meta hero:name / display:name，Header 优先显示 emoji+name，完整路径退到 tooltip 与点击复制。

## 来源

- self：nita 2026-11-18 报：打开的 Hero，Agent Block Header 显示目录名 E:/primary/heros/hero-feaa3f86 不友好（哈希后缀 + 混合分隔符，看不出是哪个 Hero）

## 验收判据

- [ ] `npx vitest run frontend/app/workspace/hero-launch.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/view/term/` → `passed`
- [ ] `npx vitest run frontend/app/block/` → `passed`
- [ ] `npm run i18n:check` → `pass`

## 记录

_（待补）_
