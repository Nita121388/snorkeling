# NIGHT-RUN（夜间自主开发运行日志）

> 这份文件是**夜间无人值守开发的交接页**：任何后续 agent 读这一页就能知道「今晚在做什么、做到哪、
> 怎么验、下一步是什么」。每完成一个里程碑就更新这里（连同任务目录里的 `implement.md`）。
>
> 最近更新：2026-11-06 05:4x（夜间收尾）
> 运行模式：cooking（无人值守）· 自主等级 autonomous · 呼喊偏好 silence（用户明确要求「不要喊我」）

## 0. 今晚的目标（用户原话归纳）

1. **验证不许依赖人眼**：任何结论都必须可机器判定（断言 + 报告 + 台账），截图只做人读补充。
2. 合适阶段**自主发布**（tag 触发三平台构建 + GitHub Release），发布说明要写清楚。
3. 夜间持续找**能确认存在的 bug / UI 缺陷 / 验证机制缺口**，包括 i18n 分支、md 预览深度优化等。
4. **数据安全 & 稳定性优先**：不 force-push、不删数据、不改用户本地状态、不在共享工作区并行写同一文件。
5. 时时记录进度与计划（本文件 + 任务 `implement.md`），便于随时接手。

## 1. 硬约束（这些是踩过坑的，别重犯）

| 约束 | 原因 |
|---|---|
| 一个 worktree 只允许一个写者 | 2026-11-05 白天已发生：另一个 agent 在主工作区 merge 并 `git commit`，把我未提交的文件扫进它的提交；两个验证台同时启动撞 scaffold `mv` 竞争 |
| 验证台并行必须错开端口 | `lib/launch.mjs` 默认 `vite 51799 / cdp 9231`；并行跑会抢端口 |
| 发版前 `git status --short` 必须干净 | release skill 明写：working tree 有未提交改动时打 tag 会发空 release（0.0.66 踩过） |
| 提交只按显式路径 `git add <path>` | 主工作区可能有别人的 staged 改动 |
| 不手改 `verify-ledger.md` 历史行，只追加 | 台账是跨机器结论，不是运行日志 |
| `pass` 只认验证台 verdict | 口头/肉眼不算；没有断言覆盖的面写进 `skipped` |

## 2. 工作流看板（每个里程碑更新）

| # | 工作流 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| W0 | 时间线长条形态的机器判定（补掉"要人眼看长条"的缺口） | ✅ 完成 | `overview-timeline` 22/22（`widthRatio=0.563`、`history=98px tail=12px`） | 用 `patchCachedSessionSummary` 播种真实 `createdAt=5h前 / updatedAt=30min前` |
| W1 | 发布当前已交付批次（看板 v2 A/B/C + 时间线 G1） | ✅ 完成 `0.0.119` | run 42052221548 success（34m59s）+ 三平台产物 + release notes 已手写 | 子代理按 release skill 执行 |
| W2 | 验证机制补强 | 进行中 | tsc 基线闸门（69→63）、vitest 排除 worktree/vendor/prototype、jsdom localStorage 内存实现、非 http fetch 守卫 → **npm test 首次全绿 2521 passed / exit 0**（此前 12 files failed）、截图空白守门 | 端口隔离仍待做 |
| W3 | 可确认 Bug 清扫 | 进行中 | 已修 5 个（三级菜单崩 / 预览系统打开崩 / 消息弹窗删除崩 / 导出死按钮 / preview 测试红灯） | 提交 c33d00a0 |
| W4 | i18n 基础（独立 worktree，branch，不阻塞 main） | 计划 | —— | 大件，先出骨架 + 一条端到端 |
| W5 | md 预览深度优化 | 进行中 | preview-edit 5/5 修好（空白截图守门 + callout 非交互导出） | 提交见 git log |

## 3. 发布记录

| 版本 | commit | tag | workflow | 结果 |
|---|---|---|---|---|
| `0.0.119` | `e7ac9f63` | `snorkeling-v0.14.6-beta.0-0.0.119` | 42052221548 | ✅ success 34m59s，三平台产物齐全；release notes 已手写补充（自动 notes 只有 changelog 链接） |

## 4. 交接要点（给下一个 agent）

- 当前主工作区状态：`main`，HEAD 见 `git log -1`；只有 `loop/INBOX.md`、`package-lock.json` 是别人/工具改的，
  不要顺手提交。
- 验证入口：`node scripts/verify/index.mjs`（看各 area 最近结论）；
  看板/时间线：`node scripts/verify/overview-board/verify.mjs`（38/38）、
  `node scripts/verify/overview-timeline/verify.mjs`（18/18）。
- 正在改的东西都在 `.trellis/tasks/<slug>/implement.md` 里，别只看这份文件。
- 任何"我觉得修好了"的结论都必须换成一条断言，否则下一个 agent 会重新踩。

## 5. 夜间追加记录（自动累积）

### 02:2x — 测试与验证台从"恒红"变"可判定"

- `npm test`（vitest）修复前：12 个文件失败、exit 1（幻影失败来自 `.claude/worktrees/**`、`.runcfg/**`
  第三方 plugin、`design/**` 原型 smoke、`scripts/**/*.test.mjs` 的 node:test 风格）。
  修复后：**227 files / 2521 tests passed，exit 0**（连续两轮）。
- 新增 `test/vitest-setup.ts`：Node >= 22.11 的 jsdom 不再自带 localStorage → 内存实现兜底；
  非 http 占位主机（`http://wave/...`）就地返回 `{data:null}`，避免 fire-and-forget RPC 变成 Unhandled Rejection。
- `preview-edit` 5/5：真因是 **clip 截图在窗口失焦时静默返回空片**（尺寸完全正确）；
  新增"文本区墨迹为 0 → 整窗重拍"守门，并给 `inkPixelCount` 补单测。
  修复前 bullet-li 的像素断言是"0 行带"（假红/假绿），修复后 1→1、2→2、4→4 行带、位移 0。

### 02:4x — 类型债二次清理（63 → 49）与一个真功能 bug

- `preview-explorer.tsx` 的 "在树里定位" 传的是 `blockData?.id`，而 `Block` 只有 `oid` →
  条件永远 `null` → **该功能静默失效**（从搜索结果/文件链接打开时不会定位到树）。已改 `oid`。
- `FileInfoCommand` / `FileRead` / `FileWrite` 的请求体在 Go 侧复用完整 `FileInfo`，TS 因此在十几处
  报 "mimetype missing"。新增 `frontend/util/fileinfo.ts` 的 `fileInfoRequest()` 集中构造，
  preview-model / preview-explorer / waveconfig-model 全部改用它（去掉魔法字段与复制）。
- `showExportModal` 返回 `void` 却被 `fireAndForget` 当 Promise 用 → 改成 `async` 并标注返回类型。
- tsc 基线 63 → **49**（`docs/project/tsc-baseline.json`）；相关目录单测 478 passed。

### 03:1x — 目录菜单/HTML 打开模式的选项翻译 + image-pager 观察

- 新真 bug：`makeDirectoryEntryMenuItems` 把 `DirectoryEntryMenuOptions`（relativePathRoot/openInCurrentBlock/…）
  直接当 `OpenPreviewEntryOptions`（forceNewBlock/directoryPath）传给 `openHtmlEntryWithMode` → TS 报"没有共同属性"，
  实际后果是 `directoryPath` 永远 undefined：**从子目录右键打开 .html 时预览块丢掉目录根**。
  新增 `menuOptionsToPreviewEntryOptions()` 显式翻译 + 两条纯函数单测；tsc 49 → 48。
- 观察（未修，属别人 in_progress 任务 `11-05-preview-pager-hover-hint`）：
  `node scripts/verify/image-pager/verify.mjs` → **30/31**，唯一红的是 `hover-tooltip-disabled-next`：
  该断言在全树到底之后去 hover「下一站」，而那一刻按钮根本不存在（没有下一站）→ 属于断言自身选错时机。
  建议改成（a）在树中段验证「下一站」hover 提示，（b）末尾只验证可见的 `›` 禁用态提示。

### 04:1x — 现状盘点 + 一处验证台归属争议

| area | 今晚结果 | 说明 |
|---|---|---|
| `overview-board` | ✅ 38/38 | 未改行为，仅断言随三视图更新 |
| `overview-timeline` | ✅ 22/22（隔离 profile/端口各跑一次） | 新增长条宽度机器判定；行数上限单测覆盖 |
| `preview-edit` | ✅ 5/5 | 空白截图守门修复 |
| `image-pager` | ⚠️ 30/31 | 唯一红：`hover-tooltip-disabled-next` 在"全树到底"后 hover 不存在的「下一站」→ 断言选错时机；属 `11-05-preview-pager-hover-hint` |
| `agent-card-seen` | ❌ 起不来 | 全新 profile 下 New Agent 面板没展开（面板选择已改成"右侧 WidgetsBar + provider 兜底"，仍失败）；属 `11-05-agent-card-seen` in_progress |

这两个红都不是"产品坏了"，而是**断言/harness 的时机或选择器问题**，且落在别人正在改的 area 里 —— 今晚按"不抢别人工作面"处理：只把诊断信息做得更可读（provider 列表兜底 + 可见按钮全量打印），不改判定逻辑。

### 04:1x — 一条给自己记的教训（已写进 spec）

CSS 补丁的 `oldText` 命中了**容器查询里的选择器列表**而不是独立规则，结果
`@container (max-width: 560px)` 的第一条规则被 `.more` 的声明块顶掉 → `.session-overview-timeline-row`
的 `min-width: 0` 消失 → 窄面板里轨道 540px 溢出 221px 面板。
真机断言 `timeline-track-visible-narrow` 当场抓住（detail 现在直接带 `{panelW, trackW, dl, dr}`）。
教训：改 SCSS 时先 `grep -n` 确认锚点唯一；断言里带几何数字，比"true/false"有用得多。

### 05:4x — 收尾盘点（给下一个 agent）

**已发版**：`0.0.119`（看板 v2 + 时间线 G1）、`0.0.120`（质量批次：测试/验证台可机器判定 + 5 个真 bug）、
`0.0.121`（导出三大修复 + 时间线行数上限 + image-pager 断言修正 + 验证台并行端口）。
三次 release notes 都**手写覆盖**了自动生成的 changelog 链接（`gh release edit --notes-file`）。

**当前质量门（全部可机器复跑）**
```bash
npx vitest run                                   # 227 files / 2532 tests passed
node --test "scripts/**/*.test.mjs" "tests/**/*.test.mjs"   # 23 passed
node scripts/check-tsc-baseline.mjs              # 47 = 基线（今晚从 69 降下来）
node scripts/verify/overview-board/verify.mjs     # 38/38
node scripts/verify/overview-timeline/verify.mjs  # 22/22（含长条宽度/几何断言）
node scripts/verify/preview-edit/run.mjs --expect=fixed  # 5/5
node scripts/verify/image-pager/verify.mjs       # 32/32
```

**还是红的 / 没做的**
- `agent-card-seen`：全新 profile 下 New Agent 面板没展开，台子起不来（`11-05-agent-card-seen` in_progress）。
- 时间线「更早 n」只做到 40 行截断 + 汇总行，没有做"展开查看"交互。
- `overview-timeline` 的行数上限只有单测覆盖（真机需要 41+ 会话才能触发，本机 fixture 造不出来）。
- i18n：本机已有 `.claude/worktrees/i18n-snorkeling`（别人在做），**今晚刻意不碰**，避免两个分支撞车。

**并行开发纪律（血的教训，写死在这里）**
- 一个 worktree 只允许一个写者；主工作区今晚被别的 agent merge 过两次（其中一次把我的
  `scripts/verify/README.md` 一起提交了）。
- 验证台并行必须错开 `VERIFY_PROFILE` / `VERIFY_VITE_PORT` / `VERIFY_CDP_PORT`。
- 提交只按显式路径 `git add <path>`；`loop/INBOX.md`、`package-lock.json` 不是我的，永远不碰。

### 06:2x — 补充：0.0.121 之后还有 3 个**开发侧**提交（不影响用户，未单独发版）

- `542ed824` 台账 fatal 记成 ✅ 的修复（纯 dev-infra）
- `e82eca14` HANDOFF 收尾
- `1a0e8653` vcs-tree-status 结论入库 + 九个 area 台账补齐

它们不改变 App 行为，留给下一次正常发版带上，避免为了文档再打一个 tag。
