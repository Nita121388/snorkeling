# 执行计划：恢复时补盖章 hero 身份 meta

> 包 `N-1124-hero-restore-header`（bug P1，门链 G2 器具 + G7 人验收）。
> 顺序不可跳：**红证 → 实现 → 绿证 → 真机/人验收**。写白名单见 `loop/items/N-1124-hero-restore-header.md`，出界即 `out-of-scope` park。

## 0. 进场（2 分钟）

```bash
node E:/primary/projects/loop/bin/queue.mjs run --id N-1124-hero-restore-header --dry-run
node E:/primary/projects/loop/bin/queue.mjs pending
```

- 先读 `prd.md` / `design.md`，确认「方案 B 不做」。
- 确认工作树干净：`git status --short`（只应有 loop/ 与本任务目录的新增）。

## 1. 写测试（G2 红证）

按 `design.md §4` 的 6 项写测试，**先只写测试、不写实现**：

1. `pkg/hero/match_test.go`（新文件，调用尚不存在的 `hero.MatchProjectPath`）
2. `pkg/agentcontrol/hero_resolve_test.go`（新文件，调用尚不存在的 `ResolveHeroForSummary`）
3. `pkg/agentcontrol/restore_test.go`：fixtures 加 `HeroID/HeroName/HeroEmoji` 三字段 + 期望键断言
4. `pkg/service/aisessionsservice/aisessionsservice_test.go`：response 带 hero 字段
5. `frontend/app/view/aisessions/utils.test.ts`：`restoreMetaForSession` hero 用例

红证采集（旧源上必须失败）：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/hero ./pkg/agentcontrol ./pkg/service/aisessionsservice -count=1" 2>&1 | Tee-Object -FilePath loop/red/N-1124-hero-restore-header.txt
npx vitest run frontend/app/view/aisessions/utils.test.ts --reporter=basic 2>&1 | tee -a loop/red/N-1124-hero-restore-header.txt
node E:/primary/projects/loop/bin/queue.mjs gate --id N-1124-hero-restore-header --gate g2 --red-proof loop/red/N-1124-hero-restore-header.txt
```

红证要求：失败原因是「符号/字段不存在」或「期望键缺失」，不能是测试自己写错（类型导入错、语法错不算）。

## 2. 实现（严格按序，每步都可编译）

1. `pkg/hero/match.go`：`MatchProjectPath(root string, heroes []Hero, projectPath string) string`；纯 stdlib；段边界 + 分隔符 + 大小写 + Clean。
2. `pkg/service/aisessionsservice/aisessionsservice.go`：`deriveHeroProps` 改调 `hero.MatchProjectPath`（机械替换，行为由 `persona_roster_test.go` 4 用例锁）；删无引用的 `normalizeMatchPath`。
   - 立即验证：`go test ./pkg/service/aisessionsservice -run TestDeriveHeroProps -count=1`（或该文件里现有用例名）。
3. `pkg/agentcontrol/hero_resolve.go`：`ResolveHeroForSummary`（显式 props.hero 优先 → cwd 派生 → `hero.Get`）；全部失败路径返回零值 + `debugf`。
4. `pkg/agentcontrol/restore.go`：
   - `RestoreContext` 加 `HeroID/HeroName/HeroEmoji`；
   - `ResolveVendorRestoreContext` 在 base 构造后、claude 分支前解析并填字段；
   - `BuildResumeBlockMeta` 按 `prd.md §R3` 盖章（无 hero 时输出与现状字节级一致）。
5. `pkg/service/aisessionsservice/aisessionsservice.go`：`AISessionsRestoreContextResponse` 加 3 字段；`RestoreContext` 返回前拷贝。
6. 生成绑定：`node scripts/run-task.mjs generate`（只接受 `gotypes.d.ts` 中 hero 三字段的 diff，顺带刷新若不可避免需在记录里说明）。
7. `frontend/app/view/aisessions/utils.ts`：`restoreMetaForSession` 按同一契约盖章；常量从 `hero-launch.ts` / `agent-logo.tsx` 导入，禁止字面量。
8. 显示端一律**不改**（block.tsx / agent-logo.tsx / term-model.ts）——若发现必须改，停下并 park 求澄清（说明方案 B 被触发）。

## 3. 绿证（判据三条 + 全量回归）

```bash
powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol -run TestBuildResumeBlockMetaParity -count=1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol ./pkg/service/aisessionsservice ./pkg/hero -count=1"
npx vitest run frontend/app/view/aisessions/utils.test.ts frontend/app/workspace/hero-launch.test.ts --reporter=basic
node scripts/i18n/check-parity.mjs
node E:/primary/projects/loop/bin/queue.mjs prove --id N-1124-hero-restore-header
```

预期：`ok` / `ok` / `HERO_RESTORE_PASS`（末行 echo）+ prove 3/3。
回归面：`go build ./...` + `npx vitest run frontend/app/block frontend/app/view/term`（header 显示端必须保持绿）。

## 4. 真机验收（G7，人签字）

1. `node scripts/verify/index.mjs` 查是否有 `aisessions`/`agent-resume` 邻近 area；有则复用，无则按 `scripts/verify/README.md` 新建 `hero-restore-header` area（能力只从 `scripts/verify/lib/` 拿）。
2. 人工步骤（写进 verify-ledger 一行结论）：
   - 打开 AI Sessions → 找一个 `projectPath` 在 hero 据点下的会话 → 恢复
   - 断言：block header 图标 = hero emoji；标题 = hero 名字（不是 `hero-<hash8>` / 项目名）
   - 同时断言：无 hero 的普通会话恢复后 header 与今天一致（无回归）
3. `queue gate --id N-1124-hero-restore-header --gate g7 --by nita`

## 5. 收尾

- `docs/project/hero-system.md`：meta 契约表下补「恢复路径补盖章」小节（字段与条件，指向 `restoreMetaForSession` / `BuildResumeBlockMeta`）。
- `docs/project/verify-ledger.md`：一行结论。
- `loop/items/N-1124-hero-restore-header.md` 记录段：红证/绿证数字、影响面、与 F-1121 边界、遗留（旧块不回填）。
- 提交：`detect_changes` 复核影响面；`git commit`（只本包白名单内文件）。

## 6. 回滚

- 单次提交可整包 revert；无数据迁移、无持久化写入（meta 只在新建块时写）。
- 若 parity 无法对齐，回滚到实现前，park 理由写「契约漂移，需人拍板字段命名」。
