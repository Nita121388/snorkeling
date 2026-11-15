# 前端多语言（i18n）落地：基建重建 + 模块迁移 + 防回潮

## 背景与现状

- 前端用户可见文案基本硬编码英文；另有 **187 个 `.tsx` 文件、约 615 行非注释中文** 散落各处（中英混杂）。
  混排示例面：`block/`、`commontext/`、`element/block-editor/`、`session-overview/`、`view/term/` 等。
- 2026-07 曾做过一次完整尝试（分支 `worktree-i18n-snorkeling`，5 个 commit，worktree 在
  `.claude/worktrees/i18n-snorkeling`）：i18next 基础设施 + 4 个模块迁移 + 一份 700 行可执行迁移手册
  `docs/docs/i18n.mdx`（Pattern A–G）。**该分支基线是 2026-07-15 的 main，落后 973 个 commit，未合并。**
- 现在必须落地：越拖硬编码越多。本次不做整支 rebase，而是**在新分支上重建基建**，旧分支只作只读参考。

## 需求

| # | 需求 | 说明 |
|---|---|---|
| R1 | 基建 | i18next + react-i18next 接线；`ui:locale` 设置（auto/en/zh）；渲染进程与主进程双实例；切换即时生效并持久化 |
| R2 | 样板模块 | `onboarding` 完整迁移，作为后续全部模块的范式；同步产出迁移手册到当前 main 结构 |
| R3 | 批量迁移 | 按模块分批，每批可独立验收、独立提交、可回滚 |
| R4 | 中英混杂治理 | 硬编码中文与英文同等对待，统一进 en/zh 资源；**en 是唯一真源，zh 是其镜像** |
| R5 | 主进程 | native 菜单、更新弹窗等 `emain` 侧文案随 locale 切换 |
| R6 | 日期/数字 | 与 `11-02-datetime-format-config` 对齐接口（i18n 只负责 locale，格式模式归那个任务） |
| R7 | 防回潮 | 闸门：新增硬编码文案、或 en/zh 键不对齐 → 本地/CI 失败 |

## 约束

- **C1 不在 main 提交。** 全部工作在 `feat/i18n-rollout` 分支 / 独立 worktree；main 只作只读基线。
- **C2 只改文案来源，不改行为。** 迁移不得改变 UI 行为、布局、事件；测试与 preview fixture 必须同步更新。
- **C3 tsc 基线不得抬高。** 当前 `docs/project/tsc-baseline.json` = **47**，闸门 `node scripts/check-tsc-baseline.mjs`。
- **C4 不重复翻译。** en/zh 单一真源；主进程复用同一批 JSON（不维护第二份）。
- **C5 不换栈。** 维持 i18next（评估结论见 `design.md §0`）。
- **C6 不静默省略。** 未覆盖的文案必须进 allowlist 并注明原因，不得"看着差不多就算过"。

## 验收判据（全部可机器判定）

### P0 · 基建落地

- `node scripts/check-tsc-baseline.mjs` → exit 0，count ≤ 47
- `npm test` → exit 0
- `ui:locale` 在设置界面可见可切换；切到 `zh` 后至少一个已知界面文案变为中文（真机证据）
- 单测断言：`getI18nMain()` 在 `setMainLocale("zh")` 后 `t(...)` 返回中文；重复调用不重 init

### P1 · 样板模块（onboarding）

- `node scripts/i18n/scan-hardcoded.mjs --dir frontend/app/onboarding` → 新增发现 = 0（allowlist 之外）
- `node scripts/i18n/check-parity.mjs` → en/zh 键集合 diff = 0
- `npm test` exit 0；tsc ≤ 47
- 真机：切 `zh` 后 onboarding 全流程文案为中文（截图入 `verify-runs/`）

### P2 · 每批模块

- 该批目录 `scan-hardcoded` 新增发现 = 0
- 键 parity 0 diff；`npm test` exit 0；tsc ≤ 47
- 涉及 UI 的批次跑对应 `scripts/verify` area，结论录 `docs/project/verify-ledger.md`

### P3 · 主进程 / 收尾

- native 菜单切 `zh` 生效（真机证据）
- 闸门可证伪：故意插入一条硬编码中文 → `i18n:check` exit 1，删除后恢复 0
- 日期/数字格式与 `ui:locale` 的契约写进 docs 并有一条断言

## 不在本次范围

- 第三语言的实际翻译（资源结构支持即可）
- 文案润色 / 术语风格统一（只做 key 规范化）
- RTL 布局
- 终端内程序输出（那是子进程的 locale，不在前端 i18n 管辖）

## 风险

1. **漂移**：`session-overview` 与 `tab` 在 main 上各被改了 47 个 commit —— 旧分支的实现**不能照搬**，必须按当前结构重迁。
2. **测试断言文案**：大量测试以英文字面量断言 UI 文案，迁移会红；随迁移逐条改为 `t()` 复算或 testid 断言。
3. **`t()` 类型重载摩擦**：插值走 `<Trans>`（Pattern B）的 `as never` 逃生口 —— P0 先做 0.5h 验证，能用原生重载就不用逃生口。
4. **闸门误报**：品牌名（`Wave`、`OpenCode`、`pi` 等）、终端控制序列、字体名会命中扫描；用 allowlist 显式治理。

## 产出物

- `frontend/i18n/**`（基建 + 资源）
- `emain/emain-i18n.ts` 等主进程接入文件
- `docs/docs/i18n.mdx`（当前 main 版迁移手册）
- `scripts/i18n/{scan-hardcoded,check-parity}.mjs` + allowlist
- `docs/project/verify-ledger.md` 中对应结论行
