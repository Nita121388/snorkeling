# Design — CommonText 发送目标弹层紧凑化

## 1. 边界

| 层 | 文件 | 改什么 |
|---|---|---|
| 纯逻辑 | `frontend/app/commontext/commontext-send-target.ts` | 新增「按 Tab 收集目录候选」纯函数；`previewSendTarget` 增加可选的目录默认值入参 |
| UI | `frontend/app/commontext/commontext-send-button.tsx` | `SendTargetPanel` 重排：目标卡 + 三行常显 + footer；目录候选走新 atom；切 Tab 重置 folder |
| 文案 | `frontend/i18n/locales/{zh,en}/commontext.json` | 新增按键；停用冗余键 |
| 测试 | `commontext-send-target.test.ts`、`commontext-send-button` 相关 dom 测试 | 覆盖新纯函数与三行常显 |
| 验证台 | `scripts/verify/commontext-send-agent-block/verify.mjs` | 补「三行常显」「切 Tab 换候选」「高度 ≤320」断言 |

不动：`resolveSendTarget` 判定、`executeCommonTextSend` 执行链路、`pending-input`、`SplitButton`。

## 2. 目录候选按 Tab：数据流

```
config.tab ──► resolveFolderScopeTabId(tab, currentTabId) ──► tabId | null
tabId ──► globalStore(WOS tab) ──► collectAgentLaunchTargetsInTab(tab, getBlock, focusedBlockId, {localHomeDir})
        ──► AgentLaunchTarget[]（agent / files / terminal / home）
        ──► collectFolderCandidatesForTab({cwds, workspaceCwd, homeDir}) ──► FolderCandidate[]
```

### 新增纯函数（send-target.ts）

```ts
export type FolderCwdSource = "agent" | "files" | "terminal" | "home";

/** 目标 Tab 的 id：current → 当前 Tab；existing → 指定 Tab；new → null（不读任何块） */
export function resolveFolderScopeTabId(tab: SendTabSelection, currentTabId: string | null | undefined): string | null;

/** 按目标 Tab 打开的块收集 cwd 候选；去重（normalizeCwd）+ 顺序：Tab 内顺序 → 工作区 → home */
export function collectFolderCandidatesForTab(input: {
    cwds: { cwd: string | null | undefined; source: FolderCwdSource }[];
    workspaceCwd?: string | null;
    homeDir?: string | null;
}): FolderCandidate[];
```

- 复用 `normalizeCwd` / 现有去重口径，不改 `collectFolderCandidates`（现有单测保持绿）。
- `note` 由 i18n 决定：`noteTabAgent` / `noteTabFiles` / `noteTabTerminal` / `noteHome` / `noteWorkspace`。
- 空 Tab（新建 Tab）→ 只有 `workspaceCwd` + `homeDir`。

### atom（send-button.tsx）

```ts
export const sendFolderCandidatesAtom = atom<FolderCandidate[]>((get) => {
    const config = get(commontextSendConfigAtom);
    const currentTabId = get(atoms.staticTabId);
    const scopeTabId = resolveFolderScopeTabId(config.tab, currentTabId);
    const tab = scopeTabId == null ? null : get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", scopeTabId)));
    const focusedBlockId = getFocusedBlockId(); // 复用 layout 判定
    const targets = collectAgentLaunchTargetsInTab(tab, (id) => get(WOS...), focusedBlockId, { localHomeDir });
    return collectFolderCandidatesForTab({ cwds: targets.map(t => ({cwd: t.cwd, source: t.source})), workspaceCwd, homeDir });
});
```

### 默认目录 / 切 Tab 重置

- `previewSendTarget` 新增可选入参 `folderDefault?: string`；`folder = config.folder ?? folderDefault ?? defaultSendFolder(...)`。
  真实调用处传 `folderCandidates[0]?.path`。
- `config.folder == null` 表示「跟随所选 Tab 的推荐项」。
- Tab 选择回调里一律 `setConfig({ ...config, tab, folder: null })`（`current` / `existing` / `new` 三条路径 + `+` 按钮）。
- `resolveSendTarget` 不动：`current` + `folder` 未显式选时仍等价「跟随聚焦块」。

## 3. UI 结构（新）

```
┌ 选择目标                        [聚焦块✓] [新建] ┐
│ [logo] 聚焦块 · Codex            [已存在]          │
│        T6 · ~/Primary/projects/snorkeling         │
├───────────────────────────────────────────────────┤
│ Agent  [✳][◻][π][>_][✦]                           │
│ Tab    [▣ T6              当前 ▾]  [+]             │
│ 目录    [▸ ~/Primary/projects/snorkeling 自动 ▾] [⋯]│
├───────────────────────────────────────────────────┤
│ [switch] 后台执行              [取消] [发送到聚焦 Codex] │
└───────────────────────────────────────────────────┘
```

- 目标卡：`data-commontext-send-target-card`，状态徽标 9.5px。
- 三行行首 32px 标签：`Agent` / `Tab` / `目录`（en: `Agent` / `Tab` / `Folder`）。
- 行尾状态用 10px 纯文本（`当前` / `已存在` / `将创建` / `自动` / `已选`），不再用 pill 徽标。
- **不新增任何说明句**：删除 `二选一`、`默认 = …`、`目录候选来自…`、`不跳转 · 后台注入`、`目标 = …`。
- 主按钮：`发送到聚焦 {{target}}` / `新建 {{target}} 并发送`；`title` 保留完整落点，供 hover 补充。

### 交互细节

- 点击 Agent 图标 / Tab / 目录（非「跟随」项）时，若当前 `preview.kind === "existing"` 则同时 `mode: "create"`。
- 目录下拉首项「跟随该 Tab（自动）」→ `folder: null`；其余项 → 该路径。
- 目录下拉为空（新建 Tab 且无工作区 cwd）时显示单行 `noFolders`，不渲染空白菜单。

## 4. 兼容与回滚

- 无 store / schema 变更，无后端改动；`config` 结构不变（`folder: null` 语义扩展）。
- 回滚 = 单文件还原 `commontext-send-button.tsx`；`send-target.ts` 新函数为纯增量，可保留。
- i18n：新增键同时进 zh/en；旧键先保留（`summaryExisting` / `targetEquals` / `backgroundOn/off` 等）以避免其他引用断裂，
  本轮只停止使用，下一轮清理。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| `collectAgentLaunchTargetsInTab` 依赖 store，atom 里读会产生订阅膨胀 | atom 只订阅 `config` + `staticTabId` + tab 对象；块数据经 `get` 一次性读取 |
| 目标 Tab 已关闭 / tabId 失效 | `scopeTabId` 查不到 tab 时退化为「无块候选」，不抛错 |
| 目录候选过多（大 Tab） | 下拉沿用现有 `max-h-[280px] overflow-y-auto`；候选按块顺序，无需额外排序 |
| 删掉文案后用户不知道默认值 | 行尾状态文本（`当前` / `自动`）+ `title` tooltip 兜底 |
