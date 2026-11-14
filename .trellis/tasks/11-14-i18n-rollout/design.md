# 技术设计：i18n 落地（基建 + 迁移 + 闸门）

> 基线：`origin/main` `dbe692b87`（2026-11-14）。旧分支参考：`worktree-i18n-snorkeling` `f07bb841`
> （worktree：`.claude/worktrees/i18n-snorkeling`，只读，不 rebase）。

## 0. 技术栈结论（已评估，不换栈）

**维持 i18next + react-i18next**（版本对齐旧分支：`i18next ^26.3.6` / `react-i18next ^17.0.9` / `i18next-cli ^1.65.0`）：

| 维度 | 结论 |
|---|---|
| 双进程 | 主进程 `createInstance()` 直接支持（旧分支 Phase 4 已验证）；Lingui/Paraglide 在 Electron 主进程侧要另造 |
| 类型安全 | `CustomTypeOptions` 提供编译期 key 校验 |
| 工具链 | `i18next-cli` scan/sync 校验 en/zh 对齐 |
| 生态 | React 生态事实标准，踩坑记录最多 |

**砍掉旧分支带进来的两个依赖**：`i18next-http-backend`、`i18next-browser-languagedetector`。
理由：Electron 内全部资源随包静态打入（旧分支 `partialBundledLanguages` + HttpBackend 实际是死路径），
全部静态 import → 同步可用、无网络失败面、少 2 个依赖。

替代方案（Lingui / FormatJS / Paraglide / next-intl）否决理由：主进程支持弱、ICU 样板重、生态新、仅 Next。

## 1. 分支与工作区

- 分支 `feat/i18n-rollout`，从 `origin/main` `dbe692b87` 起。
- worktree：`.claude/worktrees/i18n-rollout`（与现存 worktree 同址模式）。
- **main 永远不提交**；每阶段独立 commit、独立可 revert。

## 2. 运行时架构

```
                 持久层（唯一真源）
  Wave config `ui:locale`: "auto" | "en" | "zh"（默认 auto，schema enum）
                 │
     ┌───────────┴───────────┐
     ▼ renderer              ▼ main process
frontend/i18n/config.ts   emain/emain-i18n.ts
initI18n(resolved)        initI18nMain(resolved)
i18next + react-i18next   i18next.createInstance()
     ▲                        │
     │ useTranslation()       │ getI18nMain().t()
   组件树                  emain-menu / updater 等非 React 调用点
```

**数据流（push 模型，继承旧分支已验证设计）**：
- 启动：main 从 `launchSettings["ui:locale"]` resolve 后 `initI18nMain()`（在 `makeAndSetAppMenu()` 之前）；
  renderer 在 config 加载后 `initI18n()`。
- 切换：设置面板改 `ui:locale` → `AppSettingsUpdater` → `I18nModel.setActiveLocale()` →
  ① `i18n.changeLanguage()`（renderer）② preload `api.setLocale` → IPC `set-locale` →
  `setMainLocale()` + 重建 `makeAndSetAppMenu()`。
- `auto` 的 resolve 规则：renderer 用 `navigator.language`，main 用 `app.getLocale()`，
  各自归一化到 `en|zh`，失败回 `en`（回退链 `zh → en`）。

### 文件清单

| 路径 | 职责 |
|---|---|
| `frontend/i18n/config.ts` | 单例 init、`SUPPORTED_LOCALES`、`resolveLocale()`、re-export `i18n` |
| `frontend/i18n/i18nmodel.ts` | Jotai 单例 `I18nModel`：`activeLocaleAtom`、`setActiveLocale`（双写：i18next + IPC push） |
| `frontend/i18n/I18nProvider.tsx` | 启动 init + 订阅 `ui:locale` 变化驱动 `setActiveLocale` |
| `frontend/i18n/i18next.d.ts` | `CustomTypeOptions` 资源注册（每个 ns 必须登记，key 获得编译期校验） |
| `frontend/i18n/locales/{en,zh}/<ns>.json` | 资源；**en 为真源** |
| `emain/emain-i18n.ts` | `initI18nMain()`（幂等：重调用走 `changeLanguage`）、`setMainLocale()`、`getI18nMain()`、`coerceLocale()` |
| `emain/emain-ipc.ts` | `set-locale` handler |
| `emain/preload.ts` + `frontend/types/custom.d.ts` | `api.setLocale` 桥 |
| `pkg/wconfig/{settingsconfig.go,metaconsts.go}` + `schema/settings.json` | `ui:locale` 设置（`task generate` 生成，对齐 `app:theme` 的 `system` 模式） |

## 3. 命名约定

- 命名空间 = 模块名 kebab-case（`onboarding` / `tab` / `session-overview` / `common`…）；
  跨模块共享词落 `common`。
- key 按界面区块嵌套：`t("onboarding:upgradePatch.prevButton")`；插值 `{{version}}`；
  复数 `_one/_other`；**key 与值里都不允许出现 CJK**（key 全英文小驼峰）。
- en JSON 是唯一真源（新增文案先写 en 再写 zh）；zh 与 en 键集合必须完全一致（parity 闸门）。

## 4. 迁移模式（承接旧分支 Pattern A–G，P1 落地时全部更新进 `docs/docs/i18n.mdx`）

- **A** 纯文本：`t("ns:section.key")`
- **B** 插值（JSX 内）：`<Trans ns={…} i18nKey={…} values={{…}} />`；**P0 先验证** `t(key, {values})`
  在当前版本 + `CustomTypeOptions` 正确登记后是否可直接过类型——能过就删掉 `as never` 逃生口写法
- **C** 数据结构里埋文案：先重构出结构值，渲染期插值
- **D** JSX 文本里的 `<`/`>` 必须保持 HTML 实体（旧分支踩过的解析坑）
- **E** `aria-label`/`title` 等字符串属性：单 key 用 `t()`；多段拼装用模板字面量 + 逐 key `t()`
- **F** 非 React 的 `.ts`（菜单构建、model 代码）：`import { i18n } from "@/i18n/config"` 直调；
  配置元组用 `as const` 保住 key 字面量类型
- **G** 主进程：`getI18nMain().t()`，同步 init，不二次 init
- **H（新增）硬编码中文**：与英文同等对待——进 en/zh 资源；en 值按上下文翻译，拿不准的标
  `<!-- TODO(i18n-en) -->` 进 allowlist 而不是硬猜
- **I（新增）测试断言**：不断言文案字面量，改为 `i18n.t(...)` 复算或 testid 断言
  （迁移时同步修掉断言英文/中文的死文案测试）

## 5. 中英混杂治理与闸门（R4/R7）

### 扫描与对齐脚本（新增 `scripts/i18n/`）

| 脚本 | 判定 | 退出码 |
|---|---|---|
| `scan-hardcoded.mjs` | 对给定目录找：JSX 文本节点、`title/label/aria-label/placeholder/description/children` 常量属性、任意位置 CJK；输出 JSON（file/line/kind/text） | 发现不在 allowlist 的条目 → 1 |
| `check-parity.mjs` | en/zh 每个命名空间键集合 diff | 缺键/多键 → 1 |

- allowlist：`scripts/i18n/allowlist.json`，按文件+行内容 hash 登记，**必须带 reason**
  （品牌名 `Wave/OpenCode/pi`、终端控制序列、字体名、非 UI 数据如 provider id 等）。
- 入口：`npm run i18n:check`（接进 Taskfile 与 CI；CI 上对全仓跑，本地支持 `--dir` 增量）。
- 误报治理走 allowlist 版本化：每批迁移允许 `--update-baseline <dir>`，但 diff 必须人审。

### 日期/数字（R6，与 11-02 对齐）

i18next 不做格式化。约定：**locale 单一真源 = `I18nModel.getActiveLocale()`**，
`11-02-datetime-format-config` 的格式模式配置消费这个 locale 走 `Intl`；
本任务只提供 `frontend/i18n/format.ts` 的薄封装（`formatDate/formatDateTime/formatRelative` → Intl），
不定义格式模式。契约一行断言：切 `ui:locale` 后日期格式 locale 跟随。

## 6. 测试策略

- 新增单测：`resolveLocale()` 归一化、`initI18nMain` 幂等 + `setMainLocale` 切换、
  parity/scan 脚本自身（给假目录造红绿）。
- 存量测试：文本断言逐批改 `t()` 复算或 testid；**不允许断言中文文案**（zh 是镜像不是真源）。
- 真机验证：P1（onboarding 全流程切 zh）、P3（native 菜单切 zh）各留一次
  `verify-runs/` 证据；P2 按模块对应 `scripts/verify` area。

## 7. 回滚设计

- P0 基建 commit 单独成块，revert 不影响任何文案（未迁移前 `ui:locale` 只有 `auto/en/zh` 的空转）。
- 每个模块迁移一个 commit，独立 revert。
- 无数据迁移：唯一持久增量是 `ui:locale` 设置（additive，老版本忽略未知键，安全）。

## 8. loop 门链映射

- P0（基建）按 `feature/redesign` 走：G1 签认 + G2 判据 + G7 人验收。
- P1/P2 每批按 `bug/fix-small` 或 `feature/redesign` 视面大小取类；判据全部已有脚本出口
  （`scan-hardcoded` / `check-parity` / `check-tsc-baseline` / `npm test` / verify 台），
  取件前 `queue.mjs run --dry-run`。
- 每批一个 loop 工作项；夜班可执行（判据全部机器判定，无需人眼）。
