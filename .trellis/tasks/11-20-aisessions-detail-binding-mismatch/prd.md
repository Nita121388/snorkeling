# 会话详情块绑定错位：打开的详情 ≠ 列表里选中的那一行

> 背景：用户 2026-11-20 反馈「AI Sessions detail 打开时还是容易和选中时的列表项不对应」，
> 并补充「Agent TUI Block 右键 Open Session Detail 也一样」。上一轮修的是后端按 id 精确
> 定位（`11-18-aisessions-resolve-exact-id`）与 origin/connection 传递
> （`11-18-aisessions-detail-scope-threading`），后端与 scope 都已收口，剩下的问题在
> **详情块挂载后的绑定解析**：两条入口（列表双击 / term 右键）最终都渲染同一个
> `AISessionsModel`（带 `aisessions:sessionid` 的块），解析失败时会静默改绑。

## 现象

1. 纯列表块双击第 N 行 → 新开的详情块显示**另一个会话**的正文（不是第 N 行）。
2. Agent TUI 块右键 `Open Session Detail` → 同样显示别的会话。
3. 一旦错位就**粘住**：后续 60s 自动刷新也不会纠正（因为 `selectedKey` 已落在列表里）。

## 根因（读码定位，均在 `frontend/app/view/aisessions/aisessions.tsx`）

- **C1 静默改绑列表第一行**（`loadSessions` 收尾，628-663）：绑定会话在 List 结果里找不到
  （block meta 尚未就绪 / `limit:200` 窗口外 / 扫描中途 / Detail 请求瞬时失败）时，兜底分支
  `firstSession = sortSessionsByTime(sessions)[0]` 把 `selectedKey` 改成列表第一条，随后
  2399 的 effect 自动 `loadDetail(第一条)`。绑定块因此显示无关会话，且因 `selectedKey`
  已在列表内，后续刷新永不重解绑定 → 粘死。
- **C2 `loadDetailById` 无守卫**（1476-1501）：`loadDetail`（1261-1287）有
  `detailLoadSeq` + `已选中还是不是我` 双守卫，`loadDetailById` 一个都没有。慢响应回来
  无条件 `set(selectedKeyAtom, 该会话)` + `commitDetail`，覆盖用户刚点的那一行。
- **C3 旧正文照常渲染**：`detail.summary.key ≠ 当前选中` 时 `SessionDetailPane` 仍渲染旧正文，
  `loading` 只在 `detail == null` 时显示 → 切换瞬间视觉上就是「详情和选中项不对应」。

`term-model.ts:1448-1451` 的 origin 漏传经复核**不构成根因**（Agent TUI 会话是活的
local/remote 会话，connection 已传，origin 只影响外部 dump），本包不改。

## Goal

1. 绑定会话（`aisessions:sessionid` 非空）的详情块：解析失败一律**保留绑定 + 报错/重试**，
   绝不自改绑到列表任意一行。
2. 所有 detail 写入点共用一个「最新响应才提交」守卫，旧响应不得覆盖新选中。
3. 详情面板只在 `detail` 属于当前选中会话时渲染正文，其余显示加载骨架。

## Requirements

- **R1** `loadSessions` 收尾的回落分支按「是否绑定」分流：未绑定块保留现有
  「自动选最新一行」；绑定块在 `loadDetailById` 失败后**不得**再执行
  `firstSession` 分支，也**不得**因此清掉 block meta 绑定（仅在明确 session-not-found
  时清绑并展示错误态，不自动切换）。
- **R2** 抽出纯函数 `shouldCommitDetailLoad({loadSeq, latestSeq, selectedKey, targetKey})`，
  `loadDetail` 与 `loadDetailById` 共用；`loadDetailById` 补 seq 递增与提交前校验。
- **R3** 抽出纯函数 `detailBelongsToSelection(detail, selectedKey)`（或等价判定），
  `aisessions.tsx` 传给 `SessionDetailPane` 的 `detail` 在归属不符时传 `null`（走骨架），
  避免旧正文冒充当前选中。
- **R4** 纯函数放 `frontend/app/view/aisessions/detail-binding.ts`，单测 `detail-binding.test.ts`
  覆盖 R1/R2/R3 三态；组件只做接线。

## 非目标

- 不改后端 `resolveSession` / `managerForScope` / List limit 策略。
- 不改 `term-model.ts` 右键入口的 origin（见根因说明）。
- 不改 newchat（`aisessions:newchat`）绑定窗口逻辑与 `promoteNewSession`。
- 不重做详情面板视觉，不加新 UI 组件。

## Acceptance Criteria（必须机器可判）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 红证：绑定块解析失败不得改绑首行；旧响应不得覆盖；归属不符不得渲染 | `npx vitest run frontend/app/view/aisessions/detail-binding.test.ts` → 修前 FAIL（≥3 条）→ 修后 passed |
| A2 | 详情块打开计划不回归 | `npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts` → passed |
| A3 | 类型不回退 | `npx tsc --noEmit -p tsconfig.json \| grep -c "error TS"` → ≤ implement 阶段先采的基线 |
| A4 | ~~真机~~ **skipped**：列表双击 N 行 → 详情面板 `data-detail-session-key` 与被点行 `data-session-key` 逐字相等（钩子已加，验证台已备） | `node scripts/verify/aisessions-detail-binding/verify.mjs`（用户 2026-11-20 明确本机性能不够，暂不跑真机） |
| A5 | 绑定 id 找不到时不得回落列表第一行（由纯函数机器判定，真机端到端 skipped：无 UI 入口构造伪造绑定） | `npx vitest run frontend/app/view/aisessions/detail-binding.test.ts` → `detailFallbackDecision` 三态 passed |

## 回滚

三处改动彼此独立：R1（收尾分流）/ R2（守卫）/ R3（渲染归属）各自可单独 revert；
R1 是唯一改行为的点，回滚后回到现状（粘死错绑）。
