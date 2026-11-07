# Implement — 前端筛选 + Notion 详情 + emoji

## Checklist

- [ ] 1 `commontext-model.ts`：类型 + normalize（metadata 子任务已定接口）
- [ ] 2 列表行改 grid + 来源徽标（agent/human 两态）
- [ ] 3 筛选 chips：creator 三档 + device 下拉，计数与叠加逻辑
- [ ] 4 空结果分流文案 + 清除按钮
- [ ] 5 右栏重构：page icon / 大标题 inline 编辑 / 属性网格 / Preview-Edit
- [ ] 6 `commontext-emoji.ts`：emoji 存取 + recents 接入
- [ ] 7 emoji picker 接线（复用 block-editor 组件）
- [ ] 8 单测：normalize 兜底、筛选叠加、空结果分流、标题编辑提交/还原
- [ ] 9 验证台：新 area 或扩展现有 commontext area，断言迁移原型 8 条（行高全等 / 无溢出 / 属性值格式 / emoji 同步）
- [ ] 10 `verify-ledger.md` 结论 + 踩坑回写 `quality-guidelines.md`（若踩新坑）

## 验证命令

```bash
node scripts/run-task.mjs frontend:test -- --testPathPattern commontext
node scripts/verify/index.mjs
```

## 判据（G2）

1. 筛选叠加：creator=agent + device=work → 行数 = 数据集交集数
2. 行高全等：任意筛选下 8 行 `getBoundingClientRect().height` 单值
3. emoji 同步：picker 选 `🎯` 后，icon 槽 textContent === 列表行首列 textContent

## 回滚点

单 commit；右栏重构与筛选逻辑分两个 commit，便于单独回退。
