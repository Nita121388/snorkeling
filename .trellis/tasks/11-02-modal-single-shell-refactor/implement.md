# Implement — 弹窗单壳收敛 + AgentCardModal 重构

## 0. 前置：调用面枚举（替代 GitNexus impact）

**本会话 GitNexus MCP 工具不可用**（工具列表里没有 `impact` / `context` / `detect_changes`），
`node .gitnexus/run.cjs` 也没有 `impact` 子命令。因此改用**源码级调用点枚举**：
被改的符号都是「组件 + 同一个文件内的局部函数」，调用面可以用 `rg` 穷举且完备。

若后续拿到 MCP，必须补跑 `impact({target, direction:"upstream"})` 并回填下表。

| 符号 | 文件 | 调用点（已枚举） | 风险 |
|---|---|---|---|
| `Modal` | `frontend/app/modals/modal.tsx` | 12 文件 / 13 处 | **HIGH** — 全局视觉 |
| `FlexiModal` | 同上 | 11 文件 / 11 处 → 已全部迁到 `Modal` 并删除 | **HIGH** |
| `Modal.Content` / `.Footer` / `FlexiModal.Content` / `.Footer` | 同上 | **0 处** | 无（已删死 API） |
| `frontend/app/element/modal.tsx` + `.scss` | — | **0 处** | 无（已删死代码） |
| `PropertyList` / `ValueDisplay` / `InlineEditor` / `startEdit` | `view/aisessions/property/property-list.tsx` | 2 处直接（`session-note-section.tsx`、测试） | 中 |
| `SessionNoteSection` | `element/info-card/session-note-section.tsx` | 2 处（`AgentHoverCard`、`session-detail-info-card.tsx`） | 中 |
| `AgentHoverCard` | `view/term/agent-hover-card.tsx` | 4 处（`block-info-card.tsx`、`tab-more-agent-card.tsx`、`agentcardmodal.tsx`、测试） | 中 |
| `toPropertyDefs` / `humanizeKey` | `property-model.ts` | `session-note-section.tsx`、`property-list.tsx`、测试 | 低 |

**已执行的回退面校验**：

- `rg "FlexiModal" frontend` → 仅剩 `modals/modal.tsx` 里的一句注释（说明已删除）。
- `rg "element/modal" frontend` → 0。
- 两文件已从工作区删除。
- `Modal` 的所有现有 props 语义未变；新增能力全部可选。

CRITICAL 禁区（**不碰**）：

- `docs/design-system.md` §11 `DS-008` / §12 `Batch 6` 里的 `0.5px` → `1px` 边框改动
- `modalsModel` / `modalsrenderer` / `keymodel.ts` 的 ESC 链路

## 1. 执行顺序（每步一个 commit，可独立 revert）

### Step 1 — 扩展 `Modal`（纯向后兼容）

- [ ] `modal.tsx` 加 props：`title` / `subtitle` / `headerExtra` / `footer` /
      `padding` / `scrollBody` / `closeOnBackdrop`，并把 ✕ 从绝对定位改为
      `.modal-header` 内流式 flex 子项；**只在传了 `onClose` 时渲染 ✕**。
- [ ] 补 `role="dialog"` / `aria-modal` / `aria-labelledby` / ✕ 的 `aria-label`。
- [ ] `modal.scss`：
      - `.modal` 加 `max-height: min(80vh, calc(100vh - 40px))` 与 `--modal-padding: 16px`
      - `.content-wrapper` 加 `flex:1; min-height:0; overflow-y:auto; overscroll-contain; padding: var(--modal-padding)`
      - `.modal-content` 的 `padding: 0 20px` 归零
      - 新增 `.modal-header` / `.modal-header__text` / `.modal-header__extra` / `.modal-close`
      - 新增 `.modal.modal--flush` 归零 padding
      - `.modal-close-btn` 删除绝对定位规则（保留类名以防测试引用）
- [ ] 单测 `frontend/app/modals/modal.dom.test.tsx`：
      无 `onClose` 不渲染 ✕；有 `title` 时 `aria-labelledby` 指向标题 id；
      `padding={false}` 出现 `modal--flush`；`scrollBody={false}` 不出现滚动容器类。

**验证**

```bash
npx vitest run frontend/app/modals/modal.dom.test.tsx
```

**回滚点 A**（无引用方变化，revert 安全）

### Step 2 — `FlexiModal` 11 点迁移 + 删除双壳

- [ ] 按 `design.md` §2.2 表格逐个改 import + 补 `padding={false}` / `scrollBody={false}`。
- [ ] 迁移完 `rg "FlexiModal" frontend` 必须为 0，**然后**删除
      `FlexiModal` 实现与 `.Content` / `.Footer` 静态属性。
- [ ] 删除 `frontend/app/element/modal.tsx` + `frontend/app/element/modal.scss`。
- [ ] `rg "element/modal" frontend` 为 0。

**自查 grep（必做）**

```bash
# 迁移后仍有自带 padding 的调用方，必须显式 padding={false}
rg -n 'className="[^"]*\bp[xy]?-' frontend/app/modals frontend/app/onboarding frontend/app/builder
```

**验证**

```bash
npx vitest run frontend/app/modals
npm run build:prod
```

**回滚点 B**

### Step 3 — `Modal` 12 点按新形状清理

- [ ] 按 `design.md` §2.1 表格：自带 padding 的加 `padding={false}`；
      写 `pr-7` / `pr-8` 让位 ✕ 的删掉让位代码；
      `agenthooksettingsmodal` / `annotation-editor` / `aisessionnotemodal` 改用结构化 `title`。

**验证**：逐个打开这 12 个弹窗（列表见 `design.md` §2.1），确认无 padding 叠加、无遮挡。

**回滚点 C**

### Step 4 — AgentCardModal 重构

- [ ] 抽 `frontend/app/view/term/agent-card-identity.ts`：
      `useAgentCardIdentity(blockId, blockData)` 返回
      `{ provider, model, modelLoading, statusPres, statusState, agentIcon, accent, personaSessionId }`。
      从 `agent-hover-card.tsx` 抽取，**纯提取不改语义**。
- [ ] `agentcardmodal.tsx` 改用 `Modal` 的 header/footer（见 `design.md` §3）。
- [ ] `agent-hover-card.tsx` 加 `frameless?: boolean`；`embedded` 时默认 true。
- [ ] `info-card.scss` 加 `.agent-card--frameless` 减法规则（只新增选择器）。
- [ ] 左侧状态色条改由弹窗侧承载，避免 frameless 后色条与卡片重影。
- [ ] 修正 `.agent-card-model` / `.agent-card-expand-btn` 双 `margin-left:auto`。

**验证**

```bash
npx vitest run frontend/app/block/block-info-card frontend/app/element/info-card
```

**回滚点 D**

### Step 5 — `PropertyList` 功能缺陷（B2–B6）

- [ ] B2 `startEdit` 对 checkbox 短路切换 + checkbox 按钮补 `role="switch"` / `aria-checked`。
- [ ] B3 note 空值输出 `Empty`。
- [ ] B4 `SessionNoteSection` 的 `onEditNote` 在 `canEditProperties` 时走 `onOpenNoteDialog()`。
- [ ] B5 `DetailPropertyLimit = 8` + 过滤「模板有定义无值」的自定义属性。
- [ ] B6 `humanizeKey` 兜底 `select` 值。
- [ ] 清 `.property-row__value` 重复定义、`void empty;` 死代码。

**单测**

- [ ] `property-list.test.tsx` 新增：checkbox 点击 → `onChange(key, true)` 且无 `<input type="text">`；
      detail 模式 note 空 → `Empty`；`title_source` → `First user message`；
      超上限 → `+N more`。
- [ ] 更新既有「shows Empty placeholders in detail mode」。

```bash
npx vitest run frontend/app/view/aisessions/property
```

**回滚点 E**

### Step 6 — 属性区信息架构

- [ ] detail 模式拆 `primary` / `secondary`，`secondary` 默认折叠，按钮 `More properties (N)`。
- [ ] `--property-name-width` detail 模式 → `116px`。
- [ ] 新增 `.property-actions`，统一 `Add a property` 与 `AI auto-fill`；去掉 `property-ai-trigger` 虚框。

```bash
npx vitest run frontend/app/view/aisessions/property frontend/app/element/info-card
```

**回滚点 F**

### Step 7 — 全量门禁

```bash
npx vitest run
npm run build:prod
node scripts/run-task.mjs check          # typecheck / lint，见 Taskfile.yml:475
```

- [ ] 更新 `docs/design-system.md` §12 Batch 6 状态为 `Complete`，证据列写本任务路径。
- [ ] 三主题 CDP 截图（见 §3）。

## 2. Review gates

| Gate | 时机 | 通过标准 |
|---|---|---|
| G1 壳可用 | Step 1 | 单测绿；无 `onClose` 不出 ✕；`padding={false}` 生效 |
| G2 单壳达成 | Step 2 | `rg FlexiModal` = 0、`rg element/modal` = 0、`build:prod` 绿 |
| G3 12 点不退化 | Step 3 | 逐个打开无 padding 叠加 / 无遮挡 |
| G4 样板合格 | Step 4 | AgentCardModal ✕/ESC 可关、四边有内边距、无双层边框、色条不重影 |
| G5 行为正确 | Step 5 | 6 个缺陷用例全绿，无新增 `as any` / 固定色值 |
| G6 视觉通过 | Step 6 | 三主题截图；入口对齐；空态唯一 |
| G7 提交前 | Step 7 | 范围复核只命中预期文件；`build:prod` 绿；design-system §12 已更新 |

## 3. 视觉与键盘验证

app 需带 CDP 端口（`npm run dev:cdp`，默认 9222）。
若 `http://127.0.0.1:9222/json/list` 显示的是别的 Electron 应用（例如 Obsidian），
**先确认目标**，不要用 `opencli operate state` 代替。

```bash
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs elements --limit 40
node scripts/inspect-electron-ui.mjs screenshot
```

覆盖矩阵：

| 维度 | 取值 |
|---|---|
| 主题 | dark / light / monochrome |
| 弹窗（抽样 4 个） | `AgentCardModal`（新 header）、`AISessionNoteModal`（新 header）、`confirmmodal`（FlexiModal 迁移）、`agenthooksettingsmodal`（长内容滚动） |
| 数据 | 属性全空 / 超上限 / note 有值 / 自定义 checkbox / 长标题 |
| 视口 | 默认桌面 / 收窄到 `calc(100vw-32px)` |

布局证据必须一起取，不能只截图：
`getBoundingClientRect()`、`clientHeight`、`scrollHeight`、computed `padding` /
`overflow-y` / `border-radius` / `box-shadow`、元素文本与 `aria-label`。

键盘：Tab 进弹窗 → 焦点环可见 → Tab 到 ✕ → Enter 关闭 → 重开 → ESC 关闭。

## 3.5 本次执行的实际验证记录（2026-11-02）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 壳契约单测 | `npx vitest run frontend/app/modals/modal.dom.test.tsx` | 9/9 pass |
| 受影响面单测 | `npx vitest run frontend/app/modals frontend/app/element/info-card frontend/app/block frontend/app/view/aisessions/property` | 149 pass |
| 属性交互单测 | `npx vitest run frontend/app/view/aisessions/property` | 29/29 pass |
| 全量单测 | `npx vitest run` | 2234 pass / 20 fail（**Fail 均为基线既有**，见下） |
| 生产构建 | `npm run build:prod` | exit 0（4m41s） |
| 类型检查 | `npx tsc --noEmit` | 78 行既有错误（基线即脏）；我改过的文件里**零新增**（唯一命中 `agenthooksettingsmodal.tsx:490 window.api` 在 HEAD 同样存在） |

**基线既有失败（与本次改动无关，均已核到具体原因）**

- `scripts/bootstrap.test.mjs` / `dev-entry` / `dev-options` / `dev-port` / `pslog-query` / `resolve-env`、`tests/inspect-electron-ui.test.mjs`、`design/prototypes/**/smoke.test.cjs` —— 测试文件加载即失败。
- `frontend/app/block/blockregistry.test.ts`、`frontend/preview/mock/mockwaveenv.test.ts` —— `Test timed out in 5000ms`。
- `frontend/app/view/preview/preview-directory-utils.test.ts` —— `model.isPinned is not a function`（preview 代码，未触碰）。
- `emain/dev-git.test.ts` —— 非 git 目录环境的路径断言。

**未完成（需在真机上补）**

- Electron CDP 三主题截图：本机 Electron 未带 `--remote-debugging-port=9222` 启动（9222 端口当前被 Obsidian 占用），需 `npm run dev:cdp` 重启后补。
- 键盘焦点环与 22 个弹窗的逐个目视回归：同上，需运行中的 app。

## 4. 完成定义

- `prd.md` 的 Acceptance Criteria 逐条勾选，每条附证据（用例名 / 截图 / 命令输出）。
- §0 调用面表格填满（或注明 MCP 不可用并说明替代方法）。
- 没碰 §0 的 CRITICAL 禁区。
- `docs/design-system.md` §12 Batch 6 状态更新。
- 按 Step 粒度分 commit，提交信息沿用仓库风格（`refactor(modal): …` / `fix(property): …`）。
