# 实现计划

## 落点（不碰 F-1122 在改的区域）

| 文件 | 改动 | 冲突风险 |
|---|---|---|
| `frontend/app/session-overview/overview-board-model.ts` | `BoardBuiltinPropKeys` += `emoji`；`BoardPropRow.hideName` 派生 | 无（F-1122 不改此文件） |
| `frontend/app/session-overview/overview-board.tsx` | meta 行 M4、属性行 `hideName`、卡面分组 | 无（F-1122 不改此文件） |
| `frontend/app/session-overview/overview-board-props.test.ts` | 新增 hideName / emoji 去重用例 | 无 |
| `frontend/app/session-overview/session-overview.scss` | 卡片块（1591+）：表面层、间距字号、meta 组、迷你标签 | F-1122 的 hunk 在 284（Tab 分组），提交时按 hunk 过滤 |
| `frontend/app/session-overview/session-overview.tsx` | `RowMetaChips` 接 `hideName`（约 3 行） | F-1122 最近的 hunk 在 1789，与本处分离 |
| `scripts/verify/overview-board/verify.mjs` | 新增卡面/meta 断言 | 无 |

## 顺序

1. `overview-board-model.ts`
   - `BoardBuiltinPropKeys` 加 `"emoji"`（注释：卡面头像已表达，属性行不重复）。
   - `BoardPropRow` 加 `hideName: boolean`，`resolveBoardPropRows` 内按类型赋值：
     `select / status / person / relation / multi_select → true`，其余 `false`。
2. `overview-board-props.test.ts`
   - emoji 属性被过滤；`status` 自定义属性仍保留（既有断言不回归）。
   - hideName：select/status/person/multi_select → true；text/number/checkbox/date/url → false。
3. `overview-board.tsx`
   - meta 行改三簇：状态 chip ｜ provider（`getAgentLogoByProvider` 品牌标 + 名称）｜ 项目（folder 图标 + 名称）｜ 标签（迷你方片，保留 `data-board-tag`）。
   - 属性行：`row.hideName` 时跳过 `.session-overview-board-card-prop-name`，`title` 保持 `name: value`。
4. `session-overview.tsx`：`RowMetaChips` 同样按 `row.hideName` 跳过名字。
5. `session-overview.scss`（卡片块）
   - `.session-overview-board-card`：`background: var(--surface-color)`、阴影 `--surface-shadow-color`、hover 抬升 + accent 描边；`padding: 13px`、`gap: 0` + 各段 `margin-bottom`（6/9/6/6），脚注 `margin-top: 11px`；`border-radius: 10px`。
   - 字号：title 13px；preview 11.5/1.55；note 10.5 + opacity .78；`.session-overview-board-card .session-metrics` 9.5px + opacity .85 + `padding-top: 9px`。
   - 新增 meta 组/品牌标/folder/迷你标签类；`avatar` 18→20。
6. `scripts/verify/overview-board/verify.mjs`：新增断言组（卡面/属性/meta）。

## 验证命令

```bash
npx vitest run overview-board
node scripts/verify/index.mjs --area overview-board
```

## 回滚点

全部改动可按文件回滚；视觉开关不需要（纯样式 + 派生字段，无持久化）。
