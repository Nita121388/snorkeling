# 执行计划 — Sync 面板重排

## 步骤

1. **S1 原语** — 新建 `frontend/app/element/setting-card.tsx`（9 个原语）+ `setting-card.test.tsx`（渲染断言：组标题/行高属性/RadioCard 选中态与 flag/RadioRow/SaveBar 禁用/AdvancedSection 开合/SignalBars level→aria）。
2. **S2 Sync 渲染层** — 重写 `syncsettings.tsx` 的 `return`：lead → Transport(RadioCard 2×2) → Baseline → Backend(card) → Server status → This device → Status(pending) → Advanced → SaveBar。保留全部 `data-*`；`GroupHeader` / 旧 `Row` 组件删除，改引用原语。
3. **S3 判据自测** — J1/J2/J3/J4/J5（单元 + grep）。
4. **S4 真机验证** — `node scripts/verify/sync-diagnostics-copy/verify.mjs`（异步子进程跑，>60s）；补 1440/900/390 截图 + 溢出量测（J7）。
5. **S5 台账 + spec** — `docs/project/verify-ledger.md` 追加一行；`.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md` 补「设置面板行不留发丝线 / 原语位置」硬约束；`design/prototypes/settings-density/README.md` 的落地路线把 P1(部分)+P5 标记为已实现。
6. **S6 提交** — 一个 commit：`feat(waveconfig): Sync 设置面板按去密化提案重排 + Waiting to upload`。

## 校验命令

```bash
npx vitest run frontend/app/view/waveconfig/syncsettings.test.ts frontend/app/element/setting-card.test.tsx
npx tsc --noEmit 2>&1 | grep -c "waveconfig/syncsettings\|element/setting-card"
grep -c 'divide-y' frontend/app/view/waveconfig/syncsettings.tsx          # 期望 0
grep -c 'type="radio"' frontend/app/view/waveconfig/syncsettings.tsx      # 期望 0
node scripts/verify/sync-diagnostics-copy/verify.mjs                      # 期望 ≥20/20
```

## 回滚点

- 每个 S 结束后可停；S1 是纯新增（delete 文件即回滚），S2 单文件 revert 即回滚。

## 审查门

- S2 完成后自查：所有 9 个 `data-sync-*` 选择器仍在（`grep -o 'data-sync-[a-z-]*' | sort -u` 与改前对比）。
- S4 若台子 <20/20：先修选择器/命中，不调整断言。
