# 技术设计（B：多列看板）

细节以父任务 `../11-05-overview-board-v2/design.md` §2.5 为准。

## 落点文件

| 文件 | 变更 |
|---|---|
| `frontend/app/session-overview/overview-board.tsx` | `includeEmpty: true`；列头色点改 `-column-dot`；空列占位节点 |
| `frontend/app/session-overview/session-overview.scss` | board 横向 snap 布局；删 container-query 堆叠分支；空列占位样式 |
| `frontend/app/session-overview/overview-board.test.ts` | `includeEmpty` 行为用例（已存在则补充空列顺序断言） |
| `scripts/verify/overview-board/verify.mjs` | 新断言：6 列 / 空列占位 / 窄宽横向滚动 / 宽屏单行（替换旧 container-query 断言） |

## 关键 CSS（目标态）

```scss
.session-overview-board {
    display: grid;
    height: 100%;
    grid-auto-flow: column;
    grid-auto-columns: minmax(220px, 1fr);
    grid-template-columns: none;
    grid-template-rows: minmax(0, 1fr);
    gap: 12px;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
}
```

## 验证脚本改动（断言语义变更，必须同步）

| 旧断言 | 新断言 |
|---|---|
| `board-columns-fixed-order`：1 ≤ 列数 ≤ 5 | `board-columns-all-six`：列数 === 5 |
| `wide-board-multi-column`：`gridTemplateColumns` 轨道数 > 1 | 删（`grid-auto-flow` 下恒为 `none`） |
| — | `narrow-board-horizontal-scroll`：`scrollWidth > clientWidth` 且 snap 含 `x` |
| — | `board-empty-column-placeholder`：至少 1 个 `.session-overview-board-empty` |
| `wide-board-single-row` | 保留（6 列 top 一致） |

## 风险与回滚

- 嵌套滚动：body / board（横向）/ column（纵向）三层；真机若出现「滚不动/滚错层」，
  把 board 改 `max-height: 100%` 并允许 body 纵向滚动。
- 极窄面板只剩一列可见属预期（snap 滑列），靠列头 + 露边保证「这是看板」的观感。
