# 实施计划：i18n 落地

> 基线（2026-11-14 实测）：
> `tsc-baseline.json` = **47** · `npm test` 全绿 · 硬编码粗估：文案属性 ≈ 489 处 + JSX 文本行 ≈ 317
> · CJK（非注释）≈ 615 行 / 187 文件。
> 每批密度实测（attr 属性数 / CJK 行数）：`view` 322/573（内含 preview 20/291、term 9/72）·
> `element` 92/241 · `waveconfig` 94/6 · `session-overview` 16/148 · `block` 28/98 ·
> `commontext` 24/115 · `tab` 11/42 · `aipanel` 10/0 · `onboarding` 2/0 · `emain` 0/0。

## Step 0 · 分支与队列（开工前置，一次性）

1. `git worktree add .claude/worktrees/i18n-rollout -b feat/i18n-rollout origin/main`
   （期望：新 worktree HEAD = `dbe692b87`）
2. loop 队列建本任务工作项（P0 一个、P1 一个、P2 每批一个、P3 一个）；`node loop/queue.mjs run --id <id> --dry-run` 确认门清。
3. 每步产出都只在 `feat/i18n-rollout` 提交，push 到 `origin/feat/i18n-rollout`；**main 不动**。

## Step 1 · P0 判据先行（红）

先写断言、不写实现，确认红：

- `frontend/i18n/i18n-config.test.ts`：`resolveLocale("zh-CN") === "zh"`、`resolveLocale("fr") === "en"`、
  `resolveLocale("auto", "zh") === "zh"`、非法值 → `"en"`
- `frontend/i18n/parity.test.ts`（或 `check-parity.mjs` 的 vitest 包装）：对 fixture 目录断言缺键 → 1
- 主进程幂等断言：`initI18nMain()` 两次调用不抛 + `setMainLocale("zh")` 后 `getI18nMain().t("test:key")` 返回中文 fixture 值

```bash
npx vitest run frontend/i18n/   # 期望：文件不存在/断言失败（红）
```

## Step 2 · P0 基建实现

从旧分支 `worktree-i18n-snorkeling` 搬运并按 design §2 调整：

1. `frontend/i18n/{config.ts,i18nmodel.ts,I18nProvider.tsx,i18next.d.ts}` + `locales/{en,zh}/common.json`
   （删 HttpBackend / LanguageDetector；init 全静态资源、`initImmediate: false`）
2. `pkg/wconfig`：`SettingsType.UiLocale`（`jsonschema:"enum=auto,enum=en,enum=zh"`）+ `metaconsts.go`
   → `npm run task generate`（期望：`schema/settings.json` 出现 `ui:locale`，gotypes 同步，无其他 diff）
3. `app.tsx` 挂 `<I18nProvider>`；`AppSettingsUpdater` 接 `ui:locale` 变更
4. `emain/emain-i18n.ts` + `emain.ts` 启动接线 + `emain-ipc.ts` `set-locale` + `preload.ts` `api.setLocale`
   + `custom.d.ts` 类型 + `preview-electron-api.ts` mock
5. `docs/docs/config.mdx` 补 `ui:locale` 行
6. 设置面板加语言选择控件（renderer 侧，对齐 `themepicker.tsx` 的做法）

## Step 3 · P0 验证（判据必须出数字）

```bash
node scripts/check-tsc-baseline.mjs   # exit 0，count ≤ 47
npm test                              # exit 0
```

真机：设置切 `zh` → `common` 命名空间覆盖的至少一处界面变中文；native 菜单尚为英文（P3 范围，不测）。

## Step 4 · P0 提交

`feat(i18n): P0 infrastructure — i18next dual-process + ui:locale(auto/en/zh)` + push。
**回滚点**：此 commit 单独 revert 即回原状。

## Step 5 · P1 样板模块（onboarding）+ 手册

1. `scan-hardcoded.mjs` / `check-parity.mjs` 先行落地（Step 1 已有 parity 测试，这里出 CLI 版 + allowlist 骨架）
2. 迁 `frontend/app/onboarding/**` + `frontend/preview/previews/onboarding.preview.tsx`
   （参考旧分支 phase 1 的 diff，但按当前 main 结构改；旧分支 `onboarding` 漂移仅 2 commits，冲突小）
3. `t(key,{values})` 类型验证结论回写 `docs/docs/i18n.mdx`（Pattern B 是否仍需 `as never`）
4. 手册落地：把旧分支 `docs/docs/i18n.mdx` 更新到当前 main 结构（含 Pattern H/I、本任务的闸门用法）

```bash
node scripts/i18n/scan-hardcoded.mjs --dir frontend/app/onboarding   # 新增发现 0
node scripts/i18n/check-parity.mjs                                    # diff 0
npm test && node scripts/check-tsc-baseline.mjs
```

真机：onboarding 全流程切 zh 截图入 `verify-runs/`。

## Step 6 · P1 提交 + loop 工作项走门（G7 人验收）

## Step 7 · P2 批量迁移（每批 = 一个 loop 工作项，独立 commit）

批次顺序（小→大，先易后难；每批命令同 Step 5）：

| 批 | 范围 | 预估密度 | 备注 |
|---|---|---|---|
| B1 | `app/tab` + `app/aipanel` | attr 21 / CJK 42 | tab 旧分支迁过、漂移 47 commits，按当前结构重迁 |
| B2 | `app/session-overview` + `app/commontext` | attr 40 / CJK 263 | 同上；CJK 密集，Pattern H 主战场 |
| B3 | `app/block` + `app/element`（除 block-editor） | attr 120 / CJK 339 | element/block-editor 单列 |
| B4 | `app/view/waveconfig` + `app/view/{codeeditor,launcher,sysinfo,…小模块}` | attr 94+ | waveconfig 旧分支有 sample |
| B5 | `app/element/block-editor` | CJK 241 内含 | slash-palette / 表格工具栏文案密集 |
| B6 | `app/view/term` + `app/view/preview` | attr 29 / CJK 363 | preview 的 InfoCard/modal 文案最多 |
| B7 | 其余 `app/view/*` + `frontend/preview/**` mock/fixture 文案 | — | 收尾扫尾 |

每批出口（缺一 park）：scan 0 · parity 0 · `npm test` 0 · tsc ≤ 47 · UI 涉及跑对应 verify area · 台账一行。

## Step 8 · P3 主进程 + 闸门固化 + 日期契约

1. `emain/emain-menu.ts` 等主进程文案（Pattern G）→ 真机：菜单切 zh
2. `i18n:check` 接进 Taskfile + CI（故意插一条中文文案验证 exit 1，再删）
3. `frontend/i18n/format.ts` 薄封装 + 与 `11-02-datetime-format-config` 的契约断言一行
4. `docs/docs/i18n.mdx` 终稿 + `.trellis/spec` 沉淀「新 UI 代码必须走 t()」硬约束

## Step 9 · 收尾（3.3 / 3.4）

- `detect_changes()` 核对影响面 → spec 更新（trellis-update-spec）
- 全部 push `origin/feat/i18n-rollout`；合并 main 由人签（G7）

## 回滚点总表

| 点 | 动作 |
|---|---|
| P0 后 | revert P0 commit，仓库回无 i18n 状态 |
| 每批后 | revert 单批 commit，其余批不受影响 |
| P3 前 | 只 revert 主进程批，前端迁移保留 |

---

## 进度（2026-11-14 晚）

- **P0 ✅ 已完成**（commit `bc27dc1ac`，分支 `origin/feat/i18n-rollout`）
  - tsc 47 = 基线 47（0 新增）· `npm test` 279/3123 全绿 exit 0 · 新增 13 条 i18n 单测全绿
  - 真机（CDP）：auto→系统 zh-CN 生效；点 en→`setting=en/i18n=en`/标题 Language；点回 zh→全部生效（截图 `verify-runs/20261114T11143-i18n-p0/`，worktree 本地）
  - **真机踩到的新坑**：① 主进程 bundle 是 ESM，`require()` 直接抛 "Cannot find module" → Uncaught Exception → 整应用退出——IPC handler 里禁止用 `require`，循环依赖用动态 `import()`；② 新 worktree 的 electron 二进制不完整（`install.js` 解压缺 `Electron Framework`，且 `path.txt`missing → vitest 全量 50 条 unhandled error。修复：从主仓同版本拷 `dist/` + 手写 `path.txt`。
- **P1 待做**：onboarding 迁移 + `scan-hardcoded.mjs`/`check-parity.mjs` CLI 版 + `docs/docs/i18n.mdx` 手册落地
- **Pattern B 类型验证结论**（供手册回写）：i18next 27 + react-i18next 18 下，`t()` 必须用全限定 key（`t("common:settings.languageTitle")`），ns 绑定的短 key 会直接被拒； 表达式位置无需 `as never`。

- **P1 ✅ 已完成**（commit `defed3e4c`，分支 `origin/feat/i18n-rollout`）
  - onboarding 23 文件 + preview 全迁：scan `--dir frontend/app/onboarding` = 0（12 条 allowlist：CLI 命令名/配置键名，带 reason）
  - 闸门落地：`scripts/i18n/scan-hardcoded.mjs`（TS AST：jsx-text/attr/cjk）+ `check-parity.mjs` + `npm run i18n:check`（全仓口径在 P2 清完前保持红，逐批用 `--dir` 验收；P3 才接 CI）
  - 手册 `docs/docs/i18n.mdx` 重建到当前 main（Pattern A–I + 三个新坑：ESM require、jsdom 宿主 locale、electron dist 半装）
  - 旧分支 zh 资源里 46 个英文占位值全部补翻；其余同值 key 为品牌名/仓库名
  - tsc 47 = 基线 · npm test 279/3123 全绿 · parity 0
  - 真机：向导首屏中文（「欢迎使用 Snorkeling」+「继续」），截图 `verify-runs/20261114T13594-i18n-p1/onboarding-zh.png`；向导内 AI 面板 demo 文案英文属 `aipanel.tsx`（P2 B1 范围）
  - **新坑（vite）**：改 JSON 资源后 `location.reload()` 不会让静态 import 的 locale 模块刷新（网络层新、模块图旧）——dev 实例必须重启才吃到新资源
  - **下一步 P2 B1**：`app/tab` + `app/aipanel`（attr 21 / CJK 42）
