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

## 真机验证：✅ 21/21（`scripts/verify/commontext-meta-sort/`）

第一版记的是 skipped，理由成立但不可接受 —— 验证环节的目标是**自证、不依赖人类**。所以本轮把这条路补上了：

1. **`scripts/verify/lib/launch.mjs` 跨平台化**（原实现只有 Windows）：
   - `findPidByPort`：win32 → powershell 不变；macOS / Linux → `lsof -ti tcp:<port> -sTCP:LISTEN`
   - `killPid`：win32 → `Stop-Process -Force`；其它平台 → `process.kill(pid, "SIGKILL")`
   - `ensureInstance` 新增 `profile` 参数：默认 profile 是各 area 共享的，`resetProfile` 会整个
     `rmSync` 掉它 —— 并行开发时两个 area 同时起实例会互相踩（既杀别人正在跑的实例，也抢
     Electron 的 SingletonLock）。新 area 一律用独立 profile + 独立端口。
2. **新 area `scripts/verify/commontext-meta-sort/`**（独立 profile `commontext-meta-sort`，
   CDP 9251 / Vite 51811），21 条断言全绿，跑完按端口→PID 自动收尾（已验证 9251 端口释放）：
   弹窗打开 → 用真实 UI 新建 3 条 → 默认「最近使用」为创建倒序（证明新建刷新 `lastusedat`
   但不计数）→ 新条目次数为 0 → 元信息列 28px 且行高 41px 由标题决定（**不顶高行**）→
   title-asc 重排 + 偏好落 localStorage → 搜索态 5 个排序键全部 `aria-disabled` + 相关度图标
   亮起 → 清空恢复 → 详情页脚 4 组元信息 → 行内 hover 插入使该条次数变 1 且文本真的进了 editor。
3. 有意未覆盖（写进 report 的 skipped）：hover 淡出⇄插入按钮的视觉切换（CDP 合成 hover 不解
   发 group-hover）、浏览器原生 tooltip 弹出层、跨弹窗生命周期的偏好恢复（写入已断言）。
4. 环境坑（已记）：worktree 里的 `npm:install` 会把 `node_modules` 从软链换成真实目录，且
   electron 的 dist 解压可能残缺（缺 `Frameworks/`、`path.txt`）—— 用 `.cache/electron/
   electron-v41.1.0-darwin-arm64.zip` 手工 `unzip` 到 `node_modules/electron/dist` 并补
   `path.txt` 即可。
