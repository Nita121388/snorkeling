# 更新流程（通道选择 / 下载后重启安装）— 交互原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/tab/updatebanner.tsx, frontend/app/tab/tabbar.tsx, frontend/app/modals/about.tsx, emain/updater.ts, emain/updater-installer.ts
> 最后同步：2026-11-10
> 对应方案：`My Projects/Snorkling/方案/2026-11-10-更新下载与重启后安装-设计方案.md`（Obsidian）

## 这是什么

把「点击更新 → 后台下载 → 重启时才替换」的交互画成可点的原型，用来拍板下面四件事：

1. **banner 状态机**：新版本可用 / 下载中（进度+取消）/ 就绪 / 错误（重试）四个可见态，**自动检查期间不许消失**。
2. **通道选择**：About 弹窗里 `Update Channel` 从只读文本升级为 Stable / Beta 选择器。
3. **重启语义**：就绪后点开的小弹窗 —— `Restart Now` 与 `Later（下次退出时自动应用）`。
4. **解压安装支持性**：不同安装形态（macOS zip / Windows zip / Windows 安装版 / Linux）各自能支持到哪一步。

## 镜像说明（原型 ≠ 设计稿）

- banner 的 DOM/类名/文案逐字段对齐 `updatebanner.tsx`（`flex items-center gap-1 px-2 mb-1 h-[22px] text-xs font-medium rounded-sm`、`bg-action text-actiontext`、`bg-error`、`WebkitAppRegion: no-drag`）。
- About 弹窗版式对齐 `about.tsx`（Logo → 标题 → 版本/通道两行 → 仓库按钮 → Debug Info 区）。
- 「新增点」在界面上用 `NEW` 标记，只在真实组件上做增量：通道选择器、就绪弹窗、支持性面板、Copy Update Debug Info 入口。
- 颜色用同名 CSS 变量近似（`--action` / `--actiontext` / `--error` / `--hoverbg` / `--bg`），不引用真实 SCSS。

## 打开方式

直接用浏览器打开 `index.html`（无构建、无依赖）。右侧「原型控制器」切换场景与暗/亮主题。

## 场景速查

| 场景 | 看什么 |
|---|---|
| `available` | banner 显示「Update」；自动检查开跑后 banner **仍在** |
| `downloading` | 「Downloading 82.4 MB / 208.8 MB (39%)」+ × 取消 |
| `ready` | 「Ready · restart to install」点击弹重启确认窗 |
| `error` | 「Update Error」点击重试（断点续传提示） |
| `channel` | About 弹窗内切换 Stable/Beta，banner 提示当前通道与可用版本 |
| `zipwindows` | Windows zip 解压安装：明确不支持自动替换，走「下载安装包」引导 |
| `debug` | 就绪后打开 Update Debug Info（状态机轨迹、staging 路径、最近错误） |
