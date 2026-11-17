# Tab 右键「收起到更多」+ 激活/未读 Tab 置灰

> 回填任务：代码先落地（`f44ec0942`），后补任务与 loop 包。本文件记录已交付范围与待验收项。

## Goal

Tab 右键菜单新增「收起到更多」，并让不可收起的 Tab 置灰，避免"点了没反应"：

1. 菜单项存在；点击把该 `tabId` 交给 `collapseTabIds`（与「更多」下拉共用同一状态）。
2. **激活 Tab / 有未阅状态点的 Tab 置灰禁点** —— `isTabHiddenFromBar` 的优先级会让收起失效，允许点击等于点了没反应，所以显式 `enabled=false` 并带禁用说明。
3. 非激活且无未阅时保持可点；未传 `visibility` 的旧调用点保持向后兼容（可点）。

## 背景

「更多」下拉是溢出 Tab 的收纳器，而 `collapseTabIds` 是驱动它的单一状态。此前只能从下拉里移除或靠宽度自然溢出，
没有"把某个 Tab 主动收进去"的入口。另有一个语义陷阱：激活 Tab 本来就不在 bar 上（高优先级下必可见），
未阅点 Tab 也按规则常驻，两者被收起都会被 `isTabHiddenFromBar` 立刻"放回来"，所以必须置灰而不是静默无效。

## 交付范围（已在 `f44ec0942`）

| 文件 | 改动 |
|---|---|
| `frontend/app/tab/tabcontextmenu.ts` | 新增「收起到更多」菜单项 + `visibility` 置灰判定（+31 行） |
| `frontend/app/tab/vtabbar.tsx` | 横向 tab bar 右键接线（传 visibility） |
| `frontend/app/tab/tab.tsx` | 同源接线 |
| `frontend/app/tab/tabcontextmenu.test.ts` | 5 例契约测试（菜单项存在/点击交 id + 埋点/激活置灰/未阅置灰/向后兼容） |
| `frontend/i18n/locales/{en,zh}/tab.json` | 3 条文案 key |

## 验收判据

- [x] `npx vitest run frontend/app/tab/tabcontextmenu.test.ts` → 5/5 passed（当前树）
- [x] 红证：回退 `tabcontextmenu.ts` / `vtabbar.tsx` / `tab.tsx` 到 `f44ec0942^` 后同套测试 5 failed，
      存 `loop/red/N-1117-tab-collapse-to-more.txt`（2026-11-17 本机补造，红绿对偶成立）
- [ ] `npm run i18n:check` → 通过（新增 3 条 key 已双语入库）
- [ ] G7 人验收（真机）：右键非激活无未阅 Tab 出现「收起到更多」；点击后该 Tab 进「更多」列表；
      对激活 Tab / 有未阅点的 Tab 菜单项置灰且悬停有禁用说明

## 遗留

- 引擎侧（Windows）：本包需由引擎 `queue add` 入库并跑分诊；台账事件（pick/commit）本机不可写
  （`loop/INBOX.md` 已记）。真机台 `tab-hover-clip` / `vtab` 相关 area 与「更多」下拉共用 DOM，
  环境恢复后 G7 时一并走查。
