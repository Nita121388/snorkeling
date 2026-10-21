# 前端 Prompt 校对与评审记录

> 对象：`aiprompts/frontend-ui-prompt.md`
> 日期：2026-10-21
> 方法：以仓库为唯一事实源，对 Prompt 的每条断言做可复现核对；再由三个职责视角做通过/不通过判定。
> 关联任务：`.trellis/tasks/10-21-frontend-ui-prompt-audit/`

---

## 1. 上一版的事实错误（已修正）

| # | 上一版断言 | 核对结果 | 证据 | 严重度 |
| --- | --- | --- | --- | --- |
| 1 | `bg-surface` 是"写死 rgba，浅色主题下几乎不可见" | **半错**。它确实不跟随主题，但准确机制是：`@theme inline` 里值是字面量，Tailwind 直接编译成硬编码色。浅色主题下不是"不可见"，而是**分层方向反了**（变成比背景更白的一层）。且 `theme.scss` 里 `--color-surface: #f0ede6` 对 `bg-surface` **无效** | `dist/frontend/assets/index-C9SW6WsQ.css`：`.bg-surface{background-color:#ffffff0f}` vs `.bg-block{background-color:var(--block-bg-color)}` | 中 |
| 2 | "信息性文本不低于 11px" | **错，是我编的**。仓库有官方 `--text-xxs: 10px`；实测 `text-[9px]` 48 处、`text-[10px]` 130 处、`text-[11px]` 213 处。真实阶梯是 9–14px 密集布局 | `frontend/tailwindsetup.css:62`；grep 计数 | **高** |
| 3 | 图标写法 `<i className="fa fa-solid ..." />` | **不准**。主流是 FA Sharp：`fa-sharp fa-solid` 194 处 vs `fa fa-solid` 30 处 vs 裸 `fa-solid` 93 处 | grep 计数 | 中 |
| 4 | 图表"用 recharts 2.x" | **错**。root `frontend/` 对 recharts **零引用**；只在 `tsunami/frontend`（独立 workspace）用。root deps 里那个是死依赖 | `grep -rn "recharts" frontend/` → 空 | **高** |
| 5 | "复用现有 Confirm 组件"（沿用 10-13 design.md） | **错**。仓库**没有**通用 Confirm，只有专用的 `RestartConfirmModal`。要新建 | `ls frontend/app/modals | grep -i confirm` → 只有 restartconfirmmodal | **高** |
| 6 | 表格"用 @tanstack/react-table" | **高估**。只有 preview 两个文件用过，不是通用方案，写进主表会诱导滥用 | grep → `preview-directory.tsx`、`csvview.tsx` | 中 |
| 7 | 未提 `element/button.tsx` | **漏项**。57 处使用，带 `solid/outline/ghost` × `green/grey/red/yellow` 语义类，是模态主操作的标准写法 | `element/button.tsx` | **高** |
| 8 | 未提"猜错 token 会静默失效" | **漏项**。`text-main` 10 处使用但不是 token，编译产物里没有该类 → 静默无样式 | `restartconfirmmodal.tsx:38`、`unsavedfilemodal.tsx:34`；编译 CSS 无 `.text-main` | 中 |
| 9 | 禁止清单写"禁止 `cursor-not-allowed`" | 对，但不完整。实际禁用态写法是 `opacity-50` + `disabled`（`agenthooksettingsmodal.tsx` 用 `disabled:opacity-50 disabled:cursor-default`） | 源码 | 低 |
| 10 | 未提"外壳已有标题" | **漏项**。`waveconfig.tsx` 已有页面标题 + JSON/Visual 切换，内容区再写标题会重复 | `waveconfig.tsx` | 中 |

### 另外两处我确认**没错**、但上一版说得不够准的

- `bg-surface*` 用量：99 处全仓库。上一版只说"三处误用"，没说明这是普遍现状 → 容易让 agent 以为可以顺带全改。已改为"新代码不要用"，不要求批量迁移。
- `text-[9px]` 的 "Default" 徽标：确实存在，建议改 `text-xxs`（10px token）而不是含糊的"≥10px"。

---

## 2. 三个职责视角的评审

### 视角 A：前端架构 / 可维护性

**结论：通过（修正后）**

- ✅ 技术栈表逐个可验证，没有"看起来合理但仓库里没有"的条目。
- ✅ 明确了 workspace 边界（root `frontend/` vs `tsunami/frontend`），避免跨用 atom/依赖——这是这个 fork 的真实风险点。
- ✅ 把"复用"落成可执行动作（`ls element/` + `rg` + 具体反例），不是口号。
- ⚠️ 已修正：上一版把"新增依赖"一票否决，但没给"仓库缺什么"的出口（见 §6 缺失基础设施）。现在补了分级建议，避免 agent 在缺组件时硬造。
- ⚠️ 已修正：上一版把 `@tanstack/react-table`、`recharts` 放进主表，会让 agent 为小界面引入重型方案。现在标注了真实使用范围。

**残留风险**：`bg-surface*` 99 处是历史债，Prompt 只约束新代码，不治理存量。这是刻意取舍——批量替换需要单独任务，混进设置页美化会让 diff 不可审。

### 视角 B：设计系统 / 主题一致性

**结论：通过（修正后）**

- ✅ 找出了唯一一组"主题无关 token"（`surface` 三兄弟），并给可复现证据（编译产物对比）。这是本项目最容易踩的坑，论坛那套"统一 shadcn 主题"的说法在这里完全不适用。
- ✅ 字号不再强加外部规则，改为"跟随相邻组件的既有阶梯"（9/10/11/12/14）。
- ✅ 颜色纪律（≤5%、彩色只给状态/数据）与 taste-skill app-screens 的研究结论一致，不是个人偏好。
- ⚠️ 已修正：上一版要求"控件高度统一 28–30px"，但仓库 `h-7`(25 处) 与 `h-8`(23 处) 并重。改为"同一界面选一种"。
- ⚠️ 已修正：浅色主题的描述从"不可见"改为"分层方向反了"——原表述会让 agent 以为"看不见就无所谓"，实际是**看得见但错**。

**判定依据**：`theme-action-colors.test.ts` 已经用测试锁死了 action 色的对比度 ≥4.5:1，说明本项目对主题对比度是有契约意识的。Prompt 补上"三主题各验一次"与这个既有契约对齐。

### 视角 C：任务边界 / 可交付性

**结论：通过，但留一个必须人工裁决的点**

- ✅ 目标文件、只读文件、禁改文件列清楚了，`waveai-model.tsx` 和 `waveai.json` 格式明确禁改。
- ✅ 验收项都可机械判断（无 `window.*`、无新增诊断、三档宽度、暗浅双主题）。
- ✅ 承认 `tsc` 有既有噪声，判据是"无**新增**诊断"——上一版写"必须通过"会诱导 agent 去修无关文件。
- ⚠️ **未解决**：`Built-in Wave AI` 分组是 PRD 要求，但 commit `364a23ad` 故意删掉了它，`b164f05b` 只恢复过滤函数没恢复 UI。这是**产品决策冲突**，不是遗漏。Prompt 里已写成 A/B 选项，默认 A（保持隐藏）并要求在 PR 说明中标注。**需要用户确认。**

---

## 3. 评审后仍然存在的、我无法单方面判断的事

1. **内置预设（Quick/Balanced/Deep）到底要不要重新露出来？** 见 §9.4 的 A/B。我按 A 处理。
2. **`bg-surface*` 存量 99 处要不要治理？** 建议单独开任务，不混进本次。
3. **是否接受新建 `ConfirmModal`？** 这是唯一需要"加文件"的地方。若要最小改动，可以退化成行内二次确认（点删除→按钮变 "Confirm?"），零新增文件。

若采纳建议 A 与"新建 ConfirmModal"，可以直接 `task.py start` 进入实现。

---

## 4. 核对用的可复现命令

```bash
# 主题 token 真伪（决定性证据）
grep -o '\.bg-surface{[^}]*}' dist/frontend/assets/index-*.css
grep -o '\.bg-block{[^}]*}'   dist/frontend/assets/index-*.css

# token 是否真的存在
awk '/@theme inline/,/^}/' frontend/tailwindsetup.css | grep -E '^\s+--color-'

# 论坛那 5 个库是否存在
grep -E "\"(lucide-react|framer-motion|dnd-kit|zustand)\"" package.json

# 图标约定（哪一种是主流）
grep -rho '"fa-sharp fa-solid\|"fa fa-' frontend/app --include=*.tsx | sort | uniq -c

# 缺什么
ls frontend/app/element | grep -iE 'select|dropdown|toast|confirm'
ls frontend/app/modals  | grep -i confirm

# 内置预设历史
git log --oneline -5 -- frontend/app/view/waveconfig/waveaivisual.tsx
git show 364a23ad --stat
```
---

## 5. 实现阶段发现的新问题（事后补充）

| # | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| 1 | **`.block` 全局类会覆盖 Tailwind 的 `block` 工具类** | `frontend/app/block/block.scss:115` 定义 `.block { display:flex; align-items:center; justify-content:center; width:100%; height:100% }`，未分层 CSS 优先级高于 `@layer utilities`。实测 `<label className="mb-1 block text-xs">` 的 computed style 为 `display:flex; justifyContent:center; width:640px`，导致表单 label 全部居中撑满 | 已在 prompt §3.6 记录；`waveaivisual.tsx` 的 3 处 label 改为不写 `block`，修复后 computed 为 `display:inline; width:55px` |
| 2 | 该陷阱属仓库**既有问题**，不是本次引入 | 原始 `Field` 组件就写的是 `mb-1 block`，说明历史代码同样踩坑 | 本次只修目标文件；全仓库 137 处 `className` 含 `block` 需要单独评估，未纳入范围 |

**教训**：Tailwind 的原子类名会与项目的 SCSS 全局类名冲突（`.block`、`.flex` 等短名风险最高）。给 AI 的约束里应该加一条——**用 Tailwind 类前，先确认同名的全局类不存在**。
