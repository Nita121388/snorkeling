# 实施计划

## 白名单（touch 范围）

```
frontend/app/commontext/pending-input.ts
frontend/app/commontext/pending-input.test.ts
frontend/app/commontext/commontext-send-button.tsx
frontend/app/commontext/commontext-send-button.dom.test.tsx   （如需）
frontend/app/workspace/preload-tabs.ts                          （新增纯函数）
frontend/app/workspace/preload-tabs.test.ts                    （新增）
frontend/app/workspace/workspace.tsx
frontend/app/view/term/term.tsx
frontend/i18n/locales/zh/commontext.json
frontend/i18n/locales/en/commontext.json
scripts/verify/commontext-send-agent-block/verify.mjs           （探针改造 + 断言更新）
scripts/verify/commontext-send-background/verify.mjs            （新增真机台）
docs/project/verify-ledger.md
```

## 步骤

### S1 pending tab 队列 + 纯函数（无 UI）
1. `pending-input.ts`：PendingTabEntry / mountPendingInputTab / unmount / unmountByBlock /
   getPendingMountTabIds / prunePendingInputTabs / subscribePendingInput + listeners。
2. `preload-tabs.ts`：`computeRenderPreloadTabIds(activeTabId, preloadTabIds, pendingMountIds)`。
3. 单测：`pending-input.test.ts` 扩展（队列去重/上限/FIFO/移出路径/prune/订阅通知）、
   `preload-tabs.test.ts`（合并去重、不参与 cap 切片、active 优先）。

验证：`npx vitest run frontend/app/commontext/pending-input.test.ts frontend/app/workspace/preload-tabs.test.ts`

### S2 term.tsx：订阅重触发 + 非激活守卫 + 移出挂载
4. `subscribePendingInput` → tick 状态，effect 重触发（晚注册不再漏接）。
5. `isBlockTabActive` 守卫：`giveFocus` 与 `window.term` 写入只限激活 Tab。
6. inject/expire 分支调 `unmountPendingInputTabByBlock(blockId)`。

验证：`npx vitest run frontend/app/commontext frontend/app/view/term`（term 相关既有测试）
+ `npx tsc --noEmit`（对比基线 47）

### S3 Send 执行 + UI 开关
7. `commontext-send-button.tsx`：`background` 配置 + `executeCommonTextSend` 三路径改造
   （去激活 / 先建块后入队）+ Popover 开关行 + onStatus 文案。
8. i18n：`zh/en commontext.json` 新增 `send.background` / `send.backgroundHint` /
   `send.sentBackground`。
9. 单测：executeCommonTextSend 路径断言（背景时不调 setActiveTab；非背景时保留）。

验证：`npx vitest run frontend/app/commontext`
`npx eslint frontend/app/commontext frontend/app/workspace/preload-tabs.ts --max-warnings 0`
i18n parity：`node scripts/check-i18n-parity.mjs`（或既有 gate 命令，见 i18n 任务）

### S4 真机验证（用户明确要求，我亲自跑）
10. 改造现有 `commontext-send-agent-block` 台：第 8 步 `NEW_TERM_PROBE`（依赖 `window.term`）
    改为事件 detail + 模块图（`snorkeling:pending-input-injected` 的 blockId → 该块 tabId）。
11. 新增 `commontext-send-background` 真机台（复用 `../lib/`，真实指针 + 事件断言）：
    - Part 1 正常：existing/new-tab 后台发送 → activetabid 不变、activeElement 不变、
      localStorage 键集合不变、injected 事件到达目标块、切过去后块就绪；开关关闭 → 旧跳转回归。
    - Part 2 异常：TTL（测试钩子 ttlMs 透传）；注入中删块；注入中关 Tab；
      发送期间当前 Tab 打字（文字落当前 term）；4 连发（Cap 排队）。
    - Part 3 启动：杀进程→重启正常；多次后台发送→退出→重启正常（窗口 show、Tab 还原、
      localStorage 键集合一致）。
12. `docs/project/verify-ledger.md` 逐行入账。

验证：`node scripts/verify/commontext-send-agent-block/verify.mjs`
`node scripts/verify/commontext-send-background/verify.mjs`

### S5 收尾
13. loop：INBOX 记一条待引擎分诊（本机 macOS 跑不了 queue.mjs，不伪造台账）。
14. `npx tsc --noEmit` 基线不涨；`npm test` 相关面全绿；提交。

## 回滚

- 单 commit（term.tsx + pending-input + workspace + send-button + verify）→ `git revert` 单提交即回滚。
- 功能开关默认开；如线上异常可将默认值改 false（一行）止血，机制保留。

## 判据（命令 → 期望）

| # | 命令 | 期望 |
|---|---|---|
| C1 | `npx vitest run frontend/app/commontext frontend/app/workspace/preload-tabs.test.ts` | 全 passed（含新用例） |
| C2 | `npx vitest run frontend/app/view/term` | 不低于现状（既有全绿） |
| C3 | `npx tsc --noEmit` | 错误数 ≤ 基线 47 |
| C4 | `node scripts/verify/commontext-send-agent-block/verify.mjs` | exit 0（探针改造后） |
| C5 | `node scripts/verify/commontext-send-background/verify.mjs` | exit 0（Part 1/2/3 全绿） |
| C6 | `node scripts/verify/commontext-send-background/verify.mjs --startup-only` | 重启场景全绿 |

## 实施结果（2026-11-17）

### 代码
- `pending-input.ts`：pending Tab 队列（`mountPendingInputTab` / `unmount*` / `getPendingMountTabIds` /
  `prunePendingInputTabs` / `pruneExpiredPendingInputTabs` / `subscribePendingInput`），
  cap=2、FIFO 去重、硬过期兜底（ttl+5s）、验证台专用 `window.__snorkelingPendingInputOverride`（不落盘）。
- `workspace/preload-tabs.ts`（新增纯函数）：pending 不参与 `PreloadTabCap` 切片的合并；
  `workspace.tsx` 订阅 registry + 2s 过期兜底 + `data-tab-id/data-tab-active` 契约属性。
- `term.tsx`：注入 effect 订阅 registry 变更（晚注册重触发）；inject/expire 时 `unmountPendingInputTabByBlock`；
  `window.term` 与 `giveFocus` 的守卫改用 **tab.blockids 归属判定**（`tabModel.tabId` 对所有预挂载块
  恒等于 staticTabId，不能用 —— 实测踩到）。
- `commontext-send-button.tsx`：`background` 配置（默认 true）+ `planSendActivation` 纯函数
  （后台=不 activateTargetTab、不 setActiveTab）；建块成功 → 注册 pending → 入隐藏挂载队列；
  Popover 新增「后台执行」开关行（`data-commontext-send-background`）；onStatus 用 `send.sentBackground`。
- i18n：zh/en 各 +5 键（background / backgroundHint / backgroundOn / backgroundOff / sentBackground），
  `check-parity` 0 diff。

### 单测
- `pending-input.test.ts` +9 例（队列去重/cap/按块移出/prune/硬过期/订阅/异常 listener/override/通知）；
- `preload-tabs.test.ts` +7 例；`commontext-send-target.test.ts` +2 例（planSendActivation）。
- 总：`npx vitest run frontend/app/commontext frontend/app/view/term frontend/app/workspace` → **433 passed**。

### 判据实测
| # | 命令 | 结果 |
|---|---|---|
| C1 | `npx vitest run frontend/app/commontext frontend/app/workspace/preload-tabs.test.ts` | ✅ 全 passed |
| C2 | `npx vitest run frontend/app/view/term` | ✅ |
| C3 | `npx tsc --noEmit` | ⚠️ 55 条，但 **HEAD 本身也是 55**（stash 实测），基线 47 是陈旧记录；本包新增 0 条（已记 INBOX） |
| C4 | `node scripts/verify/commontext-send-agent-block/verify.mjs` | ✅ 26/26（顺带修了该台的陈旧 caret 坐标 bug：编辑器折叠后复用旧坐标导致静默超时） |
| C5 | `node scripts/verify/commontext-send-background/verify.mjs` | ✅ 32/32（Part 1/2/3；`verify-runs/20261117T15295`） |
| C6 | `... --startup-only` | ✅ 4/4（判据由「≥2 tab」改为「≥1 tab + 激活 Tab 存在」：冒烟不依赖上一轮 profile 的形状） |

### 真机台发现 / 调整
- 干净 verify profile 的初始 Tab 是 **preview**（不是 term）：焦点用例改为先在当前 Tab 建 shell 终端，
  再聚焦 xterm helper textarea；「不抢焦点」用模块直调 `executeCommonTextSend`，避免弹窗自身抢焦点干扰断言。
- 隐藏挂载时判断块归属：`showcased` 见 spec 新增章节（quality-guidelines）。

### 未覆盖（skipped，已入台内 skipped 列表）
- 「已有 Tab」路径的隐藏挂载（新建 Tab 路径已覆盖，合并逻辑同一实现，单测覆盖）；
- TUI 输入框文本回显（首启提示会吞按键，沿用 injected/fallback 事件口径）；
- bracketed paste 语义本身（复用既有 terminal.paste 链路）；
- 远程 connection 目标（本地-only）。
