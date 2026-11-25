---
id: sync-transports
title: 三 Transport 与基线选择
module: commontext
parent: commontext-suite
status: shipped
introduced: 2026-11-08
releases: []
---

folder/server/git transport 与 local/remote wins。

证据：
- commit: feat(sync): git transport（自有克隆 + 非交互硬化 + 无变更不提交）（2026-11-08）
- commit: feat(sync): 切换 transport 的基线选择（local wins / remote wins）（2026-11-08）
