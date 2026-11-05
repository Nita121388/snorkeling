# 实施清单

工作目录：`/Users/nita/Primary/projects/snorkeling-commontext`（分支 `feat/commontext-list-meta-sort`，
独立 worktree，主工作区 main 不受影响）。`node_modules` 已软链到主仓。

## 1. 数据层

- [x] `commontext-model.ts`：加 `CommonTextSortKey` / `DefaultCommonTextSortKey` / `sortCommonTextItemsBy`
      + `normalizeCommonTextSortKey`（拒绝脏值）
- [x] `sortCommonTextItems` 改为委托 `sortCommonTextItemsBy(items, "lastused-desc")`，行为逐位一致
- [x] `CommonTextComposeSearchOptions` 加 `sortKey`，`searchCommonTextComposeItems` 用它构建 `baseItems`
- [x] `recordCommonTextUse(id, opts?: { countUsage?: boolean })`

## 2. 偏好持久化

- [x] 新增 `commontext-sort-preference.ts`：`loadCommonTextSortKey()` / `saveCommonTextSortKey()`
- [x] localStorage 键 `commontext:sortKey`，异常静默

## 3. 弹窗

- [x] `ComposeState.sortKey`（打开时从偏好加载）+ `filteredItems` 传入 `sortKey`
- [x] 排序控件一行（搜索框下、chips 上）：5 个图标按钮 + 相关度/置顶提示，搜索态禁用
- [x] 排序变更后 `selectedIndex` 跟随 `detailId` 的新位置（函数式 setState，避免循环依赖）
- [x] 列表行右侧固定宽槽：元信息列 ⇄ hover 插入按钮，无布局抖动
- [x] 详情页脚元信息组（创建 / 更新 / 最近使用 / 次数）
- [x] 计数写入点：hover 插入、详情 Copy；新建改 `countUsage: false`

## 4. 测试

- [x] `commontext-model.test.ts`：`sortCommonTextItemsBy` 五种主键 + 置顶 + 并列回落 + 脏 key 归一化
- [x] `+` 浏览态 `sortKey` 生效 / 搜索态相关度压过 `sortKey`
- [x] `+` `recordCommonTextUse` 的 `countUsage:false` 只刷 `lastusedat`
- [x] `commontext-compose-modal.test.ts`：排序按钮 aria/title、元信息列、两处计数、新建不计数

## 5. 校验命令

```bash
cd /Users/nita/Primary/projects/snorkeling-commontext
npx vitest run frontend/app/commontext/
npx tsc --noEmit -p tsconfig.json | grep "commontext"   # 期望无输出（不新增错误）
```

## 6. 门禁

- [x] 全量 `npx vitest run frontend/app/commontext/` 全绿
- [x] `tsc` 不新增 commontext 相关错误（既有基线错误不算）
- [x] 真机验证：**skipped**（见下），原因与回补路径已写清
- [x] 更新 `design/prototypes/__REVIEW_GUIDE__.md` 该条状态（设计活跃 → 已落地）
- [x] 提交 + 写 Obsidian 开发记录

## 真机验证：skipped（有意，非静默省略）

- 本机是 macOS，`scripts/verify/lib/launch.mjs` 的清理路径（`findPidByPort` / `killPid`）**只实现了 Windows**
  （powershell `Get-NetTCPConnection` / `Stop-Process`）。在 macOS 上起实例后无法按端口→PID 收尾，
  会留下脱管 Electron 进程 —— 这比不跑更糟。
- 干净实例要跑 `scripts/dev-isolated.mjs`，包含 Go 后端 + vite 构建（首次 3~5 分钟），worktree 里没有
  `.tools` 固定工具链，成本与失败面都高。
- 本轮改用**机器可判定**的替代证据：`commontext-model.test.ts` 钉死排序/计数语义（含
  `sortCommonTextItems` 逐位不变、搜索态相关度压过 sortKey、置顶只作 tie-break），
  `commontext-compose-modal.test.ts` 钉死控件的 a11y 契约（aria-label / aria-disabled / tooltip 文案）
  与两个计数写入点。
- **回补路径**：给 `scripts/verify/lib/launch.mjs` 加 macOS 分支（`lsof -ti tcp:<port>` + `kill -9`），
  再照 `_template/verify.mjs` 建 `scripts/verify/commontext-meta-sort/`：CDP 里
  `dispatchEvent(new CustomEvent("snorkeling:common-text:open-search", {detail:{}}))` 打开弹窗，
  断言 `[data-commontext-sort]` 5 个按钮、`[data-commontext-meta]` 行高与 `[data-commontext-usage]`
  计数可见；种子数据需要在隔离 profile 的 `settings.json` 预写 `commontext:items`。
- 未覆盖的面：行高零位移的像素级证据、hover 淡出⇄插入按钮的视觉切换、tooltip 实际弹出。
