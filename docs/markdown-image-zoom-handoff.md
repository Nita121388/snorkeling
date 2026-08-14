# Markdown 图片放大功能 — 交接文档（给下一个 Agent）

> 本任务是"md 文件预览中图片支持放大查看 + 相关编辑体验"的续作。
> 上一轮已完成大部分实现（P0 图片操作 / P1 光标定位编辑 / P2 插入按钮），
> 但用户反馈两个 UI 问题需要**有视觉能力的 agent** 实际查看后修复：
> **1. 插入按钮（↑/↓）很丑；2. 图片显示问题不太对**（具体待确认）。

---

## 1. 当前状态

- **代码已 stash**（不是提交）：`git stash list` → `stash@{0}: On main: markdown image zoom + edit UI (P0-P2) - stashed for UI revision`
- stash 内容 = 8 个文件（都在 `frontend/app/element/`）：
  - 修改：`markdown.tsx`、`markdown-inline-edit.tsx`、`markdown-util.ts`、`markdown.scss`、`markdown-inline-edit.test.ts`
  - 新增：`image-lightbox.tsx`、`image-lightbox.scss`、`markdown-image-edit.test.ts`
- **恢复 stash**：`git stash pop`（或 `git stash apply stash@{0}` 保留备份）
- 恢复后应用里立即生效（vite HMR）。

### 与用户其他改动的关系（重要）
用户同时在开发**预览插件系统**（`frontend/app/view/preview/` 下的 `preview-plugin-registry.ts`、`plugins/base-view/`、`preview-model.tsx`、`preview.tsx` 改动）。
**这些与图片功能完全独立、零重叠**，不要动它们。图片功能全部在 `element/markdown*.tsx` 内部完成，不需要改 preview 层。

---

## 2. 已实现功能（stash 内）

| 功能 | 交互 |
|---|---|
| 图片放大（灯箱） | 单击图片 → 全屏灯箱；滚轮缩放 25%~400%、拖拽平移、双击切换 100%/适配、ESC/点遮罩/×关闭 |
| 图片右键菜单 | 放大查看 / 复制图片路径 / 修改路径（弹输入框预填）/ 删除图片（修改+删除仅可编辑预览显示） |
| 图片 URL 缓存 | `resolveRemoteFile` 模块级缓存，消除编辑/预览切换时的图片闪动 |
| 单击定位编辑 | 单击文本块 → 光标进入点击位置编辑（`caretRangeFromPoint`） |
| 插入按钮 | hover 块 → 块左缘出现 ↑/↓，点击在块前/后插入新块并编辑 |

### 已知限制（代码里有 `ponytail:` 注释）
- 图片"修改/删除路径"精确处理 `![alt](src)` / `![alt](src "title")`；`<img>` 标签、转义括号不精确匹配（菜单仍可用但不生效）
- 光标定位对含内联标记（`**`、链接）的行是近似位置

---

## 3. 用户反馈的两个问题（本次要修的重点）

1. **插入按钮（↑/↓）很丑** —— 当前实现：hover 块后块左缘内侧浮出两个小按钮（flex column、半透明深色底、translateY(-50%) 居中）。用户觉得难看。**建议**：参考 Typora/Notion 的块手柄风格，或用更简洁的单个按钮/分隔线样式。有视觉能力后先看截图再设计。
2. **图片显示问题不太对** —— 用户没细说。**需要**：
   - 打开一个带图片的 md 文件预览，实际看图片渲染效果
   - 重点检查：图片尺寸/对齐、灯箱打开后的缩放表现、图片模糊/拉伸/错位
   - 或者直接问用户具体现象

---

## 4. 如何运行应用 + CDP 探测（重点）

### 4.1 启动应用（dev 模式，带 CDP）
```bash
cd /Users/nita/Primary/projects/snorkeling
npm run setup          # 首次装工具链（如需要）
npm run dev            # 或项目 Taskfile 中的 dev 任务
```
应用启动后 CDP 端口默认 `9222`。验证：`curl http://127.0.0.1:9222/json/list`（列出所有窗口 target，如 "Wave Terminal - T1" / "T2"）。

### 4.2 内置 inspect 脚本（推荐优先用）
项目有 `scripts/inspect-electron-ui.mjs`（CDP 封装）：
```bash
node scripts/inspect-electron-ui.mjs state                      # 当前 target 概览
node scripts/inspect-electron-ui.mjs elements --limit 40        # 可见可交互元素+坐标
node scripts/inspect-electron-ui.mjs style "Common Text"        # 元素的几何+计算样式
node scripts/inspect-electron-ui.mjs click 1796 296             # 左键点击坐标
node scripts/inspect-electron-ui.mjs screenshot [path]          # 截图（视觉 agent 用这个！）
node scripts/inspect-electron-ui.mjs eval "<js>"                # 在页面执行 JS 并返回 JSON
```
多窗口时指定：`--target "Wave Terminal - T1"`。截图保存后**用 read 工具查看图片**（视觉 agent 的能力所在）。

### 4.3 打开一个带图片的 md 预览来测试
当前没有打开 md 预览时，需要先打开一个。方法：
- 在应用里用文件树/命令打开项目根目录的 md 文件（如 `README.md` 或临时造一个含 `![图](xxx.png)` 的文件）
- 或通过 CDP eval 动态渲染 Markdown 组件（见 4.5，适合无文件时快速验证组件交互）

### 4.4 检查 DOM / 样式（eval 常用片段）
```js
// 找渲染出的图片
document.querySelectorAll('.markdown-render-root img')

// 检查图片的 class/cursor/src
Array.from(document.querySelectorAll('.markdown-render-root img')).map(i =>
  ({ cls: i.className, cursor: getComputedStyle(i).cursor, src: i.getAttribute('src').slice(0,60) }))

// 检查插入按钮
document.querySelector('.markdown-insert-buttons')?.getBoundingClientRect()

// 检查灯箱
document.querySelector('.image-lightbox')
```

### 4.5 动态渲染 Markdown 组件（无文件时的组件级测试）
通过 vite 模块系统在页面里注入组件。**必须带 `?t=时间戳` 绕过 vite 模块缓存**（否则拿到旧编译）：
```js
await import('/frontend/app/element/markdown.tsx?t=' + Date.now())
```
完整渲染示例：
```js
// 用稳定引用存 commit 回调（重要！见 4.6-3）
window.__commit = (t)=>{ window.__commits.push(t); };
const React = (await import('/node_modules/.vite/deps/react.js')).default;
const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const { Markdown } = await import('/frontend/app/element/markdown.tsx?t=' + Date.now());
const host = document.createElement('div');
host.style.cssText = 'position:fixed;top:60px;left:0;width:700px;height:500px;background:#111;z-index:99999;overflow:auto;';
document.body.appendChild(host);
window.__root = ReactDOM.createRoot(host);
window.__root.render(React.createElement(Markdown, {
  text: '# t\n\n![one](/c-dark-detail.png)\n\n第二段\n',
  rehype: true,
  onInlineEditCommit: window.__commit,   // 必须稳定引用！
  resolveOpts: { baseDir: '/', connName: 'local', openLink: async()=>{} },
}));
// 等渲染：外部轮询 document.querySelector('#... .content') 是否出现，不要在页面内用 setTimeout 等太久
```

### 4.6 CDP 探测的坑（本任务实测踩过，务必读）

1. **`dispatchEvent` 合成事件 vs 真实鼠标事件**
   - `el.dispatchEvent(new MouseEvent('click', {bubbles:true}))` 能触发 React onClick（实测可行）
   - 但 **contextmenu 合成事件不触发 React onContextMenu**，必须用 CDP 真实右键：
     ```js
     await client.send("Input.dispatchMouseEvent", { type:"mousePressed", x, y, button:"right", clickCount:1 });
     await client.send("Input.dispatchMouseEvent", { type:"mouseReleased", x, y, button:"right", clickCount:1 });
     ```
   - mouseover 合成事件是否触发 React 视情况，尽量用真实 `Input.dispatchMouseEvent mouseMoved` 模拟 hover。

2. **`window.api.showContextMenu` 是只读属性**，赋值 mock 会**静默失败**（非 strict 模式）。
   要验证右键菜单内容，改为 **patch `ContextMenuModel` 实例方法**：
   ```js
   const { ContextMenuModel } = await import('/frontend/app/store/contextmenu.ts');
   const model = ContextMenuModel.getInstance();
   model.showContextMenu = function(menu, ev){ window.__menuCaptured = menu; };
   // 然后真实右键 → 读 window.__menuCaptured 的 label 列表
   ```

3. **`onInlineEditCommit` 必须传稳定引用**（`window.__commit = ...` 一次定义）。
   若传内联箭头 `()=>{}`，每次渲染新引用 → `useInlineEdit` 的 `resetKey` 变化 →
   **React 无限 re-render 卡死主线程**（页面假死、CDP 全部超时）。

4. **rAF 在 Electron 后台/遮挡窗口会暂停**。上一轮踩坑：插入按钮 measure 用 `requestAnimationFrame`，
   在窗口不可见时 rAF 永不执行 → 按钮不显示。**已改为 useEffect 同步调用**（不要改回 rAF）。
   同理，测试脚本里别依赖页面内 `setTimeout` 长时间等待（可能被节流），用外部轮询 DOM。

5. **CDP 连接要规范关闭**（`ws.close()`），否则连接泄漏 → 后续所有 inspect/eval 超时。
   脚本超时被杀时尤其容易泄漏；恢复办法：等 30s~1min 连接释放，或重启应用。

6. **多次 createRoot 到同一容器会污染**：每次动态渲染前先 `host.remove()` + 新建 host，
   结束测试后 `window.__root?.unmount?.()` + 清理注入的 DOM 和 portal（.image-lightbox 等）。

7. **hover 块会触发 ReactMarkdown 子树重渲染，块 DOM 节点会被替换**（缓存旧元素引用会 stale）。
   代码里已经用"存行号 + 按 `[data-source-line]` 重新查询"处理（不要改回缓存元素）。

### 4.7 验证链路（上一个 agent 已全部跑通）
- 单击图片 → `.image-lightbox` 出现 → ESC 消失
- 滚轮缩放 → `img` 的 `transform` matrix 变化
- 真实右键 → patch 后 `__menuCaptured` 含 4 项（放大/复制/修改/删除）
- 修改路径 → `.markdown-img-path-input input` 出现且预填当前路径 → 输入+Enter → commit 数组出现新文本
- 删除图片 → commit 文本里图片语法被移除
- 插入按钮 → hover 后 `.markdown-insert-buttons` 出现 → 点击 → `.inline-edit-overlay` 出现 → 输入+blur → commit 文本含新插入段落
- 单元测试：`npx vitest run frontend/app/element/markdown-image-edit.test.ts frontend/app/element/markdown-inline-edit.test.ts frontend/app/element/markdown.test.ts`（主目录 36 个用例，worktree 下的失败是其他分支旧代码，忽略）

---

## 5. 相关代码位置速查

| 文件 | 作用 |
|---|---|
| `frontend/app/element/markdown.tsx` | MarkdownImg（图片点击/右键/灯箱/路径输入框）、插入按钮 hover/measure、单击定位编辑 |
| `frontend/app/element/markdown-inline-edit.tsx` | beginEdit caretOffset、beginInsertEdit + insertMode commit、spliceInsertBlock |
| `frontend/app/element/markdown-util.ts` | resolveRemoteFile 缓存、图片语法 replace/remove 纯函数 |
| `frontend/app/element/image-lightbox.tsx/.scss` | 灯箱组件（缩放/拖拽/双击/ESC） |
| `frontend/app/element/markdown.scss` | `.markdown-img-clickable`、`.markdown-img-path-input`、`.markdown-insert-buttons`（按钮样式在这里改） |

### 修改建议入口（针对用户反馈）
- **按钮丑**：改 `markdown.scss` 的 `.markdown-insert-buttons` + `markdown.tsx` 里按钮 JSX（2164 行附近）。
  当前是"块左缘内侧浮两个小按钮"，可考虑更简洁的样式或交互。
- **图片显示问题**：先截图看实际效果再判断（可能是灯箱 fit 缩放、图片 max-width、对齐等问题）。

---

## 6. 完成标准
1. 按钮样式符合主流编辑器审美（Typora/Notion/语雀 风格），hover 显示、移开隐藏、不影响阅读
2. 图片在预览中显示正常（尺寸/对齐/清晰度），灯箱放大体验良好
3. 现有 36 个单元测试全过，tsc 无新增错误
4. 向用户确认后：提交（`git commit`）——注意和用户的插件系统改动**分开提交**
