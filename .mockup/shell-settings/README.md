# Shell Settings 原型(独立 HTML)

> 全局默认 Shell 切换方案的可视化原型,供评审交互细节用。

## 怎么打开

直接用浏览器开 `index.html`:

```
file:///E:/primary/projects/snorkeling-light-theme/.mockup/shell-settings/index.html
```

或在 repo 根:

```
start .mockup/shell-settings/index.html      # Windows
```

不需要 npm / Vite。原型是独立 HTML + CSS + JS,不依赖 React 工程,不会污染 frontend。

## 看什么

| 演示项 | 对应方案章节 |
|---|---|
| Settings sidebar 选中 Terminal + 标题 + 副标题 | 方案 §四「信息架构」 |
| Auto detect 项 + 推荐徽章 + 括号里展示 Auto 实际指向 | §七 ScanShells() 行为细则 5 |
| 扫描动画(0.7s 后填充) | §七 行为细则 1 |
| Discovered 分组列出 PowerShell 7.4 / 5.1 / cmd / Git Bash | §七 扫描清单 |
| WSL 1.5s 超时跳过 → 显示 skip-note | §七 行为细则 3、§十二 WSL 风险缓解 |
| Advanced → Custom path,选中后展开输入框 + Validate | §九 行为细则 3 |
| Validate 通过/失败 inline status | §九 行为细则 3 |
| Save → footer-status 反馈所选 shell | §六 核心交互流 |
| 6.5s 后弹 toast:Configured shell not found, fell back | §九 行为细则 2 fallback |

## 不演示

- **存量 block 回填**:已与用户确认不做。原型里也没有 "Apply to existing tabs"。
- **实际 ScanShells**:`MOCK_DISCOVERED` 是写死的 4 条,真实后端走 `pkg/util/shellutil/scanshells.go`(待实现)。
- **实际持久化**:Save 只是 footer-status 反馈,不写 waveobj。
- **跨平台差异**:原型只演示 Windows 视觉。
- **Claude session block**:是否吃这个默认 — 列为 spike,原型不涉及。

## 色板

直接复用 `frontend/app/theme.scss` 的 `[data-theme="light"]`:

| 原型 CSS 变量 | 取自 theme.scss |
|---|---|
| `--main-bg-color: #ebe5d9` | `--main-bg-color` |
| `--main-text-color: #4c3924` | `--main-text-color` |
| `--accent-color: #a76fca` | `--accent-color` |
| `--action-bg-color: #7c49a1` | `--accent-color-600`(light 主题的 action token) |
| `--border-color: #ded8ca` | `--border-color` |

## 关联

- 方案文档:[[My Projects/Snorkling/方案/架构与文档/全局默认Shell切换方案]]
- 后端起点:`pkg/util/shellutil/shellutil.go:88`(`DetectLocalShellPath`)
- 后端 block 创建:`pkg/blockcontroller/blockcontroller.go:280`
- memory:`wave-claude-session-env-injection`(spike 验证项)

## 下一步(原型评审通过后)

按方案 §十四 推进策略:

1. **C. spike**(~2h):验证 Claude session block 是否吃新默认 ↓
2. **B. 全做**(~1.8d):后端 `ScanShells` / `GetConfiguredShellPath` + Settings UI + 校验 + fallback toast

原型不是定稿,评审后调整,实现按最终方案为准。
