---
id: N-1119-hero-header-dup-emoji
title: "Hero Block Header 去重：保留左上 emoji，胶囊 Hero 名去掉 emoji"
type: fix-small
priority: P2
severity: S3
status: open
origin: self
source: "nita 2026-11-19 确认：保留 agent Block 左上角 emoji，胶囊内 Hero 名前缀 emoji 去掉"
task: 11-18-hero-block-header-display
order: 100
touch: [frontend/app/workspace/hero-launch.ts, frontend/app/workspace/hero-launch.test.ts, frontend/app/block/block-title.ts, frontend/app/block/block-title.test.ts, frontend/app/view/term/term-model.ts, frontend/app/view/term/term-header-emoji-only.test.ts, docs/project/hero-system.md, docs/project/verify-ledger.md, loop/**]
rollback: null
budget: {minutes: 45, retries: 2}
releaseCandidate: false
createdAt: "2026-11-19T05:31:38Z"
feature: hero-identity
---

# Hero Block Header 去重：保留左上 emoji，胶囊 Hero 名去掉 emoji

## 背景

Hero 登场时同一个 emoji 写进 agent:emoji 与 hero:name，导致 Block header 出现两次。新块只写纯名字；老块读取时剥离与 agent:emoji 相同的前缀。

## 来源

- self：nita 2026-11-19 确认：保留 agent Block 左上角 emoji，胶囊内 Hero 名前缀 emoji 去掉

## 验收判据

- [x] `npx vitest run frontend/app/workspace/hero-launch.test.ts frontend/app/block/block-title.test.ts frontend/app/view/term/term-header-emoji-only.test.ts --reporter=basic && echo HERO_HEADER_EMOJI_PASS` → `HERO_HEADER_EMOJI_PASS`

## 记录

- 红证：`loop/red/N-1119-hero-header-dup-emoji.txt` → 3 files failed / 4 tests failed / 32 passed。
- 绿证：`queue prove` → `HERO_HEADER_EMOJI_PASS`，3 files passed / 36 tests passed。
- 真机验证：用户 2026-11-19 明确指示本机性能差，暂不做；机器判据覆盖新块、老块与 header 接线。
- 影响面：`heroRosterLabel` 仅剩 hero-launch.ts 自身调用；`heroHeaderName` 调用方为 block.tsx 与 term-model.ts；`buildHeroLaunchBlockDef` 调用方为 hero-launch-window.tsx。均为低风险。
- 影响分析 caveat：GitNexus 索引 stale（2026-10-22），CLI impact 找不到这三个新符号；`detect-changes` 因此把 `TermViewModel.constructor` 判 HIGH。实际 diff 只改 header 文案接线，36/36 单测绿。
