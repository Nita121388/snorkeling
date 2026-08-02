# Snorkeling 文档差距映射表（docs-gap-map）

> 事实源：`docs/project/snorkeling-user-facing-features.md`（约 535 行 / 15 章）。
> 本表把事实源每条功能能力映射到目标页面（en + zh-Hans），作为后续施工单。
> 状态含义：TODO=待新建；REWRITE=改写过时页；DONE=已适配页面；N/A=无需文档动作。

## 一、基线核对（git 提交 ↔ 事实源）

受限环境说明：无法运行 `git log`，改为直接读取 `.git/logs/HEAD` 的 commit 列表核对。当前
HEAD 为 `aa4aa28f4fed5583fb15c9ea8ecc516684b56466`（`docs(zh-Hans): translate image alt
text`）。以下为可据 commit message 直接对应的、与用户可见功能相关的最近提交（日期升序）：

| Commit（取自 .git/logs/HEAD） | 主题 | 事实源覆盖 |
| --- | --- | --- |
| `2179535` | agent-status tab unread-dot, commontext editor filter, theme/markdown polish | 部分：agent-status→§3.6/§5.3；markdown→§7.4。commontext filter 未见单列（不确定） |
| `e3dc139` | close-tab modal, multi-select preview tree, markdown inline-edit M2 | 部分：multi-select→§6.1；markdown→§7.4；close-tab→§10.4 |
| `5e7af5b` | fix:markdown 闪动问题 | §13 修复汇总 |
| `c2f8862` | agent-status ack + derived atom cache fix | §3.6 / §5.3 状态一致性 |
| `e712204` | session-overview row renderer ack fp | §5.2 总览刷新 |
| `071732b` | agent-status, note-directory persist, tooltip ref | §4.5 备注持久化；`note:dir` 配置键见 `config.mdx` 默认值，事实源 §14 未单独说明（不确定） |
| `0515259` | markdown sanitizer blank-spacer, scss, vcs styles | §7.4 / §8 视觉细节 |
| 更早（log 可见） | ccswitch 供应商隔离、aisessions、vcs、tab、theme、release tag `snorkeling-v...` | 均已覆盖于事实源 §3/§4/§8/§10/§11/§2 |

**结论**：最近功能提交（agent-status、session-overview、markdown、ccswitch、aisessions、
vcs、tab、theme、release）均已在事实源中体现；个别把内部实现细节（commontext editor
filter、`note:dir` 配置）只写进配置/修复，未在事实源单列功能章节。差异影响面小，属正常，
不阻塞文档施工。**需在批 2/批 3 的 Agent/Sessions 页面把 `settings.json` 相关键写明，但
不得臆造未在事实源确证的行为。**

---

## 二、功能 → 目标页面映射

### A. Agent 工作流（批 2 重点）
| 事实源章节 | 能力 | 目标 en 页 | 目标 zh-Hans 页 | 状态 |
| --- | --- | --- | --- | --- |
| §3.1 | 右侧导航 Agent 入口（Terminal 与 Files 之间） | `agent-workflow.mdx`（新建） | 对应 zh 页（新建） | TODO |
| §3.2 | 智能继承终端上下文（本地/远程/回退/选择器） | `agent-workflow.mdx` | 同上 | TODO |
| §3.3 | 结合 Files 路径启动 Agent、路径一致性、多重 Files 上下文 | `agent-workflow.mdx` | 同上 | TODO |
| §3.4 | `agent:defaultprofile` / `agent:profiles` 配置 | `agent-workflow.mdx`（含配置示例） | 同上 | TODO |
| §3.5 | Agent 会话自动续接（codex/claude resume、Windows 兼容） | `agent-workflow.mdx` | 同上 | TODO |
| §3.6 | Agent 命令区块信息 / 调试信息 | `agent-workflow.mdx` | 同上 | TODO |

### B. AI Sessions / Session Overview（批 2 重点）
| 事实源章节 | 能力 | 目标 en 页 | 目标 zh-Hans 页 | 状态 |
| --- | --- | --- | --- | --- |
| §4.1 | Sessions 入口、来源目录（`~/.codex/sessions` 等） | `ai-sessions.mdx`（新建） | 对应 zh 页（新建） | TODO |
| §4.2 | 会话列表：排序/筛选/搜索/刷新/索引缓存 | `ai-sessions.mdx` | 同上 | TODO |
| §4.3 | 会话详情：角色、时间、分页、折叠、tool calls、复制 | `ai-sessions.mdx` | 同上 | TODO |
| §4.4 | 会话大纲 | `ai-sessions.mdx` | 同上 | TODO |
| §4.5 | 标记/备注/删除二次确认/deleted storage | `ai-sessions.mdx` | 同上 | TODO |
| §4.6 | 恢复会话 | `ai-sessions.mdx` | 同上 | TODO |
| §4.7 | 打开目录、复制 session id/folder/resume command | `ai-sessions.mdx` | 同上 | TODO |
| §5 | Session Overview 面板（按 Tab 分组、摘要、管理操作） | `ai-sessions.mdx#session-overview` | 同上 | TODO |

### C. Version Control（批 2 重点）
| 事实源章节 | 能力 | 目标 en 页 | 目标 zh-Hans 页 | 状态 |
| --- | --- | --- | --- | --- |
| §8.1 | VCS 区块、仓库扫描、类型/分支/改动计数 | `version-control.mdx`（新建） | 对应 zh 页（新建） | TODO |
| §8.2 | 变更分组 Changes/Untracked/Remote、折叠、多选 | `version-control.mdx` | 同上 | TODO |
| §8.3 | File Diff / File History / Repo Commits | `version-control.mdx` | 同上 | TODO |
| §8.4 | 图形化提交（commit message、默认 `chore: update selected files`） | `version-control.mdx` | 同上 | TODO |
| §8.5 | Fetch/Pull/Push/SVN Update、ahead/behind | `version-control.mdx` | 同上 | TODO |
| §8.6 | 仓库右键：复制路径/URL、Open Remote | `version-control.mdx` | 同上 | TODO |
| §8.7 | Files 右键集成 VCS 入口 | `version-control.mdx` + `customization.mdx` | 同上 | TODO |
| §12.1 | 远程 VCS/文件搜索 | `version-control.mdx` | 同上 | TODO |

### D. 改写过时页（批 3）
| 事实源章节 | 能力 | 目标 en 页 | 目标 zh-Hans 页 | 状态 |
| --- | --- | --- | --- | --- |
| §10.1 | 区块最小化 + 浮动控制 | `tabs.mdx`（改写） | 对应 zh 页 | REWRITE |
| §10.2 | 区块复制到 Tab/新 Tab | `tabs.mdx` | 同上 | REWRITE |
| §10.3 | Move Tab to New Window / Back | `tabs.mdx` | 同上 | REWRITE |
| §10.4 | 回到 Tab、布局细节 | `tabs.mdx` | 同上 | REWRITE |
| §6 | Files 工作流增强（右键复制路径、VS Code Here、定向打开） | `customization.mdx`（改写） | 同上 | REWRITE |
| §7.1 | 编辑器搜索/替换 | `customization.mdx` 或已有编辑器页 | 同上 | REWRITE |
| §7.2 | Copy Context | `customization.mdx` | 同上 | REWRITE |
| §7.4 | Markdown 有序列表辅助 | `customization.mdx` | 同上 | REWRITE |
| §9 | 复制粘贴浮层、粘贴提示、浮动 copy/paste | `customization.mdx` + `tabs.mdx`、`workspaces.mdx` | 同上 | REWRITE |
| §3/§10 | 布局上下文保留、新增快捷键（核对旧的失效） | `workspaces.mdx`、`keybindings.mdx` | 同上 | REWRITE |

### E. 收口（批 4）
| 内容 | 目标 | 状态 |
| --- | --- | --- |
| 新核心页挂入卡片区 | `docs/docs/index.mdx` + zh 镜像 | TODO |
| 引用链接更新 | `index.mdx` | TODO |
| 维护说明 | `docs/README.md` | TODO |
| 根 README 三语对齐 | `README.md` / `README.zh-CN.md` / `README.zh-TW.md` | TODO |
| 双语构建验证 | `docs/`：`npm run build -- --locale en` / `--locale zh-Hans` | 待执行（需正常环境） |

---

## 三、不臆测清单（需确认项）

1. **快捷键具体按键**：`keybindings.mdx` 中的 Wave 默认快捷键哪些在 Snorkeling 仍有效、哪些被
   Agent/Sessions/VCS 新增或改动，事实源未给具体键值。批 3 只核对明显失效项，不对新增功能编造
   快捷键。→ 需确认（缺键值信息）。
2. **`agent:profiles` 具体 schema**：事实源说「可配置命令、固定参数、模型参数、环境变量」，但未
   给出 `settings.json` 的确切字段名（如 `command`/`args`/`model`/`env`）。批 2 只给配置键名与
   概念说明，不虚构字段结构。→ 需确认（缺字段 schema）。
3. **`note:dir` 配置键**：`config.mdx` 默认值里有 `note:dir: "~"`，事实源 §4.5/§14 未展开说明。
   Sessions 页面提及备注存储时只写「Snorkeling 自己的 meta 文件」，不展开 `note:dir` 行为。
   → 需确认。
4. **Release 版本号**：事实源写 `snorkeling-v0.14.5-beta.4-0.0.32`；git log 中版本号已到
   `0.0.68`。`releasenotes.mdx` 是否补 Snorkeling release 需确认最新 tag。→ 需确认（缺 release
   notes 素材来源，见下）。

## 四、releasenotes 处理建议（批 3/批 4）

`releasenotes.mdx` 全部为上游 Wave 历史。建议在文件顶部新增一段「Snorkeling release」说明，概述
二次开发版本节奏（`snorkeling-v...` tag）与 §11 更新机制，并保留上游历史作「上游 Wave 历史」参考。
具体 release 条目内容需以 `git tag` 与 GitHub Releases 为准，本环境无法读取 → 标注需确认，不打
造未经验证的版本条目。
