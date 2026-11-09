> 同步状态：◐ 部分落地（代码已实现：`RemoteCommitRow`/`RemoteCommitList` + sync bar + `vcs-time.ts`；真机截图验证待做）
> 镜像源：frontend/app/view/vcs/vcs-changes-tab.tsx
> 最后同步：2026-11-09

# VCS · Remote 区美化（Upstream / Incoming / Outgoing）

> 状态：▲ 原型（未实现）。打开 `index.html` 直接看，深/浅色 + 同步态可切换。

---

## 一、目标

美化 VCS Changes 页里「Remote」折叠区：上游行 + Behind/Ahead 胶囊 + Incoming/Outgoing 提交列表。
当前实现在 `frontend/app/view/vcs/vcs-changes-tab.tsx`：

- 上游行 / 胶囊：L415-426（`Behind {behind}` / `Ahead {ahead}` 两个描边 pill）
- `RemoteCommitRow`：L197-205
- `RemoteCommitList`：L206-220

## 二、现状问题（有数字）

1. **标题被挤到 ~70px**：行内固定列 `hash 78px + author 120px + date 110px` 合计 308px，加 3 个 `gap-2`(24px) 后 332px；470px 面板减左右 padding 16px 只剩 ~404px → subject 可用 ≈ 72px，中文标题必然截断成 6~7 个字。
2. **胶囊无语义**：Behind/Ahead 走 `border-border` 中性色；而 `vcs-branches-tab.tsx` L330-338 已经用 `text-success ↑` / `text-error ↓` 表达方向，两个页面语汇不一致。
3. **零值噪音**：`Behind 0` 也画成同等份量的胶囊，与 `Ahead 3` 视觉权重相同。
4. **裸表格**：无表头、无 hover、行间只有同色 `border-b`，没有分组层次；ISO 时间戳 `2026-11-09T14:21:05+08:00` 占 110px 宽却几乎不可读。

## 三、两个方案

| | A（推荐）同步条 + 两行式行 | B 紧凑备选 单行 + 相对时间 |
|---|---|---|
| 行高 | ~40px（两行） | ~28px（单行，与现状同高） |
| 标题可用宽度 | ~440px（整宽） | ~300px（右侧留 author+time） |
| hash 可见 | 是，元信息行 | 否，仅 `title` |
| 改动量 | 中（`RemoteCommitRow` 重写 + 新增 sync bar） | 小（仅压缩列） |
| 适合 | 需要判断"这条是不是我刚提的" | 只看条数/方向 |

推荐 A：VCS 面板本身是窄侧栏，靠"横向省宽度"救不回标题；纵向多一行成本远低于横向抢宽度。

## 四、落地要点（若采纳 A）

- `RemoteCommitRow` → 两行 DOM：`.subject`（`truncate` + `title`）+ `.meta`（hash `font-mono` 10.5px · author · 相对时间）。
- 新增 `formatRelativeTime(dateIso)`：`<1m` → `just now`；`<60m` → `Nm`；`<24h` → `Nh`；`<7d` → `Nd`；否则 `MM-DD`。绝对时间放 `title`。
- 删除 `RemoteCommitRow` 里 `min-w-[78px] / min-w-[120px] / min-w-[110px]` 三处固定宽度。
- sync bar：`bg-surface-soft rounded-[7px] px-2.5 py-[7px]`，去掉 `border-border` 描边；`↑` 用 `text-success`、`↓` 用 `text-error`，0 值 `opacity-55`；两者皆 0 时显示 `✓ 已同步`。
- 分组标题：`text-[11px] font-semibold text-secondary` + 计数 chip(`bg-surface-soft`) + 右侧发丝线（`h-px bg-border/60`）。
- 桌面端验证：改完后走 `scripts/verify`（area 待定，可能是 vcs 相关），必须截图比对 470px 与 560px 两个宽度。

## 五、开放问题

1. 是否要「点击提交行 → 打开 commit diff / 复制 hash」？本原型 A 里画了 hover 才出现的 ⧉（P2，可先不做）。
2. Incoming 为 0 时是否保留分组标题（原型选择：整组隐藏，靠 `✓ 已同步` 兜底）。
3. 相对时间是否需要走 `11-02-datetime-format-config` 的格式配置（当前该任务仍在 planning）。
