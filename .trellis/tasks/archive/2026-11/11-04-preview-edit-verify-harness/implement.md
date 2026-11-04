# 执行清单

## M1 · 单轮判定可用（本任务的主交付）

### S1 骨架与 CDP 客户端
- [x] `scripts/verify/preview-edit/lib/cdp.mjs`：`connect(cdpUrl)` → `{send, evaluate, screenshot(clip), dblclick(x,y), close}`；基于 `ws`。
- [x] `scripts/verify/preview-edit/lib/launch.mjs`：`ensureInstance({attach, cdpPort, vitePort, profile})`；
      spawn 时记录 PID，`cleanup()` 只按 PID 结束；`waitReady()` 做三层健康检查
      （readyState / fonts.status / `.markdown-render-root`）。
- [x] 验证：`node scripts/verify/preview-edit/run.mjs --attach` 能连上已有 9231 实例。

### S2 打开 fixture（三级策略链）
- [x] `fixtures/verify/preview-edit/list-forms.md`：哨兵行 + 无序项 / 有序项 / 折叠式多行有序项 /
      嵌套子项 / 6 项长列表 / 含 `code` 与 **bold** 的项。
- [x] `lib/open.mjs`：`rpc` → `argv` → `ui` 顺序尝试，成功后必须通过"哨兵字符串出现在
      `.markdown-render-root` 内"的内容校验。
- [x] 失败时输出诊断（哪级失败、当时页面上的块列表），不静默。

### S3 观察层
- [x] `lib/observe.mjs`：`observe(case)` 产出 design.md §4 的 observation 契约；
      三态截图（before / during / afterEsc）+ crop 记录。
- [x] 双击用 CDP `Input.dispatchMouseEvent` 真手势（`clickCount:1` 两次），坐标取文本墨迹中心。
- [x] 采集 `window.__inlineEditLog`（需先 `localStorage.snorkelingInlineEditDebug="1"` 并 reload 一次）。

### S4 规则库
- [x] `lib/oracle.mjs`：按 case 的 `rules[]` 动态加载 `rules/<id>.mjs`，聚合 `{pass, checks[]}`；
      单 case 覆盖不到的 rule 报 `warn`。
- [x] `rules/01-text-zero-shift.mjs`
- [x] `rules/02-pixel-zero-shift.mjs`（依赖 `lib/pixel.mjs` 墨迹剖面）
- [x] `rules/03-no-clip.mjs`
- [x] `rules/04-single-level-indent.mjs`
- [x] `rules/05-marker-drawn.mjs`
- [x] `rules/06-clean-exit.mjs`
- [x] `rules/07-no-measure-loop.mjs`

### S5 像素层
- [x] `lib/pixel.mjs`：`crop(png, rect)`、`inkProfile(png)`（逐行带最左墨迹 x + 行带计数）、
      `diffImage(a, b, maskRects)` → 差异图。

### S6 CLI 与报告
- [x] `run.mjs`：`--attach --expect=fixed|broken --legacy-css --case=<id> --against=<report> --json --help`。
- [x] `report.json`（机器读）+ `report.md`（人读，内嵌相对路径图片）+ `verify-runs/<ts>/`。
- [x] 退出码：`pass→0`，`fail→1`，环境/脚本错误→`2`。

### S7 验收（必须全部跑出来）
- [x] `run.mjs --expect=fixed` → pass（4 个 case 全绿），单轮 < 10s（attach）。
- [x] `run.mjs --expect=broken --legacy-css` → fail，且 failing 指向 `text-zero-shift` /
      `pixel-zero-shift`，实测 Δx ≈ 26.5px（与上一轮手工对照一致）。
- [x] 连跑 3 次结果一致（确定性）。
- [x] 4 个 case 每个都有 `before/during/afterEsc` 三张 png，`report.md` 能直接看图。

## M2+（本任务只留接口，不实现）
- [x] `--legacy-worktree`：`git worktree` 到修复前 commit 跑真旧代码。
- [x] `--vlm` 软语义告警。
- [x] `--record` 录制人工操作生成 case 骨架。

## Loop 协议（写进 skill / spec，供以后 agent 循环使用）

```
1. run --expect=fixed
2. pass → 更新 baseline（如需）并收工
   fail → 读 report.json 的 failing[].rule + evidence
3. 只改一个变量
4. run --against=<上一轮 report>
   newFailures 非空 → 立即回退（这个改动是坏的）
   failing 减少   → 继续
5. 连续 3 轮无改善 / 同一 rule 反复红 → 停，把 verify-runs/<ts>/ 整个目录当证据包交给人
6. 修复确认后：把该 bug 抽象成 rules/<新 id>.mjs + 在 spec 里写明"为什么需要这条规则"
```

**门禁**：rules 库只增不减；删规则必须在 PR 里说明理由。

## 校验命令

```bash
node scripts/verify/preview-edit/run.mjs --help
node scripts/verify/preview-edit/run.mjs --expect=fixed --json
node scripts/verify/preview-edit/run.mjs --expect=broken --legacy-css --json
node scripts/verify/preview-edit/run.mjs --expect=fixed --against=verify-runs/<ts>/report.json
```

## 回滚点

| 点 | 回滚 |
|---|---|
| 全部 | 删 `scripts/verify/preview-edit/`、`fixtures/verify/`、`verify-runs/`，撤 `Taskfile.yml` 一行 |
