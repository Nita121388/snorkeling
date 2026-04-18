<p align="center">
  <a href="https://github.com/Nita121388/snorkeling">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="./assets/snorkeling-icon.svg">
		<source media="(prefers-color-scheme: light)" srcset="./assets/snorkeling-icon.svg">
		<img alt="Snorkeling Logo" src="./assets/snorkeling-icon.svg" width="220">
	</picture>
  </a>
  <br/>
</p>

# Snorkeling（基于 Wave）

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

> 本文件为社区简体中文版本，最新英文内容请参阅 [README.md](README.md)。

## Snorkeling 定制开发重点

- 本仓库基于官方 `wavetermdev/waveterm` 持续定制维护，主开发分支为 `refactor/snorkeling`。
- Agent 工作流增强：
  - 在右侧导航新增独立 `Agent` 入口。
  - Agent 启动同时考虑终端上下文与当前聚焦的 Files 路径：
    - SSH/路径一致时自动命中并直接启动。
    - 上下文不一致时弹出选择器供用户选择。
  - 支持 Agent Profile 配置（`agent:defaultprofile`、`agent:profiles`）与会话自动续接。
- Files 工作流增强：
  - 支持定向打开目标（`🧭`、`←`、`→`、`↑`、`↓`），文件/目录可在目标区块打开。
  - 编辑器与 Diff 视图支持 `🪧 Copy Context`（绝对路径 + 行号 + 代码片段）。
  - Files 右键菜单支持 `Open VS Code Here`（本地连接）。
- 版本管理工作流增强：
  - 新增独立 `VCS`、`File History`、`File Diff` 区块。
  - 支持可视化 Diff（并排/内联）和从历史记录直接打开 Diff。
  - 支持仓库路径/链接复制与跳转远程仓库。
- 窗口与布局增强：
  - 支持 `Move Tab to New Window`（将当前 Tab 弹出到新窗口）。
- 品牌资源更新：
  - Snorkeling 图标采用 Twemoji 潜水面镜（`🤿`，`1f93f`），仓库源文件为 [`assets/snorkeling-icon.svg`](./assets/snorkeling-icon.svg)。

Wave 是一款开源、集成 AI 的终端应用，支持 macOS、Linux 和 Windows。它可与任意 AI 模型协作。你可以自行提供 OpenAI、Claude、Gemini 的 API Key，也可以通过 Ollama 与 LM Studio 运行本地模型，无需账号。

Wave 还支持持久化 SSH 会话：即使网络中断或应用重启，也能自动重连并恢复工作状态。你可以用内置图形编辑器直接编辑远程文件，并在终端内联预览文件内容。

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## 关键特性

- Wave AI：可读取终端输出、分析组件上下文并执行文件操作的上下文感知助手
- 持久化 SSH 会话：连接中断、网络切换、Wave 重启后自动重连并保留会话状态
- 灵活拖拽布局：自由编排终端块、编辑器、网页浏览器与 AI 助手
- 内置编辑器：支持远程文件编辑、语法高亮和现代编辑能力
- 丰富文件预览：支持 Markdown、图片、视频、PDF、CSV、目录等远程文件类型
- 块级全屏切换：任意块可快速全屏并一键回到多块布局
- 多模型 AI 聊天：支持 OpenAI、Claude、Azure、Perplexity、Ollama
- Command Blocks：按命令隔离与追踪输出
- 一键远程连接：完整访问远端终端与文件系统
- 本地安全密钥存储：使用系统原生后端保存 API Key 与凭据
- 高度自定义：标签页主题、终端样式、背景图片
- 强大的 `wsh` 命令系统：CLI 管理工作区并在会话间共享数据
- `wsh file` 文件互通：本地与远程 SSH 主机间复制和同步文件

## Wave AI

Wave AI 是具备工作区上下文感知能力的终端助手：

- **终端上下文**：读取终端输出与滚动缓冲，用于分析与调试
- **文件操作**：支持读写和编辑文件，带自动备份与用户确认
- **CLI 集成**：通过 `wsh ai` 在命令行中直接管道输出或附加文件
- **BYOK 支持**：支持 OpenAI、Claude、Gemini、Azure 等多家模型提供方
- **本地模型**：可使用 Ollama、LM Studio 及其他 OpenAI 兼容接口
- **免费 Beta**：体验优化期间提供 AI 额度
- **即将上线**：命令执行（需用户授权）

更多说明请参考 [Wave AI 文档](https://docs.waveterm.dev/waveai) 和 [Wave AI Modes 文档](https://docs.waveterm.dev/waveai-modes)。

## 安装

Wave Terminal 支持 macOS、Linux 和 Windows。

各平台安装说明见 [Getting Started](https://docs.waveterm.dev/gettingstarted)。

也可直接从下载页安装：[www.waveterm.dev/download](https://www.waveterm.dev/download)。

### 最低系统要求

Wave Terminal 支持：

- macOS 11 及以上（arm64、x64）
- Windows 10 1809 及以上（x64）
- 基于 glibc-2.28 及以上的 Linux（Debian 10、RHEL 8、Ubuntu 20.04 等）（arm64、x64）

WSH 辅助程序支持：

- macOS 11 及以上（arm64、x64）
- Windows 10 及以上（x64）
- Linux Kernel 2.6.32 及以上（x64），Linux Kernel 3.1 及以上（arm64）

## 路线图

Wave 持续演进中。每个版本的目标会更新在 [ROADMAP](./ROADMAP.md)。

欢迎加入 [Discord](https://discord.gg/XfvZ334gwU) 或提交 [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose) 提出建议。

## Snorkeling 项目文档

- 项目章程（中文）：[docs/project/snorkeling-project-charter.md](./docs/project/snorkeling-project-charter.md)
- 执行计划（中文）：[docs/project/snorkeling-execution-plan.md](./docs/project/snorkeling-execution-plan.md)
- Agent 配置（中文）：[docs/project/agent-config.md](./docs/project/agent-config.md)
- CI/CD 与发布（中文）：[docs/project/ci-cd-release.md](./docs/project/ci-cd-release.md)
- 上游同步手册（中文）：[docs/project/upstream-sync-playbook.md](./docs/project/upstream-sync-playbook.md)

## 链接

- 官网 &mdash; https://www.waveterm.dev
- 下载页 &mdash; https://www.waveterm.dev/download
- 文档 &mdash; https://docs.waveterm.dev
- X &mdash; https://x.com/wavetermdev
- Discord 社区 &mdash; https://discord.gg/XfvZ334gwU

## 从源码构建

请查看 [Building Wave Terminal](BUILD.md)。

## 贡献

Wave 使用 GitHub Issues 跟踪问题。

更多内容见 [贡献指南](CONTRIBUTING.md)，包括：

- [如何贡献](CONTRIBUTING.md#contributing-to-wave-terminal)
- [提交前须知](CONTRIBUTING.md#before-you-start)

### 赞助 Wave

如果 Wave Terminal 对你或你的团队有帮助，欢迎赞助项目开发和维护。

- https://github.com/sponsors/wavetermdev

## 许可证

Wave Terminal 基于 Apache-2.0 协议发布。依赖许可信息见 [ACKNOWLEDGEMENTS](./ACKNOWLEDGEMENTS.md)。
