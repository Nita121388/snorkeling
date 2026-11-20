# Implement — 会话详情块绑定错位

## 白名单（touch 范围）

- `frontend/app/view/aisessions/aisessions.tsx`（R1 回落分流、R2 守卫接线、R3 渲染归属接线）
- `frontend/app/view/aisessions/session-detail.tsx`（仅当 R3 需要在面板内部加归属短路时）
- `frontend/app/view/aisessions/detail-binding.ts`（新增：纯函数）
- `frontend/app/view/aisessions/detail-binding.test.ts`（新增：红证）

## 顺序

1. [x] 采基线：`npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` 记下数字。
2. [x] 先写 `detail-binding.test.ts` 红证（对未实现的纯函数断言，跑一遍确认 FAIL ≥3）。
3. [x] 实现 `detail-binding.ts`：
   - `detailFallbackDecision({blockBound, loadByIdFailed, sessionNotFound, newChat})`
     → `"keep" | "newchat" | "first-session"`；绑定块**永远不返回** `first-session`。
   - `shouldCommitDetailLoad({loadSeq, latestSeq, selectedKey, targetKey})`。
   - `detailBelongsToSelection(detail, selectedKey)`。
4. [x] `aisessions.tsx` R1：`loadSessions` 收尾（628-663 区域）按 `detailFallbackDecision`
   分流；绑定块失败路径 `return`（保 selectedKey、保留 meta 绑定），错误交给 `errorAtom`。
5. [x] `aisessions.tsx` R2：`loadDetailById` 补 `++this.detailLoadSeq` + 提交前
   `shouldCommitDetailLoad` 校验（与 `loadDetail` 同款）。
6. [x] `aisessions.tsx` R3：`SessionDetailPane` 的 `detail` prop 在
   `!detailBelongsToSelection(...)` 时传 `null`（注意 isNewChat / liveTurn 路径不受影响）。
7. [x] A1-A3 本地判据全绿（vitest ×2 + tsc 基线）。
8. [~] A4/A5 真机 CDP **skipped**（用户 2026-11-20：本机性能不够，暂不做真机）：
   - 台子已写并登记：`scripts/verify/aisessions-detail-binding/verify.mjs`（双击非第一行 → 断言面板
     `data-detail-session-key` 逐字等于被点行）+ `scripts/verify/README.md` 登记行。
   - A5 端到端（伪造绑定 id）无 UI 入口，改由 `detailFallbackDecision` 纯单测机器判定。
9. [x] 验证台账：`node scripts/verify/index.mjs` 登记 + `docs/project/verify-ledger.md` 一行。

## 实测结果（2026-11-20）

| 判据 | 结果 |
|---|---|
| A1 detail-binding.test.ts | 14/14 passed（含修前规则红证对照） |
| A2 session-detail-block.test.ts | passed |
| A2' 全量 `frontend/app/view/aisessions` | 52 files / 818 tests passed |
| A3 tsc | 61 既有错误，本包三文件 0 新增 |
| A4 真机台 | skipped（用户明确本机性能不够）；脚本已备 |

## 验证命令

```bash
npx vitest run frontend/app/view/aisessions/detail-binding.test.ts
npx vitest run frontend/app/view/aisessions/session-detail-block.test.ts
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"
```

## 回滚点

- 第 4/5/6 步各自独立提交粒度，任何一步可单独 revert。
