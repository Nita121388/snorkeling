# NIGHT-RUN（夜间自主开发运行日志）

> 这份文件是**夜间无人值守开发的交接页**：任何后续 agent 读这一页就能知道「今晚在做什么、做到哪、
> 怎么验、下一步是什么」。每完成一个里程碑就更新这里（连同任务目录里的 `implement.md`）。
>
> 最近更新：2026-11-05 22:1x（第 1 段）
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
