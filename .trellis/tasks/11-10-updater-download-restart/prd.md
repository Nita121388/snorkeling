# 应用内更新：下载后重启安装 + Stable/Beta 通道 + 解压安装支持

> 状态：**planning，暂停（用户明确「先记录到任务中暂时不开启任务」）**。不要 `task.py start`，不要改生产代码，等用户拍板后再进实现。

## Goal

修复「更新总是失败」并统一更新交互为「点击更新 → 后台下载 → 重启时才替换」，同时增加 Stable/Beta 通道选择，并明确各类解压安装形态的支持边界。

## 背景诊断（实机证据，见设计文档）

- 检查链路：每小时自动检查，实机日志 10-03~11-10 共 20+ 次 `updater error / net::ERR_TIMED_OUT`。
- 状态机 bug：`checking-for-update` 把状态改成 `checking`，`updatebanner.tsx` 无该分支 → banner 消失；offline error 直接 return 不恢复状态 → 永久卡在 checking。
- ad-hoc 签名：macOS 构建为 ad-hoc（`codesign` 实证），electron-updater/Squirrel 原地更新不可用 → 既有 `manualInstallOnly` 手动流程（下载→ditto 解包→swap）。
- 手动流程 5 个洞：下载无重试/无逐块超时；`.part` 续传被 `sweepStaleDownloadDirs()` 清掉（死代码）；staged 包在 `/tmp` 重启即丢；swap 脚本零日志；弹窗无父窗口。
- 历史 404（`latest-mac.yml` 缺失，0.0.95 时代）现已不存在。

## 需求

1. **交互**：banner 显示「更新」→ 点击后仅下载（进度、可取消、断点续传、失败重试）→ 就绪后 `Restart Now` / `Later`；替换只发生在重启（或「稍后」后的正常退出）。
2. **状态机**：自动检查期间 banner 不得消失；网络错误不得卡死状态。
3. **通道**：Stable / Beta 可选（About 弹窗选择器），Stable = 未勾 prerelease 的最新 release，Beta = 最新 prerelease；切换即重查；`latest` 旧值映射 stable。
4. **解压安装支持**：macOS zip 完整支持（主路径）；Windows .exe 保持原生；Windows zip / Linux 为「检测 + 引导下载」，静默替换为可选 P2 扩展。
5. **可诊断**：swap 脚本写日志；「Copy Update Debug Info」。

## 约束

- 不动 Developer ID 签名方案、不做 dmg/增量更新、不重做 UI、Windows/Linux 原生更新通道保持现状。
- 所有用户可见行为变化必须与原型 `design/prototypes/updater-flow/` 对齐。
- 按 loop 门链走：实现前先确认 G 门与 `touch` 白名单，判据必须可机器判定。

## 验收标准（待拍板后细化）

- [ ] `updatebanner` 单测：checking 期间 banner 不卸载；offline error 后 banner 保留。
- [ ] 自建检测器单测：不依赖 electron-updater 网络栈；超时/失败不影响 banner 展示态。
- [ ] 下载器单测：模拟中断 → 3 次退避重试内成功；**每次重试从原始 `browser_download_url` 重新解析签名 URL**；`.part` Range 续传生效；sweep 不删当前版本目录。
- [ ] **完整性**：下载完成按 GitHub asset `digest`（sha256）校验后才解包；不匹配判失败并保留可重试。
- [ ] 通道甄别单测：stable 不返回 prerelease；beta 只取 prerelease；版本比较按 `(major, minor, patch, beta, N)` 全元组（含 base 版本升级、序号重置场景）。
- [ ] swap 脚本快照测试 + 一次真机 0.0.125 → 0.0.126 演练（等价流程已于 2026-11-10 手工验证）。
- [ ] About 弹窗通道选择器组件测试。
- [ ] 端到端（需 feed override 钩子 `SNORKELING_UPDATE_FEED`）：打 dev 包装旧版 → 点更新 → Restart Now 得到新版。
- [ ] `skipped` 登记：Windows swap / Linux 真机项（本机 macOS）。

## 关联文档

- 设计方案：`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkeling/方案/2026-11-10-更新下载与重启后安装-设计方案.md`
- 交互原型：`design/prototypes/updater-flow/`（README + index.html，`?scene=` 直达）
- 既有需求：`My Projects/Snorkling/需求/调试信息入口与稳定性诊断需求.md`（TODO-50，用户反馈原话）
- 关键代码：`emain/updater.ts`、`emain/updater-installer.ts`、`emain/updater-asset.ts`、`frontend/app/tab/updatebanner.tsx`、`frontend/app/modals/about.tsx`

## 待用户拍板（阻塞实现）

1. 范围：按分批方案（见设计文档七·2：第一批半天 / 第二批 1 小时 / 第三批半天）还是只做第一批？
2. 镜像下载（`autoupdate:mirror`）做不做？
3. 「稍后」语义：**自评审推荐改为默认只在 Restart Now 时替换，install-on-quit 独立设置项默认关**，是否接受？
4. 通道甄别：GitHub prerelease 标记（推荐）还是双 feed yml？
5. Windows zip 解压：MVP 只做「检测+引导下载」够不够？
6. 原型交互是否已确认。

## 自评审记录（2026-11-10，待用户续审）

方案方向通过；开工前需合入 5 项修正（已写入设计文档「七、方案自评审」）：

1. 自建检测器提前并入 P0（检测不能继续走 electron-updater 网络栈，否则状态机修了也没用）。
2. 续传/重试必须每次重新解析 GitHub 签名下载 URL（实测重定向到 `release-assets.githubusercontent.com`，带 token 会过期；Range 206 可用）。
3. 完整性校验升级为 sha256 digest（实测 asset 带 `digest` 字段），不只比 size。
4. install-on-quit 降档为独立设置项默认关（托盘常驻导致「自然退出」不可靠）。
5. 通道版本比较按全元组 `(major, minor, patch, beta, N)`，避免上游 base 升级+序号重置时误判。
