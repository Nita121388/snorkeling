# Snorkeling 二次开发用户功能文档

更新时间：2026-05-29 13:12（GMT+8）
面向对象：Snorkeling 使用者
范围：基于官方 Wave `v0.14.5-beta.2` 之后，在 `refactor/snorkeling` 分支持续二次开发并发布到 `snorkeling-v0.14.5-beta.4-0.0.32` 的用户可见功能。
说明：本文只记录已经落地到当前代码分支的功能，不把仍停留在方案阶段的远程 Sessions、快捷键表格、多语言切换等内容写成已交付能力。

## 1. 产品定位变化

Snorkeling 仍然继承 Wave Terminal 的核心能力：终端、远程 SSH、文件预览、内置编辑器、AI 面板、可拖拽布局和持久化会话。

二次开发后的核心目标是让日常开发操作尽量在一个 Terminal 工作台内完成：

- 在终端、文件、版本管理、AI Agent 之间少切换窗口。
- 让 Agent 启动时自动带上正确的连接和目录上下文。
- 让本机 Codex、Claude Code 历史会话可浏览、标记、备注和恢复。
- 把文件浏览、编辑、复制上下文、查找替换、版本对比、提交和同步做成图形化工作流。
- 改善复制、粘贴、区块最小化、Tab 窗口拆分、更新安装等使用细节。

## 2. 品牌与应用隔离

### 2.1 Snorkeling 独立品牌

Snorkeling 已从 Wave 的默认品牌中分离出来，用户看到的是独立应用身份：

- 应用名称改为 Snorkeling。
- 图标替换为潜水面镜语义的 Snorkeling 图标。
- README、多语言说明、截图和关于页增加 Snorkeling 定制信息。
- 发布包、更新地址和 release tag 使用 Snorkeling 自己的 GitHub 仓库。

### 2.2 运行数据隔离

应用身份和运行路径做了隔离，减少与官方 Wave 或历史本地分支互相污染的风险：

- Snorkeling 使用自己的 app id。
- 本地配置、缓存、运行时路径按 Snorkeling 应用身份处理。
- 发布和自动更新指向 `Nita121388/snorkeling`。

## 3. Agent 工作流

### 3.1 右侧导航新增 Agent 入口

右侧快捷入口新增 `Agent`，放在 `Terminal` 与 `Files` 之间。用户不需要手动新建普通终端再输入 Agent 命令，可以直接从当前工作区启动 Agent。

### 3.2 智能继承终端上下文

点击 Agent 时，Snorkeling 会根据当前 Tab 里的上下文决定启动位置：

- 如果当前聚焦的是本地终端，就在本地终端当前目录启动 Agent。
- 如果当前聚焦的是远程 SSH 终端，就在同一远程连接和目录启动 Agent。
- 如果没有明确聚焦终端，会回退使用当前 Tab 中最近的终端上下文。
- 如果当前 Tab 有多个候选环境，会展示选择器，让用户选择要在哪个环境启动。

这解决的是“我正在某个项目目录工作，Agent 应该自动进入这个目录”的问题。

### 3.3 结合 Files 路径启动 Agent

Agent 启动不仅看终端，也会看 Files/Preview 当前路径：

- 当前聚焦 Files 文件时，Agent 默认使用该文件所在目录。
- 当前聚焦 Files 目录时，Agent 默认使用该目录。
- 如果 Files 路径和某个终端的连接、目录一致，Snorkeling 会自动命中对应终端环境。
- 如果 Files 和终端上下文不一致，启动选择器会列出候选路径，避免误启动到错误目录。
- 支持多个 Files 上下文，不只依赖最后一个终端。

### 3.4 Agent Profile 配置

Agent 启动命令不再硬编码为单一命令，而是支持 profile 配置：

- 默认 profile 是 `codex`。
- 内置支持 `codex`、`claude`、`gemini`、`opencode`。
- 可通过 `settings.json` 配置 `agent:defaultprofile` 和 `agent:profiles`。
- 每个 profile 可配置命令、固定参数、模型参数、环境变量。
- 如果配置缺失，会回退到内置默认 profile。

典型用途：

- 默认用 Codex。
- 某些机器上切换到 Claude Code。
- 为不同 Agent 固定模型名和环境变量。

### 3.5 Agent 会话自动续接

Snorkeling 会在 Agent 终端区块中记录 provider 和 session 信息，用于后续识别与恢复：

- 支持 Codex `resume` 会话解析。
- 支持 Claude `--resume`、`-r`、`--session-id` 解析。
- 可从启动命令、最后执行命令、持久化 meta 中识别 session id。
- Windows 命令提示符、PowerShell 提示符等输出格式也做了兼容。
- 新 Agent 区块默认带有自动续接标记。

### 3.6 Agent 调试与命令区块信息

Agent 相关区块增加了更多可见信息：

- 命令区块头部显示启动目录。
- 支持复制 Agent/session 调试信息。
- 对无 `wsh` 的 SSH 场景补充 Agent 命令运行兼容。
- 强化了 Codex 会话发现和 Windows resume 绑定。

## 4. AI Sessions 会话浏览

### 4.1 右侧导航新增 Sessions

右侧新增 `Sessions` 入口，用来浏览本机 AI 编程工具的历史会话。当前支持：

- Codex：读取 `~/.codex/sessions`。
- Claude Code：读取 `~/.claude/projects`。
- Claude Code cache：读取 `~/.cache/claude/projects`。

当前范围是本机会话文件。远程 SSH 主机上的 Sessions 浏览仍是后续扩展方向。

### 4.2 会话列表

Sessions 页面提供会话列表能力：

- 按最后更新时间排序。
- 支持 newest/oldest 切换。
- 支持 All、Codex、Claude Code 来源筛选。
- 支持按标题、备注、路径等字段搜索。
- 会话列表可手动刷新。
- 对长会话做索引缓存，避免每次打开都全量解析。

### 4.3 会话详情

选中会话后，可以在详情区查看对话内容：

- 用户消息与 AI 消息分角色展示。
- 时间精确到秒。
- 支持最近消息优先加载，避免超长会话一次性渲染卡顿。
- 支持继续加载更早消息。
- 支持长消息折叠/展开。
- 支持加载 tool calls 相关内容。
- 支持复制单条消息。

### 4.4 会话大纲

Sessions 可按用户消息生成大纲：

- 用用户提问形成 outline。
- 点击大纲可以跳转到对应消息位置。
- 适合快速回忆一次长会话里做过什么。

### 4.5 标记、备注与删除

Snorkeling 对会话增加了本机管理层：

- 支持 mark/unmark 标记重点会话。
- 支持只看 marked 会话。
- 支持给会话写 Note。
- Note 可参与搜索。
- 删除会话前有二次确认。
- 删除不会直接永久删除源文件，而是移动到 Snorkeling 的 deleted storage。

标记和备注保存在 Snorkeling 自己的 meta 文件中，不写入 Codex 或 Claude 的原始会话文件。

### 4.6 恢复会话

从 Sessions 详情可以恢复会话：

- Codex 会话会创建新的 terminal block 并尝试 resume。
- Claude 会话会创建新的 terminal block 并尝试 resume。
- 如果会话记录里有 project path，会使用该目录作为启动目录。
- 新启动的 Agent 区块会带上 provider 与 session id，方便后续继续识别。

### 4.7 打开会话所在目录与复制信息

Sessions 提供辅助操作：

- 打开 session 文件所在目录。
- 复制 session id。
- 复制 session folder path。
- 复制 resume command。
- 复制单条消息内容。

## 5. Session Overview 会话总览

### 5.1 工作区级会话总览

新增 Session Overview 面板，用于从工作区角度查看当前打开的 Agent/session 相关区块：

- 按 Tab 分组显示区块。
- 识别 Agent-like 区块。
- 显示区块标题、类型、所在 Tab、关联 session id。
- 支持跳转到对应 Tab 和区块。

### 5.2 会话摘要与实时刷新

总览面板会读取 session 文件状态并展示摘要：

- 显示最近可读消息预览。
- 检测 session 文件 mtime/size 变化。
- 文件变化时刷新总览摘要。
- 支持手动刷新。
- 会话备注更新后，总览也能同步响应。

### 5.3 总览中的管理操作

在总览里可以直接处理会话相关操作：

- 打开会话详情弹窗。
- 打开会话 Note 弹窗。
- 删除/关闭对应区块。
- 处理找不到 session 文件、解析失败等错误状态。

## 6. Files 文件工作流

### 6.1 Files Explorer 增强

Files 区块从普通目录预览扩展为更完整的文件工作台：

- 支持更强的目录树浏览。
- 文件夹排序改为自然排序，数字命名的目录更符合人的阅读顺序。
- 支持隐藏文件显示设置。
- 支持按名称、修改时间等排序。
- 支持新建文件、新建文件夹、重命名、删除。
- 删除目录时会提示递归删除确认。

### 6.2 文件复制与粘贴

Files 右键菜单和拖放流程增强：

- 支持复制单个或多个文件。
- 支持粘贴到当前目录或指定文件夹。
- 支持 Copy File Name。
- 支持 Copy Full File Name。
- 支持 Copy Relative Path。
- 支持 shell quoted 路径复制，方便粘贴到命令行。
- 拖放复制遇到冲突时提供覆盖/合并相关提示。

### 6.3 定向打开目标

Files 支持把文件/目录打开到指定方向或目标区块：

- 可在当前区块打开。
- 可向左、右、上、下打开。
- 可按目标区域打开，减少布局混乱。
- 打开路径时保留连接信息，本地和远程都可用。

### 6.4 从 Files 启动 Agent

Files 与 Agent 工作流打通：

- 右键文件或目录可以以当前路径作为 Agent 上下文。
- 文件路径会自动转换为所在目录。
- 远程 Files 会带上远程连接。

### 6.5 Open VS Code Here

本地连接的 Files 右键菜单支持 `Open VS Code Here`：

- 对本地目录可直接用 VS Code 打开。
- 适合在 Snorkeling 中定位路径后，临时切到外部 IDE 做复杂编辑。

## 7. 文件编辑与 Markdown 编辑

### 7.1 编辑器搜索与替换

内置编辑器增强了搜索体验：

- 支持编辑器内搜索。
- 支持上一条/下一条跳转。
- 支持大小写、整词、正则等搜索选项。
- 支持单个替换。
- 支持全部替换。
- 只读文件禁用替换，避免误操作。
- 搜索焦点和替换焦点稳定性做了修复。

### 7.2 Copy Context

编辑器和 Diff 视图支持复制上下文：

- 复制绝对路径。
- 复制行号。
- 复制选中的代码片段。
- 自动加上 Markdown 代码块。
- 适合把错误代码、文件位置、上下文片段直接发给 AI Agent。

示例格式：

```md
/path/to/file.ts:42
```typescript
selected code
```
```

### 7.3 选中文本搜索文件

编辑器选中文本后，可以把选择内容用于 Files 搜索：

- 支持解析 `file:line`、路径、代码引用等常见选择文本。
- 支持从当前文件/目录上下文搜索目标。
- 适合从报错文本或日志片段快速定位文件。

### 7.4 Markdown 有序列表辅助

Markdown 编辑增加了有序列表处理能力：

- 识别 Markdown 有序列表。
- 支持把当前列表项上移/下移。
- 移动后自动调整编号。
- 支持选区内重新编号。
- 移动时有视觉反馈，降低误操作风险。

## 8. 版本管理工作流

### 8.1 新增 VCS 区块

新增 `Version Control` 区块，支持在 Snorkeling 内查看和操作 Git/SVN 仓库：

- 自动扫描当前路径及父级/子级仓库。
- 支持 Git。
- 支持 SVN。
- 显示仓库名、类型、分支、改动数量、未跟踪数量、远端差异数量。
- 支持手动刷新。
- 支持本地连接和远程连接。

### 8.2 变更文件查看

VCS 区块把文件分组展示：

- Changes：已跟踪文件改动。
- Untracked：未跟踪文件。
- Remote：远端相关变更。
- 支持折叠/展开分组。
- 支持多选文件。
- 支持 Select All / Select None。

### 8.3 Diff 与文件历史

VCS 相关新增独立区块：

- `File Diff`：查看单文件工作区 diff 或历史 revision diff。
- `File History`：查看某个文件的历史提交。
- `Repo Commits`：查看整个仓库的提交列表。

能力包括：

- 从文件行直接打开 Diff。
- 从文件行直接打开 History。
- 从历史提交点击打开对应 Diff。
- Diff 支持 side-by-side 和 inline 模式。
- 对不能渲染成单文件视觉 diff 的内容，回退显示 raw patch。

### 8.4 仓库提交

VCS 区块支持图形化提交：

- 多选变更文件。
- 输入 commit message。
- 点击 Commit 提交。
- 成功后刷新仓库状态。
- 失败时展示错误详情。
- 默认提交信息为 `chore: update selected files`，用户可修改。

### 8.5 远端同步

VCS 区块支持常见同步动作：

- Git：Fetch、Pull、Push。
- SVN：Update。
- 显示 Git ahead/behind。
- 显示 Git incoming/outgoing commits。
- 显示 SVN remote files。
- 操作成功或失败都有提示。

### 8.6 仓库右键操作

仓库头部右键菜单支持：

- Copy Repository Path。
- Copy Repository URL。
- Open Remote Repository。
- Move/Copy block 相关布局菜单。

### 8.7 Files 右键集成 VCS

Files 中检测到 Git/SVN 仓库时，右键菜单会出现版本管理入口：

- View History。
- View Diff。
- View Repository Log。
- Open VCS Block。
- Pull 或 SVN Update。
- 解析失败时可 Copy Debug Info。

## 9. 终端与复制粘贴体验

### 9.1 选区复制浮层

在终端、预览、普通文本区域中选中文本后，会出现复制浮层：

- 点击即可复制选区。
- 支持终端选区复制。
- 支持文件预览选区复制。
- 复制按钮反馈更明确。
- 避免用户反复使用快捷键或右键菜单。

### 9.2 粘贴提示

复制后短时间内点击可编辑区域，会显示粘贴提示：

- 点击提示可把剪贴板内容插入当前输入点。
- 可关闭粘贴提示。
- xterm 的专用输入区不会显示额外提示，避免干扰终端粘贴。

### 9.3 浮动复制和粘贴快捷操作

应用级增加浮动 copy/paste quick actions：

- 选中文本时出现 Copy。
- 最近复制后进入可编辑控件时出现 Paste。
- 对普通输入框、textarea、contenteditable 生效。

## 10. 区块、Tab 与窗口布局

### 10.1 区块最小化

新增区块最小化与悬浮管理能力：

- 区块可最小化。
- 当前 Tab 右下角出现 minimized blocks 浮动按钮。
- 浮动按钮可拖动，位置按 Tab 记忆。
- 可预览最小化区块。
- 可恢复区块到布局中。
- 可删除最小化区块。

### 10.2 区块复制到其他 Tab

新增区块复制相关能力：

- 可把区块复制到指定 Tab。
- 可把区块复制到新 Tab。
- 复制后的区块保持原始 meta 和视图信息。

### 10.3 Move Tab to New Window

Tab 右键菜单新增窗口拆分操作：

- `Move Tab to New Window`：把当前 Tab 移到新窗口。
- `Move Tab Back`：把拆出去的 Tab 移回主窗口。
- 适合把某个项目或某个远程会话单独放到另一块屏幕。

### 10.4 回到 Tab 与布局细节修复

二次开发中还补充了若干布局体验：

- Files 打开后可更自然地回到相关 Tab。
- 定向打开和区块移动菜单结合。
- 修复部分布局和焦点状态下的异常行为。
- 终端 xterm 焦点恢复更稳定。

## 11. 更新、安装与发布体验

### 11.1 Snorkeling 专属 Release

项目增加了 Snorkeling 自己的发布流程：

- 使用 `snorkeling-v...` tag 发布。
- GitHub Actions 构建 macOS、Linux、Windows 包。
- release 包含 Snorkeling 专属 app metadata。
- 支持从 GitHub Releases 获取更新。

### 11.2 自动更新修复

更新流程做了多轮修复：

- 支持 semver release tags。
- 检查更新失败时显示错误。
- 包含 updater metadata。
- 从 tag 推导 app version。
- 改善更新后重启流程。
- 强化 macOS 更新兼容。
- 允许没有 macOS signing secrets 时继续发布未签名包。
- 串行化 release package task，降低 CI 并发打包冲突。

### 11.3 Launch at Login

应用菜单新增 `Launch at Login`：

- 可控制 Snorkeling 是否开机登录后自动启动。
- 适合把 Snorkeling 当作常驻开发工作台。

## 12. 远程与平台兼容

### 12.1 远程 VCS 与文件搜索

VCS、Files 搜索等能力走已有 remote RPC：

- 支持对远程连接执行 Git/SVN 状态扫描。
- 支持远程文件名搜索。
- 支持远程文件内容搜索相关能力。
- 操作超时和错误会返回到 UI 提示。

### 12.2 Windows 兼容

二次开发中特别处理了部分 Windows 场景：

- Windows 下 Agent resume session 绑定。
- Windows shell step 的 CI 修复。
- release npm install 在 Windows 上更稳定。
- 命令解析兼容 `.exe`、`.cmd`、`.bat`、`.ps1` 后缀。

## 13. 用户可见修复汇总

除新增功能外，二次开发还修复了多处用户可感知问题：

- Agent 没有终端上下文时回退到可用连接。
- Agent launch context 更准确匹配当前 Files 路径。
- Codex session discovery 更稳定。
- Agent command blocks 显示 cwd。
- 无 `wsh` SSH session 中 command block 可运行 Agent 命令。
- Files 查找替换焦点更稳定。
- Files 目录自然排序。
- 文件文本预览更稳。
- SVN folder history diff 可显示。
- VCS diff 视图格式更清晰。
- Copy button feedback 更明确。
- 终端 focus 恢复更可靠。
- 更新流程的错误提示、重启流程和 release metadata 更可靠。

## 14. 当前边界与未交付方向

以下内容已有方案或后续方向，但不应理解为当前已完整交付：

- Sessions 目前只浏览本机会话，不直接浏览 SSH 远程主机上的 Codex/Claude 会话。
- Agent profile 当前主要通过 `settings.json` 配置，还没有完整图形化 profile 管理页。
- 命令面板快捷键表格、多语言切换仍在方案文档中。
- Agent 物理状态灯仍是方案，不是当前正式功能。
- 特定笔记实时编辑与预览模式仍是方案。

## 15. 适合用户理解的一句话总结

Snorkeling 是在 Wave Terminal 基础上为 AI 编程工作流做的二次开发版：它把 Agent 启动、AI 会话管理、文件浏览编辑、复制上下文、Git/SVN 对比提交、区块布局和自动更新串到一个终端工作台里，让用户尽量少离开 Terminal。
