# VCS Remote 区美化：同步条 + 两行式提交行

## Goal

VCS Changes 页 Remote 折叠区（Upstream / Incoming / Outgoing）从「上游文字 + 两个描边胶囊 + 固定列裸表格」改为「语义色同步条 + 两行式提交行 + 带计数的分组标题」。原型：`design/prototypes/vcs/vcs-remote-sync-widget/index.html`（方案 A，用户已拍板）。

## Requirements

1. **sync bar** 取代「Upstream origin/main + Behind N + Ahead N」三件套
   - 容器 `bg-surface-soft`、圆角 7px、无描边（与 11-09-overview-board-chip-polish 的「去描边胶囊化」一致）
   - 左：分支图标 + upstream 名（`font-mono`，超长省略，`title` 全量）；upstream 未配置时显示斜体「未配置」
   - 右：`↑{ahead}` 用 `text-success`、`↓{behind}` 用 `text-error`，中间 `·` 分隔
   - 值为 0 的一侧降到 `opacity-55`（保留可见，用户需确认「没落后」）
   - both 为 0 → 右侧替换为 `✓ 已同步`（muted + success 勾）
2. **提交行改两行式**
   - 第一行 subject：整宽、`truncate`、`title` 全量，`text-xs`（12px）`text-main`
   - 第二行元信息：hash（`font-mono` 10.5px）+ `·` + author + `·` + 相对时间，`text-muted`
   - 删除 `min-w-[78px] / min-w-[120px] / min-w-[110px]` 三处固定宽度
   - 左 2px 语义轨：Outgoing 绿 / Incoming 红；静止 55% 融合，hover 保持
   - hover：行背景 `bg-hover`
3. **分组标题**：`Outgoing` / `Incoming` 字号 11px `font-semibold` `text-secondary` + 计数 chip（`bg-surface-soft`、`font-mono` 10px）+ 右侧 1px 发丝线
4. **相对时间**：`<1m` → `just now`；`<60m` → `Nm ago`；`<24h` → `Nh ago`；`<7d` → `Nd ago`；更早 → `MM-DD`；解析失败 → 原样字符串。绝对时间进 `title`。
5. **分组可见性**：`commits.length === 0` 的组整组不渲染（沿用现状），`✓ 已同步` 兜底。
6. **不动**：Fetch/Pull/Push 按钮禁用逻辑、折叠状态管理、非 git 的 remoteFiles 分支、外层 CollapsibleHeader。

## Non-goals

- 不做「点击行打开 commit diff」、不做 hover 复制 hash 按钮（P2，另开）。
- 不接 `11-02-datetime-format-config` 的格式配置（该任务仍 planning），相对时间先硬编码英文短格式。

## Acceptance Criteria

- [x] `vcs-changes-tab.tsx` 中 `RemoteCommitRow` 不再出现任何固定列宽（`grep min-w-\[` = 0）
- [x] `npx tsc --noEmit` 对本包三个文件 0 error（仓内另有 48 处存量错误，均在 preview/mock、term、dev-runtime 等无关文件）
- [x] `vcs-time.test.ts` 11 条用例全绿（`npx vitest run frontend/app/view/vcs/` → 24 passed）
- [ ] 真机 470px 宽度下完整显示 3 条示例 commit 的 subject（截图证据）— **推迟**：用户 2026-11-09 明确「暂时不用验证，准备提交推送，回家后继续」
- [ ] ahead=3/behind=0 与 ahead=0/behind=0 两种状态截图各一张 — **同上推迟**
- [ ] 相关 verify area 出口 0 — **推迟**：`scripts/verify/vcs-panel-buttons` 需要已开 VCS 块的实例，本轮起实例后 `hasTab=false blocks=0` 被中断

## Notes

- 镜像源：`frontend/app/view/vcs/vcs-changes-tab.tsx`（L197-220 `RemoteCommitRow`/`RemoteCommitList`，L415-429 Remote 折叠区）
- 已存在语汇：`vcs-branches-tab.tsx` L330-338 `↑ text-success / ↓ text-error`，本任务与之对齐。
- 原型另存：`design/prototypes/vcs/vcs-remote-sync-widget/`，落地后改状态为 ◐ → ●。
