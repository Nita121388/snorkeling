# 空 Tab 页「暂无 Block」样式 macOS 正常、Windows 不显示 — 根因与修复方案

> 调查完成：2026-08-16。状态：**等待用户确认 Windows 现象后定论**（未改任何代码）。

## 问题

macOS 上删除最后一个 block 后的空 Tab 页正确显示「暂无 Block」空态；Windows 上未正常显示（表现为空白/异常）。

## 根因分析（代码事实）

空 Tab 显示逻辑在 `frontend/app/tab/tabcontent.tsx:61`：

```tsx
} else if ((tabData?.blockids?.length ?? 0) === 0) {
    // 显示“暂无 Block”空态
} else {
    // TileLayout 渲染 block
}
```

- 渲染逻辑**平台无关**；唯一平台差异是快捷键文案（`⌘N` vs `Alt+N`），不影响显示。
- 2026-08-08 提交 `f47d7169` 修复过一个真实 bug（Git 历史实证）：
  - **后端**：删除 tab 中最后一个 block 时，`utilfn.RemoveElemFromSlice` 返回 `nil`，序列化为 `"blockids": null`。修复：新增 `removeBlockIdFromTab`（`pkg/wcore/block.go`）保持非 nil 空切片 → `[]`。
  - **前端**：旧判断 `tabData?.blockids?.length == 0` 对 `null` 失效（`null.length == 0` 为 `false`），走 TileLayout 渲染空白。修复：`length ?? 0` 兜底。
- 新建空 tab 后端初始化为 `BlockIds: []string{}`（`pkg/wcore/workspace.go` `createTabObj`），数据正常。
- TileLayout / layoutModel 用 `tab.blockids || []` 安全处理，null 数据**不会崩溃、只渲染空白**（`frontend/layout/lib/layoutModel.ts:442,474`）。
- Font Awesome 图标为本地打包（`public/fontawesome/`，woff2 已确认存在于 `dist/frontend`，构建产物两平台一致）→ 字体/样式加载差异基本排除。
- 数据存储：SQLite `~/.waveterm/db/waveterm.db`（Windows 同构），表 `db_tab` 的 `data` 字段为 JSON。

## 原因分诊（用户回来后 10 秒确认）

| 现象 | 结论 |
|---|---|
| a. 完全空白 | 数据问题：tab.blockids 为 `null`（旧 bug 残留）或含幽灵 blockId |
| b. “Tab Not Found” / “Tab Loading” | 数据同步/加载问题（另查） |
| c. 有「暂无 Block」但图标方块/不居中 | 渲染/字体问题（概率极低，基本排除） |
| d. 显示旧文案「按 Ctrl+` 新建」 | Windows 前端是旧构建 |

补充信息：Windows 上跑的是源码（npm run）还是安装包？构建/安装时间？

## 修复方案（等用户同意后落地）

### 方案 1（首选，纯数据/环境，不写代码）

1. Windows 更新到最新 main 构建（包含 `f47d7169` 前后端修复）。
2. 修复残留 null 数据（Windows 上 SQLite）：

```sql
UPDATE db_tab
SET data = json_set(data, '$.blockids', json('[]'))
WHERE json_extract(data, '$.blockids') IS NULL;
```

   或直接删除异常 tab 重建。

### 方案 2（可选代码加固，根治数据问题）

- **前端**：空态判断已兜底 null（`?? 0`）；若确认幽灵 blockId 场景，在进入 TileLayout 前对 blockids 做真实存在性过滤。
- **后端**：加载/处理 tab 时自愈 `null` 与幽灵 blockId（例如 upsert 时规范化 `BlockIds`）。
- 补一个前端/后端最小测试（对 `removeBlockIdFromTab` 已有测试；可补 Tab 加载自愈测试）。

## 待办

- [ ] 用户确认 Windows 现象（a/b/c/d）与构建来源
- [ ] 按分诊结果定论
- [ ] 获同意后实施方案（默认方案 1，视分诊结果决定是否加方案 2）